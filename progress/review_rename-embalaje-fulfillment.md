# review — rename `embalaje` -> `en_fulfillment` (feature 28)

Reviewer: rol reviewer (no edita codigo). Worktree: `ordenex-f28`. DB real:
`postgres@localhost:5432/ordenex`. Fecha: 2026-07-10.

## Verificacion ejecutada por el reviewer

- `bash ./init.sh` -> `== init OK ==`. typecheck OK, lint OK,
  Test Files 78 passed (78), Tests 687 passed (687). Confirmado (coincide con la
  bitacora del implementer).
- `prisma migrate status` -> "Database schema is up to date!" (11 migraciones).
- Grep independiente case-insensitive de `embalaje` en el repo: 12 archivos, TODOS
  dentro del whitelist justificado (ver punto 1). Ningun rastro en codigo de
  produccion (`lib/`, `scripts/`, `app/`), tests vigentes, ni `specs/ordenes`.
- Sin cambios en `.tsx`/UI (git diff): feature backend pura, confirmado.

### R11 — DB real, verificado por el reviewer (no solo la bitacora)

- (a) `order_status`: 8 filas, `embalaje`=0, `en_fulfillment`=1. OK
- (b) tipo PG `order_status_value` existe con los 8 labels correctos, en el orden
  de `ORDER_STATUS_SEED`. OK
- Columna `order_status.value` sigue `TEXT` (enum standalone, decision humana). OK
- (c) Reversibilidad ejecutada por el reviewer:
  - DOWN (DROP TYPE + UPDATE inverso): total=8, `embalaje`=1, `en_fulfillment`=0,
    enum=0. El UPDATE in-place NO cambia el numero de filas (conserva id/FKs).
  - RE-UP (rename + CREATE TYPE): total=8, `embalaje`=0, `en_fulfillment`=1, enum=1.
  - Estado final restaurado; `migrate status` sigue limpio. Reversibilidad e
    idempotencia demostradas de primera mano.

## Checklist de trazabilidad R1..R11

| Req | Test / evidencia | Estado |
|-----|------------------|--------|
| R1  | `tests/unit/types/order-status.test.ts` (lista con `en_fulfillment`, 8 unicos) + `lib/types/order-status.ts` | CUBIERTO |
| R2  | `tests/unit/scripts/seed-order-status.test.ts` (3 tests; deriva de `ORDER_STATUS_SEED`, idempotente por value) | CUBIERTO |
| R3  | `tests/integration/db/rename-order-status-migration.test.ts` (regex UPDATE UP, sin CREATE/DROP TABLE/DELETE/INSERT) | CUBIERTO |
| R4  | mismo test (regex UPDATE inverso DOWN) + reversibilidad real | CUBIERTO |
| R5  | `tests/unit/config/ordenes-config.test.ts` (override `en_fulfillment`) | CUBIERTO |
| R6  | `tests/unit/guards/no-embalaje.test.ts` + edits en `db/schema.prisma`, `specs/ordenes/*` | CUBIERTO |
| R7  | `tests/unit/guards/no-embalaje.test.ts` (grep repo con whitelist) + grep independiente del reviewer | CUBIERTO |
| R8  | `./init.sh` verde (typecheck+lint+test) | CUBIERTO |
| R9  | `tests/integration/db/order-status-enum-migration.test.ts` (CREATE TYPE, sin ALTER TABLE, DROP TYPE IF EXISTS) | CUBIERTO |
| R10 | mismo test (valores enum == `ORDER_STATUS_SEED`, set-equality) | CUBIERTO |
| R11 | Up+down reales contra DB verificados por el reviewer; evidencia en impl doc | CUBIERTO |

Ningun test es placebo: cada uno afirma el comportamiento concreto (literales SQL,
set-equality contra la fuente unica, conteos en DB real).

## Veredicto por punto de atencion

1. **Whitelist del guard.** CORRECTO y justificado, no laxo. Los 12 matches son:
   spec de esta feature (`specs/rename-embalaje-fulfillment/**`), carpeta de la
   migracion de rename + su test (literal exigido por R3/R4 en `WHERE value='embalaje'`
   y el regex), el propio guard, `feature_list.json` (definicion feature 28) y
   `progress/*` (append-only, decision humana). El unico ensanchamiento sobre la
   letra de R7 (dir `progress/` completo via `IGNORED_DIRS`) esta cubierto por la
   decision humana append-only y `progress/` no es "codigo/tests/specs vigentes".
   Ningun archivo de produccion ni `specs/ordenes` esta whitelisted, luego un
   rastro real NO puede esconderse en el alcance que R7 protege.

2. **Fix en `scripts/seed-catalogos.ts`.** CORRECTO, sin efectos colaterales.
   `getPrismaClient()` (adapter `PrismaPg`) y `process.loadEnvFile()` viven dentro
   de `main()`, que solo corre si el modulo es entrypoint (guarda `isEntrypoint`
   con `import.meta.url`). Los tests que importan `seedRoles`/`seedOrderStatus` NO
   disparan `main()` ni abren conexion (687 tests verdes). `loadEnvFile()` esta en
   try/catch: recargar .env es idempotente e inocuo.

3. **Deuda `scripts/db-rollback.ts`.** DEUDA ACEPTABLE, no bloqueante. R11 exige
   rollback verificable y esta cubierto: el reviewer ejecuto up+down reales con
   `prisma db execute --file` (exactamente lo prescrito por D4). `db-rollback.ts`
   es un helper preexistente, NO tocado por esta feature y fuera de su alcance
   (rename + enum). Diferirlo a una feature aparte es correcto; documentar la deuda.

## Hallazgos

- Ninguno BLOQUEANTE.
- menor: `IGNORED_DIRS` del guard ignora `progress/` entero (mas amplio que la
  letra de R7). Aceptado por decision humana append-only; sin impacto sobre el
  alcance protegido.
- menor/deuda: `scripts/db-rollback.ts` roto en Prisma 7 (usa `--schema`). Fuera de
  alcance; arreglar en feature aparte.

## VEREDICTO GLOBAL: APROBADO (0 bloqueantes)
