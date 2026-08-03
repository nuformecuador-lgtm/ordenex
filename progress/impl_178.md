# Feature 178 — Bitacora de implementacion

## T1 — Reconocimiento

Verificado leyendo el CODIGO REAL (rama `feature/178-purga-pdf-cargas`, checkout principal),
no el spec. Cada punto con `archivo:linea` exacto.

### (i) `Carga.createdAt` existe y NO esta indexado — CONFIRMADO

- `db/schema.prisma:590` — `model Carga {`
- `db/schema.prisma:600` — `createdAt DateTime @default(now()) @map("created_at")` → **existe**.
- Indices declarados en el modelo `Carga` (todos, `db/schema.prisma:606-608`):
  - `606`: `@@unique([usuarioCarga, name])` (R9/R10 de la 141)
  - `607`: `@@index([usuarioCarga])`
  - `608`: `@@index([fechaCarga])`
- **No hay `@@index([createdAt])`.** El unico indice temporal es sobre `fechaCarga`
  (`db/schema.prisma:592`, `@map("fecha_carga")`), que es una columna DISTINTA de `created_at`.
- Comparacion: `Orden` SI tiene `@@index([createdAt])` en `db/schema.prisma:563`, y tiene
  `@@index([cargaId])` en `db/schema.prisma:572` (indice TOTAL, no parcial).

**Conclusion: CONFIRMADO.** El corte por `carga.created_at` exige el indice nuevo (T2).

### (ii) `IFileStorage.remove` existe y `SupabaseFileStorage.remove` descarta el error — CONFIRMADO

