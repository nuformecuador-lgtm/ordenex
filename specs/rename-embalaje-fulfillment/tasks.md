# tasks.md — rename `embalaje` -> `en_fulfillment` (feature 28)

Cada task es discreta y verificable. `[P]` = paralelizable (sin dependencia con
otra `[P]` del mismo bloque). El orden numerico refleja dependencias.

## Bloque A — Fuente de verdad y seed

- [ ] **T1 (R1).** En `lib/types/order-status.ts`, reemplazar `"embalaje"` por
  `"en_fulfillment"` (5.º valor). Mantener 8 valores unicos.
  - Hecho cuando: el archivo ya no contiene `embalaje` y `ORDER_STATUS_SEED`
    incluye `en_fulfillment`.
  - Test: `tests/unit/types/order-status.test.ts`.

- [ ] **T2 (R1).** En `tests/unit/types/order-status.test.ts`, actualizar la
  lista esperada (`embalaje` -> `en_fulfillment`) manteniendo el assert de 8
  valores unicos.
  - Hecho cuando: el test pasa y afirma `en_fulfillment`.
  - Depende de: T1.

- [ ] **T3 (R2).** Verificar `tests/unit/scripts/seed-order-status.test.ts`
  (deriva de `ORDER_STATUS_SEED`, no hardcodea `embalaje`). No requiere edicion;
  confirmar que pasa con `en_fulfillment`.
  - Hecho cuando: el test verde muestra `en_fulfillment` entre los 8 sembrados.
  - Depende de: T1.

## Bloque B — Migracion de rename

- [ ] **T4 (R3).** Crear
  `db/migrations/20260710140000_rename_order_status_embalaje_en_fulfillment/migration.sql`
  con:
  `UPDATE "order_status" SET "value" = 'en_fulfillment' WHERE "value" = 'embalaje';`
  - Hecho cuando: el archivo existe con el UPDATE exacto y ningun `CREATE/DROP
    TABLE` ni cambios a otras tablas.
  - Test: `tests/integration/db/rename-order-status-migration.test.ts`.

- [ ] **T5 (R4).** Crear `.../down.sql` con el UPDATE inverso:
  `UPDATE "order_status" SET "value" = 'embalaje' WHERE "value" = 'en_fulfillment';`
  - Hecho cuando: el archivo existe y revierte T4; idempotente (0 filas si no hay
    origen).
  - Depende de: T4.

- [ ] **T6 (R3, R4).** Crear el test estatico
  `tests/integration/db/rename-order-status-migration.test.ts` (patron
  `carga-masiva-schema.test.ts`): localiza la carpeta `*_rename_order_status_*`,
  lee `migration.sql`/`down.sql` y afirma por regex el UPDATE UP, el UPDATE DOWN
  inverso, y que no hay `CREATE TABLE`/`DROP TABLE`/`DELETE`/`INSERT`.
  - Hecho cuando: el test pasa contra los archivos de T4/T5.
  - Depende de: T4, T5.

## Bloque C — Referencias en tests, specs y comentarios

- [ ] **T7 [P] (R5).** En `tests/unit/config/ordenes-config.test.ts`, cambiar el
  override `ORDENES_DEFAULT_ESTATUS_VALUE` de `"embalaje"` a `"en_fulfillment"`
  (lineas ~28 y ~32).
  - Hecho cuando: el test pasa y ya no menciona `embalaje`.

- [ ] **T8 [P] (R6).** En `db/schema.prisma`, actualizar el comentario del modelo
  `OrderStatus` (~linea 163): `embalaje` -> `en_fulfillment`.
  - Hecho cuando: el comentario nombra `en_fulfillment`; el esquema no cambia.

- [ ] **T9 [P] (R6).** En `specs/ordenes/requirements.md` (~linea 27) y
  `specs/ordenes/design.md` (~lineas 38 y 206), reemplazar `embalaje` por
  `en_fulfillment`.
  - Hecho cuando: esos archivos ya no contienen `embalaje`.

## Bloque D — Guard y verificacion final

- [ ] **T10 (R6, R7).** Crear `tests/unit/guards/no-embalaje.test.ts`: grep
  case-insensitive de `embalaje` en el repo; falla si aparece fuera del whitelist
  (`progress/history.md`, `progress/review_ordenes.md`, `feature_list.json`,
  `specs/rename-embalaje-fulfillment/**`, y directorios ignorados `.git`,
  `node_modules`, build).
  - Hecho cuando: el test pasa (sin rastros fuera del whitelist).
  - Depende de: T1–T9.

- [ ] **T11 (R8).** Correr `npm run typecheck`, `npm run lint`, `npm test` y
  `./init.sh`; todo en verde.
  - Hecho cuando: `./init.sh` termina en verde y se pega la salida en
    `progress/impl_rename-embalaje-fulfillment.md` con el mapa R<n> -> test.
  - Depende de: T1–T10.

- [ ] **T12 (proceso).** Documentar en `progress/impl_rename-embalaje-fulfillment.md`
  la correccion y la mencion historica en `progress/history.md`/`review_ordenes.md`
  (que NO se editan). NO reescribir `progress/history.md`.
  - Hecho cuando: el impl doc registra el mapa de trazabilidad y la nota de
    append-only.
  - Depende de: T11.

## Dependencias (resumen)

- T2, T3 -> T1
- T5, T6 -> T4
- T7, T8, T9 son `[P]` entre si y respecto a los bloques A/B
- T10 -> T1..T9
- T11 -> T1..T10
- T12 -> T11

## Nota (puerta de aprobacion)

Antes de Fase 2, resolver las Preguntas abiertas de `requirements.md`
(trato de `progress/review_ordenes.md` y del slug/branch en `feature_list.json`).
