# Tasks — paginacion

> Convención: cada task tiene criterio de "hecho" y el/los `R<n>` que cubre.
> `[P]` = paralelizable con otras `[P]` del mismo bloque. Tests con Vitest +
> `@testing-library/react` en jsdom (`// @vitest-environment jsdom`), patrón de
> `tests/components/`. Los tests de la vista mockean `listarOrdenes`
> (`vi.mock("@/lib/actions/ordenes")`) y aíslan la cache de SWR (`SWRConfig
> provider: () => new Map()` o `dedupingInterval: 0`). NO se toca backend/DB/
> Prisma/RLS ni el contrato de `DataTable`.
>
> Decisión de diseño CERRADA: `Pagination` es un componente SEPARADO, controlado
> y transport-agnostic; `/ordenes` se cablea **server-side** reutilizando
> `listarOrdenes({page,pageSize})` (ya existe). Las antiguas Q1–Q4 están RESUELTAS
> (decisión humana 2026-07-09): server-side (R31), botones primera/última activos
> en `/ordenes` (R32), ventana numérica con elipsis + `aria-current` (R26–R30) y
> selector `[10,25,50]` acotado por `MAX_PAGE_SIZE` con reset a página 1 (R33/R34).
> Ya no hay preguntas abiertas en requirements.md.
>
> Reparto: todos los bloques los ejecuta `frontend_dev`. No hay trabajo backend.

## Bloque A — Componente `Pagination` (UI pura, controlada)

- [x] **A1. Definir `PaginationProps` y `PaginationLabels`** en
  `components/shared/Pagination.tsx`. Hecho: props `page/pageSize/total`,
  `onPageChange?/onPageSizeChange?`, `pageSizeOptions?`, `disabled?`,
  `showFirstLast?`, `ariaLabel?`, `labels?`; compila en strict sin `any` público;
  NO importa nada de `DataTable` ni de `orden`. Cubre **R1, R2**.

- [x] **A2. Derivaciones puras** (`totalPages`, `safePage` con clamp, `isFirst`,
  `isLast`, `emptyDataset`) e indicador de posición accesible (`aria-live`,
  texto "Página X de Y" o `labels.status`). Depende de A1. Cubre **R3, R9, R17**.

- [x] **A3. Controles de navegación** anterior/siguiente (y primera/última si
  `showFirstLast`) como `<button type="button">` con `aria-label`, `disabled`
  calculado, dentro de `<nav aria-label>`; handlers que solo emiten
  `onPageChange` y son no-op si falta callback o está `disabled`/en límite.
  Depende de A2. Cubre **R4, R5, R6, R7, R8, R15, R16, R18**.

- [x] **A4. Selector de tamaño de página** (`<select>` accesible) que solo se
  renderiza si hay `onPageSizeChange` + `pageSizeOptions`; muestra `pageSize`
  actual y emite `onPageSizeChange(number)`. Depende de A1. Cubre **R10, R11, R12**.

- [x] **A5. Estados límite del dataset**: `total===0` (todos los controles
  disabled, "Página 1 de 1"/sin resultados) y `totalPages===1` (navegación
  disabled, indicador visible, selector si aplica); `disabled` global deshabilita
  todo. Depende de A2, A3. Cubre **R13, R14, R23 (parte disabled)**.

- [x] **A6. Helper puro `buildPageItems(current, totalPages, siblingCount)`** que
  produce la lista de items `number | 'ellipsis'` según el algoritmo del diseño:
  primera y última siempre presentes, ventana `current ± k`, elipsis solo cuando
  el hueco es > 1 página (si el hueco es de 1, se muestra ese número), dedup
  defensivo. Función aislada y sin estado. Depende de A1. Cubre **R26, R27**.

- [x] **A7. Render de la ventana numérica** (solo si `siblingCount` está definido):
  botones `<button type="button">` por cada número con `aria-label`, `onClick ->
  onPageChange(n)` (no-op si `n===safePage`, sin callback, `disabled` o vacío);
  el botón de `safePage` lleva `aria-current="page"` y los demás no; elipsis como
  `<span aria-hidden="true">…</span>` no accionable; comparten `disabled` global y
  estado vacío. Depende de A6, A3. Cubre **R28, R29, R30**.

## Bloque B — Tests de componente de `Pagination` (mapa R→test)

- [x] **B1. [P] Nav accesible + indicador de posición.** Test: render con
  `page=2,pageSize=10,total=45` → `getByRole('navigation', { name })`, texto
  "Página 2 de 5" leído por `aria-live`. Cubre **R3, R15, R17**.

- [x] **B2. [P] Siguiente/anterior emiten.** Test: click "siguiente" →
  `onPageChange(3)`; click "anterior" → `onPageChange(1)` (buttons por
  `getByRole('button', { name })`). Cubre **R4, R16**.

