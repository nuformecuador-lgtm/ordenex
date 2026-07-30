# Feature 141 — Diseño técnico

> Cubre R1–R55 de `requirements.md`. Zona backend. **Sin UI**: no hay listado, filtro ni
> visualización por lote (gate F1.4-5). El único cambio en el cliente es de fontanería en
> `carga-masiva-chunks.ts` (`.ts`, no `.tsx`): propaga el token de lote emitido por el
> servidor y el total de la sesión.
>
> Nombres cerrados en el gate F1.4-1: tabla `carga` (SINGULAR, convención del repo), modelo
> Prisma `Carga` con `@@map("carga")`, columna `orden.carga_id`.
>
> **Cambio de diseño (gate F1.4-7/8/9):** el `carga.id` lo genera el SERVIDOR, el cliente
> nunca lo propone; y el lote admite un `name` opcional único por usuario.
>
> **Cambio de diseño (gate F1.4-11/12):** la vía API key acepta `download_type`
> (`consolidate` por defecto | `individual`) y **esta feature SÍ escribe `download_url`**
> reusando el generador de PDFs de la feature 136. Queda **derogada** la decisión previa de
> "`download_url` siempre NULL" (ver §6, que la reemplaza).

## 0. Resumen de la decisión

Se crea la tabla `carga` (un registro por LOTE de carga masiva) y dos columnas nuevas en
`orden`: `carga_id` (FK nullable a `carga`, `ON DELETE RESTRICT`) y `download_url` (texto
nullable). La fila de `carga` se asegura DENTRO de la misma transacción que inserta las
órdenes del bloque, con el patrón helper-sobre-`tx` que ya usa el repo
(`appendCambioEstado(tx, ...)`).

El identificador del lote es un **token opaco emitido por el servidor**: se genera con
`randomUUID()` dentro de la transacción, en la petición que crea el lote. En la vía sesión el
PRIMER chunk que persiste órdenes lo crea y lo devuelve en la respuesta; los chunks
siguientes lo reenvían para correlacionarse con el mismo lote. En la vía API key el lote se
crea una vez por petición.

El lote admite un `name` opcional definido por el usuario, único por usuario
(`UNIQUE(usuario_carga, name)`), cuya violación aborta la carga con **409**.

## 1. Modelo de datos

### 1.1 Tabla `carga` (nueva)

| Columna | Tipo | Null | Notas |
| --- | --- | --- | --- |
| `id` | TEXT (uuid) | NOT NULL | PK. **Generado SIEMPRE por el servidor** dentro de la tx (R15). Token opaco para el cliente. |
| `fecha_carga` | TIMESTAMP(3) | NOT NULL | `DEFAULT CURRENT_TIMESTAMP` — instante de creación del lote. |
| `usuario_carga` | TEXT | NOT NULL | FK → `usuario(id)` `ON DELETE RESTRICT`. Usuario que realizó la carga (R2). |
| `name` | TEXT | NULL | Nombre OPCIONAL del lote, definido por el usuario (R8). NULL = sin nombre. |
| `download_url` | TEXT | NULL | D1. URL del PDF **consolidado** del lote (modo `consolidate`, R47). NULL en la vía sesión (R40), en modo `individual` y ante fallo best-effort (R51). |
| `total_files` | INTEGER | NOT NULL | `DEFAULT 0`. TAMAÑO TOTAL del lote (gate F1.4-2). Sesión = total de filas de la sesión declarado por el cliente; API = `ordenes.length` del payload. Nunca el tamaño de un chunk ni de un batch. |
| `created_at` | TIMESTAMP(3) | NOT NULL | `DEFAULT CURRENT_TIMESTAMP` (convención del repo). |
| `updated_at` | TIMESTAMP(3) | NOT NULL | `@updatedAt`. |

Índices: `carga_usuario_carga_idx`, `carga_fecha_carga_idx` y el ÚNICO compuesto
`carga_usuario_carga_name_key` sobre (`usuario_carga`, `name`) (R9).
Postgres trata los NULL como distintos en un índice único, así que N lotes sin nombre del
mismo usuario conviven sin colisión (R10) — no se usa un índice único PARCIAL (`WHERE name IS
NOT NULL`) porque no aporta nada aquí y complica el DOWN.

RLS: `ENABLE ROW LEVEL SECURITY` sin policies (patrón `orden_mensajero_meta` /
`plantilla_mensaje` / `api_key`); autorización de negocio en el service (R12).

**No existen** `batch_url` ni `status` (D2/D3). `fecha_carga` y `created_at` conviven a
propósito: `fecha_carga` es el dato de negocio pedido explícitamente y podría fijarse en el
futuro a un instante distinto del alta técnica de la fila; `created_at`/`updated_at` son la
auditoría estándar de toda tabla del repo.

### 1.2 Cambios en `orden`

| Columna | Tipo | Null | Notas |
| --- | --- | --- | --- |
| `carga_id` | TEXT | NULL | FK → `carga(id)` `ON DELETE RESTRICT`. NULL = orden sin lote (histórico o alta manual). Índice `orden_carga_id_idx`. |
| `download_url` | TEXT | NULL | D1. URL del PDF **individual** de ESA orden (modo `individual`, R48). NULL en modo `consolidate`, en la vía sesión, sin etiqueta imprimible (R49) y ante fallo (R51). Sin índice (no se consulta por ella). |

