# Bitácora de implementación — feature `ordenes` (id 6, complexity high)

CRUD backend de órdenes (Server Actions → OrdenService → OrdenRepository), catálogo
`order_status` con seed idempotente, geografía jerárquica y migraciones reversibles
con RLS. Implementado por `backend_dev` (opus), coordinado y verificado por
`implementer`. Sin UI (esa es la feature 7). Spec: `specs/ordenes/{requirements,design,tasks}.md`.

## Estado: VERDE

- `pnpm db:generate` → OK (Prisma Client v7.8.0, nuevos modelos/relaciones).
- `pnpm typecheck` (tsc --noEmit) → sin errores.
- `pnpm lint` (eslint) → sin errores.
- `pnpm test` (vitest run) → **35 archivos, 243 tests, 243 passed**. 8 archivos / 90 tests nuevos de `ordenes`.
- `prisma validate` → schema válido.

Salida real `pnpm test`:
```
 Test Files  35 passed (35)
      Tests  243 passed (243)
   Duration  20.54s
```

## Archivos creados

Migraciones (escritas a mano replicando el formato del repo; NO ejecutadas — sin DB):
- `db/migrations/20260709130000_ordenes_catalogos_geografia/migration.sql`
- `db/migrations/20260709130000_ordenes_catalogos_geografia/down.sql`
- `db/migrations/20260709130100_ordenes/migration.sql`
- `db/migrations/20260709130100_ordenes/down.sql`

Código:
- `lib/types/order-status.ts` (ORDER_STATUS_SEED, fuente única de verdad, 7 valores)
- `lib/config/ordenes.ts` (DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, DEFAULT_ESTATUS_VALUE, overrides env)
- `lib/types/orden.ts` (schemas zod crear/actualizar/listar + OrdenDTO + resultados discriminados)
- `lib/interfaces/repositories/IOrdenRepository.ts` (+ errores de dominio)
- `lib/interfaces/services/IOrdenService.ts` (Actor, tipos de entrada)
- `lib/repositories/OrdenRepository.ts` (solo Prisma; filtra deleted_at; P2002→conflict)
- `lib/services/OrdenService.ts` (matriz de autorización por rol R19–R24)
- `lib/actions/ordenes.ts` (`'use server'`: crear/obtener/listar/actualizar/borrar, deps inyectables)

Tests:
- `tests/unit/types/order-status.test.ts`
- `tests/unit/scripts/seed-order-status.test.ts`
- `tests/unit/config/ordenes-config.test.ts`
- `tests/unit/types/orden-schemas.test.ts`
- `tests/unit/repositories/orden-repository.test.ts`
- `tests/unit/services/orden-service.test.ts`
- `tests/integration/actions/ordenes-action.test.ts`
- `tests/unit/db/ordenes-rls.test.ts` (cobertura estática de RLS/SERIAL/uniques/FK)

## Archivos modificados

- `db/schema.prisma` — modelos `OrderStatus`, `Zona`, `Provincia`, `Canton`,
  `Distrito`, `Orden`; relación inversa `ordenesTienda Orden[] @relation("OrdenTienda")`
  en `Usuario`; relaciones inversas en catálogos/geografía.
- `scripts/seed-catalogos.ts` — `seedOrderStatus(prisma)` (upsert por value, idempotente) + invocación en `main()`.
- `specs/ordenes/tasks.md` — T001–T016 marcadas [x].

## Mapa de trazabilidad R<n> → test (real, no tautológico)