- [x] **B3. [P] Primera/última.** Test: `showFirstLast`, `page=3,total=45,
  pageSize=10` → "primera" → `onPageChange(1)`; "última" → `onPageChange(5)`.
  Cubre **R5**.

- [x] **B4. [P] No-op sin callback.** Test: sin `onPageChange`, click "siguiente"
  no lanza y no rompe render. Cubre **R6**.

- [x] **B5. [P] Límite primera página.** Test: `page=1` → "anterior"/"primera"
  con `disabled` (por `toBeDisabled()`); click no invoca `onPageChange`.
  Cubre **R7, R18**.

- [x] **B6. [P] Límite última página.** Test: `page=totalPages` →
  "siguiente"/"última" `disabled`; click no invoca `onPageChange`.
  Cubre **R8, R18**.

- [x] **B7. [P] Page fuera de rango se acota.** Test: `page=99,total=45,
  pageSize=10` → muestra "Página 5 de 5", "siguiente" disabled, sin throw.
  Cubre **R9**.

- [x] **B8. [P] Selector de tamaño presente y emite.** Test: `pageSizeOptions=
  [10,25,50]` + `onPageSizeChange`; cambia `<select>` a 25 → `onPageSizeChange(25)`;
  opción actual = `pageSize`. Cubre **R10, R11**.

- [x] **B9. [P] Selector ausente sin callback/opciones.** Test: sin
  `onPageSizeChange` → no hay `<select>`; navegación sigue funcionando.
  Cubre **R12**.

