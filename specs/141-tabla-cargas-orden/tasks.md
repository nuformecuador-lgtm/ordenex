# Feature 141 — Tasks

Convención: `[P]` = paralelizable con las tareas marcadas del mismo bloque.
Cada task incluye su criterio de "hecho" y los requisitos que cubre.

Nombres cerrados en el gate F1.4: tabla **`carga`** (singular), modelo Prisma `Carga`,
columna `orden.carga_id`, FK `ON DELETE RESTRICT`. Alcance **sin UI**.

> **Renumeración:** el gate F1.4-7/8/9 renumeró los requisitos y el gate F1.4-11/12 añadió
> `download_type` + generación de PDFs; el rango vigente es **R1–R55**. Las tasks de abajo ya
> citan la numeración NUEVA.
>
> **Estado:** T0–T14 se implementaron con el diseño anterior (el cliente generaba el
> `cargaId`; `download_url` siempre NULL). El **bloque 5** corrige el id server-side + `name`;
> el **bloque 6** añade `download_type` y la escritura de `download_url`. Las tasks superadas
> están marcadas como SUPERADA POR y su `[x]` histórico no vale como "hecho" para el reviewer.

## Bloque 0 — Datos

- [x] **T0. Migración `20260727120000_carga_orden_carga_id`** (R1–R7, R11–R14)
  — parcialmente SUPERADA POR **T15** (falta la columna `name` + índice único compuesto)
  - `db/migrations/20260727120000_carga_orden_carga_id/migration.sql` con: tabla `carga`
    (id, fecha_carga, usuario_carga, download_url, total_files, created_at, updated_at), FK
    `usuario_carga → usuario(id) ON DELETE RESTRICT`, índices `carga_usuario_carga_idx` y
    `carga_fecha_carga_idx`, `ENABLE ROW LEVEL SECURITY`; `ALTER TABLE orden ADD COLUMN
    carga_id TEXT` + `download_url TEXT`, índice `orden_carga_id_idx` y FK
    `orden_carga_id_fkey → carga(id) ON DELETE RESTRICT`; `down.sql` que revierte exacto.
  - **Hecho:** ambos archivos existen; el UP no contiene `UPDATE "orden"` (sin backfill) ni
    toca `num_guia`.

- [x] **T1. Schema Prisma** (R1–R7, R14) — SUPERADA POR **T16** (falta `name` + `@@unique`)
  - `db/schema.prisma`: modelo `Carga` (`@@map("carga")`, campos camelCase con `@map`),
    relación `Usuario.cargasRealizadas`, campos `Orden.cargaId` / `Orden.downloadUrl` +
    relación `Orden.carga` + `@@index([cargaId])`.

- [x] **T2. [P] Test estático de la migración** (R1–R14) — ampliada por **T17**
  - `tests/integration/db/carga-migration.test.ts` (patrón `zonas-migration.test.ts`).

- [x] **T3. [P] Denylist de `zonas-migration.test.ts`**
  - `!d.endsWith("_carga_orden_carga_id"), // feature 141: apendida despues`.

## Bloque 1 — Repositorio

- [x] **T4. Helper transaccional `ensureCargaEnTx`** — SUPERADA POR **T18**
  - Versión actual: `createMany([...], skipDuplicates)` con el id PROPUESTO POR EL CLIENTE.
    Ese comportamiento queda prohibido por R15.

- [x] **T5. `LoteContexto` en `IOrdenRepository`** (R34, R36) — ampliada por **T18**
- [x] **T6. `OrdenRepository`: ensure + `carga_id` en la misma tx** (R34–R36)

## Bloque 2 — Servicio

- [x] **T7. `BulkOrdenService.cargarMasiva` propaga el lote** (R26–R29, R38) — ampliada por **T19**
- [x] **T8. [P] `BulkOrdenService.cargarViaApi` crea su lote** (R30–R33, R39) — ampliada por **T19**

## Bloque 3 — Borde HTTP y cliente

- [x] **T9. Controller `carga-masiva/chunk`** (R18, R19, R38, R41) — ampliada por **T20**
- [x] **T10. [P] Controller `api-key/carga`** (R39, R41) — ampliada por **T20**
- [x] **T11. Cliente de chunks (fontanería, SIN UI)** (R26, R29) — SUPERADA POR **T21**
  - Versión actual: `procesarEnChunks` GENERA el UUID de la sesión. Prohibido por R15.

