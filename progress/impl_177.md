# Feature 177 — API: consulta de orden por guía o remisión y generación del PDF por orden y por carga

Bitácora de implementación (BACKEND_DEV). Spec: `specs/177-api-consulta-orden-pdf/`
(`requirements.md`, 45 requisitos; `design.md`; `tasks.md`). Rama: `feature/177-api-consulta-orden-pdf`.

Estado: **T1–T22 hechas** (22/23). T23 queda a medias por diseño: el implementer tiene prohibido
correr la suite entera y `./init.sh`; el gate lo ejecuta el leader. Lo que sí está medido aquí:
`pnpm typecheck` limpio, `pnpm lint` con 0 errores, y los 19 archivos de test de la feature
(y sus no-regresiones) en verde.

---

## Decisiones cerradas de la puerta F1.4

Quedan registradas aquí como fuente para el resto de los bloques. No se reabren.

- **(a) Precedencia fija: gana `num_guia`.** Primero se resuelve `{id}` contra `num_guia`; solo
  si ninguna guía propia coincide se prueba `num_remision`. **No** se responde `409` por
  ambigüedad. Riesgo asumido y declarado: la orden alcanzable solo por una remisión que colisiona
  con la guía de otra orden propia queda invisible por esta ruta, en silencio (R14/R15, con test
  discriminante).
- **(b) `/generate` solo `POST`.** Los dos archivos de ruta de `/generate` exportan únicamente
  `POST`; ningún `GET`, ni siquiera adicional. Next responde `405` al resto de verbos (R44).
- **(c) Carga identificada por uuid + `cargaId` publicado.** La ruta es
  `POST /api/ordenes/api-key/carga/{cargaId}/generate` con `z.string().uuid()`, y publicar
  `cargaId` en el schema `CargaResponse` del OpenAPI (objeto TS + `.yaml` + ejemplo) entra en el
  alcance (R45).
- **(d) Sin modo `force`.** El reuso es incondicional: con `download_storage_path` poblado solo se
  re-firma. Consecuencia asumida: un cambio de layout no es refrescable por API (la única salida
  es la purga de la feature 178).

---

## T1 — Reconocimiento (verificado contra el código)

### (i) `num_guia` / `num_remision`: `@unique` por separado, sin unicidad cruzada — CONFIRMADO

- `db/schema.prisma:480` — `numGuia Int? @unique @map("num_guia")`.
- `db/schema.prisma:481` — `numRemision String @unique @map("num_remision")`.
- El bloque de constraints del modelo `Orden` (`db/schema.prisma:555-574`) está compuesto
  ÚNICAMENTE por `@@index([...])` (`tiendaId`, `estatusId`, `createdAt`, `mensajeroAsignadoId`,
  `zonaId`, `provinciaId`, `cantonId`, `distritoId`, `cargaId`, el GIN de `busquedaTexto`, …):
  el modelo `Orden` **no declara ningún `@@unique`**, por tanto no hay restricción compuesta ni
  cruzada entre ambas columnas. Los `@@unique` más cercanos pertenecen a otros modelos:
  `@@unique([zonaId, distritoId])` (`db/schema.prisma:471`) y
  `@@unique([usuarioCarga, name])` de `Carga` (`db/schema.prisma:597`).
- `db/schema.prisma:1493-1494` — en el modelo espejo/histórico, `numGuia`/`numRemision` van
  explícitamente **SIN** `@unique` ("SIN @unique: es copia, no identidad"): no aporta unicidad.

⇒ El riesgo declarado (a) de `requirements.md` sigue vigente tal cual.

### (ii) `download_url` / `downloadUrl` sigue SIN lectores — CONFIRMADO

Barrido de `downloadUrl|download_url` sobre `app/**` y `lib/**` (`.ts`/`.tsx`). Todas las
apariciones son escrituras, tipos de la respuesta o comentarios; **cero lecturas de la columna**
(ningún `select` de Prisma la proyecta).

Escrituras reales (Prisma):

- `lib/repositories/OrdenRepository.ts:1291` —
  `await this.prisma.carga.update({ where: { id: cargaId }, data: { downloadUrl: url } })`
  (feature 141/R47, URL del consolidado).
- `lib/repositories/OrdenRepository.ts:1303` —
  `await tx.orden.update({ where: { id: item.ordenId }, data: { downloadUrl: item.url } })`
  (feature 141/R48, URL individual por orden).

Escritura en el cuerpo de la respuesta, que **no lee la columna** (usa el mapa en memoria
`urlPorOrden`):

- `app/api/ordenes/api-key/carga/route.ts:368` —
  `ordenes: summary.ordenes.map((o) => ({ ...o, downloadUrl: urlPorOrden.get(o.id) ?? null }))`.

Solo comentarios / documentación de contrato (sin acceso a la columna):
`app/api/ordenes/api-key/carga/route.ts:164,298,316`;
`lib/interfaces/services/IEtiquetasLotePdfService.ts:20`;
`lib/interfaces/services/IEtiquetasDescargaService.ts:5,23,24`;
`lib/interfaces/repositories/IOrdenRepository.ts:736,742`;
`lib/repositories/OrdenRepository.ts:1259`;
`lib/services/EtiquetasLotePdfService.ts:107`;
`lib/services/EtiquetasDescargaService.ts:35,56,65,71`;
`lib/repositories/carga-lote.ts:76`.

⇒ La columna sigue siendo **write-only**; la decisión de R36/R37 (columna nueva
`download_storage_path`) se sostiene sin cambios.

### (iii) `SELF_AUTH_ROUTES` contiene `/api/ordenes/api-key`, match por prefijo — CONFIRMADO

- `middleware.ts:32` —
  `const SELF_AUTH_ROUTES = ["/api/cron", "/api/ordenes/api-key", "/api/webhooks"];`
- `middleware.ts:39-41` — `matches(pathname, routes)` =
  `routes.some((r) => pathname === r || pathname.startsWith(`${r}/`))` (exacto **o** prefijo).
