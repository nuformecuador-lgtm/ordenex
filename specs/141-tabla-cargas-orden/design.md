# Feature 141 — Diseño técnico

> Cubre R1–R30 de `requirements.md`. Zona backend. **Sin UI**: no hay listado, filtro ni
> visualización por lote (gate F1.4-5). El único cambio en el cliente es de fontanería: el
> orquestador de chunks genera y propaga un identificador de lote y el total de la sesión.
>
> Nombres cerrados en el gate F1.4-1: tabla `carga` (SINGULAR, convención del repo), modelo
> Prisma `Carga` con `@@map("carga")`, columna `orden.carga_id`.

## 0. Resumen de la decisión

Se crea la tabla `carga` (un registro por LOTE de carga masiva) y dos columnas nuevas en
`orden`: `carga_id` (FK nullable a `carga`) y `download_url` (texto nullable). La fila de
`carga` se asegura DENTRO de la misma transacción que inserta las órdenes del bloque, con
el patrón helper-sobre-`tx` que ya usa el repo (`appendCambioEstado(tx, ...)`).

El identificador del lote lo **genera el cliente** de la carga masiva por sesión (un UUID por
sesión de carga) y viaja en cada chunk; el servidor lo trata de forma idempotente
(`INSERT ... ON CONFLICT DO NOTHING` + verificación de propietario). En la vía API key el
identificador lo genera el servidor, una vez por petición.

## 1. Modelo de datos

### 1.1 Tabla `carga` (nueva)

| Columna | Tipo | Null | Notas |
| --- | --- | --- | --- |
| `id` | TEXT (uuid) | NOT NULL | PK. En la vía sesión lo propone el cliente (UUID validado); en la vía API lo genera el servidor. |
| `fecha_carga` | TIMESTAMP(3) | NOT NULL | `DEFAULT CURRENT_TIMESTAMP` — instante de creación del lote (R20 del pedido literal). |
| `usuario_carga` | TEXT | NOT NULL | FK → `usuario(id)` `ON DELETE RESTRICT`. Usuario que realizó la carga (R2). |
| `download_url` | TEXT | NULL | D1. Nace NULL; ninguna ruta de esta feature la escribe (R29). |
| `total_files` | INTEGER | NOT NULL | `DEFAULT 0`. TAMAÑO TOTAL del lote (gate F1.4-2). Sesión = total de filas de la sesión declarado por el cliente; API = `ordenes.length` del payload. Nunca el tamaño de un chunk ni de un batch. |
| `created_at` | TIMESTAMP(3) | NOT NULL | `DEFAULT CURRENT_TIMESTAMP` (convención del repo). |
| `updated_at` | TIMESTAMP(3) | NOT NULL | `@updatedAt`. |

Índices: `carga_usuario_carga_idx`, `carga_fecha_carga_idx`.
RLS: `ENABLE ROW LEVEL SECURITY` sin policies (patrón `orden_mensajero_meta` /
`plantilla_mensaje` / `api_key`); autorización de negocio en el service (R9).

**No existen** `batch_url` ni `status` (D2/D3). `fecha_carga` y `created_at` conviven a
propósito: `fecha_carga` es el dato de negocio pedido explícitamente y podría fijarse en el
futuro a un instante distinto del alta técnica de la fila; `created_at`/`updated_at` son la
auditoría estándar de toda tabla del repo.

### 1.2 Cambios en `orden`

| Columna | Tipo | Null | Notas |
| --- | --- | --- | --- |
| `carga_id` | TEXT | NULL | FK → `carga(id)` `ON DELETE RESTRICT`. NULL = orden sin lote (histórico o alta manual). Índice `orden_carga_id_idx`. |
| `download_url` | TEXT | NULL | D1. Nace NULL; sin índice (sin consumidor todavía). |

Sin backfill (D7/R8): toda orden previa queda `carga_id IS NULL`.
`num_guia` no se toca (D6/R11).

