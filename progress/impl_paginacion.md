# Implementación — paginacion (feature id 8, zone=frontend, complexity=medium)

> Branch: `feature/8-paginacion`. Spec aprobada por humano (2026-07-09).
> Zona frontend pura: implementado por `frontend_dev` (opus), coordinado por
> `implementer`. NO se tocó backend, DB, Prisma, migraciones, RLS, `app/api/`
> ni el contrato de `components/shared/DataTable.tsx`. Se REUTILIZÓ el backend
> existente `listarOrdenes({page,pageSize})` (feature 6).

## Veredicto

VERDE — R1..R34 cubiertos con test. typecheck + lint limpios. `./init.sh` OK.
289 tests en 40 archivos, todos pasando (verificado de forma independiente por
el implementer, no solo reportado por el subagente).

## Archivos creados

- `components/shared/Pagination.tsx` — componente `Pagination` controlado,
  genérico, transport-agnostic, sin dominio (no importa tipos de `orden` ni de
  `DataTable`). Incluye el helper puro EXPORTADO `buildPageItems(current,
  totalPages, siblingCount)` para la ventana numérica con elipsis.
- `hooks/usePagination.ts` — hook client-side reutilizable (segmenta array en
  memoria); modo alternativo, no usado como default de `/ordenes`.
- `tests/components/Pagination.test.tsx` — Bloque B (B1..B16) + `buildPageItems`.
- `tests/components/usePagination.test.tsx` — Bloque C (C2), `renderHook`.
- `tests/components/OrdenesPagination.test.tsx` — Bloque E (E1..E8), vista
  `/ordenes` con `listarOrdenes` mockeada como fetcher de SWR.

## Archivos modificados

- `app/(app)/ordenes/page.tsx` — cableado SERVER-SIDE: estado `page/pageSize`,
  `useSWR(["ordenes:list", page, pageSize], () => fetcher(page, pageSize))`,
  fetcher que llama `listarOrdenes({page,pageSize})` (throw si `status!=='ok'`),
  render de `<DataTable/>` + `<Pagination showFirstLast siblingCount={1}
  pageSizeOptions={[10,25,50].filter(s => s <= MAX_PAGE_SIZE)}
  onPageSizeChange reset a página 1 />` como hermanos. (D1, D2)
- `tests/components/OrdenesPage.test.tsx` — D6 y D7 (feature 7) ADAPTADOS: antes
  afirmaban "sin paginación" y `listarOrdenes({})`; ahora reflejan el
  comportamiento server-side (`{page:1, pageSize:20}` y presencia del `<nav>` de
  paginación). D1..D5 intactos (sus mocks ya devolvían `{page,pageSize,total}`).

## Mapa R<n> -> test

| R | Test |
| --- | --- |
| R1 | Pagination.test B1 (nav accesible; componente en shared/ sin dominio) |
| R2 | Pagination.test B2 (controlado: emite, no muta) |
| R3 | Pagination.test B1 ("Página 2 de 5") |
| R4 | Pagination.test B2 |
| R5 | Pagination.test B3 (primera/última) |
| R6 | Pagination.test B4 (no-op sin callback) |
| R7 | Pagination.test B5 (límite primera, disabled) |
| R8 | Pagination.test B6 (límite última, disabled) |
| R9 | Pagination.test B7 (page fuera de rango acotado) |
| R10 | Pagination.test B8 (selector presente) |
| R11 | Pagination.test B8 (selector emite) |
| R12 | Pagination.test B9 (selector ausente sin callback) |
| R13 | Pagination.test B10 (dataset vacío) |
| R14 | Pagination.test B11 (una sola página) |
| R15 | Pagination.test B1 (nav semántico) |
| R16 | Pagination.test B2 (buttons reales por aria-label) |
| R17 | Pagination.test B1 (aria-live) |
| R18 | Pagination.test B5, B6 (toBeDisabled) |
| R19 | OrdenesPagination.test E1 (composición hermano) |
| R20 | OrdenesPagination.test E1 (SWR + listarOrdenes) |
| R21 | OrdenesPagination.test E2 (cambio página re-consulta) |
| R22 | OrdenesPagination.test E3 (refinado por R34) |
| R23 | Pagination.test B12 + OrdenesPagination.test E4 (carga/disabled) |
| R24 | OrdenesPagination.test E5 (vacío total=0) |
| R25 | OrdenesPagination.test E6 (total del backend, no recalculado) |
| R26 | Pagination.test B13 (buildPageItems) |
| R27 | Pagination.test B13 (elipsis) |
| R28 | Pagination.test B14 + OrdenesPagination.test E8 |
| R29 | Pagination.test B15 + OrdenesPagination.test E8 (aria-current) |
| R30 | Pagination.test B16 (ventana con disabled/vacío) |
| R31 | OrdenesPage.test D7 (server-side {page,pageSize}) + OrdenesPagination E1 |
| R32 | OrdenesPagination.test E7 (primera/última) + E8 (ventana numérica) |
| R33 | OrdenesPagination.test E3 (<select> = [10,25,50] acotado por MAX_PAGE_SIZE) |
| R34 | OrdenesPagination.test E3 (reset a página 1 al cambiar tamaño) |