- `middleware.ts:47` — `if (matches(pathname, SELF_AUTH_ROUTES)) return NextResponse.next();`,
  ANTES de leer la cookie de sesión (`middleware.ts:49`).

⇒ Las tres rutas nuevas (`/api/ordenes/api-key/orden/…`, `/api/ordenes/api-key/carga/…`) caen bajo
el prefijo: **no se toca `middleware.ts`** (R40). T19 lo verifica sobre `matches()`.

### (iv) Tipo real de `summary.cargaId` en la vía por API key — **PUEDE SER `null`**

La vía por API key es `BulkOrdenService.cargarViaApi` (no existe ningún método llamado
`createOrdenesConGuia`; el homólogo en el repositorio es `createManyOrdenesConGuia`).

- `lib/services/BulkOrdenService.ts:449-463` — el lote solo se persiste si `toCreate.length > 0`;
  la rama `else` es literalmente `: { creadas: [], cargaId: null }` (`:463`). Una petición cuyas
  filas son TODAS `duplicada` o `error` no crea fila de `carga`, y el `cargaId` es `null`.
- `lib/services/BulkOrdenService.ts:487` — ese valor viaja al summary sin normalizar:
  `this.buildViaApiSummary(rows.length, filas, ordenes, persistido.cargaId)`.
- `lib/services/BulkOrdenService.ts:507-522` — `buildViaApiSummary(..., cargaId: string | null)`
  lo copia tal cual al objeto devuelto (`cargaId` en `:520`).
- `lib/interfaces/services/IBulkOrdenService.ts:45-49` — el contrato lo declara explícito:
  `cargaId: string | null;` con el comentario "`null` si no se creó ninguna orden y por tanto
  ningún lote (R33)".
- `lib/interfaces/repositories/IOrdenRepository.ts:715-731` — `createManyOrdenesConGuia(...)`
  devuelve `Promise<{ creadas: CreateOrdenConGuiaResultRow[]; cargaId: string | null }>`.
- `app/api/ordenes/api-key/carga/route.ts:285,303,367` — el handler toma `cargaResult.summary`
  (`:285`), pasa `cargaId: summary.cargaId` a la descarga (`:303`) y hace `...summary` en la
  respuesta `200` (`:367`): el `null` llega al integrador sin filtro ni default.

**Decisión para R45/T18:** en `CargaResponse` el campo se declara
`cargaId: { type: ["string", "null"], format: "uuid" }` y **NO** se añade a `required`: el
contrato no puede prometer un `string` que la propia respuesta contradice en el caso "0 creadas".

---

## Notas para bloques siguientes

**Repositorio de la 106 (T7 replica su proyección; T21 afirma que no cambió):**

- Interfaz — `lib/interfaces/repositories/IOrdenRepository.ts:596`:
  `findDetalleByNumGuiaForOwner(numGuia: number, ownerId: string): Promise<ApiOrdenDetalleRow | null>;`
- Implementación — `lib/repositories/OrdenRepository.ts:1480-1514`. Proyección a reutilizar en
  `findDetalleByOrdenIdForOwner`: `prisma.orden.findFirst` con
  `where: { numGuia, tiendaId: ownerId, deletedAt: null }` (`:1485`) y
  `select: { ...API_ORDEN_SELECT, gestiones: { where: { resultado: { in: ["entregada","rechazada"] }, evidenciaStoragePath: { not: null } }, select: { resultado, evidenciaStoragePath, evidenciaContentType, createdAt }, orderBy: { createdAt: "asc" } } }`
  (`:1486-1501`); salida `{ ...toApiOrdenRow(row), evidencias: [...] }` (`:1504-1513`).

**Andamiaje de los handlers api-key existentes:**

- `lib/api/api-key-request.ts:18` — `extraerBearer(req: Request): string | null`.
- `lib/api/api-key-request.ts:27` —
  `buildAutenticar(): (rawKey: string | null) => Promise<ApiKeyAuthResult>`.
  Ojo: `app/api/ordenes/api-key/carga/route.ts:142,193` conserva copias LOCALES de ambas
  (anteriores a la extracción). Las rutas nuevas importan las de `lib/api/api-key-request`, como
  hace `app/api/ordenes/api-key/[numGuia]/route.ts:25`.
- Patrón de `deps` inyectables y forma del handler —
  `app/api/ordenes/api-key/[numGuia]/route.ts:27-79`:
  `export interface DetalleApiDeps { autenticar?; lecturaService? }` (`:27-30`), builder privado
  con Prisma/Supabase (`:32-36`), `handleDetalleApi(req, rawParam, deps = {})` (`:42-71`) y un
  `export async function GET` fino que solo hace `await ctx.params` y delega (`:73-79`).
- `lib/errors/with-error-handler.ts:10` — `withErrorHandler<T>(...)`.
- `lib/errors/http.ts:8` — `appErrorToResponse(shape: AppErrorShape): NextResponse`. Uso conjunto:
  `if (isAppErrorShape(result)) return appErrorToResponse(result);`
  (`app/api/ordenes/api-key/[numGuia]/route.ts:69-70`).

**Generador de PDF (features 136/141) y firma:**

- `lib/interfaces/services/IEtiquetasLotePdfService.ts:43-46` —
  `generarYAlmacenar(ordenIds: string[], actor: Actor): Promise<EtiquetasLotePdfResultado | null>`.
- `lib/interfaces/services/IEtiquetasLotePdfService.ts:58-61` —
  `generarYAlmacenarPorOrden(ordenIds: string[], actor: Actor): Promise<EtiquetaOrdenPdfResultado[]>`.
- `lib/interfaces/services/IEtiquetasLotePdfService.ts:8-15` — `EtiquetasLotePdfResultado =
  { path: string; signedUrl: string; expiraEnSegundos: number }` (el `path` es lo que se persiste).
- `lib/interfaces/services/IEtiquetasLotePdfService.ts:22-30` — `EtiquetaOrdenPdfResultado`, igual
  más `ordenId`.
- `lib/interfaces/external/ISignedUrlProvider.ts:8` —
  `createSignedUrl(path: string, expiresInSeconds: number): Promise<string>`.

