# Diseño — ordenes: carga masiva (endpoint) (feature 15)

## Enfoque general

La feature es un **Route Handler** (`app/api/ordenes/carga-masiva/route.ts`), no
una Server Action. Justificación: el consumidor es el componente genérico
`BulkUpload` (feature 9), que hace `fetch(endpoint, { method: "POST", body: FormData })`
con el archivo bajo el campo `file`. `docs/architecture.md` prescribe Route Handler
para "API pública / entrada externa con archivo"; un upload multipart de archivo,
parseable en streaming, no es idiomático para Server Actions invocadas desde un
componente que solo conoce una URL. El handler es la capa Controller: lee sesión,
resuelve actor, valida el archivo en el borde, delega en el service y traduce el
resultado a HTTP.

Capas (patrón feature 6, Controller → Service → Repository):

```
app/api/ordenes/carga-masiva/route.ts        Controller HTTP: sesión, actor, multipart, límites, appErrorToResponse
lib/services/BulkOrdenService.ts             Orquesta: autorización, resolución geo/mensajero/tienda, dedup, batch
lib/repositories/OrdenRepository.ts (ext)    + métodos batch: existentes por remisión, resolución geo/mensajero, createMany
lib/parsers/spreadsheet.ts                   Parseo CSV/XLSX -> filas normalizadas (borde tipado)
lib/types/carga-masiva.ts                    Schemas zod de fila + tipos de resultado (RowResult, BulkSummary)
lib/config/carga-masiva.ts                   MAX_FILE_BYTES, MAX_ROWS, BATCH_SIZE, DEFAULT_ESTATUS_VALUE (env override)
lib/interfaces/services/IBulkOrdenService.ts
lib/interfaces/repositories/IOrdenRepository.ts (ext)
```

Se reutiliza `resolveActorFromSession` (hoy en `lib/actions/ordenes.ts`): se
extrae a un helper compartido (`lib/auth/resolve-actor.ts`) para consumirlo tanto
desde la Server Action existente como desde el nuevo Route Handler, sin duplicar
la lectura de cookie/sesión.

## Modelo de datos (Prisma)

Cambios en `model Orden` (snake_case vía `@map`):

```prisma
model Orden {
  // ...campos actuales...
  peso                Decimal? @db.Decimal(10, 3)          // pasa a nullable (R4)
  direccion           String?                              // nuevo (R1)
  montoCobrar         Decimal? @db.Decimal(12, 2) @map("monto_cobrar")   // nuevo (R1)
  mensajeroSugeridoId String?  @map("mensajero_sugerido_id")             // nuevo (R1/R2)

  mensajeroSugerido   Usuario? @relation("OrdenMensajeroSugerido", fields: [mensajeroSugeridoId], references: [id])

  @@index([mensajeroSugeridoId])   // R2
}
```

En `model Usuario` se añade el back-relation:
`ordenesMensajeria Orden[] @relation("OrdenMensajeroSugerido")`.

`num_remision` YA es `@unique` (índice `orden_num_remision_key`): sirve como base
de la deduplicación (R25) y del `skipDuplicates` del `createMany` (R27). No se crea
índice nuevo para dedup.

### Migración `db/migrations/<ts>_carga_masiva_ordenes/`

`migration.sql` (UP):
- `ALTER TABLE "orden" ALTER COLUMN "peso" DROP NOT NULL;`  *(R4)*
- `ALTER TABLE "orden" ADD COLUMN "direccion" TEXT;`
- `ALTER TABLE "orden" ADD COLUMN "monto_cobrar" DECIMAL(12,2);`
- `ALTER TABLE "orden" ADD COLUMN "mensajero_sugerido_id" TEXT;`
- `CREATE INDEX "orden_mensajero_sugerido_id_idx" ON "orden"("mensajero_sugerido_id");`
- `ALTER TABLE "orden" ADD CONSTRAINT "orden_mensajero_sugerido_id_fkey" FOREIGN KEY ("mensajero_sugerido_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;`
- `INSERT INTO "order_status" ("id","value") VALUES (gen_random_uuid()::text,'en_preparacion') ON CONFLICT ("value") DO NOTHING;`  *(R6)*
- `orden` conserva RLS ya habilitada; no se añaden policies (acceso service role). *(R3)*

