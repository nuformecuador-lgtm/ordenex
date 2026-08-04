# Feature 177 — Tasks

Checklist de pasos discretos y verificables. `[P]` = paralelizable dentro de su bloque.
Cada task trae su criterio de "hecho" y los `R<n>` que cubre. Al final, el mapa de
trazabilidad `R<n>→test` que el reviewer verifica (`docs/specs.md` §Trazabilidad).

> **Puerta F1.4 CERRADA el 2026-08-03** con aprobación explícita del humano (migración, `cargaId`
> como contrato público, riesgo (a) y 409 sin guía imprimible). (a) precedencia fija **`num_guia` gana** (sin 409 de ambigüedad);
> (b) `/generate` **solo `POST`**; (c) carga por **uuid** + publicar `cargaId` en
> `CargaResponse`; (d) **sin** modo `force`. No se reabren.
>
> **Cambios respecto de la versión anterior de este spec:** **ningún requisito murió**;
> **R14 y R15 cambiaron de contenido** (de "409 por ambigüedad" a "precedencia de `num_guia`" y
> "fallback a `num_remision`") y **nacieron dos: R44** (solo `POST`) y **R45** (`cargaId` en
> `CargaResponse`). Total: **45 requisitos**. En tasks: T10/T13/T14 pasan a exigir el test
> **discriminante** de precedencia, T14/T15 cubren además R44, y **T18 deja de ser condicional**
> (era "si (c) se cierra por uuid") para cubrir R45.

---

## Bloque 0 — Reconocimiento (bloqueante, primero)

- [x] **T1** — Registrar en `progress/impl_177.md` las decisiones cerradas de la puerta F1.4
  (a: gana `num_guia`; b: solo `POST`; c: uuid + `cargaId` publicado; d: sin `force`) y
  confirmar contra el código: (i) `num_guia`/`num_remision` siguen siendo `@unique` por separado
  y sin unicidad cruzada; (ii) `download_url` sigue sin lectores; (iii) `SELF_AUTH_ROUTES` sigue
  conteniendo `/api/ordenes/api-key`; (iv) **el tipo real de `summary.cargaId`** (¿puede ser
  `null` en la vía por API key?), que fija cómo se declara en el schema `CargaResponse` (R45).
  **Hecho:** los cuatro puntos citados con archivo:línea en `progress/impl_177.md`.
- [x] **T2 [P]** — Verificar en un scratch que Next.js acepta el árbol de rutas propuesto
  (`orden/[id]` como hermano estático de `[numGuia]`, y `carga/[cargaId]/generate` junto a
  `carga/route.ts`). **Hecho:** `pnpm exec next build` (o `next dev` arrancando) sin el error
  "You cannot use different slug names for the same dynamic path". Si falla, se replantea la
  forma de la ruta ANTES de escribir nada más.

## Bloque A — Modelo de datos (depende de T1; commit propio)

- [x] **T3** — Añadir `downloadStoragePath String? @map("download_storage_path")` a `Orden` y a
  `Carga` en `db/schema.prisma`. **Hecho:** `pnpm db:generate` regenera el cliente y
  `pnpm typecheck` pasa. [R36]
- [x] **T4** — Crear `db/migrations/<ts>_download_storage_path/` con `migration.sql`
  (2 `ADD COLUMN`) y `down.sql` (2 `DROP COLUMN`, orden inverso). **Hecho:** `pnpm db:migrate`
  aplica; `pnpm db:rollback` revierte sin error; el diff de schema queda VACÍO tras re-aplicar;
  ninguna sentencia toca `download_url`. [R39]

## Bloque B — Configuración (independiente; `[P]` con A)

- [x] **T5 [P]** — Añadir `API_SIGNED_URL_TTL_SECONDS` a `EtiquetasConfig`
  (`lib/config/etiquetas.ts`), env `ETIQUETAS_API_SIGNED_URL_TTL_SECONDS`, default 300,
  clamp `[1, MAX_SIGNED_URL_TTL_SECONDS]`. **Hecho:** test unitario de config: default 300, env
  válida respetada, env absurda acotada, `SIGNED_URL_TTL_SECONDS` (3600) INTACTA. [R24, R43]

