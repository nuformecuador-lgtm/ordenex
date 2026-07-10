# tasks.md — rename `embalaje` -> `en_fulfillment` (feature 28)

Cada task es discreta y verificable. `[P]` = paralelizable (sin dependencia con
otra `[P]` del mismo bloque). El orden numerico refleja dependencias.

## Bloque A — Fuente de verdad y seed

- [x] **T1 (R1).** En `lib/types/order-status.ts`, reemplazar `"embalaje"` por
  `"en_fulfillment"` (5.º valor). Mantener 8 valores unicos.
  - Hecho cuando: el archivo ya no contiene `embalaje` y `ORDER_STATUS_SEED`
    incluye `en_fulfillment`.
  - Test: `tests/unit/types/order-status.test.ts`.

- [x] **T2 (R1).** En `tests/unit/types/order-status.test.ts`, actualizar la
  lista esperada (`embalaje` -> `en_fulfillment`) manteniendo el assert de 8
  valores unicos.
  - Hecho cuando: el test pasa y afirma `en_fulfillment`.
  - Depende de: T1.

- [x] **T3 (R2).** Verificar `tests/unit/scripts/seed-order-status.test.ts`
  (deriva de `ORDER_STATUS_SEED`, no hardcodea `embalaje`). No requiere edicion;
  confirmar que pasa con `en_fulfillment`.
  - Hecho cuando: el test verde muestra `en_fulfillment` entre los 8 sembrados.
  - Depende de: T1.

## Bloque B — Migracion de rename

- [x] **T4 (R3).** Crear
  `db/migrations/20260710140000_rename_order_status_embalaje_en_fulfillment/migration.sql`
  con:
  `UPDATE "order_status" SET "value" = 'en_fulfillment' WHERE "value" = 'embalaje';`
  - Hecho cuando: el archivo existe con el UPDATE exacto y ningun `CREATE/DROP
    TABLE` ni cambios a otras tablas.
  - Test: `tests/integration/db/rename-order-status-migration.test.ts`.

- [x] **T5 (R4).** Crear `.../down.sql` con el UPDATE inverso:
  `UPDATE "order_status" SET "value" = 'embalaje' WHERE "value" = 'en_fulfillment';`
  - Hecho cuando: el archivo existe y revierte T4; idempotente (0 filas si no hay
    origen).
  - Depende de: T4.

- [x] **T6 (R3, R4).** Crear el test estatico
  `tests/integration/db/rename-order-status-migration.test.ts` (patron
  `carga-masiva-schema.test.ts`): localiza la carpeta `*_rename_order_status_*`,
  lee `migration.sql`/`down.sql` y afirma por regex el UPDATE UP, el UPDATE DOWN
  inverso, y que no hay `CREATE TABLE`/`DROP TABLE`/`DELETE`/`INSERT`.
  - Hecho cuando: el test pasa contra los archivos de T4/T5.
  - Depende de: T4, T5.

## Bloque B2 — Enum de Postgres `order_status_value` (standalone)

> Sujeto a la Sub-decision ABIERTA (standalone vs retipar). Estas tasks asumen
> STANDALONE (recomendado). Si el humano decide retipar, ajustar T-enum + schema.

- [x] **T4b (R9).** Crear
  `db/migrations/20260710150000_order_status_value_enum/migration.sql` con
  `CREATE TYPE "order_status_value" AS ENUM (...)` y los 8 valores ya con
  `en_fulfillment`, en el mismo orden que `ORDER_STATUS_SEED`. NO retipa la
  columna `order_status.value`. Patron: `CREATE TYPE "rol_value"` de la migracion
  `20260708212416_login_usuario_rba`.
  - Hecho cuando: existe el `CREATE TYPE` con los 8 valores y ningun `ALTER TABLE`.
  - Test: `tests/integration/db/order-status-enum-migration.test.ts`.

- [x] **T5b (R9).** Crear `.../down.sql` con `DROP TYPE IF EXISTS "order_status_value";`.
  - Hecho cuando: el archivo existe y revierte T4b.
  - Depende de: T4b.

- [x] **T6b (R9, R10).** Crear el test estatico
  `tests/integration/db/order-status-enum-migration.test.ts`: lee `migration.sql`
  del enum, extrae los valores del `CREATE TYPE` y afirma que el conjunto es
  identico a `ORDER_STATUS_SEED` (R10); afirma `DROP TYPE IF EXISTS` en el
  `down.sql` y que el UP no contiene `ALTER TABLE` (standalone, R9).
  - Hecho cuando: el test pasa contra T4b/T5b y detecta desincronizacion.
  - Depende de: T1 (fuente TS actualizada), T4b, T5b.