**Configuración (T5):** `lib/config/etiquetas.ts` — helpers privados
`readPositiveInt(name, fallback)` (`:7-12`) y `clamp(value, min, max)` (`:14-17`);
`export const MAX_SIGNED_URL_TTL_SECONDS = 86_400` (`:26`);
`MAX_ETIQUETAS_POR_PDF_HARD_CAP = 1_000` (`:45`); interfaz `EtiquetasConfig` (`:48-63`) y
`loadEtiquetasConfig()` (`:65-79`), con `SIGNED_URL_TTL_SECONDS` = 3600 (`:68-72`, queda INTACTA)
y `MAX_ETIQUETAS_POR_PDF` (`:73-77`). `API_SIGNED_URL_TTL_SECONDS` se añade con el mismo patrón:
`clamp(readPositiveInt("ETIQUETAS_API_SIGNED_URL_TTL_SECONDS", 300), 1, MAX_SIGNED_URL_TTL_SECONDS)`.

**Contrato publicado (T16/T17/T18):** `lib/api/openapi-spec.ts` publica hoy **4 paths**
(`paths:` en `:80`; `"/api/ordenes/api-key/carga"` `:81`, `"/api/ordenes/api-key"` `:189`,
`"/api/ordenes/api-key/{numGuia}"` `:258`, `"/api/ordenes/api-key/{numGuia}/cancelar"` `:317`)
⇒ pasan a 7. El schema `CargaResponse` vive en `lib/api/openapi-spec.ts:540-551`
(`required: ["total","creadas","duplicadas","conError","filas","ordenes"]` en `:542`) y su espejo
en `docs/api/api-key-openapi.yaml:590`; se referencia por `$ref` desde
`lib/api/openapi-spec.ts:155` y `docs/api/api-key-openapi.yaml:101`, y el ejemplo publicado de la
respuesta `200` de la carga arranca en `lib/api/openapi-spec.ts:156-159` (`examples.resumen`).

**Ruteo (T2):** `app/api/ordenes/api-key/` ya tiene el slug `[numGuia]`; las rutas nuevas se
desambiguan con los segmentos estáticos `orden/` y `carga/`.

---

## Archivos creados / modificados

### Producción — creados

| Archivo | Qué es |
|---|---|
| `app/api/ordenes/api-key/orden/[id]/route.ts` | Controller `GET` de consulta (T13) |
| `app/api/ordenes/api-key/orden/[id]/generate/route.ts` | Controller `POST` de PDF por orden (T14) |
| `app/api/ordenes/api-key/carga/[cargaId]/generate/route.ts` | Controller `POST` de PDF consolidado (T15) |
| `lib/interfaces/services/IApiOrdenResolucionService.ts` | Contrato de resolución `{id}` → orden (T10) |
| `lib/services/ApiOrdenResolucionService.ts` | Precedencia fija `num_guia` > `num_remision` (T10) |
| `lib/interfaces/services/IApiPdfEtiquetaService.ts` | Contrato reuso-o-genera (T11) |
| `lib/services/ApiPdfEtiquetaService.ts` | `porOrden` / `porCarga` (T11) |
| `lib/api/api-orden-identificador.ts` | zod compartido del path `{id}` (refactor de limpieza) |
| `db/migrations/20260803120000_download_storage_path/migration.sql` | UP: 2 `ADD COLUMN` (T4) |
| `db/migrations/20260803120000_download_storage_path/down.sql` | DOWN: 2 `DROP COLUMN`, orden inverso (T4) |

### Producción — modificados

| Archivo | Qué cambió |
|---|---|
| `db/schema.prisma` | `downloadStoragePath String? @map("download_storage_path")` en `Orden` y en `Carga` (T3) |
| `lib/config/etiquetas.ts` | `API_SIGNED_URL_TTL_SECONDS` (env `ETIQUETAS_API_SIGNED_URL_TTL_SECONDS`, default 300, clamp `[1, MAX_SIGNED_URL_TTL_SECONDS]`). `SIGNED_URL_TTL_SECONDS` (3600) intacta (T5) |
| `lib/interfaces/repositories/IOrdenRepository.ts` | 5 firmas nuevas (T6–T9) |
| `lib/repositories/OrdenRepository.ts` | 5 métodos nuevos + extracción de `API_ORDEN_DETALLE_SELECT`/`toApiOrdenDetalleRow` compartidos con la 106 (T6–T9) |
| `lib/interfaces/services/IApiOrdenLecturaService.ts` | **Adición** de `detallePorOrdenId(actor, ordenId)`; `detalle` intacto (refactor) |
| `lib/services/ApiOrdenLecturaService.ts` | `detallePorOrdenId` + helper privado `toDetalleDTO` común; `detalle(actor, numGuia)` conserva firma, comportamiento y proyección (R17) |
| `lib/api/openapi-spec.ts` | 4 → **7 paths**, schema `PdfGenerateResponse`, `cargaId` en `CargaResponse` y en el ejemplo (T16/T18). +201 líneas, 0 borradas |
| `docs/api/api-key-openapi.yaml` | Espejo de lo anterior (T17/T18). +177 líneas, 0 borradas |
| `.env.example` | Documenta `ETIQUETAS_API_SIGNED_URL_TTL_SECONDS` |

`middleware.ts` **no se tocó** (R40): el prefijo `/api/ordenes/api-key` ya cubre las tres rutas.
`app/api/ordenes/api-key/[numGuia]/**` y `/cancelar` **no se tocaron** (R17).
`download_url` no se lee ni se escribe en ninguna línea nueva.

### Tests — creados

