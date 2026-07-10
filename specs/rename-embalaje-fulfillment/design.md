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

### D3 — Enum de Postgres `order_status_value` (standalone) — R9, R10
Se crea un enum de Postgres siguiendo el patron del tipo `rol_value` (enum
`RolValue` de la feature 19; ver `db/migrations/20260708212416_login_usuario_rba/`
`migration.sql` con `CREATE TYPE "rol_value" AS ENUM (...)` y su `down.sql` con
`DROP TYPE IF EXISTS "rol_value"`).

Nombre del tipo en DB: **`order_status_value`** (snake_case, coherente con
`rol_value`, `estado_usuario`). Si en el futuro se declarara en Prisma, el enum TS
seria `OrderStatusValue @@map("order_status_value")` (espejo de
`RolValue @@map("rol_value")`); por eso el nombre logico recomendado es
`OrderStatusValue`.

**Punto tecnico clave (por que SQL manual, no enum en `schema.prisma`):** Prisma
Migrate solo materializa un enum si algun modelo lo referencia. Un enum declarado
en `schema.prisma` pero NO usado por ninguna columna no se emite en la migracion
ni se crea en la DB. Como la decision recomendada es STANDALONE (no retipar la
columna, R9), el enum NO tendria referencia y Prisma no lo crearia. Por tanto se
crea con **migracion SQL manual** (misma tecnica que el UPDATE de rename), y
`schema.prisma` NO cambia.

```
-- migration.sql (UP) — 8 valores, ya con en_fulfillment
CREATE TYPE "order_status_value" AS ENUM (
  'entregada','devuelta','devuelta_origen','reprogramada',
  'en_fulfillment','en_ruta_bodega_principal','en_bodega','en_preparacion'
);
```
```
-- down.sql (DOWN)
DROP TYPE IF EXISTS "order_status_value";
```

Notas:
- `CREATE TYPE` no admite `IF NOT EXISTS` nativo; Prisma Migrate corre cada
  migracion una sola vez, asi que no se requiere idempotencia en el UP. El
  `down.sql` usa `IF EXISTS` para reversion segura.
- **Sincronia con la fuente unica (R10):** el valor canonico sigue siendo
  `ORDER_STATUS_SEED` (`lib/types/order-status.ts`). El enum SQL duplica esos 8
  valores; un test estatico parsea el `CREATE TYPE` y afirma que el conjunto es
  identico a `ORDER_STATUS_SEED`, evitando desincronizacion.
- Carpeta: `db/migrations/20260710150000_order_status_value_enum/`
  (timestamp posterior al rename `20260710140000_...`).

### D4 — Verificacion estatica + ejecucion real (deuda LEVANTADA) — R3, R4, R9, R10, R11
Primera barrera (estatica), patron `carga-masiva-schema.test.ts`: leer
`migration.sql`/`down.sql` y afirmar por regex/`toContain`.
- `tests/integration/db/rename-order-status-migration.test.ts` (R3, R4).
- `tests/integration/db/order-status-enum-migration.test.ts` (R9, R10: valores del
  `CREATE TYPE` == `ORDER_STATUS_SEED`, `DROP TYPE` en down).

Segunda barrera (ejecucion real, R11): a diferencia del patron 4/6/15, estas
migraciones SI se aplican y revierten contra el Postgres real del worktree
(`DATABASE_URL` del `.env`). Se aplican con `prisma migrate` (up), se revierten
ejecutando los `down.sql`, y la salida se registra como evidencia en
`progress/impl_rename-embalaje-fulfillment.md` (docs/verification.md). Esta feature
NO deja la ejecucion como deuda diferida.

### D5 — Guard anti-`embalaje` (R6, R7)
Nuevo test `tests/unit/guards/no-embalaje.test.ts` que recorre el arbol del repo
con un grep case-insensitive de `embalaje` y falla si aparece fuera del
whitelist (confirmado por el humano):
- `progress/history.md` (append-only, bitacora historica).
- `progress/review_ordenes.md` (append-only, registro de review historico).
- `feature_list.json` (definicion de la feature 28: nombre/slug/branch).
- `specs/rename-embalaje-fulfillment/**` (esta spec describe el rename).
- `.git/`, `node_modules/`, artefactos de build.

Este guard es la evidencia ejecutable de "no quedan rastros" y protege contra
regresiones futuras.

## Lista EXACTA de archivos a tocar (Fase 2)