| R | Test |
|---|------|
| R1  | `ordenes-rls.test.ts` (order_status en migración) + `prisma validate` |
| R2  | `order-status.test.ts` (7 valores incl. en_bodega) + `seed-order-status.test.ts` |
| R3  | `seed-order-status.test.ts::idempotencia` (upsert por value, id estable) |
| R4/R5/R6 | migración catálogos/geografía (orden FK) + `down.sql` inverso; `prisma validate` |
| R7–R13,R14a | `schema.prisma` validado + `ordenes-rls.test.ts` (SERIAL/NOT NULL/nullable/Decimal) |
| R8/R14 | `ordenes-rls.test.ts` (num_guia SERIAL + uniques) · conflicto: `orden-repository.test.ts` (P2002) |
| R14b | `orden-service.test.ts` (fixtures geo; geo inexistente→validation) + `ordenes-action.test.ts` |
| R15/R17 | `migration.sql`/`down.sql` de ambas carpetas (rollback real DIFERIDO) |
| R16 | `ordenes-rls.test.ts` (ENABLE ROW LEVEL SECURITY en 6 tablas; anon real DIFERIDO) |
| R18 | `ordenes-action.test.ts::sin sesion valida -> unauthenticated (sin DB)` |
| R19 | resolución de actor en `ordenes.ts` + matriz completa en `orden-service.test.ts` |
| R20 | `orden-service.test.ts::maestro/admin CRUD total` |
| R21 | `orden-service.test.ts` (fuerza tiendaId; solo suyas) + `orden-repository.test.ts` (where tiendaId) |
| R22 | `orden-service.test.ts::adminTienda tiendaId ajeno -> forbidden, no crea` |
| R23/R41 | `orden-service.test.ts::mensajero crear/borrar forbidden, update solo estatusId` |
| R24 | `orden-service.test.ts::rol no reconocido -> forbidden` (todas las ops) |
| R25/R26 | `orden-schemas.test.ts` + `orden-service.test.ts` (FKs) + `ordenes-action.test.ts` |
| R27 | `orden-service.test.ts::default en_bodega + delega` + `ordenes-action.test.ts` (numGuia) |
| R28 | `orden-repository.test.ts` (P2002) + `orden-service.test.ts` (conflict) + `ordenes-action.test.ts` |
| R29 | `orden-service.test.ts::obtener` + `ordenes-action.test.ts` |
| R30 | `orden-repository.test.ts::list count` + `orden-service.test.ts` (skip/take/total) + `ordenes-action.test.ts` |
| R31 | `orden-schemas.test.ts` (lista blanca) + `orden-repository.test.ts` (orderBy) + `orden-service.test.ts` |
| R32 | `orden-schemas.test.ts` (page/pageSize/sortBy inválidos) + `ordenes-action.test.ts` |
| R33 | `ordenes-config.test.ts` (cap) + `orden-schemas.test.ts` + `ordenes-action.test.ts` |
| R34 | `orden-repository.test.ts` (find/list filtran deleted_at) + `orden-service.test.ts` |
| R35/R36/R37 | `orden-service.test.ts::actualizar` + `ordenes-action.test.ts` |
| R38 | `orden-service.test.ts::estatusId inexistente -> validation` + `ordenes-action.test.ts` |
| R39/R40 | `orden-repository.test.ts` (softDelete) + `orden-service.test.ts` + `ordenes-action.test.ts` |
| R42 | `ordenes-action.test.ts` (resultado discriminado, sin PII) en todas las acciones |

## Deuda diferida (justificada — no hay Postgres, igual que login T004/T020, permissions, role-seed)

- **Ejecución real de migraciones y seed contra Postgres**: `prisma migrate`/`db:seed`
  no corridos. Migraciones escritas a mano replicando el formato exacto del repo;
  `prisma validate` confirma coherencia schema↔SQL.
- **R16 (rechazo query anon)** y **R15/R17 (rollback + re-migrate sin diff)**:
  tests de integración contra DB real diferidos. Cubierto estáticamente por
  `ordenes-rls.test.ts` (verifica ENABLE ROW LEVEL SECURITY en las 6 tablas,
  SERIAL de num_guia, índices únicos y FK distrito ON DELETE SET NULL sobre el SQL).
- **Timestamps de migración**: `20260709130000`/`20260709130100`, posteriores a
  `20260709120000_seed_maestro_user`, garantizan orden de FK (geografía antes que `orden`).

## Veredicto

VERDE — 243/243 tests pasan (90 nuevos de `ordenes`); db:generate/typecheck/lint limpios.
Migración/seed/RLS/rollback contra Postgres real diferidos y documentados. Pendiente de revisión por `reviewer`.