## Salida real de verificación (ejecutada por el implementer)

### pnpm run typecheck
```
> tsc --noEmit
(sin errores)
```

### pnpm run lint
```
> eslint
(sin errores)
```

### pnpm test
```
> vitest run
 Test Files  40 passed (40)
      Tests  289 passed (289)
   Duration  21.98s
```

### ./init.sh
```
-> pnpm run test
 Test Files  40 passed (40)
      Tests  289 passed (289)
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

## Notas para el reviewer (no bloqueantes)

1. Conflicto D6/D7 de feature 7 resuelto adaptando aserciones obsoletas al nuevo
   comportamiento server-side (no se borraron D1..D5). Ver "Archivos modificados".
2. Botones nativos `<button type="button">` en vez de la primitiva base-ui
   `Button`, para garantizar el atributo `disabled` real que exigen R7/R8/R18 y
   las aserciones `toBeDisabled()`. El design.md lo autoriza.
3. `DEFAULT_PAGE_SIZE` (20) NO está en `pageSizeOptions` `[10,25,50]` — es
   exactamente lo que fija la spec (R33 + design.md: `useState(DEFAULT_PAGE_SIZE)`
   con `PAGE_SIZE_OPTIONS=[10,25,50]`). El `<select>` controlado con `value=20`
   sin opción coincidente no lanza en React/jsdom. Consecuencia esperada de la
   config aprobada, señalada por transparencia; el reviewer decide si amerita
   ajuste de spec.

## Ajuste post-review (2026-07-09): DEFAULT_PAGE_SIZE 20 -> 25

Decisión humana para alinear el selector de tamaño de página. Con default 20 (no
presente en `pageSizeOptions [10,25,50]`) el `<select>` mostraba visualmente "10"
mientras el estado real era 20. Con 25 (opción válida) selector y estado coinciden
en el primer render (ver nota 3 arriba, ahora resuelta).

### Archivos tocados
- `lib/config/ordenes.ts`: `readPositiveInt("ORDENES_DEFAULT_PAGE_SIZE", 20)` -> `25`.
- `tests/unit/config/ordenes-config.test.ts`: dos aserciones de default `toBe(20)` -> `toBe(25)`.
- `tests/components/OrdenesPagination.test.tsx`:
  - E1: `{page:1,pageSize:20}` -> `25`; `bodyRows` 20 -> 25; "Página 1 de 3" -> "Página 1 de 2".
  - E2: primera fila p2 `REM-1021` -> `REM-1026`; `{page:2,pageSize:20}` -> `25`; "Página 2 de 3" -> "Página 2 de 2".
  - E3: como 25 ya es el default, se cambia el selector a `50` (distinto del default) para seguir
    probando "cambiar tamaño vuelve a página 1"; asserts a `{page:1,pageSize:50}` y "Página 1 de 2".
  - E6: mock `pageSize:20` -> `25`; totalPages `ceil(45/25)=2`; "Página 1 de 3" -> "Página 1 de 2".
- `tests/components/OrdenesPage.test.tsx`: retornos mock `pageSize:20` -> `25` (coherencia) y
  D7 assert del fetcher `{page:1,pageSize:20}` -> `25` (usa el default de estado).

### Consumidores NO afectados (verificado)
- `lib/types/orden.ts` (`listarOrdenesSchema.default(ordenesConfig.DEFAULT_PAGE_SIZE)`): lee la
  config dinámicamente; `orden-schemas.test.ts "aplica defaults"` no asevera el valor de pageSize.
- Tests de backend `orden-service.test.ts`, `ordenes-action.test.ts`, `orden-repository.test.ts`:
  usan `pageSize/take: 20` como INPUT explícito (no como default), no dependen de DEFAULT_PAGE_SIZE.

### Salida final de tests
`pnpm typecheck` OK · `pnpm lint` OK · `pnpm test`: Test Files 40 passed (40), Tests 289 passed (289).