Sin backfill (D7/R11): toda orden previa queda `carga_id IS NULL`.
`num_guia` no se toca (D6/R14).

### 1.3 Prisma (`db/schema.prisma`)

```prisma
// Feature 141 — LOTE de carga masiva. Una fila por carga masiva efectiva (>=1 orden
// persistida), tanto por sesion (UI /ordenes, XLSX en chunks) como por API key.
// `id` lo genera SIEMPRE el servidor (gate F1.4-7): el cliente nunca lo propone.
// Sin `status` (D3) y sin `batch_url` (D2). RLS habilitada sin policies: la
// autorizacion vive en el service (patron orden_mensajero_meta / plantilla_mensaje).
model Carga {
  id           String   @id @default(uuid())
  fechaCarga   DateTime @default(now()) @map("fecha_carga")
  usuarioCarga String   @map("usuario_carga") // FK -> usuario: quien realizo la carga
  name         String?  // gate F1.4-8: nombre OPCIONAL del lote, definido por el usuario
  downloadUrl  String?  @map("download_url")  // R47: URL del PDF consolidado del lote (modo consolidate)
  totalFiles   Int      @default(0) @map("total_files") // gate F1.4-2: tamano TOTAL del lote
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  usuario Usuario @relation("CargaUsuario", fields: [usuarioCarga], references: [id], onDelete: Restrict)
  ordenes Orden[] @relation("OrdenCarga")

  @@unique([usuarioCarga, name]) // gate F1.4-9: unicidad del nombre POR USUARIO (NULLs conviven)
  @@index([usuarioCarga])
  @@index([fechaCarga])
  @@map("carga")
}
```

En `model Orden`:

```prisma
  cargaId     String?  @map("carga_id")     // feature 141/D7: lote de carga masiva; NULL = sin lote
  downloadUrl String?  @map("download_url") // R48: URL del PDF individual de esta orden (modo individual)

  carga Carga? @relation("OrdenCarga", fields: [cargaId], references: [id], onDelete: Restrict)

  @@index([cargaId])
```

En `model Usuario`: `cargasRealizadas Carga[] @relation("CargaUsuario")` (nombre de campo
Prisma en plural; la TABLA es `carga`, singular).

### 1.4 Migración `db/migrations/20260727120000_carga_orden_carga_id/`

La migración **NO está aplicada en ninguna base y su PR no está mergeado**, así que `name` y
su índice único entran **en sitio**, en este mismo par de archivos: no se crea una migración
correctiva (gate F1.4-10).

`migration.sql` (UP), aditiva:

```sql
CREATE TABLE "carga" (
  "id"            TEXT NOT NULL,
  "fecha_carga"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usuario_carga" TEXT NOT NULL,
  "name"          TEXT,
  "download_url"  TEXT,
  "total_files"   INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "carga_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "carga_usuario_carga_fkey" FOREIGN KEY ("usuario_carga")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Unicidad del nombre POR USUARIO (no global). Postgres considera los NULL distintos
-- entre si, de modo que varios lotes sin nombre del mismo usuario conviven.
CREATE UNIQUE INDEX "carga_usuario_carga_name_key" ON "carga"("usuario_carga", "name");

CREATE INDEX "carga_usuario_carga_idx" ON "carga"("usuario_carga");
CREATE INDEX "carga_fecha_carga_idx"   ON "carga"("fecha_carga");

ALTER TABLE "carga" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "orden" ADD COLUMN "carga_id" TEXT;
ALTER TABLE "orden" ADD COLUMN "download_url" TEXT;
CREATE INDEX "orden_carga_id_idx" ON "orden"("carga_id");
ALTER TABLE "orden" ADD CONSTRAINT "orden_carga_id_fkey" FOREIGN KEY ("carga_id")
  REFERENCES "carga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

`down.sql` (DOWN), revierte exactamente (el `DROP TABLE` arrastra PK, índices —incluido el
único compuesto—, FK y RLS):

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

## 2. Identidad del lote y chunking (vía sesión)

`app/(app)/ordenes/_components/carga-masiva-chunks.ts` trocea el archivo en el navegador y
hace **N peticiones** a `POST /api/ordenes/carga-masiva/chunk`; cada petición es una
invocación independiente de `BulkOrdenService.cargarMasiva`. El servidor no tiene noción
propia de "sesión de carga": sin un identificador compartido, N chunks producirían N lotes
(rompe R26).

**Decisión (gate F1.4-7):** el identificador lo emite el SERVIDOR.

1. El cliente envía el primer chunk **sin** `cargaId`.
2. El servidor, dentro de la transacción del primer batch que inserta órdenes, genera
   `randomUUID()`, inserta la fila de `carga` (con `name`, `usuario_carga`, `total_files`) y
   escribe ese id en `carga_id` de las órdenes de ese batch (R15/R16/R34).
3. La respuesta del chunk incluye `cargaId`.
4. El cliente reenvía ese `cargaId` —tal cual lo recibió— en los chunks siguientes.
5. Con `cargaId` presente, el servidor **no inserta** ninguna fila de `carga`: la LEE dentro
   de la transacción, comprueba propiedad y la reutiliza (R17). Un id inexistente o de otro
   usuario ⇒ `CargaLoteAjenoError` ⇒ **403** (R19), y la transacción revierte, así que la
   petición no crea órdenes.

Propiedades:

- **El cliente no puede elegir el id.** La rama de creación solo existe cuando `cargaId` es
  `null`; con `cargaId` presente solo hay lectura. Un UUID inventado no crea nada: cae en la
  rama de lectura y da 403 (indistinguible de "lote ajeno", lo que además evita enumerar
  lotes existentes).
- **Un lote por sesión** aunque haya N chunks (R26): solo el primer chunk con órdenes crea.
- **Sin lotes huérfanos** (R35): la creación solo se ejecuta cuando hay ≥1 orden que
  insertar; un chunk con 0 órdenes a crear no toca `carga` (R28) y el dry-run ni siquiera
  llega a la capa de persistencia (R27).
- **Serialidad:** `procesarEnChunks` envía los lotes EN SERIE (bucle `for ... await`), así
  que el chunk 2 siempre conoce ya el `cargaId` del chunk 1. Si en el futuro se paralelizaran
  los chunks, dos peticiones sin `cargaId` crearían dos lotes; queda documentado como
  invariante del cliente (test en T11).
- **`total_files` = total del lote, no del chunk (R7/R29):** el cliente conoce el total de
  filas de la sesión antes de trocear y lo envía en todos los chunks; solo lo escribe el
  INSERT de creación, y los chunks posteriores no lo reescriben. Deliberadamente NO se
  acumula por chunk: un reintento de red duplicaría el total.
- **`name`** se envía en todos los chunks pero solo lo persiste el INSERT de creación; los
  posteriores no lo modifican (R23).

Vía API key: una petición = una llamada a `cargarViaApi` = un lote. No hay `cargaId` de
entrada: el repo genera el id en el primer batch con órdenes y lo REUSA en los batches
internos siguientes de esa misma llamada (R30).

## 3. Nombre del lote y el 409 de punta a punta

- **Entrada:** `name?: string` (trim; cadena vacía ⇒ `undefined` ⇒ NULL) validado con zod en
  ambos bordes (R20/R22). Tope de longitud defensivo (p. ej. `.max(120)`).
- **DB:** el índice único `carga_usuario_carga_name_key` es la autoridad. No se hace un
  `SELECT` previo de "¿existe el nombre?": sería una comprobación TOCTOU y añadiría un
  round-trip; se deja fallar el INSERT y se traduce el error.
- **Repositorio:** el helper captura el error de unicidad de Prisma
  (`PrismaClientKnownRequestError` con `code === "P2002"` sobre el target
  `usuario_carga, name`) y lanza un error de dominio tipado
  `CargaNombreDuplicadoError extends Error` (junto a `CargaLoteAjenoError`, en
  `lib/interfaces/repositories/IOrdenRepository.ts`), portando el `name` conflictivo. La
  `$transaction` revierte: no queda ni el lote ni las órdenes de esa petición (R24).
- **Servicio:** `BulkOrdenService` **no** captura ninguno de los dos errores; los deja
  propagar (son condiciones del borde, no clasificación de filas).
- **Borde HTTP:** ambos route handlers traducen dentro de su `withErrorHandler`:
  `CargaNombreDuplicadoError → new ConflictError("ya existe una carga con el nombre '<name>'")`
  (`CONFLICT` ⇒ **409**) y `CargaLoteAjenoError → new ForbiddenError()` (⇒ **403**). Se reusan
  las clases de `lib/errors` (feature 10); no se inventan códigos nuevos.

## 4. Cambios por capa

```
app/(app)/ordenes/_components/carga-masiva-chunks.ts   (cliente)    → reenvía el cargaId emitido por el servidor + name + totalFiles
app/api/ordenes/carga-masiva/chunk/route.ts            (Controller) → zod: cargaId?: uuid, name?: string, totalFiles?: int>=0; 403/409
app/api/ordenes/api-key/carga/route.ts                 (Controller) → zod: name?, download_type?; 409; orquesta etiquetas por modo (§6)
lib/services/EtiquetasDescargaService.ts               (Service)    → NUEVO: genera según modo + persiste download_url (§6.3)
lib/services/EtiquetasLotePdfService.ts                (Service)    → + generarYAlmacenarPorOrden (modo individual, §6.1)
lib/interfaces/services/IEtiquetasLotePdfService.ts    (contrato)   → + EtiquetaOrdenPdfResultado
lib/services/BulkOrdenService.ts                       (Service)    → propaga el contexto de lote al repo
lib/repositories/OrdenRepository.ts                    (Repository) → ensure de carga + carga_id en el mismo tx
lib/repositories/carga-lote.ts                         (helper tx)  → ensureCargaEnTx(tx, ...)  [patrón appendCambioEstado]
lib/interfaces/repositories/IOrdenRepository.ts        (contrato)   → LoteContexto, CargaLoteAjenoError, CargaNombreDuplicadoError,
                                                                      setCargaDownloadUrl, setOrdenesDownloadUrl (§6.2)