## Bloque C — Referencias en tests, specs y comentarios

- [x] **T7 [P] (R5).** En `tests/unit/config/ordenes-config.test.ts`, cambiar el
  override `ORDENES_DEFAULT_ESTATUS_VALUE` de `"embalaje"` a `"en_fulfillment"`
  (lineas ~28 y ~32).
  - Hecho cuando: el test pasa y ya no menciona `embalaje`.

- [x] **T8 [P] (R6).** En `db/schema.prisma`, actualizar el comentario del modelo
  `OrderStatus` (~linea 163): `embalaje` -> `en_fulfillment`.
  - Hecho cuando: el comentario nombra `en_fulfillment`; el esquema no cambia.

- [x] **T9 [P] (R6).** En `specs/ordenes/requirements.md` (~linea 27) y
  `specs/ordenes/design.md` (~lineas 38 y 206), reemplazar `embalaje` por
  `en_fulfillment`.
  - Hecho cuando: esos archivos ya no contienen `embalaje`.

## Bloque D — Guard y verificacion final

- [x] **T10 (R6, R7).** Crear `tests/unit/guards/no-embalaje.test.ts`: grep
  case-insensitive de `embalaje` en el repo; falla si aparece fuera del whitelist
  (`progress/history.md`, `progress/review_ordenes.md`, `feature_list.json`,
  `specs/rename-embalaje-fulfillment/**`, y directorios ignorados `.git`,
  `node_modules`, build).
  - Hecho cuando: el test pasa (sin rastros fuera del whitelist).
  - Depende de: T1–T9.

- [x] **T11 (R11).** Aplicar las migraciones contra el Postgres real
  (`DATABASE_URL` del `.env`): `prisma migrate` (up) de rename + enum, `prisma
  generate`. Luego verificar el rollback ejecutando ambos `down.sql` contra la DB
  real y confirmar que la base vuelve al estado previo (fila `en_fulfillment`
  revertida a `embalaje`, `order_status_value` eliminado). Reaplicar up para dejar
  la DB en el estado final.
  - Hecho cuando: up y down corren sin error contra la DB real y su salida queda
    pegada en `progress/impl_rename-embalaje-fulfillment.md`.
  - Depende de: T4, T5, T4b, T5b.

- [x] **T12 (R8).** Correr `npm run typecheck`, `npm run lint`, `npm test` y
  `./init.sh`; todo en verde.
  - Hecho cuando: `./init.sh` termina en verde y se pega la salida en
    `progress/impl_rename-embalaje-fulfillment.md` con el mapa R<n> -> test.
  - Depende de: T1–T11.

- [x] **T13 (proceso).** Documentar en `progress/impl_rename-embalaje-fulfillment.md`
  la correccion, el mapa de trazabilidad R1..R11 -> test, la evidencia de
  ejecucion real (R11) y la nota de que `progress/*` (history + review_ordenes) es
  append-only y NO se edita.
  - Hecho cuando: el impl doc registra trazabilidad, evidencia y nota append-only.
  - Depende de: T12.

## Dependencias (resumen)

- T2, T3 -> T1
- T5, T6 -> T4
- T5b, T6b -> T4b; T6b -> T1
- Bloque B2 (enum) es `[P]` respecto al Bloque B (rename)
- T7, T8, T9 son `[P]` entre si y respecto a los bloques A/B/B2
- T10 -> T1..T9 (incluye T4b–T6b)
- T11 (ejecucion real) -> T4, T5, T4b, T5b
- T12 -> T1..T11
- T13 -> T12

## Nota (puerta de aprobacion)

Antes de Fase 2, resolver la **Sub-decision ABIERTA** de `requirements.md`: enum
PG **standalone** (recomendado) vs **retipar** la columna `order_status.value`. Si
se decide retipar, ajustar el Bloque B2 (schema.prisma + `ALTER TABLE` en la
migracion del enum + rollback del retipado) antes de implementar.

Decisiones ya confirmadas por el humano: `progress/*` (incl. `review_ordenes.md`)
es append-only (no se edita, whitelist del guard); `feature_list.json` conserva
`embalaje` en nombre/slug/branch (whitelist).
