# impl 63 — Orden lista actualizada (BACKEND, Grupos A + B)

> Alcance de esta bitacora: SOLO backend (Grupos A y B + tests D1). El frontend
> (Grupo C: primitiva Tabs, `OrdenesTabs`, wiring de page) es de `frontend_dev` en
> un paso posterior. NO se tocaron UI/componentes/paginas.

## Columna real de estado en Orden

`db/schema.prisma` -> `model Orden { estatusId String @map("estatus_id") ... }`.
La clave PUBLICA del filtro es `status_id`; el mapa `FILTER_TO_COLUMN = { status_id:
"estatusId" }` (campo Prisma) es el unico punto que conoce el nombre interno.

## Archivos tocados

Creados:
- `lib/actions/order-status.ts` — Server Action `listarOrderStatus()` (A2).
- `tests/unit/actions/order-status.test.ts` — R1-R4.
- `tests/unit/types/orden-filter.test.ts` — R6/R7/R11.

Modificados:
- `lib/types/order-status.ts` — tipo `ListarOrderStatusResult` discriminado (A1).
- `lib/types/orden.ts` — `ordenFilterSchema` (`.strict()`), `ORDEN_FILTER_FIELDS`,
  `filter?` en `listarOrdenesSchema` (B1).
- `lib/services/OrdenService.ts` — `FILTER_TO_COLUMN` + traduccion `filter.status_id`
  -> `where.estatusId` con precedencia sobre el escalar, componiendo con el alcance
  por rol (B2).
- `lib/repositories/OrdenRepository.ts` — `orderBy: { value: "asc" }` en
  `listOrderStatus()` (A3, R5).
- `tests/unit/services/orden-service.test.ts` — describe nuevo R8/R9/R10.
- `tests/unit/repositories/orden-repository.guia.test.ts` — caso R5 orderBy.

NOTA: NO se relajo la autz de `listarCatalogoEstatus()` (feature 17): sigue en
maestro/admin. `listarOrderStatus()` es accion NUEVA con autz "todos excepto
mensajero".

## Mapa R -> test

| R | Test |
| --- | --- |
| R1 | `tests/unit/actions/order-status.test.ts` -> ok con `{id,value}` |
| R2 | idem -> `it.each(["maestro","admin","adminTienda","adminSatelite"])` ok |
| R3 | idem -> sin sesion -> `unauthenticated`, repo NO llamado |
| R4 | idem -> mensajero + rol desconocido -> `forbidden`, repo NO llamado |
| R5 | `tests/unit/repositories/orden-repository.guia.test.ts` -> `orderBy {value:asc}` |
| R6 | `tests/unit/types/orden-filter.test.ts` -> acepta `filter.status_id`; filter opcional |
| R7 | idem -> clave fuera de whitelist -> ZodError; `status_id` vacio -> ZodError |
| R8 | `tests/unit/services/orden-service.test.ts` -> `filter.status_id` -> `where.estatusId` (+precedencia); whitelist == ['status_id'] |
| R9 | idem -> filter + adminTienda acotado a su tienda |
| R10 | idem -> sin filter = comportamiento previo; `estatusId` escalar sigue |
| R11 | `tests/unit/types/orden-filter.test.ts` -> ni `estatusId` ni `deletedAt` ni `tiendaId` pasan el `.strict()` |

## Verificacion

`pnpm typecheck`: 0 errores en archivos de la feature 63. Los errores que quedan son
PRE-EXISTENTES del baseline `adjustments` (drift tarifas/zonas/usuarios), ajenos a
esta feature: `lib/repositories/TarifaVigentePorZonaRepository.ts`, `scripts/seed-zonas.ts`,
`tests/**/tarifa-*`, `tests/**/usuario-*`, `auth-service`, `postulacion-login-regresion`,
`asignacion-mensajero-service`, `rol-admin-satelite-authz`. Ninguno introducido aqui.

`pnpm vitest run` de los 4 archivos tocados/creados:
```
Test Files  4 passed (4)
Tests  78 passed (78)
```
Tests NUEVOS de la feature 63: 20 (8 action + 6 filter-types + 5 service filter + 1 repo R5).

## Veredicto

R1-R11 hechos; typecheck 0 en lo propio (rojos restantes pre-existentes); 20 tests
nuevos verdes, 78 verdes en los archivos tocados. Sin rojos nuevos.