lib/types/carga-masiva.ts                              (tipos)      → BulkSummary.cargaId
lib/interfaces/services/IBulkOrdenService.ts           (contrato)   → options.cargaId/name/totalFiles, CargaViaApiSummary.cargaId
```

### 4.1 Contrato de repositorio

```ts
// lib/interfaces/repositories/IOrdenRepository.ts
export interface LoteContexto {
  /**
   * Token de lote EMITIDO POR EL SERVIDOR y reenviado por el cliente (chunks 2..N).
   * `null` = esta petición crea el lote y el repo genera el id (R15/R16).
   * NUNCA es un valor elegido por el usuario: con id presente solo se LEE.
   */
  cargaId: string | null;
  /** `carga.usuario_carga`: el actor de la carga (R2/R31). */
  usuarioCargaId: string;
  /** Tamaño TOTAL del lote (R7/R29/R32). Nunca el tamaño del chunk/batch. */
  totalFiles: number;
  /** `carga.name` opcional del usuario; solo lo usa la creación del lote (R21/R23). */
  name?: string | null;
}

export class CargaLoteAjenoError extends Error {}      // → 403 en el borde (R19)
export class CargaNombreDuplicadoError extends Error {} // → 409 en el borde (R24)

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

Dentro de cada `$transaction` de batch, y **antes** del `createMany`:

```ts
const cargaId = await ensureCargaEnTx(tx, { id: loteId, usuarioCargaId, totalFiles, name });
// ...createMany con data.map(d => ({ ...toCreateManyInput(d), cargaId }))
```

`ensureCargaEnTx` (`lib/repositories/carga-lote.ts`, patrón `appendCambioEstado(tx, ...)`):

```
si params.id === null:                       // rama de CREACIÓN (R15/R16)
    id = randomUUID()                         // SIEMPRE server-side
    try  INSERT carga (id, usuario_carga, name, total_files)
    catch P2002 sobre (usuario_carga, name) -> throw CargaNombreDuplicadoError(name)
sino:                                         // rama de REUTILIZACIÓN (R17)
    fila = SELECT * FROM carga WHERE id = params.id
    si fila == null            -> throw CargaLoteAjenoError(id)   // id desconocido (R19)
    si fila.usuario_carga != actor -> throw CargaLoteAjenoError(id)
devuelve id
```

Diferencias con la versión anterior del diseño (que hay que corregir en el código ya
implementado): desaparece el `createMany([...], skipDuplicates: true)` con id propuesto por
el cliente; la creación y la reutilización son ramas distintas y excluyentes.

Se invoca solo cuando el batch tiene ≥1 orden que insertar (R28/R35). `skipDuplicates` del
`createMany` de órdenes puede saltar filas: `carga_id` se escribe en el INSERT, así que
**solo** las órdenes efectivamente creadas quedan asociadas al lote; las duplicadas
preexistentes no se modifican (R36).

### 4.2 Servicio

```ts
cargarMasiva(rows, actor, options?: { dryRun?: boolean; cargaId?: string; name?: string; totalFiles?: number })
cargarViaApi(rows, actor, options?: { name?: string })
```

- `dryRun` → no se llama al repo, `summary.cargaId = null` (R27).
- `toCreate.length === 0` → no se llama al repo, `summary.cargaId = null` (R28/R33).
- Vía sesión en firme → `lote = { cargaId: options.cargaId ?? null, usuarioCargaId: tiendaId,
  totalFiles: options.totalFiles ?? rows.length, name: options.name ?? null }`
  (`tiendaId = actor.usuarioId`, el `adminTienda` autenticado — el mismo actor del historial).
- Vía API key → `lote = { cargaId: null, usuarioCargaId: actor.usuarioId,
  totalFiles: rows.length, name: options?.name ?? null }` — `rows` ES el array `ordenes` del
  payload ya validado por zod (R32). El actor es el usuario dedicado de la API key, el mismo
  que ya queda como `orden.tienda_id` y como actor del historial `carga_api` (R31); no hay
  otro usuario humano identificable en ese canal, y usar el creador de la key sería una
  atribución falsa.
- Ambos summaries llevan `cargaId: string | null` (R38/R39).

### 4.3 Controllers

`chunk/route.ts`:

```ts
const chunkBodySchema = z.object({
  rows: z.array(z.record(z.string(), z.string())).min(1).max(cargaMasivaConfig.MAX_CHUNK_ROWS),
  dryRun: z.boolean().optional().default(false),
  cargaId: z.uuid().optional(),                   // R18 -> 422 si no es UUID
  name: z.string().trim().min(1).max(120).optional(), // R20/R22
  totalFiles: z.number().int().min(0).optional(), // total de la SESIÓN (R29)
});
```

y traduce `CargaLoteAjenoError → ForbiddenError` (403, R19) y
`CargaNombreDuplicadoError → ConflictError` (409, R24). Sigue exigiendo `adminTienda` (R41).

