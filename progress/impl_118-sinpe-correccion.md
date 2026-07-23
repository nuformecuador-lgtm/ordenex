# Impl 118 — Corrección SIMPE → SINPE (bitácora)

> Rama: `feature/118-sinpe-correccion` (nace de `dev` limpio + spec).
> Estrategia: `ALTER TYPE "metodo_pago_value" RENAME VALUE 'SIMPE' TO 'SINPE'` en una
> migración NUEVA con `down.sql` inverso. Solo cambia el VALOR del enum + tipos +
> labels + tests. Identificadores internos (`total_simpe`, `totalSimpe`, clave DTO
> `simpe`) intactos (R9). Migración histórica intacta (R10).

## Archivos creados (4)

- `db/migrations/20260723120000_metodo_pago_rename_simpe_to_sinpe/migration.sql`
  — UP: `RENAME VALUE 'SIMPE' TO 'SINPE'` (R2). Timestamp posterior a la última
  migración (`20260722150000_*`).
- `db/migrations/20260723120000_metodo_pago_rename_simpe_to_sinpe/down.sql`
  — DOWN: `RENAME VALUE 'SINPE' TO 'SIMPE'` (R3). Contiene `'SIMPE'` por diseño.
- `tests/integration/db/metodo-pago-rename-simpe-sinpe-migration.test.ts`
  — cobertura estática UP/DOWN (R2/R3) + garantía de no-reescritura de filas (R4).
- `tests/unit/guards/censo-simpe.test.ts`
  — guard de censo case-sensitive de `SIMPE` sobre `app/ lib/ tests/ e2e/` (R12).

## Archivos modificados — fuentes (10)

- `db/schema.prisma` — `enum MetodoPagoValue`: `SIMPE` → `SINPE` + comentario. (NO se
  tocan `total_simpe`/`totalSimpe`.)
- `lib/types/metodo-pago.ts` — `METODO_PAGO_SEED` → `SINPE` + comentario.
- `lib/utils/cierre-totales.ts` — `case "SIMPE":` → `case "SINPE":` (la clave DTO
  `simpe` local NO cambia, R9).
- `app/(app)/mis-asignaciones/_components/metodo-pago-options.ts` — clave+label.
- `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` — `METODO_LABEL`, `TotalItem`
  label, `value` de columna (`id:"simpe"` interno NO cambia).
- `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` — `METODO_LABEL`,
  `TotalItem` label, comentario.
- `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` — `TotalItem` label.
- `app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx` — `value` de
  columna (`id:"simpe"` interno NO cambia).
- `lib/services/CierreBodegaService.ts` — **comentario** `SIMPE`→`SINPE` (línea 79).
  Fuera del censo original del design pero REQUERIDO por el guard R12 (era el único
  `SIMPE` mayúscula restante en `lib/`). Solo comenta; NO toca la clave DTO `simpe`.

## Archivos modificados — tests (12)

- `tests/unit/types/metodo-pago.test.ts` — set `SINPE` + nombre.
- `tests/unit/utils/cierre-totales.test.ts` — input `metodoPago:"SINPE"` (DTO `simpe:`
  intacto).
- `tests/unit/types/gestion-orden-schemas.test.ts` — `metodoPago:"SINPE"`.
- `tests/unit/services/cierre-dia-service.test.ts` — inputs + aserciones `SINPE`.
- `tests/unit/services/cierres-admin-service.test.ts` — `metodoPago:"SINPE"`.
- `tests/unit/services/cierre-bodega-service.test.ts` — texto del nombre del test.
- `tests/integration/db/resolver-novedad-reprograma-dinero.test.ts` — textos.
- `tests/integration/actions/cierre-dia-action.test.ts` — `metodoPago:"SINPE"`.
- `tests/components/CierreDiaModule.test.tsx` — input + `getByText("SINPE")`.
- `tests/components/CierresAdminModule.test.tsx` — input + `getByText("SINPE")`.
- `tests/integration/db/gestion-orden-migration.test.ts` — **R10**: desacoplado de
  `METODO_PAGO_SEED`; afirma el literal HISTÓRICO `SIMPE` con set
  `{efectivo, SIMPE, transferencia}`.