## Bloque 4 — Invariantes y cierre (primera pasada)

- [x] **T12. [P] Invariante "sin lotes huérfanos ni órdenes a medias"** (R34, R35)
- [x] **T13. [P] No-regresión del alta manual y del histórico** (R11, R14, R37, R40)
  — parcialmente SUPERADA POR **T29**: su aserción "`download_url` NULL en AMBAS vías" ya no
  vale para la vía API key (R47/R48); queda acotada a la vía sesión (R40).
- [x] **T14. Mapa de trazabilidad R→test** — rehacer en **T30** con R1–R55

## Bloque 5 — Cambio de diseño: id server-side + `name` único por usuario

> Todas dependen del spec actualizado. La migración **NO está aplicada en ninguna base ni
> mergeado su PR**: se modifica EN SITIO, sin migración correctiva (gate F1.4-10).

- [x] **T15. Migración en sitio: columna `name` + índice único compuesto** (R8, R9, R10, R13)
  - En `db/migrations/20260727120000_carga_orden_carga_id/migration.sql`: añadir `"name" TEXT`
    a la definición de `CREATE TABLE "carga"` y
    `CREATE UNIQUE INDEX "carga_usuario_carga_name_key" ON "carga"("usuario_carga", "name");`.
  - `down.sql` no cambia (el `DROP TABLE` arrastra columna e índice); confirmarlo por lectura.
  - **Prohibido:** crear una carpeta de migración nueva o un `ALTER TABLE ... ADD COLUMN name`
    correctivo.
  - **Hecho:** el UP declara `name` nullable (sin `NOT NULL`) y el índice único compuesto;
    `pnpm db:migrate` sobre base limpia aplica y `pnpm db:rollback` revierte.
  - Depende de: nada (primera del bloque).

- [x] **T16. Prisma: `name` + `@@unique([usuarioCarga, name])`** (R8, R9) — depende de T15
  - `model Carga`: campo `name String?` (sin `@map`: la columna ya es snake-compatible) y
    `@@unique([usuarioCarga, name])`.
  - **Hecho:** `pnpm db:generate` OK; `prisma migrate diff` entre schema y migración sin drift.

- [x] **T17. [P] Ampliar el test estático de la migración** (R8, R9, R10, R13) — depende de T15
  - En `tests/integration/db/carga-migration.test.ts`: asertar `"name" TEXT` nullable, el
    `CREATE UNIQUE INDEX "carga_usuario_carga_name_key"` sobre (`usuario_carga`, `name`), y
    que NO existe un índice único global sobre `name` solo.
  - **Hecho:** el test pasa y falla si se quita cualquiera de las dos cláusulas.

- [x] **T18. Rehacer `ensureCargaEnTx`: crear vs reutilizar** (R15–R17, R19, R21–R24, R34)
  — depende de T16
  - `lib/repositories/carga-lote.ts`: dos ramas EXCLUYENTES.
    (a) `id === null` → `randomUUID()` server-side + `create` de la fila con `name`; capturar
    `P2002` sobre (`usuario_carga`, `name`) → lanzar `CargaNombreDuplicadoError(name)`.
    (b) `id !== null` → **solo lectura**: `findUnique`; `null` o `usuarioCarga` distinto →
    `CargaLoteAjenoError(id)`. NUNCA inserta con un id entrante.
  - Añadir `CargaNombreDuplicadoError` junto a `CargaLoteAjenoError` en
    `lib/interfaces/repositories/IOrdenRepository.ts`, y `name?: string | null` a `LoteContexto`.
  - Eliminar el `createMany([...], skipDuplicates: true)` con id del cliente y actualizar el
    JSDoc del helper (hoy documenta el diseño viejo).
  - **Hecho:** tests unitarios con `tx` mockeado cubren: crea con id generado por el servidor
    (y el id devuelto NO es ninguno de los recibidos), no vuelve a insertar cuando se pasa un
    id, lanza `CargaLoteAjenoError` con id inexistente, lanza `CargaLoteAjenoError` con id de
    otro usuario, persiste `name` al crear, lo ignora al reutilizar, y traduce `P2002` a
    `CargaNombreDuplicadoError`.