`api-key/carga/route.ts`: añade al `cargaApiBodySchema` `name` opcional y
`download_type: z.enum(["consolidate", "individual"]).optional().default("consolidate")`
(R42/R43/R44 → valor inválido = `VALIDATION_ERROR`/422 antes de crear nada), traduce el 409
del nombre duplicado, y orquesta la generación de etiquetas según el modo (§6). El `cargaId`
viaja dentro del `summary` que ya se difunde con `{ ...summary, etiquetasPdf }` (R39).

El schema de la vía sesión **no** conoce `download_type` (R46): una clave desconocida en el
body simplemente se ignora, como hoy.

### 4.4 Cliente (vía sesión) — fontanería, sin UI

`procesarEnChunks` acepta `name` y `totalFiles` en `ProcesarChunksOpts`, y mantiene en una
variable local el `cargaId` que devuelve el servidor: lo envía a partir del segundo chunk. No
genera UUIDs. `totalFiles` = número de filas de la sesión (`filas.length` tras el dedup
intra-archivo, el mismo arreglo que se trocea) y se repite en todos los chunks (R29).

**Sin UI (gate F1.4-5):** el `cargaId` no se pinta, no se lista y no se filtra; ningún
`.tsx` cambia por esta feature.

## 5. Contratos I/O

| Operación | Entrada nueva | Salida nueva |
| --- | --- | --- |
| `POST /api/ordenes/carga-masiva/chunk` | `cargaId?: uuid` (emitido por el servidor), `name?: string`, `totalFiles?: int >= 0` | `cargaId: string \| null` en el summary |
| `POST /api/ordenes/api-key/carga` | `name?: string`, `download_type?: "consolidate" \| "individual"` (default `consolidate`) | `cargaId: string \| null`, `downloadType`, `etiquetasPdf` (consolidate) y `ordenes[].downloadUrl` (individual) |
| `cargarMasiva` | `options.cargaId`, `options.name`, `options.totalFiles` | `summary.cargaId` |
| `cargarViaApi` | `options.name` | `summary.cargaId` |
| `createManyOrdenes*` | `lote: LoteContexto` | `{ ..., cargaId }` |
| `EtiquetasDescargaService.generarYPersistir` | `{ modo, cargaId, ordenes, actor }` | `{ consolidado, porOrden }` (§6.3) |

Errores nuevos: **422** (`cargaId` con formato inválido R18, o `download_type` fuera del
enum R44), **403** (`cargaId` desconocido o de otro usuario, R19), **409** (`name` repetido
para el mismo usuario, R24). El resto del contrato de error no cambia. Los fallos de
generación de PDF NO son errores HTTP: siguen siendo 200 con el fallo visible (R51).

## 6. `download_type`: etiquetas consolidadas vs individuales (SOLO vía API key)

### 6.1 Qué se reusa de la feature 136 (ya mergeada en `dev`)

Piezas existentes que NO se reescriben:

| Pieza | Rol |
| --- | --- |
| `EtiquetaGuiaService.generarEtiquetas({ ordenIds }, actor)` (feature 32) | Devuelve `EtiquetaGuiaDTO[]` imprimibles + `omitidas` (`sin_guia` / `no_encontrada`) sin abortar el lote → base de R49. |
| `buildEtiquetasLotePdf(dtos)` (`lib/pdf/etiquetas-pdf-lote.ts`) | Construye el PDF (una página por etiqueta). Con un array de UN elemento produce el PDF individual: **el modo `individual` no necesita builder nuevo**. |
| `SupabaseFileStorage.upload({ path, bytes, contentType })` | Subida al bucket privado `etiquetasConfig.ETIQUETAS_BUCKET`. |
| `SupabaseSignedUrlProvider.createSignedUrl(path, ttl)` | Firma con `etiquetasConfig.SIGNED_URL_TTL_SECONDS` (clamp 24 h). |
| `EtiquetasLotePdfService.generarYAlmacenar(ordenIds, actor)` | Camino `consolidate` COMPLETO: ya devuelve `{ path, signedUrl, expiraEnSegundos }`. Se usa tal cual. |
| `EtiquetasLoteExcedeTopeError` + `etiquetasConfig.MAX_ETIQUETAS_POR_PDF` + `maxDuration = 60` | Tope duro y degradación visible (R52). |

Lo ÚNICO nuevo del lado del PDF es el modo `individual`: **N PDFs de 1 página, N uploads,
N signed URLs**. Se añade como método del MISMO servicio (no hay servicio nuevo de render),
para reusar sus cinco dependencias inyectadas y su tope:

```ts
// lib/interfaces/services/IEtiquetasLotePdfService.ts  (aditivo)
export interface EtiquetaOrdenPdfResultado {
  ordenId: string;
  path: string;
  signedUrl: string;
  expiraEnSegundos: number;
}

generarYAlmacenarPorOrden(
  ordenIds: string[],
  actor: Actor,
): Promise<EtiquetaOrdenPdfResultado[]>;
```

Implementación (`EtiquetasLotePdfService`):

1. UNA sola llamada a `generarEtiquetas({ ordenIds }, actor)` (no N: evita N+1).
   `forbidden` o cero etiquetas → `[]` (R50/R49).