| Archivo | Tests |
|---|---|
| `tests/unit/repositories/orden-repository.api-consulta-pdf.test.ts` | 24 |
| `tests/unit/repositories/orden-repository.no-regresion-106.test.ts` | 8 |
| `tests/unit/services/api-orden-resolucion-service.test.ts` | 10 |
| `tests/unit/services/api-pdf-etiqueta-service.test.ts` | 14 |
| `tests/unit/services/api-pdf-etiqueta-columna-intacta.test.ts` | 5 |
| `tests/unit/services/api-orden-lectura-service.por-orden-id.test.ts` | 4 |
| `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` | 11 |
| `tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts` | 15 |
| `tests/integration/api/ordenes-api-key-orden-generate.route.test.ts` | 9 |
| `tests/integration/api/ordenes-api-key-carga-generate.route.test.ts` | 14 |
| `tests/integration/api/ordenes-api-key-177-key-nunca-filtrada.route.test.ts` | 9 |

### Tests — modificados

- `tests/unit/config/etiquetas-config.test.ts` — ampliado con 5 casos del TTL nuevo (T5).
- `tests/unit/auth/middleware.test.ts` — ampliado con 4 casos de R40 (T19).
- `tests/unit/services/orden-service.test.ts`, `bulk-orden-service.test.ts`,
  `bulk-orden-service.carga-api.test.ts`, `rol-admin-satelite-authz.test.ts`,
  `tests/integration/api/ordenes-api-key-detalle.route.test.ts`, `...-listado.route.test.ts`,
  `...-seguridad.route.test.ts` — **solo stubs** en fakes exhaustivos de `IOrdenRepository` /
  `IApiOrdenLecturaService` (el typecheck los exige). Ningún assert tocado.
- **Ningún guard existente fue editado.** `tests/unit/api/openapi-contrato-en-reparto.test.ts`
  sigue verde sin cambios y `enumsTs` sigue en 4.

---

## Migración: round-trip verificado (T4/R39)

`db/migrations/20260803120000_download_storage_path/`. Ninguna sentencia menciona `download_url`
(solo aparece en 4 líneas de comentario).

```
Applying migration `20260803120000_download_storage_path`
All migrations have been successfully applied.

$ pnpm db:rollback
Aplicando rollback: 20260803120000_download_storage_path
Script executed successfully.
Script executed successfully.
Rollback completado: 20260803120000_download_storage_path

# tras el rollback el diff vuelve a proponer exactamente las dos columnas (el DOWN revirtió de verdad):
ALTER TABLE "carga" ADD COLUMN     "download_storage_path" TEXT;
ALTER TABLE "orden" ADD COLUMN     "download_storage_path" TEXT;

# re-aplicar y comprobar diff vacío:
Applying migration `20260803120000_download_storage_path`
All migrations have been successfully applied.
$ prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script --exit-code
-- This is an empty migration.
EXIT=0
```

**Desviación declarada:** `pnpm db:migrate` (= `prisma migrate dev`) **no puede correr en esta base**
por un drift PREEXISTENTE y ajeno a la 177: la DB local tiene registrada
`20260728120000_orden_historial_origen_deshacer_asignacion`, que no existe en `db/migrations/` ni en
ningún commit, y `20260714123909_reconcile_fks_drop_order_status_value` fue modificada tras aplicarse.
`migrate dev` solo ofrece reset destructivo; **no se reseteó**. La migración se aplicó con
`prisma migrate deploy`, que es exactamente lo que corre `scripts/migrate-deploy.ts:68` en el build.
El rollback sí usó `pnpm db:rollback` tal cual.

---

## Salida real de la verificación

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm lint
✖ 41 problems (0 errors, 41 warnings)
```

Los 41 warnings son `@typescript-eslint/no-unused-vars` sobre parámetros con prefijo `_` en dobles
de test; 27 son preexistentes y 14 nacen de los fakes `vi.fn` de esta feature, mismo patrón ya
presente en el repo (`deshacer-asignacion-service.test.ts` y otros). **Cero errores.**

```
$ pnpm exec vitest run <19 archivos: los 11 nuevos, los 2 ampliados y 6 de no-regresión
  (106: detalle/cancelar/api-lectura/lectura-service; 88: carga; guard openapi)>

 Test Files  19 passed (19)
      Tests  237 passed (237)
   Duration  3.52s