- [x] **T19. Servicio: `name` y sin id propuesto por el cliente** (R16, R17, R20–R23, R26,
  R30–R33) — depende de T18
  - `cargarMasiva(rows, actor, { dryRun, cargaId, name, totalFiles })` y
    `cargarViaApi(rows, actor, { name })`; propagar `name` al `LoteContexto`; actualizar el
    JSDoc de `IBulkOrdenService` (hoy dice que el cliente identifica la sesión).
  - **Hecho:** `bulk-orden-service.test.ts` y `bulk-orden-service.carga-api.test.ts` cubren:
    lote creado sin `cargaId` de entrada y devuelto en el summary; segundo chunk con ese
    `cargaId` reutiliza (una sola creación); `name` persistido solo al crear; `cargaId = null`
    en dry-run y con cero creadas.

- [x] **T20. Borde HTTP: `name` en ambas vías + 409/403/422** (R18–R20, R24, R38, R39, R41)
  — depende de T19
  - `chunk/route.ts`: `name: z.string().trim().min(1).max(120).optional()` en el schema;
    mapear `CargaNombreDuplicadoError → ConflictError` (409) y `CargaLoteAjenoError →
    ForbiddenError` (403); `cargaId` sigue siendo `z.uuid().optional()` (formato inválido →
    `VALIDATION_ERROR`/422).
  - `api-key/carga/route.ts`: `name` opcional en `cargaApiBodySchema` + mapeo del 409. Sin
    tocar la lógica de etiquetas (features 112/136).
  - **Hecho:** tests de integración de ambas rutas: 409 con mensaje que nombra el duplicado,
    403 con `cargaId` inexistente y con `cargaId` ajeno, 422 con `cargaId` mal formado, 200
    con `name` ausente (lote con `name` NULL) y con `name` presente; las aserciones de
    `etiquetasPdf` siguen verdes.

- [x] **T21. Cliente de chunks: dejar de generar el UUID** (R15–R17, R26, R29) — depende de T20
  - `app/(app)/ordenes/_components/carga-masiva-chunks.ts`: quitar `crypto.randomUUID()`;
    guardar en una variable local el `cargaId` que devuelve la respuesta del primer chunk y
    reenviarlo a partir del segundo; aceptar `name` opcional en `ProcesarChunksOpts` y
    mandarlo en el body; `totalFiles` sigue siendo el total de la sesión.
  - **Prohibido:** pintar, listar o filtrar por lote (gate F1.4-5); ningún `.tsx` en el diff.
  - **Hecho:** test con `fetchImpl` fake verifica que el PRIMER chunk va sin `cargaId`, que
    los siguientes envían exactamente el id devuelto por el servidor, que el dry-run no envía
    ninguno, que `totalFiles` es el de la sesión en todos, y que los chunks se envían en
    serie; `git diff --name-only` no incluye ningún `.tsx`.

- [x] **T22. [P] Test del invariante "el id nunca lo elige el cliente"** (R15, R19)
  — depende de T18
  - Test de repositorio/servicio: enviando un `cargaId` UUID que no existe en la DB, no se
    crea ninguna fila de `carga` con ese id y la petición falla (403); tras un fallo, ninguna
    orden queda persistida.
  - **Hecho:** ambos casos verdes.

- [x] **T23. [P] Cerrar el bloque 5** (R15–R25) — depende de T15–T22
  - Verificación conjunta: `pnpm test` verde en los archivos tocados por el bloque 5.

## Bloque 6 — `download_type` + escritura de `download_url` (vía API key)

> Deroga la política "download_url siempre NULL". Reusa la feature 136 (ya en `dev`); ver
> design §6. Ninguna task de este bloque toca `.tsx` ni la vía sesión.