## Bloque C — Repositorio (depende de A)

- [x] **T6 [P]** — `findByGuiaORemisionForOwner(...)` en `IOrdenRepository` + `OrdenRepository`:
  `WHERE tienda_id = ownerId AND deleted_at IS NULL AND (num_guia = $g OR num_remision = $r)`,
  `take: 2`, con `$g = null` cuando el identificador no es entero positivo.
  **Hecho:** test unitario (Prisma mockeado) que afirma: el `where` fuerza `tiendaId` y
  `deleted_at: null`; con identificador no numérico NO se emite condición sobre `num_guia`;
  devuelve 0, 1 y 2 filas según el fixture; usa comparación de igualdad (nunca `contains`/`mode`).
  [R6, R7, R8, R9, R10, R11, R12]
- [x] **T7 [P]** — `findDetalleByOrdenIdForOwner(ordenId, ownerId)` reutilizando la MISMA
  proyección de `findDetalleByNumGuiaForOwner` (incluye evidencias `entregada`/`rechazada` con
  `evidencia_storage_path` no nulo). **Hecho:** test unitario: propia con evidencias, propia sin
  evidencias (`[]`), ajena → `null`, borrada → `null`; y un test que afirma que
  `findDetalleByNumGuiaForOwner` NO cambió de firma ni de proyección. [R16, R17]
- [x] **T8 [P]** — `findDownloadStoragePathByOrdenForOwner` + `setOrdenDownloadStoragePath`.
  **Hecho:** test unitario: lectura devuelve `null` para fila heredada (con `download_url` no
  nula y path NULL); la escritura emite un `update` con `data` de UNA sola clave
  (`downloadStoragePath`) y no incluye `downloadUrl` ni ninguna otra columna. [R26, R38]
- [x] **T9 [P]** — `findCargaConOrdenesForOwner` (exige `usuario_carga = ownerId`; devuelve
  `downloadStoragePath` + ids de órdenes del lote con `tienda_id = ownerId` y
  `deleted_at IS NULL`) + `setCargaDownloadStoragePath`. **Hecho:** test unitario: carga propia
  con N órdenes, carga ajena → `null`, carga inexistente → `null`, órdenes borradas excluidas;
  la escritura toca UNA sola columna. [R29, R32, R35]

## Bloque D — Services (depende de C)

- [x] **T10** — `IApiOrdenResolucionService` + `ApiOrdenResolucionService.resolver(actor, id)`:
  normaliza el identificador (trim), calcula el candidato entero, llama al repo y aplica la
  **precedencia fija** (`num_guia` primero, `num_remision` como fallback), devolviendo también
  `via`. Sin estado `ambiguo` y sin 409.
  **Hecho:** tests con repo fake: (1) resuelve por guía (`via: "num_guia"`); (2) resuelve por
  remisión (`via: "num_remision"`); (3) identificador no numérico no consulta guía; (4) 0 filas
  → `not_found`; (5) **test DISCRIMINANTE de R14**: el repo devuelve DOS filas —orden A con
  `num_guia = 100234` y orden B con `num_remision = "100234"`— y el service devuelve **la orden
  A**, con `via: "num_guia"`, y NO la B (se afirma el `id` devuelto, no solo que hay respuesta);
  (6) el service nunca produce `409`/`conflict` en ninguna rama. [R6, R8, R9, R14, R15]