`down.sql` (DOWN, orden inverso, sin tocar lo preexistente):
- `ALTER TABLE "orden" DROP CONSTRAINT IF EXISTS "orden_mensajero_sugerido_id_fkey";`
- `DROP INDEX IF EXISTS "orden_mensajero_sugerido_id_idx";`
- `ALTER TABLE "orden" DROP COLUMN IF EXISTS "mensajero_sugerido_id";`
- `ALTER TABLE "orden" DROP COLUMN IF EXISTS "monto_cobrar";`
- `ALTER TABLE "orden" DROP COLUMN IF EXISTS "direccion";`
- `DELETE FROM "order_status" WHERE "value" = 'en_preparacion' AND NOT EXISTS (SELECT 1 FROM "orden" o JOIN "order_status" s ON o."estatus_id"=s."id" WHERE s."value"='en_preparacion');`  *(R6: solo si no referenciado)*
- Reponer NOT NULL de `peso` es destructivo si hubo filas sin peso; el `down.sql`
  intenta `ALTER COLUMN "peso" SET NOT NULL` envuelto en aviso (falla explícita si
  existen nulos, para no corromper). *(coherente con la reversibilidad de R4)*

## Estatus y default

- `ORDER_STATUS_SEED` (`lib/types/order-status.ts`) suma `"en_preparacion"` como
  8º valor (R5). `seedOrderStatus` ya itera esa lista con upsert idempotente: sin
  cambios de código en el seed.
- Default **global** (decisión humana 2026-07-10): `ordenesConfig.DEFAULT_ESTATUS_VALUE`
  cambia de `en_bodega` a `en_preparacion`. Como el service resuelve el estatus por
  `value` (no hay default a nivel DB en `orden.estatus_id`), el cambio es solo de
  config, y afecta al CRUD de feature 6 y a la carga masiva por igual. **Impacto en
  feature 6:** el test de creación que hoy afirma `en_bodega` DEBE actualizarse a
  `en_preparacion` (ver tasks T7). `BulkOrdenService` lee el mismo default de config,
  sin constante propia divergente.

## Parseo: librería elegida

**Elegida: `exceljs`** (nueva dependencia de runtime, `pnpm add exceljs`). Hoy
`package.json` NO trae ningún parser de CSV/XLSX, así que una dependencia nueva es
inevitable para cumplir "CSV **o** XLSX".

Razones:
- Cubre **ambos** formatos con una sola dependencia: XLSX vía streaming
  `WorkbookReader` (`exceljs.stream.xlsx.WorkbookReader`) y CSV vía `workbook.csv.read`.
- El `WorkbookReader` procesa XLSX **fila por fila en streaming**, clave para el
  requisito de alto volumen (R27/R28) sin cargar todo el árbol XML en memoria.
- Pure-JS, sin bindings nativos: instala y corre en el runtime Node de Vercel.

`lib/parsers/spreadsheet.ts` expone `parseSpreadsheet(buffer, ext): AsyncIterable<RawRow>`
que normaliza cabeceras (lowercase + trim, R16) y emite objetos `{ [col]: string }`
por fila, agnóstico del formato. El límite de tamaño (R28) se aplica ANTES de
parsear leyendo `file.size`; el límite de filas se aplica durante la iteración.

### Alternativa descartada

- **SheetJS `xlsx`** (+ CSV nativo): descartada. El build publicado en el registro
  npm de `xlsx` está desactualizado y arrastra CVEs históricas (prototype
  pollution / ReDoS); SheetJS movió su distribución soportada FUERA del npm público,
  lo que complica `pnpm install`, el lockfile y las auditorías. Además exigiría un
  segundo camino (parser CSV aparte), duplicando superficie de mantenimiento.
- **`papaparse` (CSV) + `exceljs` (XLSX)**: descartada por añadir DOS dependencias
  cuando `exceljs` ya resuelve CSV aceptablemente dentro de los límites de tamaño
  fijados (R28). Se prefiere minimizar el número de dependencias nuevas.

## Estrategia de alto volumen (batch)

1. **Guardas de borde** (R28): `file.size ≤ MAX_FILE_BYTES` y conteo de filas
   ≤ `MAX_ROWS` (se corta la iteración y se rechaza si se excede).