Produccion / codigo:
1. `lib/types/order-status.ts` — `"embalaje"` -> `"en_fulfillment"` (R1).
2. `db/schema.prisma` — comentario del modelo `OrderStatus` (R6). Sin cambio de esquema (enum standalone NO se declara aqui; ver D3).
3. `db/migrations/20260710140000_rename_order_status_embalaje_en_fulfillment/migration.sql` — NUEVO (R3).
4. `db/migrations/20260710140000_rename_order_status_embalaje_en_fulfillment/down.sql` — NUEVO (R4).
5. `db/migrations/20260710150000_order_status_value_enum/migration.sql` — NUEVO, `CREATE TYPE order_status_value` (R9).
6. `db/migrations/20260710150000_order_status_value_enum/down.sql` — NUEVO, `DROP TYPE IF EXISTS order_status_value` (R9).

Tests:
7. `tests/unit/types/order-status.test.ts` — lista esperada usa `en_fulfillment` (R1).
8. `tests/unit/config/ordenes-config.test.ts` — override usa `en_fulfillment` (R5).
9. `tests/integration/db/rename-order-status-migration.test.ts` — NUEVO (R3, R4).
10. `tests/integration/db/order-status-enum-migration.test.ts` — NUEVO (R9, R10).
11. `tests/unit/guards/no-embalaje.test.ts` — NUEVO (R6, R7).

Evidencia (no es archivo de codigo):
12. `progress/impl_rename-embalaje-fulfillment.md` — mapa R->test + salida real de
    `prisma migrate` (up) y de los `down.sql` contra `DATABASE_URL` (R11).

Nota: `tests/unit/scripts/seed-order-status.test.ts` deriva la lista esperada de
`ORDER_STATUS_SEED` (no hardcodea `embalaje`), por lo que **no requiere edicion**;
pasa a verificar `en_fulfillment` automaticamente al cambiar R1 (cubre R2).

Specs de codigo (docs vivas, se mantienen exactas):
13. `specs/ordenes/requirements.md` — linea 27 (R6).
14. `specs/ordenes/design.md` — lineas 38 y 206 (R6).

NO se tocan (append-only / definicion, confirmado por el humano):
- `progress/history.md` — bitacora append-only. La correccion se documenta en
  `progress/impl_rename-embalaje-fulfillment.md`, NO reescribiendo history.
- `progress/review_ordenes.md` — append-only, en el whitelist del guard (R7).
- `feature_list.json` — nombre/slug/branch de la feature 28 (definicion historica).

## Alternativa descartada

**Recrear la fila (DELETE `embalaje` + INSERT `en_fulfillment`)** en vez de
`UPDATE` in-place. Descartada porque el INSERT genera un `id` nuevo: las ordenes
existentes cuyo `estatus_id` apunta al `id` viejo quedarian huerfanas o violarian
la FK `orden_estatus_id_fkey` (el DELETE fallaria por RESTRICT si hay ordenes en
ese estado). El `UPDATE` in-place conserva `id` y FKs, es mas simple y
reversible sin logica de reasignacion.

**Alternativa secundaria (contexto): enum de Postgres con `ALTER TYPE ... RENAME
VALUE`** (patron feature 19). No aplica al rename: `order_status` ya es una tabla
de catalogo, no un enum. El rename del valor se hace con UPDATE sobre la fila.

**Alternativa descartada del enum PG: RETIPAR la columna `order_status.value` al
nuevo enum.** Descartada como opcion por defecto (recomendacion: standalone). Al
retipar (`ALTER TABLE "order_status" ALTER COLUMN "value" TYPE "order_status_value"
USING ("value"::text::"order_status_value")`):
- Contradice la instruccion del humano de "solo renombralo en la tabla" (no
  reestructurar).
- Exige que TODA fila existente sea un valor valido del enum en el momento de la
  migracion; cualquier valor legado fuera de los 8 rompe el `ALTER`.
- Acopla el enum a Prisma: habria que declararlo en `schema.prisma`
  (`enum OrderStatusValue @@map("order_status_value")`) y retipar el modelo, con
  lo que la migracion dejaria de ser SQL "manual" y cambiaria el flujo de seed.
- Rollback mas complejo (retipar de vuelta a TEXT antes de `DROP TYPE`).
Queda como Sub-decision ABIERTA en requirements.md; si el humano opta por retipar,
R9/R11 y la lista de archivos se ajustan (schema.prisma cambia, la migracion del
enum incluye el `ALTER TABLE`, y el down invierte el retipado antes del `DROP
TYPE`).