- [x] **T11** — `IApiPdfEtiquetaService` + `ApiPdfEtiquetaService` con `porOrden` y `porCarga`,
  inyectando repo, `IEtiquetasLotePdfService`, `ISignedUrlProvider` y el TTL de T5. Lógica:
  path presente → solo `createSignedUrl` (`generado: false`); ausente → generar + persistir
  (`generado: true`). Traduce lista vacía / `null` → `sin_etiqueta` y
  `EtiquetasLoteExcedeTopeError` → `excede_tope`. **Hecho:** tests con dobles:
  (a) reuso NO llama a `generarYAlmacenar*` ni a `upload` y SÍ a `createSignedUrl` con el path
  persistido y TTL 300; (b) generación llama a upload y persiste el path devuelto;
  (c) `sin_etiqueta` no sube ni persiste; (d) `excede_tope` no construye; (e) NUNCA se devuelve
  un valor leído de `download_url`. [R20, R21, R22, R23, R24, R25, R30, R31, R33, R34, R38]
- [x] **T12** — Test de aislamiento del service: `porOrden`/`porCarga` con un id ajeno →
  `not_found` y **cero** llamadas a `IEtiquetasLotePdfService` (que no filtra por owner,
  `IEtiquetaGuiaService.ts:38`). **Hecho:** spy en 0 invocaciones. [R4, R7, R12, R29]

## Bloque E — Controllers / route handlers (depende de D)

- [x] **T13** — `app/api/ordenes/api-key/orden/[id]/route.ts` (GET consulta). Reusa
  `extraerBearer`, `buildAutenticar`, `deps` inyectables, `withErrorHandler`,
  `appErrorToResponse`. zod `min(1).max(128)` sobre `{id}`.
  **Hecho:** test de integración del handler (sin DB): 401 sin/mal Bearer, 403 usuario/key no
  activos, 200 por guía, 200 por remisión, 404 inexistente, 404 ajena (idéntica), 422
  vacío/excedido, respuesta SIN `storagePath`/bucket/ids internos/PII, y el **caso
  discriminante de R14 extremo a extremo**: con las dos órdenes colisionadas el `200` devuelve
  la de la guía; ningún caso responde `409`.
  [R1, R2, R3, R11, R12, R13, R14, R15, R16, R18, R42]
- [x] **T14** — `app/api/ordenes/api-key/orden/[id]/generate/route.ts` exportando **solo
  `POST`**. **Hecho:** test de integración: 200 `generado:true` la 1ª vez, 200 `generado:false`
  la 2ª con la MISMA orden y URL distinta (re-firmada), 404 ajena, 409 sin guía, 401/403/422;
  el caso discriminante de R14 (con ambas coincidencias se genera el PDF de la orden de la
  GUÍA, verificado por el `ordenId` pasado al generador); y que el módulo **no exporta `GET`**
  (una petición `GET` no ejecuta el handler). [R19, R20, R21, R22, R27, R44]
- [x] **T15** — `app/api/ordenes/api-key/carga/[cargaId]/generate/route.ts` exportando **solo
  `POST`**, zod uuid sobre `{cargaId}`.
  **Hecho:** test de integración: 200 `generado:true` / `generado:false`, 404 ajena, 404
  inexistente, 409 sin etiquetas, 409 excede tope, 422 uuid inválido (y 422 con un id que no es
  uuid, p. ej. el `name` del lote), 401/403, y que el módulo **no exporta `GET`**.
  Confirma que `POST /api/ordenes/api-key/carga` (feature 88) sigue respondiendo igual.
  [R28, R29, R30, R31, R33, R34, R44]

## Bloque F — Contrato publicado (depende de E)

- [x] **T16** — Añadir los 3 paths a `lib/api/openapi-spec.ts` + schema
  `PdfGenerateResponse`, reutilizando `OrdenDetalle` y las `responses` existentes por `$ref`.
  **Hecho:** `openApiSpec.paths` tiene 7 claves y `tests/unit/api/openapi-contrato-en-reparto.test.ts`
  sigue verde SIN modificarlo (en particular `enumsTs` sigue en 4). [R41]
- [x] **T17** — Espejar los 3 paths en `docs/api/api-key-openapi.yaml`.
  **Hecho:** el guard de espejo del `.yaml` verde. [R41]
