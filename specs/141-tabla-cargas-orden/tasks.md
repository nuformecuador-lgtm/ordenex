# Feature 141 — Tasks

Convención: `[P]` = paralelizable con las tareas marcadas del mismo bloque.
Cada task incluye su criterio de "hecho" y los requisitos que cubre.

Nombres cerrados en el gate F1.4: tabla **`carga`** (singular), modelo Prisma `Carga`,
columna `orden.carga_id`, FK `ON DELETE RESTRICT`. Alcance **sin UI**.

## Bloque 0 — Datos

- [x] **T0. Migración `20260727120000_carga_orden_carga_id`** (R1–R11)
  - Crear `db/migrations/20260727120000_carga_orden_carga_id/migration.sql` con: tabla
    `carga` (id, fecha_carga, usuario_carga, download_url, total_files, created_at,
    updated_at), FK `usuario_carga → usuario(id) ON DELETE RESTRICT`, índices
    `carga_usuario_carga_idx` y `carga_fecha_carga_idx`, `ENABLE ROW LEVEL SECURITY`;
    `ALTER TABLE orden ADD COLUMN carga_id TEXT` + `download_url TEXT`, índice
    `orden_carga_id_idx` y FK `orden_carga_id_fkey → carga(id) ON DELETE RESTRICT`.
  - Crear `down.sql` que revierte exactamente (drop FK/índice/columnas de `orden`, drop
    tabla `carga`).
  - **Hecho:** ambos archivos existen; el UP no contiene `UPDATE "orden"` (sin backfill) ni
    toca `num_guia`; `pnpm db:migrate` aplica y `pnpm db:rollback` revierte sin error.
  - Depende de: nada.

- [x] **T1. Schema Prisma** (R1–R7, R11) — depende de T0
  - `db/schema.prisma`: modelo `Carga` (`@@map("carga")`, campos camelCase con
    `@map`), relación `Usuario.cargasRealizadas`, campos `Orden.cargaId` /
    `Orden.downloadUrl` + relación `Orden.carga` + `@@index([cargaId])`.
  - **Hecho:** `pnpm db:generate` OK y `prisma migrate diff` entre schema y migración no
    reporta drift.

- [x] **T2. [P] Test estático de la migración** (R1–R11) — depende de T0
  - `tests/unit/db/carga-migration.test.ts` (patrón `zonas-migration.test.ts`): verifica por
    regex la tabla `carga` (singular), las columnas, la ausencia de `batch_url`/`status`, la
    nullabilidad de `carga_id`/`download_url`, RLS habilitada, ambas FK `ON DELETE RESTRICT`
    y que el DOWN revierte.
  - **Hecho:** el test pasa y falla si se borra cualquier cláusula del UP.

- [x] **T3. [P] Actualizar la denylist de `zonas-migration.test.ts`** — depende de T0
  - Añadir `!d.endsWith("_carga_orden_carga_id"), // feature 141: apendida despues` en
    `tests/integration/db/zonas-migration.test.ts`.
  - **Hecho:** `tests/integration/db/zonas-migration.test.ts` vuelve a verde.

## Bloque 1 — Repositorio

- [x] **T4. Helper transaccional `ensureCargaEnTx`** (R12, R13, R17, R23, R24) — depende de T1
  - Nuevo `lib/repositories/carga-lote.ts` (patrón `appendCambioEstado(tx, ...)`):
    `INSERT ... ON CONFLICT (id) DO NOTHING`, relectura y verificación de `usuario_carga`,
    error tipado `CargaLoteAjenoError` si el lote es de otro usuario; genera UUID si el id
    entrante es `null`; devuelve el id.
  - **Hecho:** tests unitarios con `tx` mockeado cubren: crea si no existe, no duplica si ya
    existe, lanza si el propietario difiere, genera id cuando entra `null`.

- [x] **T5. `LoteContexto` en `IOrdenRepository`** (R12, R19, R25) — depende de T4
  - Añadir `LoteContexto`, cambiar firmas de `createManyOrdenes` (ahora
    `{ inserted, cargaId }`) y `createManyOrdenesConGuia` (ahora `{ creadas, cargaId }`),
    documentando en JSDoc la semántica del lote.
  - **Hecho:** typecheck señala exactamente los llamadores a actualizar (service + tests).

- [x] **T6. `OrdenRepository`: ensure + `carga_id` en la misma tx** (R23, R24, R25) — depende de T5
  - En `createManyOrdenes` y `createManyOrdenesConGuia`: invocar `ensureCargaEnTx` dentro del
    `$transaction` de cada batch, sólo si el batch tiene filas; propagar el id resuelto a los
    batches siguientes; añadir `cargaId` a `toCreateManyInput`.
  - **Hecho:** tests de repositorio (patrón `orden-repository.bulk.test.ts`) verifican que el
    `createMany` recibe `cargaId` en todas las filas, que el ensure ocurre dentro del mismo
    `$transaction` y que un batch vacío no toca `carga`.

## Bloque 2 — Servicio

- [x] **T7. `BulkOrdenService.cargarMasiva` propaga el lote** (R12–R15, R18, R27) — depende de T6
  - `options.cargaId` / `options.totalFiles` (fallback `rows.length`); no llamar al repo en
    `dryRun` ni con `toCreate.length === 0`; `summary.cargaId` en `BulkSummary`
    (`lib/types/carga-masiva.ts`) e `IBulkOrdenService`.
  - **Hecho:** `tests/unit/services/bulk-orden-service.test.ts` cubre: un lote por sesión,
    dryRun sin lote (`cargaId === null`), chunk sin creadas sin lote, `usuarioCargaId` = actor,
    y `total_files` = total declarado de la sesión (NO el tamaño del chunk) con el valor
    fijado una sola vez aunque lleguen N chunks.

