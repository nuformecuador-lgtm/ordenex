# requirements.md — rename estado `embalaje` -> `en_fulfillment` (feature 28)

## Contexto

Feature de CORRECCION de nomenclatura. El estado del catalogo `order_status`
llamado `embalaje` representa el concepto de *fulfillment* y debe renombrarse a
`en_fulfillment` para seguir la convencion `en_` del resto de estados
(`en_preparacion`, `en_bodega`, `en_ruta_bodega_principal`).

Se hace como feature APARTE porque las features que introdujeron/usaron
`embalaje` (feature 6 y otras) ya estan `done` y no se re-ejecutan.

Hechos verificados sobre el repo (grounding re-confirmado con Grep):

- `order_status` es una **tabla de catalogo** (no un enum de Postgres). Definida
  en `db/migrations/20260709130000_ordenes_catalogos_geografia/migration.sql`
  con indice UNIQUE `order_status_value_key` sobre `value`.
- Las filas de `order_status` se siembran en **runtime** por `seedOrderStatus`
  (`scripts/seed-catalogos.ts`), que itera `ORDER_STATUS_SEED`
  (`lib/types/order-status.ts`) con `upsert` por `value`. Ademas, la migracion
  `20260710000000_carga_masiva_ordenes` inserta `en_preparacion` con
  `INSERT ... ON CONFLICT (value) DO NOTHING` (precedente de seed via migracion).
- `embalaje` aparece hoy (dev) en: `lib/types/order-status.ts:10`,
  `db/schema.prisma:163` (comentario del modelo), `tests/unit/types/order-status.test.ts:12`,
  `tests/unit/config/ordenes-config.test.ts:28,32`, `specs/ordenes/requirements.md:27`,
  `specs/ordenes/design.md:38,206`, `progress/review_ordenes.md:47`,
  `progress/history.md:112`, y en `feature_list.json` (definicion de la feature 28).
- NO hay referencias en `.tsx`/UI. Es backend puro.

Alcance ampliado por decision humana (2026-07-10): ademas del rename en la tabla,
esta feature crea un **enum de Postgres** para los estados de orden (para
validaciones posteriores), siguiendo el patron del enum `rol_value` (`RolValue`,
feature 19). Hoy NO existe tal enum: `order_status` es solo tabla catalogo y
`OrderStatusValue` (TS) se deriva de `ORDER_STATUS_SEED`.

Deuda de despliegue LEVANTADA para esta feature: a diferencia del patron
4/6/15 (migraciones no aplicadas contra Postgres en CI), aqui las migraciones
**SI se aplican y revierten contra Postgres real** (el worktree tiene `.env` con
`DATABASE_URL` funcional; `prisma generate` corre y la suite pasa). La
verificacion estatica (leer `migration.sql`/`down.sql` y afirmar por regex, patron
`tests/integration/db/carga-masiva-schema.test.ts`) se conserva como primera
barrera, pero NO sustituye a la ejecucion real de up + down (R11).

## Requisitos (EARS)

- **R1 — Fuente unica de verdad (TS).** El sistema DEBE definir el estado de
  fulfillment como `en_fulfillment` en `ORDER_STATUS_SEED`
  (`lib/types/order-status.ts`). `ORDER_STATUS_SEED` NO DEBE contener el valor
  `embalaje` y DEBE mantener exactamente 8 valores unicos.

- **R2 — Seed coherente.** CUANDO se ejecute `seedOrderStatus`
  (`scripts/seed-catalogos.ts`), el sistema DEBE sembrar `en_fulfillment` y NO
  DEBE sembrar `embalaje`, conservando la idempotencia por `value` (una fila por
  valor, `id` estable en re-ejecuciones).

- **R3 — Migracion de rename (UP).** El sistema DEBE incluir una migracion
  Prisma cuyo `migration.sql` renombre la fila del catalogo `order_status` de
  `embalaje` a `en_fulfillment` **in-place**, mediante
  `UPDATE "order_status" SET "value" = 'en_fulfillment' WHERE "value" = 'embalaje'`,
  preservando el `id` de la fila y por tanto las FKs `orden.estatus_id` que la
  referencian. La migracion NO DEBE crear ni borrar filas de `order_status`, ni
  tocar otras tablas.

- **R4 — Reversion e idempotencia (DOWN).** El sistema DEBE proveer `down.sql`
  con el `UPDATE` inverso
  (`SET "value" = 'embalaje' WHERE "value" = 'en_fulfillment'`). SI el valor de
  origen no existe en la tabla, ENTONCES cada script DEBE afectar 0 filas sin
  error (idempotente/reejecutable).

- **R5 — Tests de config actualizados.** Los tests que fijan
  `ORDENES_DEFAULT_ESTATUS_VALUE` (`tests/unit/config/ordenes-config.test.ts`)
  DEBEN usar `en_fulfillment` en lugar de `embalaje`, y seguir verificando el
  mecanismo de override por entorno.

- **R6 — Referencias en specs y comentarios vigentes.** Las specs de codigo
  `specs/ordenes/requirements.md` y `specs/ordenes/design.md`, y el comentario
  del modelo `OrderStatus` en `db/schema.prisma`, NO DEBEN referenciar `embalaje`
  como estado vigente; DEBEN nombrar `en_fulfillment`.

- **R7 — Ausencia de rastros.** Tras el cambio, el sistema NO DEBE contener
  ninguna referencia a `embalaje` (case-insensitive) en codigo de produccion,
  tests ni specs vigentes. Las UNICAS excepciones permitidas son los artefactos
  append-only y de definicion: `progress/history.md`, `progress/review_ordenes.md`,
  `feature_list.json` (nombre/branch/slug de la feature 28) y la propia carpeta
  `specs/rename-embalaje-fulfillment/` (que describe el rename). Verificable con
  grep case-insensitive.

