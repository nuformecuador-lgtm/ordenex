# Impl — Feature 26: Dashboard / apartado del admin de tienda

> Rama: `feature/26-dashboard-admin-tienda` (desde `origin/dev`). Frontend puro.
> Implementado vía subagente `frontend_dev` (modelo `opus`), coordinado por implementer.
> NO se tocó backend/DB/actions/RLS/Prisma ni `ordenes-columns.tsx`.

## Veredicto
Feature 26 implementada como frontend puro. `./init.sh` en verde (typecheck + lint +
689/689 tests). E2E omitido de forma justificada (sin infraestructura seed/login para
adminTienda en el repo). Listo para reviewer.

## Archivos creados
- `app/(app)/ordenes/_components/OrdenesModule.tsx` — módulo cliente reutilizable
  extraído de `ordenes/page.tsx`; prop opcional `columns?: Column<OrdenListItemDTO>[]`
  con default `ordenesColumns`. Sin prop => comportamiento idéntico a `/ordenes` (D2).
- `app/(app)/_components/ordenes-columns-admin-tienda.ts` — `ordenesColumnsAdminTienda`
  = `ordenesColumns.filter(c => c.id !== "tienda")` (4 columnas, sin "Tienda") (D3, R11).
- `app/(app)/_components/AdminTiendaDashboard.tsx` — Server Component: encabezado
  "Panel de tienda" + `<OrdenesModule columns={ordenesColumnsAdminTienda} />` (D5, R2/R6/R8/R11).
- `tests/components/AdminTiendaDashboard.test.tsx`
- `tests/components/HomePageRol.test.tsx`
- `tests/components/OrdenesModuleReuse.test.tsx`

## Archivos modificados
- `app/(app)/ordenes/page.tsx` — ahora solo `return <OrdenesModule />` (refactor sin
  cambio funcional, D2/T1.2).
- `app/(app)/page.tsx` — ramificación por rol server-side vía `resolveActorFromSession()`;
  `adminTienda` → `<AdminTiendaDashboard />`; resto de roles / actor null → placeholder
  "Bienvenido" + LogoutButton intacto (D1, R1/R3/R4/R5).
- `tests/components/HomePage.test.tsx` — añadido mock de `resolveActorFromSession` (→ null)
  para preservar la rama placeholder; aserciones de visibilidad de logout intactas.

## Mapa R → test
| Req | Test |
| --- | --- |
| R1  | `tests/components/HomePageRol.test.tsx` :: "R1: rol adminTienda con sesión válida renderiza el dashboard" |
| R2  | `tests/components/AdminTiendaDashboard.test.tsx` :: "R2: muestra un encabezado visible" |
| R3  | `tests/components/HomePageRol.test.tsx` :: "R3: un rol distinto de adminTienda NO renderiza el dashboard" |
| R4  | `tests/components/HomePageRol.test.tsx` :: "R4: sin sesión válida (actor null) NO renderiza el dashboard" |
| R5  | `tests/components/HomePageRol.test.tsx` :: "R5: el rol se resuelve server-side invocando resolveActorFromSession" |
| R6  | `tests/components/AdminTiendaDashboard.test.tsx` :: "R6: monta el módulo de órdenes (tabla aria-label 'Órdenes')" |
| R7  | Backend feature 6 (sin cambio frontend): `tests/integration/actions/ordenes-action.test.ts`, `tests/unit/db/ordenes-rls.test.ts`. Ver decisión e2e. |
| R8  | `tests/components/AdminTiendaDashboard.test.tsx` :: "R8: ofrece el botón de carga masiva" |
| R9  | `tests/components/AdminTiendaDashboard.test.tsx` :: "R9: delega los estados de carga/error/vacío" |
| R10 | `tests/components/OrdenesModuleReuse.test.tsx` (`/ordenes` y dashboard montan el mismo `OrdenesModule`, sin segunda DataTable/fetch) |
| R11 | `tests/components/AdminTiendaDashboard.test.tsx` :: "R11: NO incluye la columna 'Tienda'; exactamente 4 columnheaders" |

Regresión `/ordenes`: `tests/components/OrdenesPage.test.tsx` sigue verde SIN modificarlo
(5 columnas, loading/empty/error, paginación, `listarOrdenes({page,pageSize})`, sin fetch API).

## Salida real de verificación

### `./init.sh` (ejecutado por el implementer, independiente del subagente)
```
== Arnes SDD :: init ==
✓ node v22.13.1
✓ dependencias presentes
-> pnpm run typecheck   (tsc --noEmit, sin errores)
-> pnpm run lint        (eslint, sin errores)
-> pnpm run test        (vitest run)
 Test Files  78 passed (78)
      Tests  689 passed (689)
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```
EXIT: 0

### Suite
- typecheck: OK (TS strict, sin `any`).
- lint: OK.
- test: **689 passed / 0 failed** (78 archivos).

## Decisión e2e
No se creó `e2e/dashboard-admin-tienda.spec.ts`. El patrón real del repo
(`e2e/auth.spec.ts`, `e2e/home.spec.ts`) depende de credenciales sembradas y está
"escrito pero no ejecutado" por falta de DB/seed; no existe infraestructura de
login+seed para un usuario `adminTienda`. Crear un e2e así sería frágil e inejecutable.
R1 queda cubierto por component tests (`HomePageRol`); R7 por el filtro backend de
feature 6 (`ordenes-action` + `ordenes-rls`). No se ejecutó `pnpm run test:e2e`
(mismo diferimiento de entorno que el resto de la suite e2e del repo).
NOTA para el reviewer: valorar si esta omisión es aceptable para la trazabilidad de
R1/R7 dado el estado del entorno e2e, o si debe quedar como hallazgo/observación.

## Bloqueos
Ninguno.