2. Mismo tope que el consolidado sobre el nº de etiquetas (R52): por encima lanza
   `EtiquetasLoteExcedeTopeError` ANTES de construir nada. El coste de N PDFs de 1 página es
   equivalente en render al consolidado y ADEMÁS paga N uploads + N firmas, así que reutilizar
   el mismo tope es conservador y no necesita config nueva.
3. Por cada etiqueta: `build([dto])` → `upload({ path: \`${actor.usuarioId}/${randomUUID()}.pdf\` })`
   → `createSignedUrl(path, ttl)`. Se correlaciona por `ordenId` (el DTO ya lo lleva; si no,
   por `numGuia`, que el summary también expone).
4. Devuelve una entrada por etiqueta generada; las órdenes omitidas simplemente no aparecen
   → su `download_url` queda NULL (R49).

### 6.2 Persistencia de las URLs (capa repositorio)

Dos escrituras POST-COMMIT (la carga ya está confirmada; esto no puede revertirla):

```ts
// IOrdenRepository (aditivo)
setCargaDownloadUrl(cargaId: string, url: string): Promise<void>;              // R47
setOrdenesDownloadUrl(items: { ordenId: string; url: string }[]): Promise<void>; // R48
```

`setOrdenesDownloadUrl` actualiza en una sola transacción (un `update` por orden; el volumen
está acotado por el tope de etiquetas). Ninguna de las dos toca `carga_id`, `num_guia` ni
estado.

### 6.3 Orquestación (capa servicio) — `EtiquetasDescargaService`

El borde NO puede llamar al repositorio (regla de capas), así que la orquestación
"generar según modo + persistir + armar la respuesta" vive en un servicio nuevo y delgado
`lib/services/EtiquetasDescargaService.ts`, con DI por constructor
(`IEtiquetasLotePdfService`, `IOrdenRepository`):

```ts
generarYPersistir(params: {
  modo: "consolidate" | "individual";
  cargaId: string | null;
  ordenIds: string[];
  actor: Actor;
}): Promise<{
  consolidado: { url: string; expiraEnSegundos: number } | null;   // R47/R53
  porOrden: Map<string, string>;                                    // ordenId -> url (R48/R54)
}>;
```

- `ordenIds.length === 0` → devuelve vacío sin tocar Storage ni DB (R50).
- `consolidate` → `generarYAlmacenar` y, si hay `cargaId`, `setCargaDownloadUrl`.
  (`cargaId === null` no puede ocurrir con órdenes creadas, pero si ocurriera se devuelve la
  URL sin persistirla: la respuesta no miente.)
- `individual` → `generarYAlmacenarPorOrden` y `setOrdenesDownloadUrl`.
- NO captura errores: los propaga para que el borde aplique best-effort (mismo criterio que
  la 136, que deliberadamente deja el try/catch en el endpoint).

### 6.4 Contrato de respuesta (compatibilidad hacia atrás)

```jsonc
{
  "total": 3, "creadas": 2, "duplicadas": 1, "conError": 0,
  "filas": [...],
  "ordenes": [
    { "id": "...", "numRemision": "R-1", "numGuia": 1234, "estado": "en_ruta_bodega_central",
      "costoEnvio": "3.50",
      "downloadUrl": null }        // NUEVO (aditivo). Modo individual -> URL; consolidate -> null
  ],
  "cargaId": "…",                   // feature 141
  "downloadType": "consolidate",   // NUEVO (R55): modo aplicado, incluido el default
  "etiquetasPdf": { "url": "https://…", "expiraEnSegundos": 3600 }
}
```

**Decisión de forma (R53/R54):** se conserva `etiquetasPdf` EXACTAMENTE como lo dejó la 136
para el modo `consolidate` (mismo campo, mismas tres formas: objeto, `{ error }`, `null`), y
la variante `individual` se expresa con un campo **aditivo por orden**,
`ordenes[].downloadUrl`, en vez de un array paralelo nuevo. Razones:

1. **Compatibilidad:** un integrador de la 136 que solo lee `etiquetasPdf` no ve cambios de
   forma mientras no pida `individual` (y por defecto no lo pide).
2. **Correlación gratis:** el array `ordenes` ya trae `id` y `numGuia`; un array paralelo
   obligaría al integrador a cruzar por id y podría desalinearse.
3. **Espejo del modelo:** `ordenes[].downloadUrl` es literalmente el valor persistido en
   `orden.download_url`; `etiquetasPdf.url` lo es de `carga.download_url`.

En modo `individual`, `etiquetasPdf` vale `null` salvo un fallo GLOBAL (tope excedido o
excepción del servicio), en cuyo caso lleva `{ error }` — así el fallo total sigue siendo
visible en un único lugar conocido (R51/R52), mientras que un fallo de UNA orden se ve como
`downloadUrl: null` en esa orden.

### 6.5 Best-effort y qué queda en `download_url` si falla

Se mantiene la política de la 136 **en ambos modos** (R51):