- [x] **B10. [P] Dataset vacío.** Test: `total=0` → "Página 1 de 1" (o "sin
  resultados"), TODOS los controles disabled, sin throw. Cubre **R13**.

- [x] **B11. [P] Una sola página.** Test: `total=5,pageSize=10` → navegación
  disabled, indicador visible, selector visible si aplica. Cubre **R14**.

- [x] **B12. [P] `disabled` global.** Test: `disabled` → todos los controles
  disabled y sin emisión al hacer click. Cubre **R23 (parte disabled)**.

- [x] **B13. [P] `buildPageItems` (unitario).** Test de la función pura: casos
  `totalPages<=1` → `[1]`; pocas páginas sin elipsis (`total=50,pageSize=10,
  current=3, sibling=1`) → `[1,2,3,4,5]`; muchas páginas con elipsis a ambos lados
  (`current=10, totalPages=20, sibling=1`) → `[1,'ellipsis',9,10,11,'ellipsis',20]`;
  hueco de 1 muestra el número (no elipsis). Cubre **R26, R27**.

- [x] **B14. [P] Botones numéricos emiten y elipsis no.** Test: `siblingCount=1`,
  `page=3,total=90,pageSize=10`; click en botón "5" → `onPageChange(5)`; la elipsis
  no es `button` (no accionable, `aria-hidden`); click en el botón de la página
  actual no emite. Cubre **R28**.

- [x] **B15. [P] `aria-current` en página activa.** Test: `siblingCount=1,page=3`
  → exactamente un botón numérico con `aria-current="page"` (el "3"); los demás sin
  `aria-current`. Cubre **R29**.

- [x] **B16. [P] Ventana con `disabled`/vacío.** Test: con `disabled` global (y con
  `total=0`) → todos los botones numéricos `disabled` y sin emisión al click.
  Cubre **R30**.

(B1–B16 dependen de A2–A7; entre sí son `[P]`.)

## Bloque C — Hook `usePagination` (modo client-side reutilizable)

- [x] **C1. Implementar `hooks/usePagination.ts`**: `usePagination<T>(items,
  initialPageSize)` → `{ page, pageSize, total, pagedItems, setPage, setPageSize }`,
  segmenta con `slice`, acota `page` a `totalPages`. Cubre soporte **client-side**
  (transport-agnostic del componente).

- [x] **C2. [P] Test del hook** (`renderHook`): con 23 items y `pageSize=10` →
  `total=23`, `pagedItems.length` correcto por página; `setPage`/`setPageSize`
  actualizan; page fuera de rango se acota. Cubre el modo client-side.

## Bloque D — Cableado de `/ordenes` (server-side, composición)

- [x] **D1. Ampliar `app/(app)/ordenes/page.tsx`**: estado `page/pageSize`,
  `useSWR(["ordenes:list", page, pageSize], () => fetcher(page, pageSize))` con
  fetcher que llama `listarOrdenes({ page, pageSize })` (throw si `status!=='ok'`)
  y devuelve `{ items, total, pageSize }`; render de `<DataTable data={items}/>` +
  `<Pagination page pageSize total disabled={isLoading} onPageChange={setPage}
  onPageSizeChange={(s)=>{setPageSize(s);setPage(1);}} .../>` como hermanos.
  Depende de A3/A4/A7. Cubre **R19, R20, R21, R22, R23, R24, R25, R31**.

- [x] **D2. Config firme de props en `/ordenes`**: pasar `showFirstLast` y
  `siblingCount={1}` al `Pagination`, y `pageSizeOptions=[10,25,50].filter(s => s
  <= MAX_PAGE_SIZE)` (acotado por `ordenesConfig`). Hecho: la vista muestra
  primera/última + ventana numérica y un selector con exactamente esas opciones
  (ninguna > MAX_PAGE_SIZE); al cambiar el tamaño, `setPage(1)`. Depende de D1.
  Cubre **R32, R33, R34**.

## Bloque E — Tests de la vista `/ordenes` (Server Action mockeada como fetcher SWR)

- [x] **E1. [P] Composición y primera página.** Test: mock `{status:'ok',
  items:[...10], page:1, pageSize:10, total:23}` → `DataTable` con 10 filas +
  `navigation` de paginación como hermano, "Página 1 de 3", `DataTable` sin props
  de paginación (contrato intacto). Cubre **R19, R20**.

- [x] **E2. [P] Cambio de página re-consulta.** Test: click "siguiente" → el mock
  de `listarOrdenes` se llama con `{ page:2, pageSize:10 }` y se renderizan las
  filas de la página 2; indicador "Página 2 de 3". Cubre **R21**.

- [x] **E3. [P] Selector 10/25/50 y reset a página 1.** Test firme (el selector NO
  es opcional): el `<select>` ofrece exactamente `[10,25,50]` (acotadas por
  `MAX_PAGE_SIZE`); estando en página 2, cambiar `pageSize` a 25 → `listarOrdenes`
  llamado con `{ page:1, pageSize:25 }` (vuelve a página 1). Cubre **R33, R34
  (refina R22)**.

- [x] **E4. [P] Estado carga sin corromper paginación.** Test: mock diferido →
  `DataTable` en carga y controles de `Pagination` `disabled`; el indicador de
  posición no se pierde. Cubre **R23**.

- [x] **E5. [P] Estado vacío (total 0).** Test: mock `{status:'ok', items:[],
  page:1, pageSize:10, total:0}` → "No hay órdenes" en `DataTable` y `Pagination`
  vacío con controles disabled. Cubre **R24**.

- [x] **E6. [P] Autorización delegada / total del backend.** Test: verifica que
  `total`/`totalPages` mostrados provienen del `total` del mock (no recalculados)
  y que la vista muestra exactamente los `items` devueltos. Cubre **R25**.

- [x] **E7. [P] Primera/última activos en `/ordenes`.** Test: mock con
  `total=90,pageSize=10,page=5` → botones "primera"/"última" presentes; click
  "última" → `listarOrdenes` llamado con `{ page:9, pageSize:10 }`; click "primera"
  → `{ page:1, pageSize:10 }`. Cubre **R32 (parte primera/última)**.

- [x] **E8. [P] Ventana numérica en `/ordenes`.** Test: mock con
  `total=90,pageSize=10,page=5` → botones numéricos con elipsis y "5" con
  `aria-current="page"`; click en botón "7" → `listarOrdenes` con `{ page:7,
  pageSize:10 }`. Cubre **R32 (parte ventana), R28, R29**.

(E1–E8 dependen de D1/D2; entre sí son `[P]`.)

## Bloque F — Verificación

- [x] **F1.** `pnpm run typecheck` sin errores (genéricos/strict, sin `any`
  público en `Pagination`/`usePagination`).
- [x] **F2.** `pnpm run lint` sin errores.
- [x] **F3.** `pnpm test` verde (Bloques B, C, E).
- [x] **F4.** Escribir en `progress/impl_paginacion.md` el mapa `R1..R34 → test`
  y pegar la salida de los tests.
- [x] **F5.** `./init.sh` en verde.

## Mapa de trazabilidad R → task/test (resumen)

| R | Task/Test |
| --- | --- |
| R1 | A1, B1 |
| R2 | A1 |
| R3 | A2, B1 |
| R4 | A3, B2 |
| R5 | A3, B3 |
| R6 | A3, B4 |
| R7 | A3, B5 |
| R8 | A3, B6 |
| R9 | A2, B7 |
| R10 | A4, B8 |
| R11 | A4, B8 |
| R12 | A4, B9 |
| R13 | A5, B10 |
| R14 | A5, B11 |
| R15 | A3, B1 |
| R16 | A3, B2 |
| R17 | A2, B1 |
| R18 | A3, B5, B6 |
| R19 | D1, E1 |
| R20 | D1, E1 |
| R21 | D1, E2 |
| R22 | D1, E3 |
| R23 | A5, D1, B12, E4 |
| R24 | D1, E5 |
| R25 | D1, E6 |
| R26 | A6, B13 |
| R27 | A6, B13 |
| R28 | A7, B14, E8 |
| R29 | A7, B15, E8 |
| R30 | A7, B16 |
| R31 | D1 |
| R32 | D2, E7, E8 |
| R33 | D2, E3 |
| R34 | D2, E3 |