### 1.3 Prisma (`db/schema.prisma`)

```prisma
// Feature 141 — LOTE de carga masiva. Una fila por carga masiva efectiva (>=1 orden
// persistida), tanto por sesion (UI /ordenes, XLSX en chunks) como por API key.
// Sin `status` (D3) y sin `batch_url` (D2). RLS habilitada sin policies: la
// autorizacion vive en el service (patron orden_mensajero_meta / plantilla_mensaje).
model Carga {
  id           String   @id @default(uuid())
  fechaCarga   DateTime @default(now()) @map("fecha_carga")
  usuarioCarga String   @map("usuario_carga") // FK -> usuario: quien realizo la carga
  downloadUrl  String?  @map("download_url")  // D1: nace NULL (la escribe una feature posterior)
  totalFiles   Int      @default(0) @map("total_files") // gate F1.4-2: tamano TOTAL del lote
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  usuario Usuario @relation("CargaUsuario", fields: [usuarioCarga], references: [id], onDelete: Restrict)
  ordenes Orden[] @relation("OrdenCarga")

  @@index([usuarioCarga])
  @@index([fechaCarga])
  @@map("carga")
}
```

En `model Orden`:

```prisma
  cargaId     String?  @map("carga_id")     // feature 141/D7: lote de carga masiva; NULL = sin lote
  downloadUrl String?  @map("download_url") // feature 141/D1: nace NULL

  carga Carga? @relation("OrdenCarga", fields: [cargaId], references: [id], onDelete: Restrict)

  @@index([cargaId])
```

En `model Usuario`: `cargasRealizadas Carga[] @relation("CargaUsuario")` (nombre de campo
Prisma en plural; la TABLA es `carga`, singular).

### 1.4 Migración `db/migrations/20260727120000_carga_orden_carga_id/`

`migration.sql` (UP), aditiva:

```sql
CREATE TABLE "carga" (
  "id"            TEXT NOT NULL,
  "fecha_carga"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usuario_carga" TEXT NOT NULL,
  "download_url"  TEXT,
  "total_files"   INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "carga_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "carga_usuario_carga_fkey" FOREIGN KEY ("usuario_carga")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "carga_usuario_carga_idx" ON "carga"("usuario_carga");
CREATE INDEX "carga_fecha_carga_idx"   ON "carga"("fecha_carga");

ALTER TABLE "carga" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "orden" ADD COLUMN "carga_id" TEXT;
ALTER TABLE "orden" ADD COLUMN "download_url" TEXT;
CREATE INDEX "orden_carga_id_idx" ON "orden"("carga_id");
ALTER TABLE "orden" ADD CONSTRAINT "orden_carga_id_fkey" FOREIGN KEY ("carga_id")
  REFERENCES "carga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

`down.sql` (DOWN), revierte exactamente:

```sql
ALTER TABLE "orden" DROP CONSTRAINT IF EXISTS "orden_carga_id_fkey";
DROP INDEX IF EXISTS "orden_carga_id_idx";
ALTER TABLE "orden" DROP COLUMN IF EXISTS "download_url";
ALTER TABLE "orden" DROP COLUMN IF EXISTS "carga_id";
DROP TABLE IF EXISTS "carga";
```

Nota operativa: `tests/integration/db/zonas-migration.test.ts` mantiene una denylist de
carpetas "apendidas después"; hay que añadir `!d.endsWith("_carga_orden_carga_id")` o la
suite se pone roja con esta migración (ver tasks).

## 2. El problema del chunking (vía sesión) y su solución

`app/(app)/ordenes/_components/carga-masiva-chunks.ts` trocea el archivo en el navegador y
hace **N peticiones** a `POST /api/ordenes/carga-masiva/chunk`; cada petición es una
invocación independiente de `BulkOrdenService.cargarMasiva`. El servidor no tiene hoy noción
de "sesión de carga": sin un identificador compartido, N chunks producirían N lotes, lo que
contradice R12.

**Decisión:** el identificador del lote se crea UNA vez por sesión de carga en el cliente
(`crypto.randomUUID()`, antes del primer chunk en firme) y viaja en el body de cada chunk
como `cargaId`. El servidor:

1. Valida el formato UUID en el borde con zod (R16 → 400).
2. En la transacción de cada bloque de inserción, hace un *ensure* idempotente:
   `INSERT INTO carga (id, usuario_carga, total_files, ...) VALUES (...) ON CONFLICT (id) DO NOTHING`,
   y luego relee la fila para verificar `usuario_carga = actor.usuarioId`; si no coincide,
   lanza (el borde lo traduce a 403, R17).
3. Inserta las órdenes del bloque con `carga_id = cargaId` en esa misma transacción (R23).

Propiedades que se obtienen:

- **Un lote por sesión** aunque haya N chunks (R12/R13): el `ON CONFLICT DO NOTHING` hace
  que solo el primer chunk que persiste órdenes cree la fila.
- **Sin lotes huérfanos** (R24): el *ensure* solo se ejecuta cuando hay ≥1 orden que
  insertar; un chunk con 0 órdenes a crear no toca `carga` (R15), y el dry-run ni siquiera
  llega a la capa de persistencia (R14).
- **Atomicidad por bloque, no por sesión.** Cada chunk (y dentro de él, cada batch de
  `BATCH_SIZE`) es su propia transacción; eso ya era así antes de esta feature (éxito parcial
  es un comportamiento deliberado de la carga masiva, feature 15/R29). El invariante que se
  garantiza es el de R23/R24: ninguna orden queda persistida sin su `carga_id` y ningún lote
  existe sin al menos una orden. Si el chunk 3 de 5 falla, el lote existe con las órdenes de
  los chunks 1–2 — coherente con el éxito parcial ya existente.
- **`total_files` = total del lote, no del chunk (gate F1.4-2, R7/R18):** el cliente conoce
  el total de filas de la sesión ANTES de trocear (ya deduplica y chunkea el arreglo
  completo), así que envía ese mismo `totalFiles` en TODOS los chunks. Como el *ensure* es
  `ON CONFLICT DO NOTHING`, solo lo escribe el INSERT que gana (el primer chunk que persiste
  órdenes) y los siguientes no lo reescriben: el valor no se acumula, no se sobrescribe y no
  degenera al tamaño de un chunk. Los chunks repiten un valor idéntico, así que el resultado
  es el mismo gane el que gane. Deliberadamente NO se hace `ON CONFLICT DO UPDATE SET
  total_files = total_files + EXCLUDED.total_files`: acumular por chunk rompería la
  idempotencia ante un reintento de red del mismo chunk.
- En la vía API key el total es `ordenes.length` del payload, conocido en la misma llamada
  (R21); los batches internos de `BATCH_SIZE` no lo alteran por el mismo motivo.

Confianza en un id provisto por el cliente: el id es un UUID opaco sin significado y la
verificación de propietario impide colgar órdenes del lote de otra tienda (R17). No hay
enumeración útil: no se expone ningún dato del lote a partir de su id en esta feature.

Vía API key: una petición = una llamada a `cargarViaApi` = un lote. El id lo genera el
servidor en la capa de persistencia (o `randomUUID()` en el repo) la primera vez que hay un
batch con órdenes, y se reutiliza para los batches internos siguientes de la misma llamada.

## 3. Cambios por capa

```
app/(app)/ordenes/_components/carga-masiva-chunks.ts   (cliente)  → genera cargaId por sesión, lo manda en cada chunk
app/api/ordenes/carga-masiva/chunk/route.ts            (Controller) → zod: cargaId?: uuid, totalFiles?: int>=0
app/api/ordenes/api-key/carga/route.ts                 (Controller) → devuelve summary.cargaId (sin más cambios)
lib/services/BulkOrdenService.ts                       (Service)    → propaga el contexto de lote al repo
lib/repositories/OrdenRepository.ts                    (Repository) → ensure de carga + carga_id en el mismo tx
lib/repositories/carga-lote.ts                         (helper tx)  → ensureCargaEnTx(tx, ...)  [patrón appendCambioEstado]
lib/interfaces/repositories/IOrdenRepository.ts        (contrato)   → LoteContexto en createManyOrdenes*/CreateOrdenData
lib/types/carga-masiva.ts                              (tipos)      → BulkSummary.cargaId
lib/interfaces/services/IBulkOrdenService.ts           (contrato)   → options.cargaId/totalFiles, CargaViaApiSummary.cargaId
```

### 3.1 Contrato de repositorio

```ts
// lib/interfaces/repositories/IOrdenRepository.ts
export interface LoteContexto {
  /** id del lote. `null` = el repo lo genera (vía API key, un lote por llamada). */
  cargaId: string | null;
  /** usuario_carga de la fila de `carga` (el actor de la carga). */
  usuarioCargaId: string;
  /** Tamaño TOTAL del lote (gate F1.4-2). Sesión = filas de la sesión declaradas por el
   *  cliente; API = `ordenes.length` del payload. Nunca el tamaño del chunk/batch. */
  totalFiles: number;
}