- `tests/integration/db/zonas-migration.test.ts` — añade la exclusión
  `_metodo_pago_rename_simpe_to_sinpe` al invariante de orden de migraciones (mismo
  patrón que las features 99–109 apendidas tras zonas). Necesario para suite verde.

## No tocados (R9/R10) — verificado

`total_simpe` / `totalSimpe` (schema + migraciones cierre_dia/cierre_bodega + repos),
clave DTO `simpe` de `{ efectivo, simpe, transferencia, general }`, `id:"simpe"` de
columnas UI, y la migración histórica `20260711150000_*/migration.sql`.

## Mapa R<n> → test

| R | Prueba |
| - | ------ |
| R1  | `tests/unit/types/metodo-pago.test.ts` (seed = {efectivo, SINPE, transferencia} y 1:1 con enum Prisma) + `metodo-pago-rename-simpe-sinpe-migration.test.ts` (UP RENAME) |
| R2  | `metodo-pago-rename-simpe-sinpe-migration.test.ts::"R2: ALTER TYPE ... RENAME VALUE 'SIMPE' TO 'SINPE'"` |
| R3  | `metodo-pago-rename-simpe-sinpe-migration.test.ts::"R3: ALTER TYPE ... RENAME VALUE 'SINPE' TO 'SIMPE'"` |
| R4  | `metodo-pago-rename-simpe-sinpe-migration.test.ts::"R4: NO reescribe filas ..."` (usa RENAME VALUE, sin UPDATE/ADD VALUE/RECREATE → OID y filas preservados; aplicación contra Postgres = DEUDA estática declarada, patrón del repo) |
| R5  | `tests/unit/types/metodo-pago.test.ts` + `typecheck` verde (`satisfies readonly MetodoPagoValue[]` + `_EnsureExhaustive`) |
| R6  | `tests/components/CierreDiaModule.test.tsx` / `CierresAdminModule.test.tsx` (`getByText("SINPE")`) |
| R7  | `tests/unit/utils/cierre-totales.test.ts` (`metodoPago:"SINPE"` suma al carril) + `cierre-dia-service.test.ts` |
| R8  | `tests/components/CierreDiaModule.test.tsx` / `CierresAdminModule.test.tsx` (`getByText("SINPE")`, sin `"SIMPE"`) + guard R12 |
| R9  | `tests/unit/utils/cierre-totales.test.ts` (DTO `{ efectivo, simpe, transferencia, general }` intacto) + suite completa verde (repos/servicios con `simpe`/`totalSimpe`) |
| R10 | `tests/integration/db/gestion-orden-migration.test.ts` (afirma literal histórico `SIMPE`, desacoplado del seed) |
| R11 | Los 12 tests actualizados en verde + `metodo-pago-rename-simpe-sinpe-migration.test.ts` |
| R12 | `tests/unit/guards/censo-simpe.test.ts` (censo case-sensitive de `SIMPE`; allowlist = guard + 2 tests de migración que afirman el literal) |

## Verificación (salida real)

- `pnpm run typecheck` → sin errores (tras `pnpm run db:generate` para refrescar el
  cliente Prisma con `SINPE`).
- `pnpm run lint` → 0 errores (143 warnings pre-existentes, ninguno de esta feature).
- `pnpm test` → **454 archivos, 4528 tests, 0 fallos** (~120s).
- `./init.sh` → `== init OK ==` (typecheck + lint + test verdes; todas las migraciones
  con `down.sql`).

## Veredicto

SIMPE → SINPE corregido de forma reversible (RENAME VALUE + down.sql), tipos/labels/
tests alineados, identificadores internos intactos; init.sh y 4528 tests en verde.