| Situación | HTTP | `carga.download_url` | `orden.download_url` | Respuesta |
| --- | --- | --- | --- | --- |
| Éxito `consolidate` | 200 | URL firmada | NULL | `etiquetasPdf: { url, expiraEnSegundos }` |
| Éxito `individual` | 200 | NULL | URL firmada por orden | `ordenes[].downloadUrl` |
| Orden sin etiqueta imprimible (`individual`) | 200 | NULL | **NULL** (esa orden) | esa orden con `downloadUrl: null` |
| Fallo de render/Storage/firma/persistencia | 200 | **NULL** | **NULL** | `etiquetasPdf: { error }` (genérico) |
| Tope de etiquetas excedido | 200 | **NULL** | **NULL** | `etiquetasPdf: { error }` explicando el tope (R52) |
| Cero órdenes creadas | 200 | — (no hay lote) | — | `etiquetasPdf: null`, sin tocar Storage (R50) |

La carga **nunca** se revierte por esto: las órdenes y sus `num_guia` quedan creados. Un
fallo deja las columnas en NULL, que es un estado consistente y **reintentable**: como no hay
cola de jobs para esto en el alcance, el reintento hoy es manual/futuro (una feature posterior
puede encolar un job `etiquetas_pdf` que rellene los `download_url` NULL de un lote). Se deja
escrito como deuda, no como capacidad existente.

El log del fallo sigue usando `describirErrorSeguro` (nunca el mensaje crudo del render, que
puede arrastrar PII de la orden).

### 6.6 TTL de las URLs firmadas — limitación asumida y escrita

`createSignedUrl` emite URLs que **caducan** (`ETIQUETAS_SIGNED_URL_TTL_SECONDS`, default
1 h, techo 24 h). Persistir esa URL en `download_url` significa que la columna guarda un valor
que deja de funcionar al expirar.

**Decisión: se persiste la URL firmada tal cual, asumiendo la caducidad**, porque:

1. El humano pidió que la URL se guarde en `download_url`; guardar otra cosa (un path) haría
   que el nombre y el tipo de la columna mientan respecto de su contenido.
2. No hay hoy ningún lector de `download_url` (sin UI, gate F1.4-5): el consumidor real es la
   respuesta inmediata del endpoint, que se entrega dentro del TTL.
3. Re-firmar exige guardar el `path` del objeto, y eso es una columna nueva
   (`download_path`) que el humano no pidió y que este alcance no autoriza.

**Deuda explícita (no ocultada):** `carga.download_url` / `orden.download_url` contienen una
URL con expiración; pasado el TTL el enlace guardado devuelve 403 de Storage. La solución
correcta —y la que debe abordar la feature que construya la UI de descarga— es persistir el
`path` (que `EtiquetasLotePdfResultado` YA devuelve) y re-firmar bajo demanda desde un
endpoint autenticado. Palanca operativa mientras tanto: subir
`ETIQUETAS_SIGNED_URL_TTL_SECONDS` hasta el techo de 24 h.

## 7. Seguridad y rendimiento

- **RLS** habilitada en `carga` sin policies: acceso solo por service role, igual que
  `api_key`, `plantilla_mensaje` y `orden_mensajero_meta`.
- **Autorización** intacta (R41): `adminTienda` en la vía sesión, `apiKey` en la vía API; el
  guard de propiedad del lote es una defensa adicional, no un permiso nuevo.
- **Id no adivinable ni elegible:** UUID v4 generado en servidor; un id ajeno o inexistente
  devuelve el mismo 403, sin revelar existencia.
- **Sin PII nueva en `carga`** (`name` es texto libre del usuario; no se loguea junto a
  secretos). Ojo: los PDFs SÍ contienen PII de la orden (destinatario, dirección, teléfono);
  viven en el bucket **privado** de la 136 y solo se alcanzan por URL firmada con TTL, con el
  path aislado por dueño (`${actor.usuarioId}/...`). El log de fallos sigue usando
  `describirErrorSeguro` (nunca el mensaje crudo del render).
- **Coste del modo `individual`:** N PDFs de 1 página + N uploads + N firmas. Se acota con el
  MISMO tope de etiquetas de la 136 (`MAX_ETIQUETAS_POR_PDF`, default 300) y se ejecuta bajo
  el `maxDuration = 60` ya declarado en la ruta; por encima del tope no se empieza (R52).
- **Coste por chunk**: la rama de creación añade un INSERT; la de reutilización, un SELECT por
  batch, dentro de transacciones que ya hacían varios round-trips.
  `orden_carga_id_idx` cubre la consulta natural "órdenes de un lote" y
  `carga_usuario_carga_name_key` resuelve la unicidad sin lecturas previas.

## 8. Alternativas descartadas

### A. El cliente genera el `cargaId` (UUID) y lo envía en todos los chunks
Era el diseño del primer borrador: un solo camino (`INSERT ... ON CONFLICT DO NOTHING`) y
cero round-trips extra. **Rechazada por el humano (gate F1.4-7):** el identificador de una
fila interna no puede depender de un valor elegido por el cliente; permitía que un cliente
fijara la PK de una fila de negocio y obligaba a confiar en el guard de propiedad como única
defensa. El diseño actual separa creación (servidor) de reutilización (lectura verificada).