createManyOrdenes(
  data: CreateOrdenData[],
  batchSize: number,
  historial: HistorialContexto,
  lote: LoteContexto,
): Promise<{ inserted: number; cargaId: string | null }>;

createManyOrdenesConGuia(
  data: CreateOrdenData[],
  batchSize: number,
  historial: HistorialContexto,
  lote: LoteContexto,
): Promise<{ creadas: CreateOrdenConGuiaResultRow[]; cargaId: string | null }>;
```

`createManyOrdenes` pasa de devolver `number` a devolver `{ inserted, cargaId }` porque el
service necesita el id para el summary (R27). Es un cambio de firma acotado a dos llamadores
(`BulkOrdenService`) y a sus tests.

Dentro de cada `$transaction` de batch, y **antes** del `createMany`:

```ts
const cargaId = await ensureCargaEnTx(tx, { id: loteId, usuarioCargaId, totalFiles });
// ...createMany con data.map(d => ({ ...toCreateManyInput(d), cargaId }))
```

`ensureCargaEnTx` (nuevo, `lib/repositories/carga-lote.ts`, mismo patrón que
`appendCambioEstado(tx, ...)`):

1. `id = params.id ?? randomUUID()`.
2. `INSERT INTO "carga" (...) VALUES (...) ON CONFLICT ("id") DO NOTHING`.
3. `SELECT usuario_carga FROM "carga" WHERE id = $1` → si `usuario_carga !== usuarioCargaId`
   lanza `CargaLoteAjenoError` (el service/borde lo traduce a 403, R17).
4. Devuelve `id`.

Solo se invoca cuando el batch tiene ≥1 orden que insertar (R15/R24). Nótese que
`skipDuplicates` puede saltar filas: `carga_id` se escribe en el INSERT, así que **solo** las
órdenes efectivamente creadas quedan asociadas al lote; las duplicadas preexistentes no se
modifican (R25).

### 3.2 Servicio

```ts
cargarMasiva(rows, actor, options?: { dryRun?: boolean; cargaId?: string; totalFiles?: number })
```

- `dryRun` → no se llama al repo, `summary.cargaId = null` (R14).
- `toCreate.length === 0` → no se llama al repo, `summary.cargaId = null` (R15).
- En firme → `lote = { cargaId: options.cargaId ?? null, usuarioCargaId: tiendaId,
  totalFiles: options.totalFiles ?? rows.length }` (R18; el fallback `rows.length` solo
  aplica si el cliente no declara el total: degrada al tamaño del chunk, nunca a 0).
  (`tiendaId = actor.usuarioId`, el `adminTienda` autenticado — el mismo actor que ya se usa
  para el historial.)
- `cargarViaApi` → `lote = { cargaId: null, usuarioCargaId: actor.usuarioId,
  totalFiles: rows.length }` — `rows` ES el array `ordenes` del payload, ya validado por zod
  en el borde (R21). El actor es el usuario dedicado de la API key, el mismo que ya queda como
  `orden.tienda_id` y como actor del historial `carga_api` (R20); no hay otro usuario humano
  identificable en ese canal, y usar el creador de la key sería una atribución falsa.
- Ambos summaries ganan `cargaId: string | null`.

### 3.3 Controllers

`chunk/route.ts`: el schema pasa a

```ts
const chunkBodySchema = z.object({
  rows: z.array(z.record(z.string(), z.string())).min(1).max(cargaMasivaConfig.MAX_CHUNK_ROWS),
  dryRun: z.boolean().optional().default(false),
  cargaId: z.uuid().optional(),                   // R16 -> 400 si no es UUID
  totalFiles: z.number().int().min(0).optional(), // total de la SESIÓN (R18)
});
```

y traduce `CargaLoteAjenoError` a `ForbiddenError` (R17). La respuesta sigue siendo el
summary, ahora con `cargaId`.

`api-key/carga/route.ts`: **cambio mínimo** — no toca la lógica de etiquetas de la feature
112/136; el `cargaId` llega dentro del `summary` que ya se difunde con `{ ...summary,
etiquetasPdf }` (R28). Idealmente esta feature no edita ese archivo en absoluto; si hiciera
falta editarlo, se limita a nada más que el tipo de la respuesta.

### 3.4 Cliente (vía sesión)

`procesarEnChunks` acepta `cargaId` y `totalFiles` en `ProcesarChunksOpts` y los incluye en
el body de cada chunk. El llamador (módulo de carga masiva de `/ordenes`) genera
`crypto.randomUUID()` UNA vez, al iniciar la carga en firme (no en el dry-run), y calcula
`totalFiles` = número de filas de la sesión (`filas.length` tras el dedup intra-archivo, el
mismo arreglo que se trocea), enviando ese mismo valor en todos los chunks (R18).

**Sin UI (gate F1.4-5):** el `cargaId` devuelto no se pinta, no se lista, no se filtra y no
se persiste en el cliente. El cambio es exclusivamente de fontanería en
`carga-masiva-chunks.ts` y su llamador.

## 4. Contratos I/O

| Operación | Entrada nueva | Salida nueva |
| --- | --- | --- |
| `POST /api/ordenes/carga-masiva/chunk` | `cargaId?: uuid`, `totalFiles?: int >= 0` | `cargaId: string \| null` en el summary |
| `POST /api/ordenes/api-key/carga` | — | `cargaId: string \| null` en el summary |
| `cargarMasiva` | `options.cargaId`, `options.totalFiles` | `summary.cargaId` |
| `cargarViaApi` | — | `summary.cargaId` |
| `createManyOrdenes*` | `lote: LoteContexto` | `{ ..., cargaId }` |

Errores: 400 (`cargaId` no UUID), 403 (`cargaId` de otro usuario). El resto del contrato de
error no cambia.

## 5. Punto de integración futuro (feature 136, NO se implementa aquí)

La feature 136 (`specs/136-etiquetas-pdf-carga-api/`, in_progress) genera un PDF consolidado
de etiquetas **por lote** en la carga por API key y devuelve una signed URL en
`etiquetasPdf.url`. `carga.download_url` es el destino natural de esa URL (una por lote) y
`orden.download_url` el de una eventual etiqueta por orden.

Esta feature **no** cablea nada de eso: ambas columnas nacen y quedan NULL (R29). Para
minimizar el solape de archivos con 136:

- No se modifica `lib/services/EtiquetasLotePdfService.ts`, `lib/pdf/*` ni la lógica de
  etiquetas del endpoint de API key.
- El único cambio en `app/api/ordenes/api-key/carga/route.ts` es de tipo/propagación del
  summary (idealmente cero líneas: el spread `{ ...summary, etiquetasPdf }` ya lo arrastra).
- Cuando 136 esté mergeada, una feature posterior escribirá `download_url` con un UPDATE
  best-effort posterior al commit del lote (misma política de "no revertir la carga").

## 6. Seguridad y rendimiento

- **RLS** habilitada en `carga` sin policies: acceso solo por service role, igual que
  `api_key`, `plantilla_mensaje` y `orden_mensajero_meta`.
- **Autorización** intacta (R30): `adminTienda` en la vía sesión, `apiKey` en la vía API; el
  chequeo de propietario del lote es una defensa adicional, no un permiso nuevo.
- **Sin PII nueva**: `carga` no almacena datos personales; no se loguea el `cargaId` junto a
  secretos.
- **Coste por chunk**: el *ensure* añade un INSERT idempotente + un SELECT por batch dentro
  de una transacción que ya hacía varios round-trips; `orden_carga_id_idx` cubre la consulta
  natural "órdenes de un lote".

## 7. Alternativas descartadas

### A. Crear una fila de `carga` por cada chunk HTTP (sin identificador de sesión)
Es la implementación más simple (cero cambios en el cliente y en el contrato), pero produce
tantos "lotes" como chunks: un archivo de 1.000 filas con `chunkSize` 200 generaría 5 lotes,
rompiendo R12 y volviendo inútil el `carga_id` como identificador de lote para la feature
posterior que lo consumirá (D6). **Descartada.**

### B. Endpoint previo `POST /api/ordenes/carga-masiva/iniciar` que devuelve el `cargaId`
El id lo generaría el servidor (más autoritativo, sin confiar en el cliente) y quedaría
registrado antes de la primera inserción. Se descarta porque: (1) crea lotes huérfanos por
diseño — si el usuario abandona tras iniciar, queda una fila de `carga` sin órdenes, lo que
contradice R24 y obliga a un limpiador; (2) añade un round-trip y una ruta nueva con su
propia autorización; (3) la ganancia de seguridad es marginal, porque el *ensure* idempotente
ya verifica el propietario del lote (R17) y el id es un UUID opaco. **Descartada**, con la
nota de que si aparece la necesidad de registrar intentos de carga fallidos (lote sin
órdenes), esta alternativa pasa a ser la correcta.

### C. Derivar el lote en el servidor por (usuario, ventana de tiempo)
Agrupar automáticamente todos los chunks del mismo `adminTienda` dentro de una ventana de N
minutos en un solo lote. Evita cambiar el cliente y el contrato, pero es heurístico: dos
cargas legítimas seguidas se fusionarían en un lote y una carga lenta se partiría en dos.
Un identificador de lote no puede depender de un reloj. **Descartada.**

### D. Reusar `num_guia` o un prefijo de `num_remision` como identificador de lote
Contradice D6 (`num_guia` se mantiene tal cual y es por orden, no por lote) y `num_remision`
lo provee la tienda sin garantía de estructura por lote. **Descartada.**

### E. Tabla `carga` con `status` y `batch_url` (pedido original)
El humano cerró explícitamente D2/D3: sin `batch_url` y sin `status`. Añadirlos "por si
acaso" introduciría un enum nuevo y una máquina de estados sin consumidor. **Descartada por
decisión cerrada.**

### F. `orden.carga_id` NOT NULL con backfill de un lote sintético "histórico"
Daría un invariante más fuerte, pero inventaría un lote que nunca existió y falsearía
`usuario_carga`/`fecha_carga` de todo el histórico, además de exigir un backfill pesado sobre
`orden`. Contradice D7. **Descartada.**
