# Implementación — ordenes - list (feature id 7, complexity high)

Estado: IMPLEMENTADA. Verificación en verde. Pendiente de revisión por el reviewer
(el implementer no se autoaprueba).

## Alcance ejecutado
- UI (feature 7): `DataTable<T>` genérico reutilizable + vista `/ordenes` (Client
  Component con SWR sobre la Server Action existente `listarOrdenes`).
- Backend (feature 6, ampliación mínima del LISTADO): `tiendaNombre` en el DTO de
  listado vía `include/select` de la relación `Orden.tienda -> Usuario.nombre`.
  SIN migración (relación ya existente), sin RLS nueva, sin tocar el resto del CRUD
  ni la autorización por rol.

## Archivos tocados

### Backend — feature 6 (subagente backend_dev)
Código:
- `lib/types/orden.ts` — nuevo `OrdenListItemDTO = OrdenDTO & { tiendaNombre: string }`;
  `ListarOrdenesResult.items` pasa a `OrdenListItemDTO[]`. `OrdenDTO` sin cambios.
- `lib/interfaces/repositories/IOrdenRepository.ts` — `ListOrdenesResult.items: OrdenListItemDTO[]`.
- `lib/interfaces/services/IOrdenService.ts` — `ListarOrdenesServiceResult.items: OrdenListItemDTO[]`.
- `lib/repositories/OrdenRepository.ts` — `WITH_ESTATUS_Y_TIENDA`, tipo `OrdenListRow`
  (`Prisma.OrdenGetPayload<...>`), `toListItemDTO`; `list()` mapea `tiendaNombre = row.tienda.nombre`.
  `create`/`findById`/`update` siguen con `toDTO`/`WITH_ESTATUS` (sin tiendaNombre).
- `lib/services/OrdenService.ts` — solo fluye el tipo; autorización y `where` por rol INTACTOS (R22).
- `lib/actions/ordenes.ts` — sin cambios de código (el tipo fluye solo).
Tests:
- `tests/unit/repositories/orden-repository.test.ts`
- `tests/unit/services/orden-service.test.ts`
- `tests/integration/actions/ordenes-action.test.ts` (ajuste del fake `listar` para tipar `tiendaNombre`)

### UI — feature 7 (subagentes frontend_dev)
Código:
- `components/shared/DataTable.tsx` (creado) — `Column<T>`, `DataTableProps<T>`, `DataTable<T>`.
- `app/(app)/ordenes/_components/ordenes-columns.tsx` (creado) — 5 columnas de `OrdenListItemDTO`.
- `app/(app)/ordenes/page.tsx` (modificado) — placeholder -> Client Component con SWR + DataTable.
Tests:
- `tests/components/DataTable.test.tsx` (creado, 11 tests)
- `tests/components/OrdenesPage.test.tsx` (creado, D1–D7)
- `tests/components/PlaceholderPages.test.tsx` (modificado: retirado el caso obsoleto de `/ordenes`
  ahora que ya no es placeholder; su cobertura vive en OrdenesPage.test.tsx)

### Sin migración
No se requirió migración ni `down.sql`: la relación `Orden.tienda -> Usuario` y
`Usuario.nombre` ya existen en `db/schema.prisma` (feature 6). Es un `include`/`select`.

## Mapa de trazabilidad R -> test