- [x] **T18 [P]** — Publicar `cargaId` en el schema `CargaResponse` del OpenAPI **y** del
  `.yaml`, con el tipo que T1 haya confirmado (`string`/`["string","null"]`, `format: uuid`), y
  añadirlo al ejemplo publicado de la respuesta de carga. **Hecho:** test de contrato nuevo que
  afirma (a) `CargaResponse.properties.cargaId` existe en el objeto TS, (b) el `.yaml` lo
  declara igual, (c) el ejemplo de `POST /api/ordenes/api-key/carga` lo muestra; y los guards
  de contrato existentes siguen verdes. [R45]

## Bloque G — Verificación transversal

- [x] **T19 [P]** — Test de middleware/ruteo: petición sin cookie de sesión y con Bearer válido
  a las 3 rutas nuevas NO recibe 307 a `/login`. **Hecho:** test verde sobre `matches()` de
  `middleware.ts` con los 3 pathnames. [R40]
- [x] **T20 [P]** — Test de seguridad de la key: forzar un error en cada uno de los 3 endpoints
  y afirmar que ni la key ni su hash aparecen en el cuerpo ni en `console.*` (spy). **Hecho:**
  verde en los tres. [R5]
- [x] **T21 [P]** — Test de no-regresión de la feature 106: `GET /api/ordenes/api-key/{numGuia}`
  y `PUT .../cancelar` conservan ruta, verbo, contrato y comportamiento. **Hecho:** los tests
  existentes de la 106 pasan sin editarlos, y un test nuevo afirma que la firma de
  `findDetalleByNumGuiaForOwner` no cambió. [R17]
- [x] **T22 [P]** — Test de "columna intacta": tras `/generate` (orden y carga), `download_url`
  conserva su valor previo (incluido `null`) y ninguna otra columna cambia (`estatus_id`,
  `num_guia`, `carga_id`, sin filas nuevas en el historial de estados). **Hecho:** verde.
  [R26, R35, R38]
- [x] **T23** — `./init.sh` + `pnpm typecheck` + `pnpm lint` + suite completa en verde;
  `progress/impl_177.md` con el mapa `R→test` final y las decisiones (a)-(d) aplicadas.

---

## Mapa de trazabilidad `R<n>→test`