- [x] **T24. `download_type` en el borde de la carga por API** (R42–R46, R55) — depende de T20
  - `app/api/ordenes/api-key/carga/route.ts`: añadir al `cargaApiBodySchema`
    `download_type: z.enum(["consolidate","individual"]).optional().default("consolidate")`;
    devolver `downloadType` en el cuerpo de la respuesta.
  - **Prohibido:** añadir `download_type` al schema de `carga-masiva/chunk` (R46) o crear
    columna para él (R45).
  - **Hecho:** tests de integración de la ruta: sin el campo ⇒ `downloadType:"consolidate"`;
    `"individual"` ⇒ eco correcto; `"otro"` ⇒ 422 sin crear órdenes (el service no se llama);
    el schema de chunk sigue sin conocerlo.

- [x] **T25. Modo individual en `EtiquetasLotePdfService`** (R48, R49, R52) — depende de T24
  - `lib/interfaces/services/IEtiquetasLotePdfService.ts`: añadir `EtiquetaOrdenPdfResultado`
    y `generarYAlmacenarPorOrden(ordenIds, actor)`.
  - `lib/services/EtiquetasLotePdfService.ts`: implementarlo reusando `generarEtiquetas` (UNA
    llamada), `build([dto])` por etiqueta, `storage.upload` y `signedUrls.createSignedUrl`, y
    el MISMO tope (`EtiquetasLoteExcedeTopeError` antes de construir nada).
  - **Prohibido:** builder de PDF nuevo o servicio de render nuevo (se reusa `lib/pdf`).
  - **Hecho:** tests unitarios con dobles: N etiquetas ⇒ N `build`/`upload`/`createSignedUrl`
    y N resultados correlacionados por `ordenId`; orden sin etiqueta imprimible ⇒ no aparece
    en el resultado; cero etiquetas o `forbidden` ⇒ `[]` sin tocar Storage; por encima del
    tope ⇒ lanza sin llamar a `build`.

- [x] **T26. Persistencia de las URLs en el repositorio** (R47, R48) — depende de T25
  - `IOrdenRepository` + `OrdenRepository`: `setCargaDownloadUrl(cargaId, url)` y
    `setOrdenesDownloadUrl(items)` (una transacción; sin tocar `carga_id`, `num_guia` ni
    estado).
  - **Hecho:** tests de repositorio verifican el `update` a la fila correcta y que no se
    modifica ninguna otra columna.

- [x] **T27. `EtiquetasDescargaService` (orquestación por modo)** (R47–R51, R53, R54)
  — depende de T26
  - Nuevo `lib/services/EtiquetasDescargaService.ts` con DI (`IEtiquetasLotePdfService`,
    `IOrdenRepository`) y `generarYPersistir({ modo, cargaId, ordenIds, actor })` según
    design §6.3; NO captura errores (best-effort vive en el borde).
  - **Hecho:** tests unitarios: `consolidate` ⇒ un PDF + `setCargaDownloadUrl` y ningún
    `setOrdenesDownloadUrl`; `individual` ⇒ N PDFs + `setOrdenesDownloadUrl` y ningún
    `setCargaDownloadUrl`; `ordenIds` vacío ⇒ no toca Storage ni DB.

- [x] **T28. Cableado en el endpoint + contrato de respuesta** (R47–R55) — depende de T27
  - En la ruta: sustituir la llamada directa a `EtiquetasLotePdfService` por
    `EtiquetasDescargaService` según `downloadType`, conservando el try/catch best-effort, el
    chequeo de tope previo y `describirErrorSeguro`; añadir `downloadUrl` a cada entrada de
    `ordenes[]` y `downloadType` al cuerpo; `etiquetasPdf` intacto en modo `consolidate`.
  - **Hecho:** tests de integración: consolidate OK ⇒ `etiquetasPdf.url` + `carga.download_url`
    persistida + `ordenes[].downloadUrl` todos `null`; individual OK ⇒ `ordenes[].downloadUrl`
    con URL + `carga.download_url` NULL + `etiquetasPdf: null`; fallo de Storage ⇒ 200,
    `etiquetasPdf: { error }`, columnas NULL y órdenes conservadas con su `num_guia`; tope
    excedido ⇒ 200 con el mensaje del tope y sin tocar Storage; cero creadas ⇒
    `etiquetasPdf: null` sin tocar Storage; las aserciones heredadas de la 136 siguen verdes.