| R | Test concreto |
| --- | --- |
| R1 | `DataTable.test.tsx` (tipo local `Row`, sin dominio) + `DataTable.tsx` genérico |
| R2 | `DataTable.test.tsx::B1 cabeceras por columna, th scope=col, name por ariaLabel` |
| R3(a) | `DataTable.test.tsx::B2 render FUNCIÓN` |
| R3(b) | `DataTable.test.tsx::B3 render STRING (clave)` |
| R3(c) | `DataTable.test.tsx::B4 sin render lee por column.id` |
| R4 | `DataTable.test.tsx::B11 id único por columna` |
| R5 | `DataTable.test.tsx::B1` |
| R6 | `DataTable.test.tsx::B2` (+ columnas estatus/tienda vía `OrdenesPage.test.tsx::D1`) |
| R7 | `DataTable.test.tsx::B3` (+ numRemision vía `OrdenesPage.test.tsx::D1`) |
| R8 | `DataTable.test.tsx::B4` (+ numGuia/destinatario vía `OrdenesPage.test.tsx::D1`) |
| R9 | `DataTable.test.tsx::B5 N filas y orden preservado` |
| R10 | `DataTable.test.tsx::B6 rowKey por id y función, sin warning de key` |
| R11 | `DataTable.test.tsx::B7 estado vacío (emptyMessage)` |
| R12 | `DataTable.test.tsx::B8 estado carga role=status` |
| R13 | `DataTable.test.tsx::B9 estado error role=alert` |
| R14 | `DataTable.test.tsx::B10 caption` |
| R15 | `DataTable.test.tsx::B1 (th tagName + scope=col, roles table/columnheader)` |
| R16 | `DataTable.test.tsx::B1 (name por ariaLabel) + B10 (name por caption)` |
| R17 | `ordenes-columns.tsx` + `page.tsx`, ejercido en `OrdenesPage.test.tsx::D1` |
| R18 | `OrdenesPage.test.tsx::D1` y `::D7 (invoca action mockeada, sin fetch a app/api)` |
| R19 | `OrdenesPage.test.tsx::D1 (fila por item)` |
| R20 | `OrdenesPage.test.tsx::D2 (carga)` y `::D3 (vacío "No hay órdenes")` |
| R21 | `OrdenesPage.test.tsx::D4 (unauthenticated/forbidden/validation_error + throw -> role=alert genérico)` |
| R22 | `OrdenesPage.test.tsx::D5 (muestra exactamente los items, no re-filtra)` + `orden-service.test.ts::R25/R26 propaga sin re-filtrar (adminTienda fuerza where.tiendaId)` |
| R23 | `OrdenesPage.test.tsx::D6 (sin controles de paginación/orden/filtro ni acciones por fila)` |
| R24 | `OrdenesPage.test.tsx::D1 (Tienda = tiendaNombre; uuid tiendaId ausente del DOM)` |
| R25 | `orden-repository.test.ts::R25/R26 incluye tienda.nombre en el select y mapea tiendaNombre` + `orden-service.test.ts` |
| R26 | `orden-repository.test.ts` + `orden-service.test.ts::R25/R26` + `OrdenesPage.test.tsx::D1` |

## Salida real de verificación

### pnpm typecheck
```
> tsc --noEmit
(sin errores, exit 0)
```

### pnpm lint
```
> eslint
(sin errores, exit 0)
```

### pnpm test (vitest run, no watch)
```
 RUN  v4.1.10
 Test Files  37 passed (37)
      Tests  263 passed (263)
   Duration  25.16s
```

### ./init.sh
```
✓ node v22.13.1
✓ dependencias presentes
-> pnpm run typecheck  (ok)
-> pnpm run lint       (ok)
-> pnpm run test       (Test Files 37 passed / Tests 263 passed)
✓ todas las migraciones tienen down.sql
! no hay .env. Crea uno a partir de .env.example   (aviso preexistente, no bloqueante)
== init OK ==
```

## Deuda / notas
- Aviso `.env` en init.sh es preexistente y no bloqueante (los tests no requieren DB real).
- E2E (Playwright): no se añadió en esta iteración. La vista es de solo lectura sobre
  la Server Action existente; los flujos críticos de órdenes (CRUD/auth) los cubre la
  feature 6. Si el reviewer considera `/ordenes` flujo crítico, quedaría como hallazgo
  para añadir un E2E.
- Contrato menor de `DataTable`: valores objeto crudos leídos por clave se renderizan
  como celda vacía (nunca `[object Object]`); `render` función mantiene el `ReactNode` tipado.
