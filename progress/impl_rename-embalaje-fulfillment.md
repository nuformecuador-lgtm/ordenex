# impl — rename `embalaje` -> `en_fulfillment` (feature 28)

Fecha: 2026-07-10. Worktree: `ordenex-f28`. DB real: `postgres@localhost:5432/ordenex`.
Rol: implementer (coordina backend_dev; no autoaprueba). Enum PG: **STANDALONE**
(decision humana confirmada: la columna `order_status.value` sigue `TEXT`).

## Archivos tocados

Produccion / codigo:
- `lib/types/order-status.ts` — `embalaje` -> `en_fulfillment` en `ORDER_STATUS_SEED` (5.o valor, 8 unicos). (R1)
- `db/schema.prisma` — comentario del modelo `OrderStatus` (`embalaje` -> `en_fulfillment`); esquema sin cambios. (R6)
- `scripts/seed-catalogos.ts` — FIX soporte: `main()` usa `getPrismaClient()` (adapter `PrismaPg`) en vez de `new PrismaClient()` sin adapter; ademas carga el `.env` con `process.loadEnvFile()` (Prisma 7 no auto-carga; el seed corre por tsx, no por el CLI). Las funciones seed* NO cambian (reciben el cliente por parametro; los tests las importan sin conexion).
- `db/migrations/20260710140000_rename_order_status_embalaje_en_fulfillment/migration.sql` — NUEVO, UPDATE SET value=en_fulfillment WHERE value=embalaje. (R3)
- `db/migrations/20260710140000_rename_order_status_embalaje_en_fulfillment/down.sql` — NUEVO, UPDATE inverso. (R4)
- `db/migrations/20260710150000_order_status_value_enum/migration.sql` — NUEVO, CREATE TYPE order_status_value AS ENUM (8 valores), sin ALTER TABLE. (R9)
- `db/migrations/20260710150000_order_status_value_enum/down.sql` — NUEVO, DROP TYPE IF EXISTS order_status_value. (R9)

Tests:
- `tests/unit/types/order-status.test.ts` — lista esperada usa en_fulfillment. (R1)
- `tests/unit/config/ordenes-config.test.ts` — override usa en_fulfillment. (R5)
- `tests/integration/db/rename-order-status-migration.test.ts` — NUEVO, assert regex UP/DOWN, sin CREATE/DROP TABLE/DELETE/INSERT. (R3, R4)
- `tests/integration/db/order-status-enum-migration.test.ts` — NUEVO, valores del CREATE TYPE == ORDER_STATUS_SEED, DROP TYPE IF EXISTS en down, sin ALTER TABLE. (R9, R10)
- `tests/unit/guards/no-embalaje.test.ts` — NUEVO, grep case-insensitive del repo con whitelist. (R6, R7)

Specs de codigo (docs vivas):
- `specs/ordenes/requirements.md`, `specs/ordenes/design.md` — embalaje -> en_fulfillment. (R6)

NO tocados (append-only / definicion, whitelist): `progress/*` (history, review_ordenes, current), `feature_list.json`.

## Mapa R<n> -> test

| Req | Test que lo cubre | Estado |
|-----|-------------------|--------|
| R1  | tests/unit/types/order-status.test.ts | verde |
| R2  | tests/unit/scripts/seed-order-status.test.ts (3 tests; deriva de ORDER_STATUS_SEED, siembra en_fulfillment) | verde |
| R3  | tests/integration/db/rename-order-status-migration.test.ts (regex UP) | verde |
| R4  | tests/integration/db/rename-order-status-migration.test.ts (regex DOWN inverso) | verde |
| R5  | tests/unit/config/ordenes-config.test.ts | verde |
| R6  | tests/unit/guards/no-embalaje.test.ts (sobre specs/ordenes + schema.prisma) | verde |
| R7  | tests/unit/guards/no-embalaje.test.ts (repo con whitelist) | verde |
| R8  | ./init.sh (typecheck + lint + test) | verde |
| R9  | tests/integration/db/order-status-enum-migration.test.ts (CREATE TYPE / DROP TYPE IF EXISTS / sin ALTER TABLE) | verde |
| R10 | tests/integration/db/order-status-enum-migration.test.ts (valores enum == ORDER_STATUS_SEED) | verde |
| R11 | Ejecucion real up + rollback contra DATABASE_URL (evidencia abajo) | verde |

## Salida de tests (resumen)

./init.sh -> "== init OK ==":
- pnpm run typecheck -> OK, 0 errores.
- pnpm run lint -> OK, 0 errores/warnings.
- pnpm test (vitest) -> Test Files 78 passed (78) . Tests 687 passed (687).
- init.sh: todas las migraciones tienen down.sql; .env presente.

## Evidencia R11 — ejecucion real contra Postgres (localhost:5432/ordenex)