- [x] **T29. [P] Ajustar la no-regresión de `download_url`** (R40, R47, R48) — depende de T28
  - Reescribir la parte de T13 que afirmaba "NULL en ambas vías": la vía **sesión** sigue
    dejando ambas columnas NULL; la vía API key ya no.
  - **Hecho:** el test de la vía sesión sigue verde con la aserción acotada y existe su
    contraparte para la vía API key.

- [x] **T30. Rehacer el mapa de trazabilidad R1–R55** — depende de T15–T29
  - `progress/impl_141.md` con la tabla **R1..R55** → test concreto, sustituyendo la tabla
    R1..R30 anterior; anotar las tasks superadas y la deuda del TTL (design §6.6).
  - **Hecho:** ningún requisito sin test; `./init.sh` y `pnpm test` en verde; `pnpm typecheck`
    sin errores nuevos respecto del baseline medido al empezar.

## Grafo de dependencias (bloques 5 y 6)

```
T15 ── T16 ─┬─ T18 ── T19 ── T20 ─┬─ T21
            ├─ T22 [P]             └─ T24 ── T25 ── T26 ── T27 ── T28 ── T29 [P]
            └─ T17 [P]                                                     └── T30
                                     T23 [P]
```

## Notas de ejecución (implementer, primera pasada)

- **T0** — `migration.sql` y `down.sql` existen y están cubiertos por un test estático, pero
  NO se ejecutaron `pnpm db:migrate` ni `pnpm db:rollback`: el `.env` del entorno apunta a una
  base COMPARTIDA. El round-trip up→down→up contra Postgres queda para el reviewer (misma
  política que la feature 101). **Esto refuerza que la migración se puede editar en sitio
  (T15): no se ha aplicado en ninguna base.**
- **T2** — el test estático vive en `tests/integration/db/carga-migration.test.ts` (no en
  `tests/unit/db/`): es donde están TODOS los tests de migración del repo.
- **T11** — el `cargaId` lo generaba `procesarEnChunks`; T21 revierte eso: el id pasa a
  emitirlo el servidor. `procesarEnChunks` sigue recibiendo el arreglo COMPLETO de la sesión,
  así que su `filas.length` ES el total de la sesión (R29) y su invocación es exactamente una
  por sesión (R26).

## Notas de ejecucion (implementer, segunda pasada — bloques 5 y 6)

- **T15/T16** — la migracion se edito EN SITIO (`name` TEXT + `CREATE UNIQUE INDEX
  carga_usuario_carga_name_key`), sin carpeta correctiva. NO se ejecutaron `pnpm db:migrate`
  ni `pnpm db:rollback`: el `.env` apunta a una base COMPARTIDA y el encargo lo prohibe. El
  round-trip up->down->up contra Postgres queda para el reviewer. `prisma migrate diff`
  tampoco se corrio (exige shadow DB); el no-drift se cubre por aserciones estaticas.
- **T18** — `ensureCargaEnTx` quedo con dos ramas EXCLUYENTES; desaparecio el
  `createMany([...], skipDuplicates)` con id del cliente. `CargaNombreDuplicadoError` vive en
  `lib/interfaces/repositories/IOrdenRepository.ts`, junto a `CargaLoteAjenoError`.
- **T21** — el token lo guarda `procesarEnChunks` (`.ts`) en una variable local y lo reenvia
  desde el 2.º chunk; ningun `.tsx` cambia (verificado con `git diff --name-only`).
- **T27/T28** — el endpoint de la API key ya no inyecta `IEtiquetasLotePdfService` sino
  `IEtiquetasDescargaService` (`deps.descargaService`): el borde no puede hablar con el
  repositorio. Las aserciones heredadas de la feature 136 siguen verdes sobre el modo
  `consolidate`, que es la garantia de compatibilidad hacia atras (R53).
- **Deuda del TTL (design §6.6)** — `carga.download_url` / `orden.download_url` guardan una
  URL FIRMADA que caduca (`ETIQUETAS_SIGNED_URL_TTL_SECONDS`, default 1 h, techo 24 h).
  Pasado el TTL el enlace persistido devuelve 403 de Storage. Asumido a proposito en este
  alcance; la solucion (persistir el `path` y re-firmar bajo demanda) exige una columna y un
  endpoint que el humano no pidio.