| R | Descripción corta | Test (task / caso) |
|---|---|---|
| R1 | 401 sin/mal Bearer, sin tocar DB ni Storage | T13/T14/T15: "responde 401 cuando falta o es inválido el Bearer" |
| R2 | 401 key desconocida | T13: "responde 401 cuando la key no existe" |
| R3 | 403 usuario/key no activos | T13/T14/T15: "responde 403 cuando el usuario o la key no están activos" |
| R4 | Owner = actor.usuarioId | T12: "usa actor.usuarioId y no acepta owner de la petición" |
| R5 | Key nunca logueada ni serializada | T20: "no filtra la key en errores ni en logs" |
| R6 | Resuelve contra guía Y remisión, con owner | T6 repo + T10 service: "resuelve por num_guia y por num_remision del owner" |
| R7 | Scope por owner en el repositorio | T6 repo: "el where fuerza tienda_id = ownerId" + T12 |
| R8 | No numérico → solo remisión | T6 + T10: "con identificador no numérico no consulta num_guia" |
| R9 | Numérico → ambas columnas | T6 + T10: "con entero positivo evalúa ambas columnas" |
| R10 | Comparación exacta | T6: "usa igualdad, nunca contains/startsWith" |
| R11 | 404 sin coincidencia | T6 + T13: "404 cuando ninguna orden propia coincide" |
| R12 | 404 ajena/borrada (idéntico) | T6 + T12 + T13: "404 idéntico para orden ajena y borrada" |
| R13 | 422 id vacío o excedido, sin consultar | T13: "422 con {id} vacío o de más de 128 chars, sin tocar la DB" |
| R14 | Precedencia: gana `num_guia` (test discriminante) | T10 + T13 + T14: "con la guía de A y la remisión de B casando a la vez, devuelve A y no B" |
| R15 | Fallback a `num_remision`; nunca 409 por ambigüedad | T10 + T13: "resuelve por remisión cuando ninguna guía coincide" + "ninguna rama responde 409" |
| R16 | Detalle con la forma de la 106 | T7 repo + T13: "devuelve el mismo DTO de detalle, evidencias firmadas y [] sin evidencias" |
| R17 | La 106 queda intacta | T21: "los endpoints de la 106 conservan ruta, verbo y contrato" |
| R18 | Sin path/bucket/ids/PII | T13: "la respuesta no expone storagePath, bucket ni datos del mensajero" |
| R19 | /generate resuelve igual que la consulta | T14: "/generate aplica las mismas reglas de resolución, la misma precedencia y los mismos 404/422" |
| R20 | Genera y persiste la RUTA (no la URL) | T11 + T14: "genera, sube y persiste el path devuelto por el generador" |
| R21 | Reuso: no genera ni sube | T11 + T14: "con path persistido no llama a generar ni a upload" |
| R22 | 200 con URL nueva + TTL + generado | T11 + T14 + T15: "responde url, expiraEnSegundos y generado true/false" |
| R23 | Nunca devuelve URL persistida | T11: "la URL sale siempre de createSignedUrl, nunca de download_url" |
| R24 | TTL 300 s, firmado en servidor | T5 config + T11: "firma con API_SIGNED_URL_TTL_SECONDS = 300" |
| R25 | 409 sin etiqueta imprimible | T11 + T14: "409 cuando la orden no tiene guía; no sube ni persiste" |
| R26 | No toca otras columnas de la orden | T8 + T22: "el update lleva solo downloadStoragePath; download_url intacta" |
| R27 | Un único objeto tras N llamadas | T14: "dos llamadas seguidas suben un solo objeto" |
| R28 | Contrato de carga idéntico al de orden | T15: "misma forma de respuesta que /generate por orden" |
| R29 | 404 carga ajena/inexistente | T9 + T12 + T15: "404 idéntico para carga ajena e inexistente" |
| R30 | Genera el consolidado y persiste el path | T11 + T15: "genera el consolidado del lote y persiste su path" |
| R31 | Reuso del consolidado | T11 + T15: "con path persistido solo re-firma" |
| R32 | Solo órdenes propias y vivas del lote | T9: "excluye órdenes borradas y de otro owner del lote" |
| R33 | 409 lote sin etiquetas imprimibles | T11 + T15: "409 cuando ninguna orden del lote tiene etiqueta" |
| R34 | 409 por tope, antes de construir | T11 + T15: "409 por MAX_ETIQUETAS_POR_PDF sin construir el PDF" |
| R35 | No toca otras columnas de la carga | T9 + T22: "el update de carga lleva solo downloadStoragePath" |
| R36 | Referencia = ruta del objeto, columna aparte | T3 schema + T8/T9: "persiste el path, no una URL, en download_storage_path" |
| R37 | "Existe" se decide por la referencia | T11: "decide reuso por downloadStoragePath y nunca por download_url" |
| R38 | Filas heredadas de la 136/141 → regenera | T8 + T11 + T22: "fila con download_url y path NULL genera y no altera download_url" |
| R39 | Migración aditiva con down.sql | T4: "db:migrate aplica los 2 ADD COLUMN y db:rollback los revierte" |
| R40 | Rutas nuevas bajo SELF_AUTH_ROUTE | T19: "las 3 rutas nuevas no se redirigen a /login sin cookie" |
| R41 | OpenAPI 7 paths + yaml espejo | T16 + T17: "el spec publica los 3 endpoints y el yaml sigue siendo espejo" |
| R42 | Shape uniforme de error, sin códigos nuevos | T13/T14/T15: "todo error responde status/code/message con códigos existentes" |
| R43 | TTL por configuración | T5: "el TTL sale de env con default 300 y clamp" |
| R44 | `/generate` solo responde a POST | T14 + T15: "el módulo de ruta no exporta GET; una petición GET no genera nada" |
| R45 | `cargaId` publicado en `CargaResponse` | T18: "CargaResponse declara cargaId en el objeto TS, en el .yaml y en el ejemplo" |