Estado inicial (pre-feature): order_status = solo en_preparacion (1 fila); enum order_status_value inexistente; catalogos a medias (tipos=1, roles=1) porque el seed nunca corrio (bug del adapter).

1. `npx prisma migrate deploy` -> aplica 20260710140000_rename_ y 20260710150000_order_status_value_enum. "All migrations have been successfully applied." La UPDATE de rename afecta 0 filas (no habia embalaje); el enum se crea. `prisma migrate status` -> "Database schema is up to date!".
2. `pnpm db:seed` (tras el fix del adapter+env) -> "Seed de catalogos completado". Estado post-seed:
   - order_status (8): devuelta, devuelta_origen, en_bodega, en_fulfillment, en_preparacion, en_ruta_bodega_principal, entregada, reprogramada.
   - filas embalaje = 0; filas en_fulfillment = 1.
   - tipo_identificacion = 3; rol = 5 (incl. adminSatelite).
   - enum order_status_value con 8 labels: entregada, devuelta, devuelta_origen, reprogramada, en_fulfillment, en_ruta_bodega_principal, en_bodega, en_preparacion.

Checks exigidos:
- (a) no queda fila order_status.value=embalaje y existe en_fulfillment: OK (embalaje=0, en_fulfillment=1).
- (b) el tipo order_status_value existe con los 8 valores correctos: OK.

3. Rollback (reversibilidad, check c). Se ejecutaron ambos down.sql con `prisma db execute --file`:
   - order_status_value_enum/down.sql (DROP TYPE) -> success.
   - rename_/down.sql (en_fulfillment -> embalaje) -> success.
   - Estado tras DOWN: order_status total=8 (sin crear/borrar filas), embalaje=1, en_fulfillment=0, enum_exists=0 -> revierte correctamente.
4. Re-aplicacion de los UP para dejar el estado final consistente:
   - rename_/migration.sql -> success; order_status_value_enum/migration.sql -> success.
   - Estado FINAL: order_status total=8, embalaje=0, en_fulfillment=1, enum_exists=1.
   - `prisma migrate status` -> "Database schema is up to date!".

Reversibilidad e idempotencia demostradas: up y down corren sin error contra la DB real; el down revierte ambos cambios sin tocar el numero de filas ni FKs (UPDATE in-place conserva el id), y la re-aplicacion restaura el estado correcto.

Nota mecanica: el rollback se ejecuto directamente con `prisma db execute --file=<down.sql>` (Prisma 7 ya NO acepta --schema en db execute/migrate resolve). Ver punto abierto sobre scripts/db-rollback.ts.

## Guard anti-embalaje

tests/unit/guards/no-embalaje.test.ts en verde. Grep case-insensitive independiente sobre el repo (excl. node_modules/.git): los unicos rastros de embalaje estan en el whitelist justificado:
- progress/* (append-only) y feature_list.json (definicion feature 28) — whitelist confirmado por el humano.
- specs/rename-embalaje-fulfillment/* — spec que describe el rename (R7).
- db/migrations/20260710140000_rename_/{migration,down}.sql y tests/integration/db/rename-order-status-migration.test.ts — OBLIGATORIO por R3/R4: embalaje es el valor origen del UPDATE WHERE value=embalaje y del regex que lo verifica.
- el propio tests/unit/guards/no-embalaje.test.ts (contiene el literal a buscar).
- tsconfig.tsbuildinfo — artefacto de build generado (no fuente; el guard ignora esa extension).

## Desviaciones / puntos para el reviewer y el humano

1. Whitelist del guard extendido respecto a la letra de R7 (necesario). R7/D5 listaban solo progress/history.md, progress/review_ordenes.md, feature_list.json y specs/rename-embalaje-fulfillment/**. Fue necesario ampliarlo (documentado en el propio test) con: (i) todo el dir progress/ — decision humana ya tomada (append-only, incluye current.md); (ii) la carpeta de la migracion de rename y su test estatico — porque R3/R4 EXIGEN el literal embalaje (valor origen del UPDATE) y el regex que lo comprueba; (iii) el propio archivo del guard. Sin esta ampliacion el guard se autocontradice con R3/R4. No es un rastro accidental sino artefacto exigido por la misma feature.
2. scripts/db-rollback.ts quedaria roto en Prisma 7 (usa --schema en `prisma db execute` y `prisma migrate resolve`, flag ya no soportado). FUERA del alcance declarado de esta feature (el fix in-scope era seed-catalogos.ts). El rollback R11 se ejecuto manualmente sin ese script. Se deja como deuda/decision para el humano: arreglar db-rollback.ts en una feature aparte.

## Nota append-only

progress/* (incl. history.md y review_ordenes.md) es append-only: NO se edito. La correccion del rename se documenta aqui, no reescribiendo la bitacora historica.