2. **Parseo streaming** fila a fila → normalización + validación zod por fila
   (`filaCargaSchema`, R18/R23).
3. **Pre-cargas en bloque** para no consultar por fila (R19/R22/R25):
   - `findExistingRemisiones(numRemisiones[])` → set de remisiones ya en DB.
   - Resolución geográfica: se cargan los catálogos geográficos referenciados por
     los nombres distintos del archivo (`findProvinciasByNombres`,
     `findCantonesByProvincia`, `findDistritosByCanton`) y se arma un índice en
     memoria para resolver jerárquicamente (R19/R21).
   - `findMensajerosByIds(ids[])` → validación de mensajeros (R22).
4. **Partición** de filas en `creadas` / `duplicadas` (R25/R26, dedup intra-archivo
   por primera ocurrencia) / `error`.
5. **Persistencia** de las válidas con `prisma.orden.createMany({ data, skipDuplicates: true })`
   en chunks de `BATCH_SIZE` (R27). `skipDuplicates` tolera carreras de
   `num_remision`. `createMany` no devuelve filas: el resumen se arma con lo
   calculado en (4).
6. **Resumen** `BulkSummary` (R30) devuelto al Controller.

Semántica: **éxito parcial** (R29). No se envuelve todo el archivo en una única
transacción (bloquearía y no daría reporte por fila); cada chunk es una operación
independiente.

## Contrato del endpoint

`POST /api/ordenes/carga-masiva` · `Content-Type: multipart/form-data`

Entrada (FormData): `file` (csv/xlsx, requerido). **No hay campo `tiendaId`:** el
endpoint solo lo usa el rol `adminTienda` y `tienda_id = actor.usuarioId` siempre.

Salida OK (HTTP 200):
```jsonc
{
  "total": 120,
  "creadas": 110,
  "duplicadas": 7,
  "conError": 3,
  "filas": [
    { "fila": 1, "numRemision": "R-001", "resultado": "creada", "estatus": "en_preparacion" },
    { "fila": 2, "numRemision": "R-002", "resultado": "duplicada", "estatus": "en_bodega" },
    { "fila": 3, "numRemision": "R-003", "resultado": "error",
      "errores": { "canton": ["cantón no encontrado en la provincia"] } }
  ]
}
```

Salida de error estructural (R31): `AppErrorShape` de feature 10 vía
`appErrorToResponse` — `UNAUTHORIZED` 401 (R10), `FORBIDDEN` 403 (R11),
`VALIDATION_ERROR` 422 (R12/R13/R16/R17/R28), `INTERNAL` 500 (fallo inesperado,
capturado por `withErrorHandler`).

Autorización (R11): ÚNICAMENTE el rol `adminTienda` puede usar este endpoint, y
crea siempre para su propia tienda (`tienda_id = actor.usuarioId`, R24). Cualquier
otro rol (`maestro`, `admin`, `mensajero`, desconocido) → `FORBIDDEN`. La carga
masiva para `maestro`/`admin` es una feature futura fuera de alcance.

### Tipos (`lib/types/carga-masiva.ts`)

```ts
type RowResultado = "creada" | "duplicada" | "error";
interface RowResult {
  fila: number; numRemision: string; resultado: RowResultado;
  estatus?: string; errores?: Record<string, string[]>;
}
interface BulkSummary {
  total: number; creadas: number; duplicadas: number; conError: number;
  filas: RowResult[];
}
```

`filaCargaSchema` (zod) valida/normaliza una fila cruda: obligatorios no vacíos
(R18), `monto_cobrar` numérico ≥ 0 o vacío→null (R23), `mensajero_sugerido_id`
string o vacío→null (R22).

## Notas de seguridad / consistencia

- El resumen no expone `deleted_at`, `password_hash` ni PII interna (R32); el
  estatus duplicado se resuelve incluyendo solo `estatus.value`.
- RLS de `orden` intacta; todo acceso es server-side vía Prisma service role (R3).
- `withErrorHandler` envuelve el cuerpo del handler para normalizar cualquier
  excepción a `AppErrorShape` (R31) y loguear sin filtrar secretos.