- [x] **T8. [P] `BulkOrdenService.cargarViaApi` crea su lote** (R19–R22, R28) — depende de T6
  - `lote = { cargaId: null, usuarioCargaId: actor.usuarioId, totalFiles: rows.length }`;
    `CargaViaApiSummary.cargaId`; sin lote si no se creó ninguna orden.
  - **Hecho:** `tests/unit/services/bulk-orden-service.carga-api.test.ts` cubre lote único por
    petición, `total_files` = cantidad de objetos del array del payload (incluyendo filas
    duplicadas/con error, y con más filas que `BATCH_SIZE`), `usuario_carga` = usuario
    dedicado de la key, y `cargaId === null` cuando no hay creadas.

## Bloque 3 — Borde HTTP y cliente

- [x] **T9. Controller `carga-masiva/chunk`** (R16, R17, R27, R30) — depende de T7
  - zod: `cargaId?: z.uuid()`, `totalFiles?: int >= 0`; traducir `CargaLoteAjenoError` a
    `ForbiddenError`; seguir exigiendo `adminTienda`.
  - **Hecho:** `tests/integration/api/ordenes-carga-masiva-chunk.route.test.ts` añade:
    400 con `cargaId` no-UUID, 403 con lote de otro usuario, 200 devolviendo `cargaId`.

- [x] **T10. [P] Controller `api-key/carga`** (R28, R30) — depende de T8
  - Verificar que `cargaId` viaja en la respuesta vía el spread existente
    `{ ...summary, etiquetasPdf }`; tocar el archivo lo mínimo (coordinación con feature 136).
  - **Hecho:** `tests/integration/api/ordenes-api-key-carga.route.test.ts` verifica `cargaId`
    en el body sin romper las aserciones de `etiquetasPdf`; diff del archivo ≤ 5 líneas.

- [x] **T11. Cliente de chunks propaga el lote (fontanería, SIN UI)** (R12, R13, R14, R18)
  — depende de T9
  - `app/(app)/ordenes/_components/carga-masiva-chunks.ts`: `cargaId`/`totalFiles` en
    `ProcesarChunksOpts` y en el body de cada chunk; el llamador genera
    `crypto.randomUUID()` una vez por sesión en firme (nunca en dry-run) y calcula
    `totalFiles` = total de filas de la sesión (el arreglo completo que se trocea).
  - **Prohibido en esta task:** pintar, listar o filtrar por lote (gate F1.4-5). Ningún
    componente `.tsx` cambia.
  - **Hecho:** test de unidad con `fetchImpl` fake verifica que los N chunks envían el MISMO
    `cargaId` y el MISMO `totalFiles` (= total de la sesión, no el del chunk), y que el
    dry-run no envía ninguno; `git diff --name-only` no incluye ningún `.tsx`.

## Bloque 4 — Invariantes y cierre

- [x] **T12. [P] Test del invariante "sin lotes huérfanos ni órdenes a medias"** (R23, R24)
  - depende de T6/T7: con repo real o fake transaccional, un fallo simulado en el
    `createMany` no deja fila en `carga`; una carga con 0 creadas no crea lote.
  - **Hecho:** ambos casos verdes.

- [x] **T13. [P] Test de no-regresión del alta manual y del histórico** (R8, R26, R29, R11)
  - depende de T7: `OrdenService.crear` deja `carga_id` NULL y no toca `carga`;
    `download_url` queda NULL en AMBAS tablas tras una carga completa por las dos vías
    (gate F1.4-4: ninguna ruta de esta feature la escribe); `num_guia` sin cambios de
    comportamiento.
  - **Hecho:** tests verdes en `tests/unit/services/orden-service.test.ts` (o archivo nuevo).

- [x] **T14. Mapa de trazabilidad R→test** — depende de T2–T13
  - `progress/impl_141.md` con la tabla R1..R30 → test concreto.
  - **Hecho:** ningún requisito sin test; `./init.sh` y `pnpm test` en verde; `pnpm typecheck`
    sin errores nuevos respecto del baseline medido al empezar.

## Grafo de dependencias (resumen)

```
T0 ─┬─ T1 ── T4 ── T5 ── T6 ─┬─ T7 ── T9 ── T11
    ├─ T2 [P]                 └─ T8 [P] ── T10 [P]
    └─ T3 [P]                            T12 [P], T13 [P]
                                              └── T14
```

## Notas de ejecucion (implementer)

Las 15 tasks estan `[x]`, con tres matices que quedan documentados en
`progress/impl_141.md` y NO se dan por hechos en silencio:

- **T0** — `migration.sql` y `down.sql` existen y estan cubiertos por un test estatico,
  pero NO se ejecutaron `pnpm db:migrate` ni `pnpm db:rollback`: el `.env` del entorno
  apunta a una base COMPARTIDA y el encargo prohibe escribir en ella. El round-trip
  up→down→up contra Postgres queda para el reviewer (misma politica que la feature 101).
- **T2** — el test estatico vive en `tests/integration/db/carga-migration.test.ts` (no en
  `tests/unit/db/`): es donde estan TODOS los tests de migracion del repo.
- **T11** — el `cargaId` de la sesion lo genera `procesarEnChunks` (en
  `carga-masiva-chunks.ts`), no sus llamadores: son componentes `.tsx` y el alcance exige
  cero `.tsx` en el diff. `procesarEnChunks` recibe el arreglo COMPLETO de la sesion, asi
  que su `filas.length` ES el total de la sesion (R18) y su invocacion es exactamente una
  por sesion (R12). Los llamadores pueden seguir pasando `cargaId`/`totalFiles` explicitos.