```

No-regresión medida por separado, sin editar un solo test ajeno:
feature 88 (`ordenes-api-key-carga.route.test.ts`) **31 passed**;
feature 106 (`detalle` + `cancelar` + `api-orden-lectura-service` + `orden-repository.api-lectura`)
**28 passed**.

`pnpm exec next build` (T2) compiló el árbol de rutas sin el error
"You cannot use different slug names for the same dynamic path"; las 6 rutas del canal conviven:

```
├ ƒ /api/ordenes/api-key/[numGuia]
├ ƒ /api/ordenes/api-key/[numGuia]/cancelar
├ ƒ /api/ordenes/api-key/carga
├ ƒ /api/ordenes/api-key/carga/[cargaId]/generate
├ ƒ /api/ordenes/api-key/orden/[id]
├ ƒ /api/ordenes/api-key/orden/[id]/generate
```

---

## Mutaciones ejecutadas (ningún test verde por casualidad)

`docs/verification.md` rechaza los tests que siguen verdes con la implementación rota. Se rompió a
propósito cada pieza y se comprobó el rojo; **todas las restauraciones se verificaron** con `diff`
contra copia previa o con `git hash-object` idéntico antes/después.

| # | Qué se rompió | Test que se puso ROJO |
|---|---|---|
| 1 | `DEFAULT_API_SIGNED_URL_TTL_SECONDS` 300 → 301 | 2 rojos en `etiquetas-config` (`expected 301 to be 300`) |
| 2 | Se quitó el `clamp` del TTL | `acota la env al maximo…` (`Expected 86400 / Received 86401`) |
| 3 | `findByGuiaORemisionForOwner` sin `tiendaId` | `R7/R12: el where fuerza tiendaId = ownerId…` |
| 4 | `findDetalleByOrdenIdForOwner` sin `deletedAt` | `R16: orden BORRADA devuelve null…` |
| 5 | `downloadUrl: null` en el `data` de `setOrdenDownloadStoragePath` | `R26: el update emite UNA sola clave en data…` |
| 6 | `findCargaConOrdenesForOwner` sin `usuarioCarga` | `R29: carga AJENA devuelve null…` |
| 7 | Prefijo fuera de `SELF_AUTH_ROUTES` | los 3 tests de R40 (`expected 307 to be 200`); el control negativo siguió verde |
| 8 | **Precedencia invertida** (remisión primero) | `R14 (DISCRIMINANTE)…` con `expected 'B' to be 'A'` |
| 9 | `resolver` sin `trim()` | `R6: normaliza el identificador con trim…` |
| 10 | Testigo de existencia = `download_url` en vez de `downloadStoragePath` | 5 rojos: reuso orden, R23, R37/R38, reuso carga, carga heredada |
| 11 | Generador invocado ANTES del chequeo de owner | los 2 tests de aislamiento de T12 |
| 12 | zod `{id}` sin `min(1).max(128)` | 6 rojos de 422 (`expected 404 to be 422`) en consulta y generate |
| 13 | 404 de "ajena" con mensaje distinto del de "inexistente" | `R12: 404 de orden ajena BYTE-IDENTICO…` |
| 14 | `export const GET = POST` en `/generate` por orden | `R44: el modulo de ruta no exporta GET…` |
| 15 | `z.string().uuid()` → `min(1)` en carga | los 2 tests de 422 (incl. el del `name` del lote) |
| 16 | `excede_tope` mapeado a 500 | `R34: 409 CONFLICT cuando el lote excede el tope` (`expected 500 to be 409`) |
| 17 | `export const GET = POST` en `/generate` por carga | los 2 tests de R44 |
| 18 | Campo extra en `API_ORDEN_DETALLE_SELECT` | `envia a Prisma exactamente la misma proyeccion que antes de la 177` |
| 19 | Path borrado del OpenAPI | 4 rojos (`to have a length of 7 but got 6`) |
| 20 | `cargaId` a `type: string` en el `.yaml` | `el .yaml declara cargaId igual que el objeto TS…` |
| 21 | `cargaId` fuera del ejemplo publicado | `el ejemplo publicado … muestra el cargaId` |
| 22 | Argumentos invertidos en `detallePorOrdenId` | `R4/R7: el ownerId que llega al repo es actor.usuarioId` |
| 23 | `console.error("bearer:", rawKey)` en la consulta | solo el describe de ese endpoint |
| 24 | Ídem en `/generate` por orden | solo el describe de ese endpoint |
| 25 | Ídem en `/generate` por carga | solo el describe de ese endpoint |
| 26 | `downloadUrl: null` en el update de orden (camino real) | tests 1 y 2 de columna-intacta |
| 27 | `name: "x"` en el update de carga | test 4 de columna-intacta |

---

## Mapa `R<n> → test`

| R | Test que lo cubre |
|---|---|
| R1 | `ordenes-api-key-orden-consulta.route` › `R1: sin Bearer, con esquema distinto o con token vacio -> 401 sin tocar DB ni Storage`; ídem en `...-orden-generate.route`; `...-carga-generate.route` › `R42: 401 sin header Authorization, sin invocar el service` + `R42: 401 con esquema distinto de Bearer y con token vacio` |
| R2 | `ordenes-api-key-orden-consulta.route` › `R2: key desconocida -> 401 indistinguible de 'no presento key'` |
| R3 | `...-orden-consulta.route` y `...-orden-generate.route` › `R3: usuario o key no activos -> 403 sin leer ordenes ni tocar Storage`; `...-carga-generate.route` › `R42: 403 cuando el usuario o la key no estan activos, sin invocar el service` |
| R4 | `api-pdf-etiqueta-service` › `el ownerId que llega al repositorio es actor.usuarioId, nunca un dato de la peticion (R4/R7)`; `api-orden-resolucion-service` › `R4: el owner pasado al repositorio es actor.usuarioId, nunca un valor de la peticion`; `api-orden-lectura-service.por-orden-id` › `R4/R7: el ownerId que llega al repo es actor.usuarioId (y el ordenId va como ordenId)` |
| R5 | `ordenes-api-key-177-key-nunca-filtrada.route` › los 9 casos (3 endpoints × 401/403/500) |
| R6 | `orden-repository.api-consulta-pdf` › `R6: una sola coincidencia devuelve id, numGuia y numRemision de esa fila`; `api-orden-resolucion-service` › `R6/R9: resuelve por num_guia…` y `R6/R15: resuelve por num_remision…` |
| R7 | `orden-repository.api-consulta-pdf` › `R7/R12: el where fuerza tiendaId = ownerId y deletedAt: null`; `api-pdf-etiqueta-service` › tests de aislamiento (T12) |
| R8 | `orden-repository.api-consulta-pdf` › `R8: con numGuia null NO se emite ninguna condicion sobre numGuia`; `api-orden-resolucion-service` › `R8: con identificador no numerico el repo recibe numGuia: null…` y `R8: '007', '0', '-3', '1.5', '1e3' y un entero fuera del rango int4 no son candidatos a guia` |
| R9 | `orden-repository.api-consulta-pdf` › `R9: con entero positivo evalua AMBAS columnas en el OR`; `api-orden-resolucion-service` › `R6/R9: resuelve por num_guia…` |
| R10 | `orden-repository.api-consulta-pdf` › `R10: compara por IGUALDAD exacta, nunca contains/startsWith/endsWith/mode` |
| R11 | `orden-repository.api-consulta-pdf` › `R11: sin coincidencias devuelve lista vacia`; `api-orden-resolucion-service` › `R11/R12: sin filas coincidentes devuelve not_found`; `...-orden-consulta.route` › `R11: 404 cuando ninguna orden propia coincide` |
| R12 | `...-orden-consulta.route` › `R12: 404 de orden ajena BYTE-IDENTICO al 404 de inexistente`; `api-pdf-etiqueta-service` › `porOrden con una orden ajena devuelve not_found y NO invoca al generador ni firma nada (R4/R7/R12)`; `orden-repository.api-consulta-pdf` › `R7/R12…` |
| R13 | `...-orden-consulta.route` › `R13: 422 con {id} vacio / solo espacios / mas de 128 chars, sin tocar la DB` (3 casos); `...-orden-generate.route` › `R19/R13: 422 con {id} vacio / solo espacios / mas de 128 chars, sin tocar la DB ni Storage` |
| **R14** | **DISCRIMINANTE, tres niveles:** `api-orden-resolucion-service` › `R14 (DISCRIMINANTE): con la guia de A y la remision de B casando a la vez devuelve A y no B` (afirma `orden.id === "A"` y `!== "B"`) + `R14: el orden en que el repositorio devuelve las filas no altera el ganador`; `...-orden-consulta.route` › `R14 (DISCRIMINANTE, extremo a extremo): … devuelve A, no B` (afirma `numRemision === "REM-A"`); `...-orden-generate.route` › `R14 (DISCRIMINANTE): con la guia de A y la remision de B se genera el PDF de A` (afirma el `ordenId` recibido por el generador). Mutación #8 confirma que discriminan. |
| R15 | `api-orden-resolucion-service` › `R6/R15: resuelve por num_remision cuando ninguna guia propia coincide` + `R15: ninguna rama produce 409 ni un estado de conflicto (0, 1 y 2 filas; numerico y no numerico)`; `...-orden-consulta.route` › `R15: 200 resolviendo por remision…` + `R15/R42: ningun caso responde 409…` |
| R16 | `orden-repository.api-consulta-pdf` › los 5 tests de `findDetalleByOrdenIdForOwner`; `api-orden-lectura-service.por-orden-id` › los 3 primeros; `...-orden-consulta.route` › `R6/R9/R16: 200 resolviendo por guia` + `R16: 200 con evidencias vacias -> []` |
| R17 | `orden-repository.no-regresion-106` › los 8 tests (aridad, proyección contra literal congelado, `where`, verbos exportados, rutas físicas). Los 28 tests de la 106 pasan sin editarlos. |
| R18 | `...-orden-consulta.route` › `R18: la respuesta 200 no expone storagePath, bucket, ids internos ni PII de mensajero` |
| R19 | `...-orden-generate.route` › `R19/R12: 404 con orden ajena` + `R19/R13: 422 …` + el discriminante de R14 |
| R20 | `api-pdf-etiqueta-service` › `genera, sube y persiste el path DEVUELTO por el generador (R20/R22)`; `...-orden-generate.route` › `R20/R21/R22/R27: 200 generado:true la primera vez y generado:false la segunda, con URL distinta` |
| R21 | `api-pdf-etiqueta-service` › `reusa el PDF persistido: no genera ni sube y firma exactamente el path guardado con TTL 300 (R21/R22/R24/R37)`; `api-pdf-etiqueta-columna-intacta` › `R21/R31: con la referencia ya persistida la segunda invocacion NO escribe absolutamente nada` |
| R22 | `api-pdf-etiqueta-service` › tests 1, 2 y 7; `...-orden-generate.route` › `R20/R21/R22/R27…`; `...-carga-generate.route` › `R28/R30…` y `R28/R31…` |
| R23 | `api-pdf-etiqueta-service` › `la URL devuelta sale SIEMPRE de createSignedUrl y nunca de una download_url persistida (R23)` + `la carga heredada … nunca devuelve la URL heredada (R23/R37/R38)` |
| R24 | `etiquetas-config` › `vale 300 segundos por defecto cuando la env no esta definida`; `api-pdf-etiqueta-service` › tests 1 y 7 (afirman TTL 300 en `createSignedUrl`) |
| R25 | `api-pdf-etiqueta-service` › `sin etiqueta imprimible: devuelve sin_etiqueta y no sube ni persiste (R25)`; `...-orden-generate.route` › `R25: 409 CONFLICT cuando la orden no tiene guia; no sube ni persiste` |
| R26 | `orden-repository.api-consulta-pdf` › `R26: el update emite UNA sola clave en data (downloadStoragePath) y no incluye downloadUrl`; `api-pdf-etiqueta-columna-intacta` › tests 1, 2 y 3 |
| R27 | `...-orden-generate.route` › `R20/R21/R22/R27: … la segunda con URL distinta` (una sola subida en dos llamadas) |
| R28 | `...-carga-generate.route` › `R28/R30: 200 con url, expiraEnSegundos y generado:true…` + `R28/R31: 200 con generado:false…` |
| R29 | `orden-repository.api-consulta-pdf` › `R29: carga AJENA devuelve null…` y `R29: carga INEXISTENTE devuelve null…`; `api-pdf-etiqueta-service` › `porCarga con una carga ajena devuelve not_found y NO invoca al generador ni firma nada (R29)`; `...-carga-generate.route` › `R29: 404 …` (los dos, con cuerpo byte-idéntico) |
| R30 | `api-pdf-etiqueta-service` › `genera el consolidado con los ordenIds del repositorio y persiste el path devuelto (R30/R32)`; `...-carga-generate.route` › `R28/R30…` |
| R31 | `api-pdf-etiqueta-service` › `reusa el consolidado persistido: no genera y solo re-firma el path guardado con TTL 300 (R31/R22/R24)`; `...-carga-generate.route` › `R28/R31…` |
| R32 | `orden-repository.api-consulta-pdf` › `R32: excluye del lote las ordenes borradas y las de otro owner`; `api-pdf-etiqueta-service` › `…(R30/R32)` |
| R33 | `api-pdf-etiqueta-service` › `lote sin etiquetas imprimibles: devuelve sin_etiqueta y no sube ni persiste (R33)`; `...-carga-generate.route` › `R33: 409 CONFLICT cuando el lote no tiene ninguna etiqueta imprimible` |
| R34 | `api-pdf-etiqueta-service` › `excede el tope: no construye el PDF, no sube y no persiste (R34)` (con el `EtiquetasLotePdfService` REAL y `build`/`upload` espiados en 0); `...-carga-generate.route` › `R34: 409 CONFLICT cuando el lote excede el tope de etiquetas por PDF` |
| R35 | `orden-repository.api-consulta-pdf` › `R35: el update de carga toca UNA sola columna y no incluye downloadUrl`; `api-pdf-etiqueta-columna-intacta` › test 4 |
| R36 | Migración T4 (round-trip arriba) + `api-pdf-etiqueta-service` › `genera, sube y persiste el path DEVUELTO por el generador` (se persiste una RUTA, no una URL) |
| R37 | `api-pdf-etiqueta-service` › `decide el reuso por downloadStoragePath y nunca por download_url: la fila heredada regenera (R37/R38)`. Mutación #10 lo confirma. |
| R38 | `orden-repository.api-consulta-pdf` › `R38: fila heredada de la 136/141 (download_url poblada, path NULL) devuelve null`; `api-pdf-etiqueta-service` › tests 6 y 11; `api-pdf-etiqueta-columna-intacta` › tests 1 y 4 |
| R39 | T4: `db:rollback` + re-aplicación con `migrate diff --exit-code` = 0 (salida pegada arriba) |
| R40 | `middleware.test` › los 3 tests `R40: … sin cookie de sesion NO recibe 307 a /login` + `R40 (control): /api/ordenes/orden/ABC-123 … sigue siendo privada y redirige a /login` |
| R41 | `openapi-177-paths-pdf-y-carga-id` › `el objeto TS declara exactamente siete paths…`, `…los tres endpoints nuevos…`, `el .yaml publicado declara los mismos siete paths, en el mismo orden`, `…reutiliza el schema OrdenDetalle de la 106`, `…solo POST y devuelven PdfGenerateResponse`, `…PdfGenerateResponse…` (TS y yaml), `…reutilizan las responses de error existentes por $ref`. `openapi-contrato-en-reparto` verde sin editar, `enumsTs` = 4. |
| R42 | `...-orden-consulta.route` › `R15/R42: ningun caso responde 409 y todo error usa status/code/message con codigos existentes`; `...-carga-generate.route` › los 6 casos etiquetados `R42` |
| R43 | `etiquetas-config` › `respeta el valor de ETIQUETAS_API_SIGNED_URL_TTL_SECONDS cuando es un entero positivo valido`, `cae al default de 300 cuando la env es cero, negativa o no numerica`, `acota la env al maximo cuando pide un TTL mayor que MAX_SIGNED_URL_TTL_SECONDS` |
| R44 | `...-orden-generate.route` › `R44: el modulo de ruta no exporta GET; POST es el UNICO verbo HTTP exportado`; `...-carga-generate.route` › `R44: el modulo de ruta no exporta GET` + `R44: POST es el UNICO verbo HTTP exportado por el modulo` |
| R45 | `openapi-177-paths-pdf-y-carga-id` › `el objeto TS declara cargaId como uuid nullable y NO lo exige en required`, `el .yaml declara cargaId igual que el objeto TS (string\|null, format uuid, no required)`, `el ejemplo publicado de POST /api/ordenes/api-key/carga muestra el cargaId` |

**45/45 requisitos mapeados a un test concreto.**

---

## Desviaciones respecto del design (declaradas, no ocultas)

1. **`porOrden` hace una segunda lectura owner-forzada en la rama sin path.**
   `findDownloadStoragePathByOrdenForOwner` colapsa "propia sin PDF" y "ajena/borrada/inexistente"
   en el mismo `null`, así que por sí solo no permite devolver `not_found` sin pasar por el
   generador (lo que T12 prohíbe). El service desambigua con `findDetalleByOrdenIdForOwner`, que ya
   fuerza owner y `deleted_at IS NULL`. La rama de reuso no paga esa consulta: un path devuelto ya
   implica propiedad. Alternativa más barata si el reviewer la prefiere: un `existsOrdenForOwner`
   en `IOrdenRepository`.
2. **La rama "generado" re-firma con `createSignedUrl(path, ttl)`** en vez de reenviar el
   `signedUrl` que ya devuelve el generador de la 136. Así R23/R24 quedan garantizados por este
   service con independencia del TTL con que se instancie `EtiquetasLotePdfService`. Coste: una
   firma extra por generación.
3. **`porCarga` corta a `sin_etiqueta` sin llamar al generador cuando `ordenIds` viene vacío**
   (lote sin órdenes propias vivas). Equivalente observable a `generarYAlmacenar([])` → `null`,
   ahorrando el round-trip.
4. **Normalización del identificador (R8/R10).** Se exige representación decimal canónica
   `^[1-9][0-9]*$` para considerar `{id}` candidato a `num_guia`. Por tanto `"007"`, `"0"`, `"-3"`,
   `"1.5"`, `"1e3"`, `"+7"`, `"0x10"` y los enteros fuera del rango `int4` **no** son candidatos y
   resuelven solo contra `num_remision`. Interpretar `"007"` como la guía 7 sería una normalización
   silenciosa que R10 prohíbe, y `"007"` es una remisión plausible. Documentado en el código.
5. **Refactor de limpieza posterior al Bloque E.** El primer corte del handler de consulta usaba un
   adaptador cuyo `findDetalleByNumGuiaForOwner` ignoraba su primer parámetro, y `/generate`
   importaba el zod desde `../route` (módulo de ruta importando a su hermano). Ambos se eliminaron:
   el zod vive en `lib/api/api-orden-identificador.ts` y `ApiOrdenLecturaService` gana
   `detallePorOrdenId` como **adición** (los 8 tests de no-regresión de la 106 siguen verdes sin
   editarlos, R17).
6. **`excede_tope` en `/generate` por orden se mapea también a 409**, defensivamente: una sola orden
   no puede superar `MAX_ETIQUETAS_POR_PDF`, así que el caso es inalcanzable por esa ruta y no tiene
   test propio. R34 lo cubren T11 y T15 por la vía de carga.
7. **`pnpm db:migrate` inutilizable en la base local** por drift preexistente (ver §Migración). Se
   usó `prisma migrate deploy`. Punto abierto para el humano: decidir si la migración fantasma
   `20260728120000_orden_historial_origen_deshacer_asignacion` se recupera o se borra del registro.
8. **`pnpm lint` sube de 27 a 41 warnings** (0 errores): 14 `no-unused-vars` sobre parámetros `_`
   de los dobles `vi.fn`, necesarios para que `toHaveBeenCalledWith` tipe. Mismo patrón ya presente
   en el repo.

---

## Riesgo declarado (a), reafirmado tras implementar

La precedencia fija hace que una orden propia cuyo `num_remision` coincide con el `num_guia` de otra
orden propia quede **inalcanzable por esta ruta**, sin ninguna señal para el integrador. Está fijado
por los tres tests discriminantes de R14 y confirmado por la mutación #8. Es la decisión (a) del
humano, no un descuido.

---

## Lo que NO se verificó aquí

- `./init.sh` y la suite entera: los corre el leader (regla de esta sesión).
- No hay E2E: la feature es backend puro sobre un canal por API key, sin UI.
- La feature 178 (purga) debe poner también `download_storage_path` a NULL al borrar el objeto; si
  no, `/generate` devolverá URLs firmadas de objetos inexistentes (nota ya declarada en
  `requirements.md`).

---

## Cierre de los dos hallazgos menores del review (`progress/review_177.md`)

Pulido posterior a la aprobación del reviewer. Sin cambios de contrato, de spec ni de comportamiento
observable.

### M1 — fuera el fallback `?? resultados[0]` de `porOrden`

`lib/services/ApiPdfEtiquetaService.ts`. La línea

```ts
const generado = resultados.find((r) => r.ordenId === ordenId) ?? resultados[0];
```

era una defensa que hacía lo contrario de defender: si el generador devolviera un resultado con un
`ordenId` distinto del pedido, en vez de fallar se persistiría en el `download_storage_path` de ESTA
orden el path del PDF de OTRA. Ahora no hay fallback: si ningún resultado casa exactamente con el
`ordenId` pedido se devuelve `sin_etiqueta` (→ 409, el mismo estado que "no hay nada que generar"),
y **nunca** se persiste ni se firma un path ajeno. El comentario del bloque lo declara.

**Alcanzabilidad reverificada antes de tocar nada:** el caso sigue siendo **inalcanzable** por
cualquier ruta real. `porOrden` invoca `generarYAlmacenarPorOrden([ordenId], actor)` con un único id,
y `EtiquetasLotePdfService` (`:109-119`) deriva cada `ordenId` del DTO de la etiqueta generada a
partir de esos mismos ids. Es endurecimiento, no la corrección de un bug vivo.

Tests nuevos (2), ambos con el generador devolviendo un resultado de `ord-AJENA`:

- `tests/unit/services/api-pdf-etiqueta-service.test.ts` › `DEFENSA: si el generador devuelve un
  resultado de OTRA orden, nunca se persiste ese path (R25)` — afirma `{ status: "sin_etiqueta" }`,
  `setOrdenDownloadStoragePath` en 0 y `createSignedUrl` en 0.
- `tests/integration/api/ordenes-api-key-orden-generate.route.test.ts` › `DEFENSA (R25): si el
  generador responde con otro ordenId, no hay 200 ni url y no se persiste nada` — afirma
  `status !== 200`, 409 `CONFLICT`, cuerpo sin `url`, 0 persistencias y 0 firmas. El helper
  `escenario` gana una opción `ordenIdAjeno?: string`; ningún test existente fue editado.

**Mutación #28 (obligatoria):** reintroducido el `?? resultados[0]` → **solo esos 2 tests en rojo**:

```
AssertionError: expected 200 not to be 200
AssertionError: expected { status: 'ok', …(3) } to deeply equal { status: 'sin_etiqueta' }
+   "url": "https://signed.test/tienda-77/recien-generado.pdf#300",
```

Esa `url` es precisamente el daño evitado: el PDF de `ord-AJENA` firmado y persistido en `ord-1`.
Restaurado y re-verificado en verde.

### M2 — TTL unificado en el composition root de la carga

`app/api/ordenes/api-key/carga/[cargaId]/generate/route.ts`, `buildPdfService()`. Instanciaba
`EtiquetasLotePdfService` con `SIGNED_URL_TTL_SECONDS` (3600, el de la UI de la 136) mientras su
hermano de orden usaba `API_SIGNED_URL_TTL_SECONDS` (300): dos roots diciendo cosas distintas sobre
lo mismo. Unificado a `API_SIGNED_URL_TTL_SECONDS`, con la misma forma que el root de orden (`ttl`
local y una sola instancia de `SupabaseSignedUrlProvider` reusada) y un comentario de una línea que
explica por qué ese TTL y no el otro.

**Sin efecto observable:** `ApiPdfEtiquetaService` descarta la `signedUrl` que emite el generador y
re-firma siempre con su propio TTL (desviación 2 de este documento). `handleCargaGenerateApi`,
`CargaGenerateApiDeps`, `POST` y el zod quedan intactos.

### Verificación de este cierre

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm lint
✖ 41 problems (0 errors, 41 warnings)     # baseline intacto

$ pnpm exec vitest run \
    tests/unit/services/api-pdf-etiqueta-service.test.ts \
    tests/unit/services/api-pdf-etiqueta-columna-intacta.test.ts \
    tests/integration/api/ordenes-api-key-orden-generate.route.test.ts \
    tests/integration/api/ordenes-api-key-carga-generate.route.test.ts

 Test Files  4 passed (4)
      Tests  45 passed (45)
   Duration  1.64s
```

La suite completa y `./init.sh` los corre el leader (regla de la sesión). El mapa `R<n> → test` no
cambia: los 2 tests nuevos refuerzan R25, que ya estaba mapeado.

### Nota menor abierta

En el test de integración, al inyectar `ordenIdAjeno` el contador de subidas **sí** se incrementa: el
generador ya subió el objeto antes de que el service descarte el resultado. Es deliberado y refleja
el comportamiento real; lo que el test fija es que no se persiste referencia ni se firma URL, no la
ausencia de un objeto huérfano. Coherente con el criterio de R20/R26/R36 ya declarado (si el UPDATE
falla queda un objeto huérfano, nunca una referencia rota) y con la purga de la feature 178.
