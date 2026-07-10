# design.md — rename `embalaje` -> `en_fulfillment` (feature 28)

## Decisiones tecnicas

### D1 — `en_fulfillment` en la fuente unica de verdad (TS)
`ORDER_STATUS_SEED` (`lib/types/order-status.ts`) es la fuente unica de verdad;
`OrderStatusValue` se deriva de ella y `seedOrderStatus` la itera con `upsert`
por `value`. Se reemplaza el literal `"embalaje"` por `"en_fulfillment"`
(sigue siendo el 5.º valor, se conservan los 8 valores). Con esto, seed y tipos
quedan alineados automaticamente (R1, R2).

Se actualiza tambien el comentario del modelo `OrderStatus` en `db/schema.prisma`
(linea ~163) que enumera los valores (R6). El modelo Prisma en si NO cambia:
`order_status` sigue siendo `id String` + `value String @unique`.

### D2 — Migracion de rename in-place (UPDATE), no recrear la fila
`order_status` es una **tabla de catalogo** con UNIQUE en `value`, referenciada
por `orden.estatus_id` (FK). En una base ya migrada, la fila `embalaje` fue
sembrada en runtime por `seedOrderStatus` (o pudo existir por features previas) y
puede estar referenciada por ordenes reales.

La migracion hace un **UPDATE in-place** del `value`, conservando el `id` de la
fila y, por tanto, todas las FKs `orden.estatus_id` que apuntan a ella:

```
-- migration.sql (UP)
UPDATE "order_status" SET "value" = 'en_fulfillment' WHERE "value" = 'embalaje';
```
```
-- down.sql (DOWN)
UPDATE "order_status" SET "value" = 'embalaje' WHERE "value" = 'en_fulfillment';
```

Propiedades:
- **Idempotente / reejecutable:** si el valor de origen no existe, el UPDATE
  afecta 0 filas sin error (R4). En base nueva (tabla vacia o solo con
  `en_preparacion` sembrado por la migracion de carga masiva) afecta 0 filas; el
  seed posterior inserta `en_fulfillment` desde el TS ya actualizado.
- **Sin conflicto de UNIQUE:** `en_fulfillment` no preexiste antes del rename.
- **No toca otras tablas** ni crea/borra filas (R3).

Carpeta de migracion (timestamp posterior al ultimo, `20260710130000_rol_admin_satelite`):
`db/migrations/20260710140000_rename_order_status_embalaje_en_fulfillment/`
con `migration.sql` + `down.sql`. Se respeta `migration_lock.toml` (postgresql).

**Orden de aplicacion en base nueva:** las migraciones corren antes que el seed
de runtime; el UPDATE no encuentra `embalaje` (0 filas) y el seed inserta
`en_fulfillment`. En base existente el UPDATE renombra la fila real. Ambos
caminos convergen a un unico valor `en_fulfillment`. Correcto.

### D3 — Verificacion estatica de la migracion (deuda 4/6/15)
Igual que `tests/integration/db/carga-masiva-schema.test.ts`, la migracion se
verifica leyendo `migration.sql`/`down.sql` y afirmando por regex/`toContain`.
NO se aplica contra Postgres real en CI (deuda aceptada del repo). Nuevo test:
`tests/integration/db/rename-order-status-migration.test.ts` (R3, R4).

### D4 — Guard anti-`embalaje` (R6, R7)
Nuevo test `tests/unit/guards/no-embalaje.test.ts` que recorre el arbol del repo
con un grep case-insensitive de `embalaje` y falla si aparece fuera del
whitelist:
- `progress/history.md` (append-only, bitacora historica).
- `progress/review_ordenes.md` (registro de review historico) — sujeto a la
  Pregunta abierta 1.
- `feature_list.json` (definicion de la feature 28: nombre/slug/branch).
- `specs/rename-embalaje-fulfillment/**` (esta spec describe el rename).
- `.git/`, `node_modules/`, artefactos de build.

Este guard es la evidencia ejecutable de "no quedan rastros" y protege contra
regresiones futuras.

## Lista EXACTA de archivos a tocar (Fase 2)

Produccion / codigo:
1. `lib/types/order-status.ts` — `"embalaje"` -> `"en_fulfillment"` (R1).
2. `db/schema.prisma` — comentario del modelo `OrderStatus` (R6). Sin cambio de esquema.
3. `db/migrations/20260710140000_rename_order_status_embalaje_en_fulfillment/migration.sql` — NUEVO (R3).
4. `db/migrations/20260710140000_rename_order_status_embalaje_en_fulfillment/down.sql` — NUEVO (R4).

Tests:
5. `tests/unit/types/order-status.test.ts` — lista esperada usa `en_fulfillment` (R1).
6. `tests/unit/config/ordenes-config.test.ts` — override usa `en_fulfillment` (R5).
7. `tests/integration/db/rename-order-status-migration.test.ts` — NUEVO (R3, R4).
8. `tests/unit/guards/no-embalaje.test.ts` — NUEVO (R6, R7).

Nota: `tests/unit/scripts/seed-order-status.test.ts` deriva la lista esperada de
`ORDER_STATUS_SEED` (no hardcodea `embalaje`), por lo que **no requiere edicion**;
pasa a verificar `en_fulfillment` automaticamente al cambiar R1 (cubre R2).

Specs de codigo (docs vivas, se mantienen exactas):
9. `specs/ordenes/requirements.md` — linea 27 (R6).
10. `specs/ordenes/design.md` — lineas 38 y 206 (R6).

NO se tocan (append-only / definicion):
- `progress/history.md` — bitacora append-only. La correccion se documenta en los
  artefactos de esta feature (`progress/impl_rename-embalaje-fulfillment.md`,
  review), NO reescribiendo history.
- `progress/review_ordenes.md` — ver Pregunta abierta 1 en requirements.md.
- `feature_list.json` — nombre/slug/branch de la feature 28 (definicion historica).

## Alternativa descartada

**Recrear la fila (DELETE `embalaje` + INSERT `en_fulfillment`)** en vez de
`UPDATE` in-place. Descartada porque el INSERT genera un `id` nuevo: las ordenes
existentes cuyo `estatus_id` apunta al `id` viejo quedarian huerfanas o violarian
la FK `orden_estatus_id_fkey` (el DELETE fallaria por RESTRICT si hay ordenes en
ese estado). El `UPDATE` in-place conserva `id` y FKs, es mas simple y
reversible sin logica de reasignacion.

**Alternativa secundaria (contexto): enum de Postgres con `ALTER TYPE ... RENAME
VALUE`** (patron feature 19). No aplica: `order_status` ya es una tabla de
catalogo, no un enum. Migrar a enum seria un cambio de modelo mucho mayor,
fuera del alcance de una correccion de nomenclatura y romperia el seed por
`upsert` existente.