- `lib/interfaces/external/IFileStorage.ts:22` — `remove(paths: string[]): Promise<void>;`
  (doc en `:18-21`: "best-effort para la limpieza atomica R24. No debe lanzar ante paths
  inexistentes").
- `lib/storage/SupabaseFileStorage.ts:57-62` — implementacion:
  - `:58` corta con `if (paths.length === 0) return;` (no llama al SDK con lista vacia).
  - `:61` `await this.storage.from(this.bucket).remove(paths);` — **el `{ error }` que devuelve
    el SDK se DESCARTA**: no se desestructura, no se comprueba, no se lanza.
  - La superficie tipada del SDK si declara el error: `lib/storage/SupabaseFileStorage.ts:21`
    → `remove(paths: string[]): Promise<{ error: { message: string } | null }>`.

**Conclusion: CONFIRMADO.** Consecuencia para el diseño: `objetosBorrados` solo puede contarse
como "solicitados", nunca como "confirmados" (riesgo ya declarado en el spec), y R20/R19
("si `remove` lanza, no se limpia") solo se activa con fallos de RED/cliente, no con errores
de la respuesta del SDK.

### (iii) `ApiPdfEtiquetaService` decide por `download_storage_path` — CONFIRMADO

- `lib/services/ApiPdfEtiquetaService.ts:44` — `async porOrden(actor, ordenId)`:
  - `:50` `const pathPersistido = await this.repo.findDownloadStoragePathByOrdenForOwner(...)`
  - `:51` `if (pathPersistido !== null) return this.firmar(pathPersistido, false);` → reuso
    (`generado: false`).
  - `:58-59` desambiguacion owner-forzada; `:64` generacion; `:77` persiste el path nuevo;
    `:78` `return this.firmar(generado.path, true)` → `generado: true`.
- `lib/services/ApiPdfEtiquetaService.ts:81` — `async porCarga(actor, cargaId)`:
  - `:86-87` lectura de la carga propia.
  - `:90` `if (carga.downloadStoragePath !== null) return this.firmar(carga.downloadStoragePath, false);`
    → reuso.
  - `:94` sin ordenes → `sin_etiqueta`; `:99` generacion.
- Comentario explicito en `:56-57`: las filas heredadas de la 136/141 (`download_url` poblada y
  `download_storage_path` a NULL) "se tratan como sin PDF y se regeneran (R38)".

**Conclusion: CONFIRMADO.** Poner `download_storage_path = NULL` es EXACTAMENTE la palanca que
hace que `/generate` vuelva a generar (R16, T23/T24). `download_url` no participa en la decision.

### (iv) `vercel.json` no tiene ninguna entrada con `0 9 * * *` — CONFIRMADO

`vercel.json:3-24`, los CINCO crons actuales:

| # | linea | path | schedule |
|---|---|---|---|
| 1 | `vercel.json:4-7` | `/api/cron/corte-diario` | `0 6 * * *` |
| 2 | `vercel.json:8-11` | `/api/cron/generar-gastos-fijos` | `0 6 * * *` |
| 3 | `vercel.json:12-15` | `/api/cron/procesar-jobs` | `* * * * *` |
| 4 | `vercel.json:16-19` | `/api/cron/procesar-devueltas-sla` | `0 * * * *` |
| 5 | `vercel.json:20-23` | `/api/cron/sync-plantillas-whatsapp` | `0 3 * * *` |

Ninguna entrada con `0 9 * * *` ni con path `/api/cron/purga-pdf-cargas`.

**Conclusion: CONFIRMADO.** La sexta entrada de T22 no colisiona en `path`. Sobre "no colisiona
en hora": `0 9 * * *` es una hora UTC distinta de las cuatro fijas (`0 6`, `0 3`) y del
`* * * * *` de la cola — ese ultimo corre CADA minuto, asi que "no colisionar con la cola" solo
puede afirmarse como "no comparte path/entrada", no como "no coincide en el minuto".

### (v) Patron de autorizacion de `procesar-devueltas-sla` — CONFIRMADO (con 1 matiz)

`app/api/cron/procesar-devueltas-sla/route.ts`:

- **Handler exportado (nombre exacto):** `handleProcesarDevueltasSla` — `:51-54`
  (`export async function handleProcesarDevueltasSla(req: Request, deps: ProcesarDevueltasSlaDeps = {}): Promise<NextResponse>`).
- **Deps inyectables:** interfaz `ProcesarDevueltasSlaDeps` en `:18-25` con `getSecret?`,
  `service?`, `now?`.
- **Campo del config del secreto:** `CORTE_DIARIO_SECRET`, leido en `:56`
  → `const expected = (deps.getSecret ?? (() => loadCronConfig().CORTE_DIARIO_SECRET))();`
  Definido en `lib/config/cron.ts:7` (`CORTE_DIARIO_SECRET: string | null`) y resuelto en
  `lib/config/cron.ts:10-15` desde `process.env.CRON_SECRET` (`""`/ausente → `null`).
- **Lectura del bearer token:** helper local `bearerToken(req)` en `:38-43` → lee
  `req.headers.get("authorization")`, aplica `/^Bearer\s+(.+)$/` y devuelve `match[1]` o `null`.
- **401 ANTES de efectos:** `:58-60`
  `if (expected === null || provided === null || provided !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });`
  Esto ocurre ANTES de `withErrorHandler` y ANTES de `deps.service ?? buildService()` (`:63`),
  asi que con secreto ausente/incorrecto **ni siquiera se construye el service** ni se toca la DB.
- **Errores:** `withErrorHandler` en `:62`, `isAppErrorShape` + `appErrorToResponse` en `:76`,
  `200` con resumen solo numerico en `:68-73` y `:77`.
- **Verbo:** `export async function GET(req)` en `:80-82`, unico verbo exportado; delega en el
  handler sin deps.

**MATIZ (DESVIACION menor respecto de lo que pide T18):** el fichero **NO declara
`export const maxDuration`**. Verificado: `grep -rn "maxDuration" app/api/cron/` no devuelve
ninguna coincidencia en NINGUNA ruta de cron. Si T18 exige `maxDuration` declarado, sera algo
NUEVO de la 178, no un clon de lo existente.

---

## Reconocimiento extra (planificacion)

### (vi) Default del 2.o parametro de `SupabaseFileStorage` y nombre del bucket de etiquetas

- `lib/storage/SupabaseFileStorage.ts:29` —
  `constructor(storage?: StorageClientLike, bucket: string = postulacionConfig.BUCKET)`.
  El default es el bucket de **postulaciones** (import en `:2`,
  `import { postulacionConfig } from "@/lib/config/postulacion";`).
- Nombre exacto del campo del bucket de etiquetas: **`ETIQUETAS_BUCKET`**, declarado en
  `lib/config/etiquetas.ts:56` y resuelto en `lib/config/etiquetas.ts:83`
  (`process.env.ETIQUETAS_BUCKET?.trim() || "etiquetas-guia"`).
  Singleton exportado: `lib/config/etiquetas.ts:102` → `export const etiquetasConfig: EtiquetasConfig = loadEtiquetasConfig();`

**Conclusion: CONFIRMADO.** T20 (`new SupabaseFileStorage(undefined, etiquetasConfig.ETIQUETAS_BUCKET)`)
es correcto y NECESARIO: sin el 2.o argumento la purga borraria contra el bucket de postulaciones.

### (vii) `readPositiveInt` en `jobs.ts` y `etiquetas.ts` — ambos rechazan el 0 — CONFIRMADO

- `lib/config/jobs.ts:8-13` — `function readPositiveInt(name: string, fallback: number): number`
  (privada al modulo, **no exportada**). `:12` → `return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;`
- `lib/config/etiquetas.ts:7-12` — `function readPositiveInt(name: string, fallback: number): number`
  (privada al modulo, **no exportada**). `:11` → identica condicion `parsed > 0`.
- Ambas son copias literales: nombre identico, firma identica, `raw === undefined || raw === ""`
  → fallback, `parseInt(raw, 10)`, y **`"0"` cae al fallback** porque `0 > 0` es falso.

**Conclusion: CONFIRMADO — R3 exige un helper NUEVO.** Reutilizar `readPositiveInt` haria que
`PURGA_PDF_RETENCION_DIAS="0"` devolviera 7, contradiciendo R3. T4 debe escribir un
`readNonNegativeInt` local (`parsed >= 0`) en `lib/config/purga-pdf.ts`. Ademas ninguno de los
dos esta exportado, asi que ni siquiera es importable.

Nota adicional para T4: `lib/config/etiquetas.ts:102` exporta un singleton ya resuelto; T4 pide
explicitamente **NO** exportar singleton en `purga-pdf.ts` (solo `loadPurgaPdfConfig()`), para
que la config se relea por corrida (R4). `lib/config/jobs.ts` ya sigue ese patron: solo exporta
`loadJobsConfig()` (`:28`), sin singleton.

### (viii) Ejemplo de test estatico de migracion

Hay **61** ficheros `tests/integration/db/*-migration.test.ts`. Dos referencias:

1. `tests/integration/db/gestion-orden-anulacion-migration.test.ts` — el mas completo del patron:
   - `:15` `const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");`
   - `:17-25` `migrationDirFor(suffix)`: busca la carpeta por **sufijo** (no por timestamp).
   - `:28-29` lee `migration.sql` y `down.sql` con `fs.readFileSync(..., "utf8")`.
   - `:30-33` lee ademas `db/schema.prisma` para afirmar ausencia de drift.
   - Afirma por **regex sobre el texto SQL**: DDL esperado (`:55-72`), ausencia de DDL prohibido
     (`:81-86`: `DROP COLUMN` / `ALTER COLUMN` / `DELETE FROM` / `DROP TABLE`), ausencia de RLS
     (`:88-92`), DOWN reversible (`:95-167`) incluido un test de **orden inverso** de sentencias
     (`:147-162`, recorre un array de regex comprobando `downSql.search(re)` creciente), y
     estructura de carpeta (`:194-207`: existen ambos ficheros + timestamp posterior al previo).
2. `tests/integration/db/orden-historial-actor-origen-index-migration.test.ts` — mismo patron,
   caso "solo indices" (el mas cercano a lo que necesita T2).

Ejemplo REAL de migracion solo-indices que sirve de plantilla para T2:
`db/migrations/20260803090000_gestion_orden_idx_created_at/migration.sql`
(`CREATE INDEX IF NOT EXISTS "gestion_orden_created_at_idx" ON "gestion_orden"("created_at");`,
una sola sentencia + cabecera de justificacion) y su
`db/migrations/20260803090000_gestion_orden_idx_created_at/down.sql`
(`DROP INDEX IF EXISTS "gestion_orden_created_at_idx";`).
Su cabecera documenta ademas dos trampas relevantes para T2/T3: **sin `CONCURRENTLY`** (Prisma
corre cada migracion en transaccion) y **Prisma no expresa indices parciales** → el indice
parcial quedara huerfano del datamodel y el `migrate dev` de T3 propondra soltarlo.

**Conclusion: CONFIRMADO**, con la advertencia de T3 ya evidenciada en el repo.

### (ix) Estructura de `db/migrations/` y scripts

- **109 entradas** en `db/migrations/` (108 carpetas + `migration_lock.toml`).
- Formato de carpeta: `<YYYYMMDDHHMMSS>_<slug_snake_case>`, p. ej.
  `20260803120000_download_storage_path` (la ultima), `20260803090000_gestion_orden_idx_created_at`,
  `20260802120000_liquidacion_pago`.
- **`down.sql` presente en las recientes:** verificado en las tres ultimas
  (`20260802120000_liquidacion_pago/`, `20260803090000_gestion_orden_idx_created_at/`,
  `20260803120000_download_storage_path/`): cada una contiene exactamente `migration.sql` + `down.sql`.
- Scripts en `package.json`:
  - `package.json:17` — `"db:generate": "prisma generate"`
  - `package.json:18` — `"db:migrate": "prisma migrate dev"`
  - `package.json:19` — `"db:migrate:create": "prisma migrate dev --create-only"`
  - `package.json:20` — `"db:rollback": "tsx scripts/db-rollback.ts"`
- `scripts/db-rollback.ts:7-16` — `getLastMigrationDir()` ordena las carpetas por nombre
  (`localeCompare`) y toma **la ULTIMA**; `:22-30` aborta con exit 1 si falta `down.sql`.
  Implicacion: el rollback solo revierte la migracion mas reciente, asi que el timestamp de la
  carpeta de T2 debe ser **posterior** a `20260803120000_download_storage_path` para que
  `pnpm db:rollback` la alcance.

**Conclusion: CONFIRMADO.**

### (x) Tests de rutas de cron existentes (patron a clonar)

- **Ruta a clonar:** `tests/integration/actions/procesar-devueltas-sla-route.test.ts`
  (test de **integracion**, Vitest, sin DB ni entorno real).
  - `:4` importa el handler directo: `import { handleProcesarDevueltasSla } from "@/app/api/cron/procesar-devueltas-sla/route";`
  - `:15` `const SECRET = "s3cr3t-cron";`
  - `:17-26` `fakeService(spy)` devuelve `{ service, spy }` con `vi.fn()` tipado.
  - `:28-30` `req(headers)` construye un `Request` nativo con `method: "GET"`.
  - `:32-45` casos 401 (sin header / token incorrecto) afirmando `expect(spy).not.toHaveBeenCalled()`.
  - `:106-107` afirma la entrada de `vercel.json` leyendo el JSON con `fs` y buscando por `path`.
- Otros del mismo patron: `tests/integration/actions/corte-diario-route.test.ts`,
  `generar-gastos-fijos-route.test.ts`, `procesar-jobs-route.test.ts`,
  `liberar-reprogramadas-route.test.ts` (este ultimo, `:108-116`, afirma la **AUSENCIA** de la
  entrada en `vercel.json` — util como plantilla de la asercion negativa).

**Conclusion: CONFIRMADO.** T18/T19/T21/T22 caben en un solo fichero
`tests/integration/actions/purga-pdf-cargas-route.test.ts`.

### (xi) Nombres exactos de los campos Prisma

`model Orden` (`db/schema.prisma:478-582`):

| Campo Prisma | Linea | Tipo | `@map` |
|---|---|---|---|
| `cargaId` | `db/schema.prisma:515` | `String?` | `@map("carga_id")` |
| `downloadUrl` | `db/schema.prisma:516` | `String?` | `@map("download_url")` |
| `downloadStoragePath` | `db/schema.prisma:522` | `String?` | `@map("download_storage_path")` |
| `deletedAt` | `db/schema.prisma:539` | `DateTime?` | `@map("deleted_at")` |
| `createdAt` | `db/schema.prisma:540` | `DateTime` | `@map("created_at")` |

Relacion: `carga` en `db/schema.prisma:550` (`Carga? @relation("OrdenCarga", fields: [cargaId], references: [id], onDelete: Restrict)`).
Tabla: `@@map("orden")` (`:581`).

`model Carga` (`db/schema.prisma:590-610`):

| Campo Prisma | Linea | Tipo | `@map` |
|---|---|---|---|
| `id` | `db/schema.prisma:591` | `String` | — (`@id @default(uuid())`) |
| `fechaCarga` | `db/schema.prisma:592` | `DateTime` | `@map("fecha_carga")` |
| `downloadUrl` | `db/schema.prisma:595` | `String?` | `@map("download_url")` |
| `downloadStoragePath` | `db/schema.prisma:598` | `String?` | `@map("download_storage_path")` |
| `createdAt` | `db/schema.prisma:600` | `DateTime` | `@map("created_at")` |
| `updatedAt` | `db/schema.prisma:601` | `DateTime` | `@map("updated_at")` |

Relacion inversa: `ordenes Orden[] @relation("OrdenCarga")` (`db/schema.prisma:604`).
Tabla: `@@map("carga")` (`:609`).

**`Carga` NO tiene `deletedAt`** — no existe soft delete de lotes (verificado en el bloque
completo `:590-610`). Por tanto R9 ("incluye ordenes borradas") solo aplica al `where` de
`orden`, y en `carga` no hay nada que excluir.

**Otro detalle util:** `Orden.busquedaTexto` (`db/schema.prisma:538`) es una columna GENERADA que
el cliente **omite globalmente** en `lib/db/prisma-client.ts`; el `UPDATE orden` de T8 no debe
tocarla (no la toca, pero conviene no usar `updateMany` con spread de campos).

---

## Bloque A (T2, T3)

### T2 — Migracion de indices parciales

Archivos creados (rutas absolutas):

- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\db\migrations\20260803140000_purga_pdf_indices\migration.sql`
- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\db\migrations\20260803140000_purga_pdf_indices\down.sql`
- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\tests\integration\db\purga-pdf-indices-migration.test.ts`

Contenido, literal segun `design.md` §3:

- **UP** — dos `CREATE INDEX` **parciales**, nada mas:
  `carga_purga_pendiente_idx` sobre `carga("created_at")`
  `WHERE "download_storage_path" IS NOT NULL OR "download_url" IS NOT NULL`, y
  `orden_purga_pendiente_idx` sobre `orden("carga_id")`
  `WHERE "carga_id" IS NOT NULL AND ("download_storage_path" IS NOT NULL OR "download_url" IS NOT NULL)`.
  **Cero DDL sobre datos:** ningun `ALTER TABLE`, `ADD/DROP COLUMN`, `ALTER TYPE`, `CREATE TABLE`,
  `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` ni `ROW LEVEL SECURITY`.
- **DOWN** — los dos `DROP INDEX` en **orden inverso**: primero `orden_purga_pendiente_idx`,
  despues `carga_purga_pendiente_idx`.
- **Sin `CONCURRENTLY`** (Prisma corre cada migracion dentro de una transaccion; mismo motivo que
  las features 126 y 167).
- **Timestamp `20260803140000`**, alfabeticamente **posterior** a
  `20260803120000_download_storage_path`, porque `scripts/db-rollback.ts:7-16` ordena las carpetas
  por nombre y revierte **solo la ultima**.
- **NO se declaran en `db/schema.prisma`:** Prisma no sabe expresar indices parciales (no hay
  `WHERE` en `@@index`). Queda escrito como comentario de encabezado en `migration.sql`, con el
  precedente del repo (los indices parciales de `jobs`, documentados en `db/schema.prisma:1619-1625`)
  y con la regla explicita: si un `migrate dev` futuro propone soltarlos, se descarta la migracion
  propuesta; **nunca** se borra el indice.

### T3 — Drift: **NO MEDIBLE LOCALMENTE** (bloqueado por la migracion fantasma ajena)

`pnpm exec prisma migrate status` (solo lectura) confirma el estado antes de intentar nada:

```
109 migrations found in prisma/migrations
Your local migration history and the migrations table from your database are different:
The last common migration is: 20260803120000_download_storage_path
The migration have not yet been applied:
20260803140000_purga_pdf_indices
The migration from the database are not found locally in prisma/migrations:
20260728120000_orden_historial_origen_deshacer_asignacion
```

Salida **literal** de `pnpm db:migrate` (`prisma migrate dev`), con stdin cerrado para que ningun
prompt pudiera aceptarse:

```
> ordenex@0.1.0 db:migrate C:\Users\Cristian\Documents\trabajo\arc\ordenex
> prisma migrate dev

Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from db\schema.prisma.
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"

- The migration `20260714123909_reconcile_fks_drop_order_status_value` was modified after it was applied.
- The migrations recorded in the database diverge from the local migrations directory. Last common migration: `20260803120000_download_storage_path`. Migrations applied to the database but absent from the migrations directory are: 20260728120000_orden_historial_origen_deshacer_asignacion

We need to reset the "public" schema at "localhost:5432"

You may use prisma migrate reset to drop the development database.
All data will be lost.
 ELIFECYCLE  Command failed with exit code 130.
```

`pnpm db:migrate:create` (`prisma migrate dev --create-only`) aborta con **exactamente el mismo
bloque de drift y el mismo exit 130**: la comprobacion de divergencia ocurre **antes** de generar
nada, asi que ni siquiera llega a proponer SQL.

Hechos y decisiones:

- La causa es **ajena y preexistente** a la feature 178: la migracion
  `20260728120000_orden_historial_origen_deshacer_asignacion` esta **registrada en la base y
  ausente del repo** (mas un checksum modificado en `20260714123909_reconcile_fks_...`). Nada de
  eso lo introduce esta feature.
- **NO se arreglo el drift y NO se reseteo la base.** Se ejecutaron ambos comandos con stdin
  cerrado precisamente para que la propuesta de `migrate reset` no pudiera confirmarse.
- **No quedo ningun artefacto:** `db/migrations/` sigue teniendo `20260803140000_purga_pdf_indices`
  como unica carpeta nueva; `migrate dev --create-only` aborto antes de crear carpeta espuria
  alguna (verificado listando el directorio despues).
- Por tanto **T3 queda NO MEDIBLE LOCALMENTE**. Las dos verificaciones que dependen de una base
  aplicable — (1) que `pnpm db:migrate` aplique el UP y `pnpm db:rollback` lo revierta sin error, y
  (2) si un `migrate dev --create-only` posterior propone o no un `DROP INDEX` fantasma de los dos
  parciales — **quedan PENDIENTES DEL GATE DEL LEADER**, en un entorno con la historia de
  migraciones alineada.
- El riesgo del `DROP INDEX` fantasma esta documentado **por anticipado** en el encabezado de
  `migration.sql` (no se espera a medirlo para dejarlo escrito), con la instruccion de que **nunca**
  se resuelve borrando el indice. Lo que falta es solo la **confirmacion empirica**, no la decision.
- Cobertura suplente mientras tanto: el test estatico de T2 verifica UP/DOWN, la reversibilidad
  simetrica y la ausencia de DDL sobre datos **sin necesidad de Postgres**, que es el patron ya
  usado por los 61 `tests/integration/db/*-migration.test.ts` del repo.

### Mapa R->test (parcial, Bloque A)

| R | Test |
|---|---|
| R26 | `tests/integration/db/purga-pdf-indices-migration.test.ts` — 12 casos en 3 suites: `UP — solo los dos indices PARCIALES de la purga (R26)`, `DOWN — suelta esos dos indices, en ORDEN INVERSO`, `carpeta de la migracion`. **Parcial:** la mitad "`db:migrate` aplica / `db:rollback` revierte + drift medido" queda pendiente del gate del leader (T3, arriba). |

## Salida de tests — Bloque A

`pnpm exec vitest related --run tests/integration/db/purga-pdf-indices-migration.test.ts`:

```
 RUN  v4.1.10 C:/Users/Cristian/Documents/trabajo/arc/ordenex

 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  17:05:36
   Duration  264ms (transform 11ms, setup 33ms, import 23ms, tests 10ms, environment 0ms)
```

`pnpm typecheck`:

```
> ordenex@0.1.0 typecheck C:\Users\Cristian\Documents\trabajo\arc\ordenex
> tsc --noEmit
```

(sin salida = 0 errores.)

`pnpm lint`:

```
✖ 41 problems (0 errors, 41 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**0 errores.** Los 41 warnings son preexistentes (`no-unused-vars` con prefijo `_` en dobles de
test ajenos); ninguno cae en los archivos de esta feature (`pnpm lint | grep -i purga` → sin
coincidencias).

> Las secciones consolidadas de cierre (**Archivos tocados**, **Mapa `R<n>`->test** completo,
> **Salida de tests** y **Riesgos declarados**) estan al FINAL de este documento, tras el Bloque F.

---

## Bloque B (T4, T5)

### Archivos creados

- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\lib\config\purga-pdf.ts` — `PurgaPdfConfig` +
  `loadPurgaPdfConfig()`. Helper local **`readNonNegativeInt`** (ausente / vacia / no entera /
  negativa -> fallback; `>= 0` -> valor tal cual, **sin clamp superior**) para
  `PURGA_PDF_RETENCION_DIAS` (default 7), y `readPositiveInt` local (semantica positiva de
  siempre) para `PURGA_PDF_MAX_CARGAS_POR_CORRIDA` (default 200; `0`/negativo/invalido -> 200,
  porque un tope de 0 no purgaria nunca). **No se exporta ningun singleton ya resuelto** (R4):
  solo la funcion y la interfaz. Confirmado por (vii) del reconocimiento: los `readPositiveInt`
  de `jobs.ts`/`etiquetas.ts` rechazan el `0` y ademas son privados a su modulo.
- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\tests\unit\config\purga-pdf-config.test.ts` —
  11 tests. Ubicacion segun la convencion del repo para `lib/config/*`
  (`tests/unit/config/<modulo>-config.test.ts`, igual que `etiquetas-config.test.ts` y
  `jobs-config.test.ts`).

### Archivos modificados

- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\.env.example` — bloque nuevo
  `# --- Feature 178: purga diaria de los PDF de cargas antiguas ---` justo despues del bloque
  136/177, con `PURGA_PDF_RETENCION_DIAS=` y `PURGA_PDF_MAX_CARGAS_POR_CORRIDA=` (sin valor
  asignado), su default, y la advertencia explicita de que `0` es un valor **valido** (no un
  "desactivado"): purga tambien lo creado el mismo dia, reversible via los `/generate` de la 177.

### Mapa parcial `R<n>` -> test (fichero `tests/unit/config/purga-pdf-config.test.ts`)

| R | Test (nombre exacto) |
|---|---|
| R1 | `loadPurgaPdfConfig — retencion (R1, R2, R3) > R1: lee la retencion de la variable de entorno PURGA_PDF_RETENCION_DIAS` |
| R2 | `... > R2: sin la env definida, la retencion vale 7 dias` y `... > R2: una retencion vacia, no numerica o negativa cae al default de 7 dias` |
| R3 | `... > R3: acepta el "0" tal cual y NO lo manda al default (purga tambien lo creado el mismo dia)` y `... > R3: no aplica ningun tope superior a la retencion (36500 dias se usan tal cual)` |
| R4 | `loadPurgaPdfConfig — resolucion por corrida (R4) > R4: el modulo no exporta ninguna configuracion ya resuelta al importarlo, solo la funcion` y `... > R4: dos llamadas consecutivas con env distinta devuelven ventanas distintas, sin recargar el modulo` |
| R21 | `loadPurgaPdfConfig — tope por corrida (R21) > R21: sin la env definida, el tope de cargas por corrida vale 200`, `... > R21: respeta PURGA_PDF_MAX_CARGAS_POR_CORRIDA cuando es un entero positivo` y `... > R21: un tope vacio, no numerico, cero o negativo cae al default de 200 (un tope de 0 no purgaria nunca)` |

R4 queda cubierto **solo parcialmente** aqui (la config no esta congelada y se relee en cada
llamada); la parte de "dos corridas del service, dos cortes" es de T9.

### Notas / desviaciones

- El test de "no hay singleton" es discriminante por dos vias: afirma que **ninguna** exportacion
  del modulo es algo distinto de una funcion, que las claves exportadas son exactamente
  `["loadPurgaPdfConfig"]`, y que ninguna exportacion es un objeto con `PURGA_PDF_RETENCION_DIAS`.
  Anadir `export const purgaPdfConfig = loadPurgaPdfConfig()` (patron de
  `lib/config/etiquetas.ts:102`) lo pondria en rojo.
- Sin desviaciones respecto de `design.md` §4.1. No se toco `tasks.md`, `feature_list.json`,
  `db/`, ni ninguna seccion ajena de esta bitacora.

## Salida de tests — Bloque B

`pnpm typecheck`:

```
> ordenex@0.1.0 typecheck C:\Users\Cristian\Documents\trabajo\arc\ordenex
> tsc --noEmit
```

(sin salida adicional: 0 errores)

`pnpm lint`:

```
✖ 41 problems (0 errors, 41 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

(0 errores; ninguna advertencia corresponde a `lib/config/purga-pdf.ts` ni a
`tests/unit/config/purga-pdf-config.test.ts` — todas son preexistentes de `no-unused-vars` en
otros ficheros)

`pnpm exec vitest related --run lib/config/purga-pdf.ts`:

```
 RUN  v4.1.10 C:/Users/Cristian/Documents/trabajo/arc/ordenex

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  17:06:10
   Duration  391ms (transform 20ms, setup 55ms, import 46ms, tests 8ms, environment 0ms)
```

**Veredicto Bloque B: T4 y T5 completos; 11/11 verdes, typecheck y lint sin errores.**

---

## Bloque C (T6, T7, T8) — Repositorio

### Archivos creados

- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\lib\interfaces\repositories\IPurgaPdfCargasRepository.ts`
- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\lib\repositories\PurgaPdfCargasRepository.ts`
- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\tests\unit\repositories\purga-pdf-cargas-repository.test.ts`

Ningun archivo existente modificado.

Contrato final (el que consume el service, sin adivinar):

```ts
export interface CargaPurgable { cargaId: string; cargaPath: string | null; ordenPaths: string[] }
export interface IPurgaPdfCargasRepository {
  findCargasPurgables(corte: Date, limite: number): Promise<CargaPurgable[]>;
  quedanCargasPurgables(corte: Date, limite: number): Promise<boolean>;
  limpiarReferencias(cargaId: string): Promise<{ ordenesActualizadas: number }>;
}
```

Constructor: `new PurgaPdfCargasRepository(prisma)` con
`prisma: Pick<PrismaClient, "carga" | "orden" | "$transaction">`.

### Mapa parcial `R<n>` -> test (`tests/unit/repositories/purga-pdf-cargas-repository.test.ts`)

| R | Test (nombre exacto del `it`) |
|---|---|
| R5 | `R5: filtra por createdAt con operador inclusivo lte, nunca por fechaCarga ni con lt` y `R5: ordena por createdAt ASC (lo mas viejo primero) y respeta el limite recibido` |
| R7 | `R7: devuelve la unidad de purga por carga — consolidado + rutas de todas sus ordenes, sin nulos` |
| R8 | `R8: exige referencia viva — en la propia carga (OR de las dos columnas) o via some de sus ordenes` y `R8: sin cargas candidatas no consulta las ordenes y devuelve lista vacia` |
| R9 | `R9: la consulta de rutas de las ordenes NO filtra por deletedAt (los PDF de las borradas ocupan bucket)` (lectura) y `R9: el where del update de ordenes es solo cargaId, sin deletedAt (incluye las borradas)` (escritura) |
| R13 | `R13/R14/R15: el data de ambos updates es exactamente downloadUrl y downloadStoragePath a null` |
| R14 | idem + `R13/R14: ambos updates ocurren dentro de la MISMA transaccion y devuelve las ordenes actualizadas` |
| R15 | `R13/R14/R15: el data de ambos updates es exactamente downloadUrl y downloadStoragePath a null` y `R15: no borra ninguna fila de carga ni de orden` |
| R22 | `R22: devuelve true cuando existe una candidata mas alla del tope de la corrida` y `R22: devuelve false cuando no queda ninguna candidata mas alla del tope` |

### Notas / desviaciones

- **R6 NO se cubre en este bloque, por construccion:** el repositorio no calcula el corte, lo
  RECIBE. Su verificacion vive en T13 (Bloque D). Esto coincide con el mapa del propio `tasks.md`.
- La segunda consulta anade `downloadStoragePath: { not: null }` al `where` de ordenes (ademas del
  `cargaId in`): **no** filtra por `deletedAt`, solo evita traer filas cuya ruta se descartaria
  igualmente al construir `ordenPaths`.
- `quedanCargasPurgables` usa `findFirst` con `skip: limite, take: 1` (no un `count`): el coste no
  crece con el backlog, y **comparte literalmente el `where`** con `findCargasPurgables` via el
  helper `whereCandidatas(corte)`, asi que los dos predicados no pueden divergir.
- Al agrupar se filtra defensivamente `o.cargaId === null` (aunque el `in` ya lo impide) para no
  usar non-null assertion y dejar R17 explicito; el test lo cubre con una fila de `cargaId: null`
  que no aparece en el resultado.
- El `data` de ambos updates es un literal inline, **no un spread**: evita tocar
  `Orden.busquedaTexto` (columna GENERADA, `db/schema.prisma:538`), trampa ya anotada en T1.
- Campo de relacion inversa: `ordenes` (no `orden`), `db/schema.prisma:604`.

### Salida de tests — Bloque C

```
pnpm exec vitest related --run lib/repositories/PurgaPdfCargasRepository.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)   (869 ms)
```

`pnpm typecheck` -> sin salida (0 errores).
`pnpm lint` -> `✖ 41 problems (0 errors, 41 warnings)`; cero ocurrencias de "purga" en la salida.

---

## Bloque D (T9-T17) — Servicio

### Archivos creados

- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\lib\interfaces\services\IPurgaPdfCargasService.ts`
- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\lib\services\PurgaPdfCargasService.ts`
- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\tests\unit\services\purga-pdf-cargas-service.test.ts`

Ningun archivo existente modificado. No se toco la 177 (`design.md` §8).

Constructor (para el composition root):

```ts
export type LeerPurgaPdfConfig = () => PurgaPdfConfig;
constructor(
  private readonly repo: IPurgaPdfCargasRepository,
  private readonly storage: IFileStorage,   // ya construido CON etiquetasConfig.ETIQUETAS_BUCKET (R11)
  private readonly leerConfig: LeerPurgaPdfConfig,
)
```

### Mapa parcial `R<n>` -> test (`tests/unit/services/purga-pdf-cargas-service.test.ts`, `describe("PurgaPdfCargasService")`)

| R | Test (nombre exacto del `it`) |
|---|---|
| R3 | `R3/R5: con retencion 0 el corte es exactamente 'now' y una carga creada esa misma manana entra` |
| R4 | `R4/R5: el corte es 'now - N dias' y la configuracion se relee en CADA corrida` |
| R5 | los tres: `R4/R5: ...`, `R3/R5: ...`, `R5/R6: con corte inclusivo entran las cargas de N y de N+1 dias, y la de N-1 queda intacta` |
| R6 | `R5/R6: con corte inclusivo entran las cargas de N y de N+1 dias, y la de N-1 queda intacta` |
| R8 | `R8/R20: la segunda corrida sobre el mismo estado no encuentra candidatas, no borra ni escribe` |
| R10 | `R10: una sola llamada a 'remove' por carga con el consolidado Y todas las rutas de sus ordenes` y `R10: el consolidado nulo no viaja a 'remove', pero si las rutas de las ordenes` |
| R12 | `R12: una carga elegible sin ninguna ruta referenciada NO invoca 'remove' (ni con lista vacia), pero si se limpia` |
| R17 | `R17: ninguna consulta ni ningun 'remove' alcanza a una orden con 'carga_id' NULL` |
| R19 | `R19: si 'remove' lanza, esa carga NO se limpia, el error se propaga y NO hay reintento interno` |
| R20 | `R20: 'remove' se invoca SIEMPRE antes de 'limpiarReferencias' y el camino feliz limpia` y `R8/R20: la segunda corrida sobre el mismo estado no encuentra candidatas, no borra ni escribe` |
| R21 | `R21/R22: con mas candidatas que el tope se procesan exactamente el tope y la corrida termina con quedaPendiente true` |
| R22 | mismo test que R21 |
| R24 | `R24: el resumen trae los conteos agregados y SOLO numeros (ni rutas, ni carga_id, ni ids)` |

**R11 no aplica a este bloque:** el service RECIBE el `IFileStorage` ya construido; el bucket lo
fija el composition root de la ruta (T20, Bloque E).

### Notas / desviaciones

- `PurgaResultado.quedaPendiente` es `boolean`, asi que el test de R24 afirma "3 numeros + 1
  booleano, cero cadenas en el JSON" en vez de "todo numero": el criterio real (sin PII, sin rutas,
  sin ids) se cubre con `not.toMatch(/:\s*"/)` mas un regex contra los ids/rutas del fixture.
- T11 pedia "no se llama a `remove` con cero rutas" para una carga **elegible sin rutas**: ese caso
  solo puede venir de una carga con `download_url` viva y `download_storage_path` nulo (herencia
  136/141), asi que usa un repo doble ad-hoc.
- **T14 (R17) es necesariamente indirecto en la capa de service:** una orden sin lote no puede
  llegar al service porque el contrato del repo agrupa por `carga_id`. El test afirma (a) su ruta no
  aparece en ninguna llamada a `remove`, (b) su fila sigue con la ruta poblada y (c) el service solo
  usa los tres metodos del contrato (`Object.keys(repo)`). **La garantia SQL fuerte de R17 es la del
  repositorio (T6).**
- El repo doble **aplica el filtro real** (`createdAt <= corte`, referencia viva, ASC, `limite`)
  sobre el fixture, asi que T13 y T17 son discriminantes y no tautologicos: la carga de `N-1` dias
  no recibe ni `remove` ni `limpiarReferencias`.
- El orden `remove` -> `limpiarReferencias` se fija con un log compartido de invocaciones
  (`expect(log).toEqual([...])`) **y ademas** con `mock.invocationCallOrder`; el log prueba tambien
  que el bucle es SECUENCIAL y no entrelazado (dos cargas). El camino de fallo verifica que `remove`
  se invoco **una sola vez** para esa carga: prueba de que no hay reintento interno (R19).
- `objetosBorrados` cuenta **rutas ENVIADAS a borrar**, no confirmadas: documentado en el comentario
  de clase del service y en el JSDoc de la interfaz, con la razon medida en T1(ii).
- Vitest es 4.1.10: la firma generica es `vi.fn<() => T>()`, no la de tuplas de vitest <= 1.

### Salida de tests — Bloque D

```
pnpm exec vitest related --run lib/services/PurgaPdfCargasService.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)   (311 ms)
```

`pnpm typecheck` -> `tsc --noEmit` sin salida (0 errores).
`pnpm lint` -> `✖ 41 problems (0 errors, 41 warnings)`; cero warnings en los tres archivos
(grep por `PurgaPdf|purga-pdf` vacio).

---

## Bloque E (T18-T22) — Cron propio

### Archivos creados

- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\app\api\cron\purga-pdf-cargas\route.ts`
- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\tests\integration\actions\purga-pdf-cargas-route.test.ts`

### Archivos modificados

- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\vercel.json` — **solo se ANADE** la sexta
  entrada `{ "path": "/api/cron/purga-pdf-cargas", "schedule": "0 9 * * *" }` (= 03:00
  America/Costa_Rica; CR es UTC-6 fijo, sin horario de verano). Las cinco existentes quedan byte a
  byte iguales y en el mismo orden.

### Mapa parcial `R<n>` -> test (`tests/integration/actions/purga-pdf-cargas-route.test.ts`)

| R | Test (nombre exacto del `it`) |
|---|---|
| R11 | `R11: construye SupabaseFileStorage con ETIQUETAS_BUCKET y NUNCA con el bucket de postulaciones` y `R11/R4: cablea repo + storage + el LECTOR de config (funcion sin invocar) en el service` |
| R18 | `R18: vercel.json define /api/cron/purga-pdf-cargas con schedule '0 9 * * *' (= 03:00 CR)`, `R18: el schedule es DIARIO (5 campos, minuto y hora fijos, dia/mes/dia-semana '*')`, `R18: ningun otro cron diario comparte su 'minuto hora' (no colisiona con corte-diario, generar-gastos-fijos ni sync-plantillas-whatsapp)` y `R18: la entrada nueva no altera ni reordena las cinco existentes` |
| R23 | `R23/R24: token correcto -> 200 con el resumen agregado SOLO numerico (sin PII ni rutas)`, `R23/R22: propaga quedaPendiente=true en el 200 (la corrida acotada termina en EXITO)`, `R23: pasa el reloj inyectado CRUDO al service (el corte es now - N dias, no un dia natural)`, `R23: la ruta declara maxDuration para que el tope por corrida tenga presupuesto explicito` y `R23: si el service lanza, la respuesta NO es 200, el cuerpo no filtra secreto ni PII, y el error queda registrado` |
| R24 | `R23/R24: token correcto -> 200 con el resumen agregado SOLO numerico (sin PII ni rutas)` |
| R25 | `R25: sin header Authorization -> 401 SIN ejecutar la purga (el service no se invoca)`, `R25: token incorrecto -> 401 sin efectos (el service no se invoca)`, `R25: secreto NO configurado en el entorno -> 401 aunque venga un token (el endpoint no queda abierto)`, `R25: sin Authorization, el GET real responde 401 sin construir NADA (ni repo, ni storage, ni service)` y `R25: con CRON_SECRET ausente del entorno, el GET real responde 401 sin construir NADA` |

### MUTACION EJECUTADA — T20 (R11) discrimina

Comprobado **empiricamente** sobre el composition root (backup + mutacion + `diff` de restauracion
-> `RESTAURADO IDENTICO`):

1. `new SupabaseFileStorage()` (2.o argumento OMITIDO) -> **ROJO**:
   `expected [] to have a length of 2 but got +0`.
   Clave: el doble de `SupabaseFileStorage` **no reproduce el default** `postulacionConfig.BUCKET`,
   asi que la omision no se traga en silencio (documentado en un comentario del propio mock).
2. `new SupabaseFileStorage(undefined, "mensajero-docs")` (bucket EQUIVOCADO) -> **ROJO**:
   `expected 'mensajero-docs' to be 'etiquetas-guia'`.

En ambos casos los otros 15 tests siguieron en verde (fallo localizado, no colateral). El test lleva
ademas una **guardia de discriminacion**: `expect(etiquetasConfig.ETIQUETAS_BUCKET).not.toBe(postulacionConfig.BUCKET)`
— si alguien igualara los dos buckets por env, el test avisa en vez de volverse vacuo.

### Notas / desviaciones

- **Desviacion deliberada respecto del clon:** el guard de autorizacion anade `expected === ""`
  ademas del `=== null` de `procesar-devueltas-sla`. `loadCronConfig()` ya mapea `""` a `null`, pero
  asi el caso (c) de R25 cubre tambien un `getSecret` que devuelva cadena vacia (se prueban los dos
  valores en bucle).
- **`maxDuration = 60` es ADICION NUEVA:** confirmado en T1(v) que **ninguna** otra ruta bajo
  `app/api/cron/` lo declara. Justificado en el comentario del fichero contra `design.md` §2/§2.1 y
  el precedente `app/api/ordenes/api-key/carga/route.ts:75`.
- El tipo de `getSecret` se mantiene `() => string | null` (identico al clon).
- **Guard que puede caducar (a decidir en el review):** el test
  `R18: la entrada nueva no altera ni reordena las cinco existentes` fija el ORDEN COMPLETO del
  array `crons`. Protege la instruccion de "anadir, no reescribir", pero se pondra rojo ante
  cualquier reordenacion futura legitima de `vercel.json`.
- El test de T21 usa un mensaje de error **envenenado** con el secreto y una ruta tipo
  `9f3a/1b2c.pdf`, y comprueba que ninguno aparece en el cuerpo, ademas de que el logger SI se
  invoco (`withErrorHandler` + `normalizeError` registran por `ConsoleErrorLogger` y devuelven
  `INTERNAL` generico).

### Salida de tests — Bloque E

```
pnpm exec vitest related --run app/api/cron/purga-pdf-cargas/route.ts
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

Regresion sobre los 6 tests ajenos que leen `vercel.json` (`corte-diario`, `generar-gastos-fijos`,
`procesar-jobs`, `procesar-devueltas-sla`, `liberar-reprogramadas`,
`notificacion-productores-wiring`): **54 passed, 0 rojos**.

`pnpm typecheck` -> sin salida (0 errores).
`pnpm lint` -> `✖ 41 problems (0 errors, 41 warnings)`; ninguna linea de los dos archivos nuevos.

---

## Bloque F (T23, T24) — Integracion con la feature 177: **R16**

### Archivo creado

- `C:\Users\Cristian\Documents\trabajo\arc\ordenex\tests\integration\purga-pdf-regenera-177.test.ts`

**Cero cambios en codigo de produccion.** La 177 no se toco (`design.md` §8): R16 se cumple por el
ESTADO DE DATOS, no por un caso especial en `ApiPdfEtiquetaService`.

### Mapa `R16` -> test

| Task | Test (nombre exacto del `it`) |
|---|---|
| **T23** | `R16 T23: tras purgar la carga, /generate de carga y de orden devuelven 200 con generado:true, invocan al generador y firman un objeto subido en esa misma llamada` |
| **T24** | `R16 T24: antes de la purga /generate de carga y de orden devuelven 200 con generado:false y NO invocan al generador` |

### Como se garantiza que el estado de datos es COMPARTIDO (y el test no es falso)

Un unico objeto `EstadoDatos` (arrays `cargas` / `ordenes`) esta detras **simultaneamente** del
doble de Prisma que consume el `PurgaPdfCargasRepository` **real** y del doble de `IOrdenRepository`
que consume el `ApiPdfEtiquetaService` **real**: `limpiarReferencias` muta literalmente las mismas
filas que la 177 lee despues. Ademas un `Set` de objetos hace de bucket compartido entre el
`IFileStorage.remove` de la purga y el generador de PDF, de modo que "el objeto original ya no
existe" y "el objeto nuevo se subio en esa llamada" son hechos del mismo almacen, no expectativas
hardcodeadas.

Piezas **reales** bajo prueba: `PurgaPdfCargasService` + `PurgaPdfCargasRepository` +
`ApiPdfEtiquetaService` + `handleCargaGenerateApi` + `handleGenerarPdfOrdenApi`.

### MUTACIONES EJECUTADAS — T23 discrimina (entregable exigido)

**Mutacion 1** — `limpiarReferencias` con `data: { downloadUrl: null }` en ambos updates, SIN
`downloadStoragePath: null` (= "la purga limpia solo la URL", el riesgo real que justifica R16):

```
 ❯ tests/integration/purga-pdf-regenera-177.test.ts (2 tests | 1 failed) 25ms
     × R16 T23: tras purgar la carga, /generate de carga y de orden devuelven 200 con generado:true, ...
AssertionError: expected false to be true // Object.is equality
- Expected
+ Received
- true
+ false
 ❯ tests/integration/purga-pdf-regenera-177.test.ts:484:32
    483|     // 1. Regeneracion, no re-firma de la referencia purgada.
    484|     expect(jsonCarga.generado).toBe(true);
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

T23 **ROJO**, T24 verde. Es exactamente el fallo real: la 177 re-firmaria la ruta purgada y el
integrador recibiria un 200 con una URL que da 404.

**Mutacion 2** — `limpiarReferencias` como no-op (`if (cargaId) return { ordenesActualizadas: 0 };`):

```
 ❯ tests/integration/purga-pdf-regenera-177.test.ts (2 tests | 1 failed) 18ms
     × R16 T23: tras purgar la carga, /generate de carga y de orden devuelven 200 con generado:true, ...
AssertionError: expected false to be true // Object.is equality
- Expected
+ Received
- true
+ false
 ❯ tests/integration/purga-pdf-regenera-177.test.ts:484:32
    483|     // 1. Regeneracion, no re-firma de la referencia purgada.
    484|     expect(jsonCarga.generado).toBe(true);
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

T23 **ROJO**, T24 **VERDE** (como exige el control discriminante de T24).

**Nota de honestidad del subagente:** en la primera pasada la mutacion 2 reventaba en
`expect(resumen.ordenesAfectadas).toBe(1)` — una asercion de contabilidad, **no** el nucleo de R16.
Se reordeno T23 para que las aserciones de R16 vayan primero y las numericas al final, y se
re-corrieron **ambas** mutaciones sobre la forma final del test: las dos fallan ahora en
`expect(jsonCarga.generado).toBe(true)`. Las salidas de arriba son las de esa forma final.

**Restauracion verificada** tras cada mutacion (sin git de escritura; backup con `cp` al scratchpad,
`diff` y `md5sum`):

```
DIFF_VACIO_RESTAURADO
7ffa485cc716ee4c622c4c79c2844879 *lib/repositories/PurgaPdfCargasRepository.ts   (md5 identico al original)
git status --porcelain lib/ app/  -> solo entradas '??' (archivos 178 sin commitear); ni una sola ' M'
```

### Notas / desviaciones

- El doble de Prisma **interpreta** el `where` que construye el repositorio real (no reimplementa su
  logica) y **lanza** ante cualquier filtro o columna de `data` que no conozca: si manana el repo
  emite un filtro nuevo o toca una columna extra (violando R15), el test revienta con un error
  explicito en vez de volverse laxo.
- El camino de orden usa un doble de `IApiOrdenResolucionService` (la resolucion de `{id}` es de la
  177 y no es lo que mide R16); el `ApiPdfEtiquetaService` y los dos handlers de ruta si son reales.
- **Sin bloqueos:** el test no destapo ningun bug en la 178; el codigo pasa T23 y T24 tal cual.

### Salida de tests — Bloque F

```
pnpm exec vitest related --run tests/integration/purga-pdf-regenera-177.test.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

Regresion por importacion:

```
pnpm exec vitest related --run lib/repositories/PurgaPdfCargasRepository.ts \
  lib/services/PurgaPdfCargasService.ts lib/services/ApiPdfEtiquetaService.ts
 Test Files  9 passed (9)
      Tests  96 passed (96)
```

`pnpm typecheck` -> sin salida (0 errores).
`pnpm lint` -> `✖ 41 problems (0 errors, 41 warnings)`; ninguna del archivo nuevo.

---

# CIERRE — Bloque G

## Archivos tocados (consolidado)

### Creados (14)

**Migracion**
1. `db/migrations/20260803140000_purga_pdf_indices/migration.sql`
2. `db/migrations/20260803140000_purga_pdf_indices/down.sql`

**Produccion**
3. `lib/config/purga-pdf.ts`
4. `lib/interfaces/repositories/IPurgaPdfCargasRepository.ts`
5. `lib/repositories/PurgaPdfCargasRepository.ts`
6. `lib/interfaces/services/IPurgaPdfCargasService.ts`
7. `lib/services/PurgaPdfCargasService.ts`
8. `app/api/cron/purga-pdf-cargas/route.ts`

**Tests**
9. `tests/integration/db/purga-pdf-indices-migration.test.ts` (12)
10. `tests/unit/config/purga-pdf-config.test.ts` (11)
11. `tests/unit/repositories/purga-pdf-cargas-repository.test.ts` (12)
12. `tests/unit/services/purga-pdf-cargas-service.test.ts` (12)
13. `tests/integration/actions/purga-pdf-cargas-route.test.ts` (16)
14. `tests/integration/purga-pdf-regenera-177.test.ts` (2)

### Modificados (2)

- `vercel.json` — sexta entrada anadida al final; las cinco existentes intactas y en su orden.
- `.env.example` — bloque nuevo de la 178 tras el bloque 136/177, con las dos claves sin valor.

**No se toco:** `db/schema.prisma`, `lib/services/ApiPdfEtiquetaService.ts` ni nada de la 177, la
cola de la feature 90 (`job_tipo`, `procesar-jobs`, `buildHandlers`, `buildRecurrencias`),
`IFileStorage`, `SupabaseFileStorage`, `OrdenRepository`, `middleware.ts`, `feature_list.json`,
`progress/current.md` ni nada bajo `specs/`.

**Total de tests nuevos: 65** en 6 ficheros.

## Mapa `R<n>` -> test (COMPLETO, los 26)

| R | Que fija | Fichero | Test (nombre exacto del `it`) |
|---|---|---|---|
| R1 | retencion desde env | `tests/unit/config/purga-pdf-config.test.ts` | `R1: lee la retencion de la variable de entorno PURGA_PDF_RETENCION_DIAS` |
| R2 | default 7 ante ausente/invalida/negativa | idem | `R2: sin la env definida, la retencion vale 7 dias` + `R2: una retencion vacia, no numerica o negativa cae al default de 7 dias` |
| R3 | minimo 0, sin tope superior | idem + `tests/unit/services/purga-pdf-cargas-service.test.ts` | `R3: acepta el "0" tal cual y NO lo manda al default (purga tambien lo creado el mismo dia)` + `R3: no aplica ningun tope superior a la retencion (36500 dias se usan tal cual)` + `R3/R5: con retencion 0 el corte es exactamente 'now' y una carga creada esa misma manana entra` |
| R4 | config resuelta por corrida | `tests/unit/config/purga-pdf-config.test.ts` + `tests/unit/services/purga-pdf-cargas-service.test.ts` | `R4: el modulo no exporta ninguna configuracion ya resuelta al importarlo, solo la funcion` + `R4: dos llamadas consecutivas con env distinta devuelven ventanas distintas, sin recargar el modulo` + `R4/R5: el corte es 'now - N dias' y la configuracion se relee en CADA corrida` |
| R5 | corte `created_at <= now - N dias` | `tests/unit/repositories/purga-pdf-cargas-repository.test.ts` + service | `R5: filtra por createdAt con operador inclusivo lte, nunca por fechaCarga ni con lt` + `R5: ordena por createdAt ASC (lo mas viejo primero) y respeta el limite recibido` + `R4/R5: ...` + `R3/R5: ...` + `R5/R6: ...` |
| R6 | dentro de la ventana no se toca nada | `tests/unit/services/purga-pdf-cargas-service.test.ts` | `R5/R6: con corte inclusivo entran las cargas de N y de N+1 dias, y la de N-1 queda intacta` |
| R7 | agrupacion por `carga_id` | `tests/unit/repositories/purga-pdf-cargas-repository.test.ts` | `R7: devuelve la unidad de purga por carga — consolidado + rutas de todas sus ordenes, sin nulos` |
| R8 | no reselecciona cargas ya purgadas | repositorio + service | `R8: exige referencia viva — en la propia carga (OR de las dos columnas) o via some de sus ordenes` + `R8: sin cargas candidatas no consulta las ordenes y devuelve lista vacia` + `R8/R20: la segunda corrida sobre el mismo estado no encuentra candidatas, no borra ni escribe` |
| R9 | incluye ordenes borradas | `tests/unit/repositories/purga-pdf-cargas-repository.test.ts` | `R9: la consulta de rutas de las ordenes NO filtra por deletedAt (los PDF de las borradas ocupan bucket)` + `R9: el where del update de ordenes es solo cargaId, sin deletedAt (incluye las borradas)` |
| R10 | borra consolidado + individuales | `tests/unit/services/purga-pdf-cargas-service.test.ts` | `R10: una sola llamada a 'remove' por carga con el consolidado Y todas las rutas de sus ordenes` + `R10: el consolidado nulo no viaja a 'remove', pero si las rutas de las ordenes` |
| R11 | bucket de etiquetas | `tests/integration/actions/purga-pdf-cargas-route.test.ts` | `R11: construye SupabaseFileStorage con ETIQUETAS_BUCKET y NUNCA con el bucket de postulaciones` (**mutado 2 veces -> rojo**) |
| R12 | sin rutas => sin `remove` | `tests/unit/services/purga-pdf-cargas-service.test.ts` | `R12: una carga elegible sin ninguna ruta referenciada NO invoca 'remove' (ni con lista vacia), pero si se limpia` |
| R13 | NULL en las 2 columnas de `carga` | `tests/unit/repositories/purga-pdf-cargas-repository.test.ts` | `R13/R14/R15: el data de ambos updates es exactamente downloadUrl y downloadStoragePath a null` |
| R14 | NULL en las 2 columnas de `orden` | idem | idem + `R13/R14: ambos updates ocurren dentro de la MISMA transaccion y devuelve las ordenes actualizadas` |
| R15 | ninguna otra columna, ninguna fila borrada | idem | `R13/R14/R15: ...` + `R15: no borra ninguna fila de carga ni de orden` |
| **R16** | `/generate` vuelve a generar tras la purga | `tests/integration/purga-pdf-regenera-177.test.ts` | `R16 T23: tras purgar la carga, /generate de carga y de orden devuelven 200 con generado:true, invocan al generador y firman un objeto subido en esa misma llamada` + control `R16 T24: antes de la purga /generate de carga y de orden devuelven 200 con generado:false y NO invocan al generador` (**mutado 2 veces -> rojo**) |
| R17 | ordenes sin lote intactas | service (indirecto) + repositorio (fuerte) | `R17: ninguna consulta ni ningun 'remove' alcanza a una orden con 'carga_id' NULL` |
| R18 | cadencia diaria 03:00 CR | `tests/integration/actions/purga-pdf-cargas-route.test.ts` | `R18: vercel.json define /api/cron/purga-pdf-cargas con schedule '0 9 * * *' (= 03:00 CR)` + `R18: el schedule es DIARIO (5 campos, minuto y hora fijos, dia/mes/dia-semana '*')` + `R18: ningun otro cron diario comparte su 'minuto hora' ...` + `R18: la entrada nueva no altera ni reordena las cinco existentes` |
| R19 | recuperacion en la corrida siguiente, sin reintentos | `tests/unit/services/purga-pdf-cargas-service.test.ts` | `R19: si 'remove' lanza, esa carga NO se limpia, el error se propaga y NO hay reintento interno` |
| R20 | idempotencia | idem | `R20: 'remove' se invoca SIEMPRE antes de 'limpiarReferencias' y el camino feliz limpia` + `R8/R20: la segunda corrida sobre el mismo estado no encuentra candidatas, no borra ni escribe` |
| R21 | tope configurable por corrida | config + service | `R21: sin la env definida, el tope de cargas por corrida vale 200` + `R21: respeta PURGA_PDF_MAX_CARGAS_POR_CORRIDA cuando es un entero positivo` + `R21: un tope vacio, no numerico, cero o negativo cae al default de 200 (un tope de 0 no purgaria nunca)` + `R21/R22: con mas candidatas que el tope se procesan exactamente el tope y la corrida termina con quedaPendiente true` |
| R22 | pendiente declarado, no encolado | repositorio + service + ruta | `R22: devuelve true cuando existe una candidata mas alla del tope de la corrida` + `R22: devuelve false cuando no queda ninguna candidata mas alla del tope` + `R21/R22: ...` + `R23/R22: propaga quedaPendiente=true en el 200 (la corrida acotada termina en EXITO)` |
| R23 | exito vs fallo distinguibles | `tests/integration/actions/purga-pdf-cargas-route.test.ts` | `R23/R24: token correcto -> 200 con el resumen agregado SOLO numerico (sin PII ni rutas)` + `R23: si el service lanza, la respuesta NO es 200, el cuerpo no filtra secreto ni PII, y el error queda registrado` |
| R24 | conteos sin PII | service + ruta | `R24: el resumen trae los conteos agregados y SOLO numeros (ni rutas, ni carga_id, ni ids)` + `R23/R24: ...` |
| R25 | 401 sin efectos sin `CRON_SECRET` | `tests/integration/actions/purga-pdf-cargas-route.test.ts` | `R25: sin header Authorization -> 401 SIN ejecutar la purga (el service no se invoca)` + `R25: token incorrecto -> 401 sin efectos (el service no se invoca)` + `R25: secreto NO configurado en el entorno -> 401 aunque venga un token (el endpoint no queda abierto)` + `R25: sin Authorization, el GET real responde 401 sin construir NADA (ni repo, ni storage, ni service)` + `R25: con CRON_SECRET ausente del entorno, el GET real responde 401 sin construir NADA` |
| R26 | migracion reversible, solo indices | `tests/integration/db/purga-pdf-indices-migration.test.ts` | 12 casos en 3 suites: `UP — solo los dos indices PARCIALES de la purga (R26)`, `DOWN — suelta esos dos indices, en ORDEN INVERSO`, `carpeta de la migracion`. **PARCIAL:** falta la confirmacion empirica `db:migrate` / `db:rollback` (ver T3, bloqueado por drift ajeno). |

**26 de 26 requisitos mapeados.** Un solo asterisco: R26 tiene su test estatico verde, pero la
mitad "aplica y revierte contra Postgres" quedo pendiente por el drift ajeno de la base local.

## Riesgos declarados (copiados del spec, T26)

1. **Huerfanos de las features 136/141: INALCANZABLES.** De aquellos objetos solo se guardo la URL
   firmada (`download_url`), nunca la ruta, e `IFileStorage.remove` necesita la ruta. Esta purga
   borra **unicamente** objetos cuya ruta este persistida en `download_storage_path`. Los demas
   quedan en el bucket, inalcanzables por codigo. Salida realista: **regla de ciclo de vida del
   bucket** en Supabase Storage (fuera de este repo) o un barrido por `list()` que `IFileStorage` no
   expone. **Ticket aparte recomendado.** Nota: `specs/177-api-consulta-orden-pdf/design.md:84-87`
   daba por hecho que esta feature los barreria; **no puede**.
2. **Ordenes con `carga_id` NULL: FUERA de alcance** (decision (d) del humano). Consecuencia
   directa de agrupar por `carga_id`: el PDF individual de una orden sin lote **no caduca nunca**
   por esta via. R17 lo fija con test para que nadie lo "arregle" por accidente. **Ticket aparte
   recomendado:** purga por antiguedad de `orden.created_at` con su propia ventana.
3. **`objetosBorrados` = "rutas SOLICITADAS", no "confirmadas".** Medido en T1(ii):
   `SupabaseFileStorage.remove` (`lib/storage/SupabaseFileStorage.ts:61`) **descarta el `{ error }`**
   que devuelve el SDK, e `IFileStorage.remove` devuelve `Promise<void>`. Con el contrato actual el
   service **no puede** distinguir un borrado correcto de uno fallido. Corolario: el camino de fallo
   de R19/R20 solo se activa ante **excepciones de red/cliente**, nunca ante un error devuelto por
   Supabase en la respuesta.
4. **Sin reintentos, sin backoff, sin dead-letter y sin traza consultable por ejecucion**, por no
   usar la cola de la feature 90 (decision (c)). La unica senal de fallo es el **codigo HTTP** de la
   respuesta del cron (R23) y el resumen numerico en los logs de Vercel Cron (R24). La recuperacion
   es **la corrida del dia siguiente** (R19). Limitacion asumida y declarada.
5. **T3 no medido:** la validacion de que `pnpm db:migrate` aplica y `pnpm db:rollback` revierte, y
   la medicion del posible `DROP INDEX` fantasma que Prisma proponga por no expresar indices
   parciales, **quedan pendientes** de un entorno con la historia de migraciones alineada. Causa
   ajena y preexistente (migracion `20260728120000_...` en base y ausente del repo). **Nunca** se
   resuelve borrando el indice.
6. **Guard que puede caducar:** `R18: la entrada nueva no altera ni reordena las cinco existentes`
   fija el orden completo del array `crons` de `vercel.json`. Decidir en el review si se conserva o
   se relaja a "las cinco siguen presentes con su schedule".
7. **`maxDuration` en ruta de cron es precedente nuevo:** ninguna otra ruta bajo `app/api/cron/` lo
   declara hoy.

## Salida de tests — consolidada

| Fichero | Tests | Resultado |
|---|---|---|
| `tests/integration/db/purga-pdf-indices-migration.test.ts` | 12 | 12 passed |
| `tests/unit/config/purga-pdf-config.test.ts` | 11 | 11 passed |
| `tests/unit/repositories/purga-pdf-cargas-repository.test.ts` | 12 | 12 passed |
| `tests/unit/services/purga-pdf-cargas-service.test.ts` | 12 | 12 passed |
| `tests/integration/actions/purga-pdf-cargas-route.test.ts` | 16 | 16 passed |
| `tests/integration/purga-pdf-regenera-177.test.ts` | 2 | 2 passed |
| **TOTAL nuevos** | **65** | **65 passed, 0 rojos** |

Regresiones comprobadas por los subagentes (no es la suite entera):

- `vitest related --run lib/repositories/PurgaPdfCargasRepository.ts lib/services/PurgaPdfCargasService.ts lib/services/ApiPdfEtiquetaService.ts` -> **9 ficheros / 96 tests passed**.
- 6 tests ajenos que leen `vercel.json` -> **54 passed, 0 rojos**.

`pnpm typecheck` -> `tsc --noEmit` sin salida: **0 errores**.
`pnpm lint` -> `✖ 41 problems (0 errors, 41 warnings)`: **0 errores**; los 41 warnings son
preexistentes (`no-unused-vars` con prefijo `_` en dobles de test ajenos) y **ninguno** cae en
archivos de esta feature.

### T25 — NO ejecutado por este implementer, por instruccion explicita

La suite completa y `./init.sh` **los corre el leader**, no este implementer (instruccion de la
sesion: el checkout es compartido). El delta de rojos contra el baseline **medido** de `dev` queda
pendiente de ese gate. Lo que si esta medido aqui: 65/65 tests nuevos verdes, typecheck limpio, lint
sin errores, y las regresiones por grafo de imports listadas arriba.