- **R8 — No regresion.** El sistema DEBE mantener en verde `npm run typecheck`,
  `npm run lint`, `npm test` y `./init.sh` tras el cambio.

- **R9 — Enum de Postgres para estados de orden.** El sistema DEBE crear, via
  migracion Prisma manual (SQL), un enum de Postgres `order_status_value`
  (patron `rol_value`) que contenga EXACTAMENTE los 8 valores de
  `ORDER_STATUS_SEED` ya con `en_fulfillment` (entregada, devuelta,
  devuelta_origen, reprogramada, en_fulfillment, en_ruta_bodega_principal,
  en_bodega, en_preparacion). El `down.sql` DEBE eliminar el tipo
  (`DROP TYPE IF EXISTS "order_status_value"`). El enum se crea **standalone**
  (recomendacion, ver Sub-decision abierta): NO retipa la columna
  `order_status.value`, que permanece `TEXT`.

- **R10 — Sincronia enum PG <-> fuente unica TS.** El sistema DEBE garantizar,
  con un test estatico, que el conjunto de valores del enum `order_status_value`
  (leido de su `migration.sql`) es identico al conjunto de `ORDER_STATUS_SEED`.
  SI ambos divergen, ENTONCES el test DEBE fallar.

- **R11 — Ejecucion real de migraciones y rollback.** CUANDO se apliquen las
  migraciones de esta feature (rename `order_status` + creacion del enum), el
  sistema DEBE aplicarlas y luego revertirlas (`down.sql`) contra el Postgres
  real (`DATABASE_URL` del worktree), sin errores y dejando la base en su estado
  previo. La evidencia (salida de `prisma migrate` up + ejecucion de los
  `down.sql`) DEBE registrarse en `progress/impl_rename-embalaje-fulfillment.md`.

## Mapa R<n> -> test (trazabilidad)

| Req | Test que lo cubre |
|-----|-------------------|
| R1  | `tests/unit/types/order-status.test.ts` (lista actualizada a `en_fulfillment`) |
| R2  | `tests/unit/scripts/seed-order-status.test.ts` (siembra `en_fulfillment`, idempotente) |
| R3  | `tests/integration/db/rename-order-status-migration.test.ts` (NUEVO; assert regex sobre `migration.sql`) |
| R4  | `tests/integration/db/rename-order-status-migration.test.ts` (assert regex sobre `down.sql`) |
| R5  | `tests/unit/config/ordenes-config.test.ts` (override usa `en_fulfillment`) |
| R6  | Guard test grep en `tests/unit/guards/no-embalaje.test.ts` (NUEVO) sobre `specs/ordenes/*` y `db/schema.prisma` |
| R7  | Guard test grep en `tests/unit/guards/no-embalaje.test.ts` (NUEVO) sobre el repo con whitelist de excepciones |
| R8  | Suite completa via `./init.sh` (typecheck + lint + test) |
| R9  | `tests/integration/db/order-status-enum-migration.test.ts` (NUEVO; assert regex sobre `CREATE TYPE` UP y `DROP TYPE` DOWN) |
| R10 | `tests/integration/db/order-status-enum-migration.test.ts` (NUEVO; compara valores del enum contra `ORDER_STATUS_SEED`) |
| R11 | Ejecucion real `prisma migrate` up + `down.sql` contra `DATABASE_URL`; evidencia en `progress/impl_rename-embalaje-fulfillment.md` (ver docs/verification.md) |

## Decisiones confirmadas por el humano (2026-07-10)

- **`progress/*` es append-only** (incluye `progress/history.md` y
  `progress/review_ordenes.md`): NO se edita; queda en el whitelist del guard
  anti-`embalaje` (R7). La correccion se documenta en los artefactos de esta
  feature, no reescribiendo history/review.
- **`feature_list.json`** conserva `embalaje` en nombre/slug/branch de la feature
  28 (`feature/28-rename-embalaje-fulfillment`); es la definicion de la feature,
  queda en el whitelist (R7).

## Sub-decision ABIERTA (puerta de aprobacion humana)

**Enum PG: standalone vs retipar la columna.** ¿La columna `order_status.value`
se RETIPA al nuevo enum `order_status_value`, o el enum queda STANDALONE (la tabla
conserva `value TEXT` y el enum solo sirve para validaciones/columnas futuras)?

- **Recomendacion: STANDALONE (no retipar ahora).** Coherente con la instruccion
  del humano de "solo renombralo en la tabla" (no reestructurar). El enum se crea
  con SQL manual y no toca la tabla; menor riesgo, reversible con `DROP TYPE`.
- **Trade-off:** standalone deja dos representaciones del mismo dominio (columna
  `TEXT` + enum PG) hasta que una feature futura decida retipar; el enum no valida
  aun la columna real. Retipar ahora daria validacion inmediata a nivel DB, pero
  implica `ALTER TABLE ... ALTER COLUMN value TYPE order_status_value USING
  (value::text::order_status_value)`, exige que TODA fila existente sea un valor
  valido del enum (incluida la ya renombrada a `en_fulfillment`), acopla el enum a
  Prisma (habria que declararlo en `schema.prisma` y retipar el modelo) y complica
  el rollback. Contradice el alcance minimo pedido.

Requiere confirmacion humana antes de Fase 2. R9 asume STANDALONE; si se decide
retipar, R9/R11 y la lista de archivos cambian (ver design.md).