### B. Crear una fila de `carga` por cada chunk HTTP (sin correlación)
La más simple (cero cambios de contrato), pero produce tantos "lotes" como chunks: un archivo
de 1.000 filas con `chunkSize` 200 generaría 5 lotes, rompiendo R26 y volviendo inútil el
`carga_id` como identificador de lote. **Descartada.**

### C. Endpoint previo `POST /api/ordenes/carga-masiva/iniciar` que devuelve el `cargaId`
También emite el id en el servidor (cumple F1.4-7), pero crea lotes huérfanos por diseño —si
el usuario abandona tras iniciar, queda una fila de `carga` sin órdenes, contra R35— y añade
una ruta nueva con su propia autorización y un round-trip. El emitir-al-primer-chunk logra lo
mismo sin esos costes. **Descartada.**

### D. Derivar el lote en el servidor por (usuario, ventana de tiempo)
Agrupar los chunks del mismo `adminTienda` dentro de una ventana de N minutos. Evita cambiar
el contrato, pero es heurístico: dos cargas legítimas seguidas se fusionarían y una carga
lenta se partiría en dos. Un identificador de lote no puede depender de un reloj.
**Descartada.**

### E. Unicidad GLOBAL de `name` (`UNIQUE(name)`)
Más simple de indexar, pero un nombre como "enero" quedaría bloqueado para todas las tiendas
por la primera que lo use, filtrando además información entre inquilinos. Contradice el gate
F1.4-9. **Descartada.**

### F. Resolver el nombre duplicado con `SELECT` previo o con sufijo automático ("enero (2)")
El `SELECT` previo es TOCTOU (dos cargas concurrentes pasan la comprobación y una falla igual
en el INSERT) y el sufijo automático inventa datos que el usuario no pidió y hace imposible
detectar el error real. El humano cerró el comportamiento en **409 explícito**.
**Descartada.**

### G. Reusar `num_guia` o un prefijo de `num_remision` como identificador de lote
Contradice D6 (`num_guia` se mantiene tal cual y es por orden, no por lote) y `num_remision`
lo provee la tienda sin garantía de estructura por lote. **Descartada.**

### H. Tabla `carga` con `status` y `batch_url` (pedido original)
Cerrado en D2/D3: sin `batch_url` y sin `status`. Añadirlos "por si acaso" introduciría un
enum nuevo y una máquina de estados sin consumidor. **Descartada por decisión cerrada.**

### I. `orden.carga_id` NOT NULL con backfill de un lote sintético "histórico"
Daría un invariante más fuerte, pero inventaría un lote que nunca existió y falsearía
`usuario_carga`/`fecha_carga` de todo el histórico. Contradice D7. **Descartada.**

### J. Persistir `download_type` en una columna de `carga`
Permitiría saber a posteriori cómo se generó cada lote y es trivial de añadir. **Descartada
por decisión cerrada (D10/R45):** es un parámetro de la petición, no un atributo del lote; el
modo ya es deducible de dónde quedó la URL (`carga.download_url` vs `orden.download_url`).

### K. Array paralelo `etiquetasPdfIndividuales: [{ ordenId, url }]` en la respuesta
Aísla lo nuevo del contrato viejo, pero obliga al integrador a cruzar por `ordenId` con
`ordenes[]`, se puede desalinear y duplica una información que ya tiene dueño natural. Se
eligió el campo aditivo `ordenes[].downloadUrl` (§6.4). **Descartada.**

### L. Reusar `etiquetasPdf` para el modo individual devolviendo la PRIMERA URL o un array
Rompería el contrato que la 136 ya expone (`etiquetasPdf` es un objeto con `url` única):
cualquier integrador existente que lo lea vería un tipo distinto según un parámetro que él no
envió. Se prioriza la compatibilidad hacia atrás (R53). **Descartada.**

### M. Generar los PDFs dentro de la transacción de la carga (bloqueante)
Garantizaría que "orden creada ⇒ `download_url` no nulo", pero ata I/O de Storage (lento y
falible) a la transacción que ya commiteó `num_guia`: un fallo de red revertiría órdenes
válidas o dejaría 500 con guías perdidas para el integrador. La 136 ya cerró esto como
best-effort y se mantiene en ambos modos (R51). **Descartada.**

### N. Persistir el `path` del objeto en vez de la URL firmada (y re-firmar al leer)
Es la solución técnicamente correcta al problema de caducidad (§6.6) y `EtiquetasLotePdfResultado`
ya devuelve el `path`. **Descartada en este alcance** porque exige una columna nueva
(`download_path`) y un endpoint de re-firma que el humano no pidió, y porque hoy no hay ningún
lector de `download_url`. Queda escrita como la deuda a saldar por la feature que construya la
descarga.

### O. Un tope de configuración propio para el modo `individual`
Separar `MAX_ETIQUETAS_POR_PDF` (consolidado) de un `MAX_ETIQUETAS_INDIVIDUALES` daría más
control fino. **Descartada por ahora:** el coste del modo individual es ≥ al del consolidado
(mismo render total + N uploads + N firmas), así que reutilizar el tope existente es la opción
conservadora y evita una env nueva sin evidencia de que haga falta.
