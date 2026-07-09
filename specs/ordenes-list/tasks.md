# Tasks — ordenes - list

> Convención: cada task tiene criterio de "hecho" y el/los `R<n>` que cubre.
> `[P]` = paralelizable con otras `[P]` del mismo bloque. Tests con Vitest +
> `@testing-library/react` en jsdom (`// @vitest-environment jsdom`), patrón de
> `tests/components/`. Los tests de la página mockean `listarOrdenes`
> (`vi.mock("@/lib/actions/ordenes")`) y `next/link`/`next/navigation` como en
> `tests/components/Sidebar.test.tsx`. NO se toca backend/DB/Prisma.
>
> Decisiones de producto CERRADAS (ya no hay preguntas abiertas): 5 columnas
> (`num_guia`, `num_remision`, `estatus`, `destinatario`, `tienda`); la columna
> `tienda` muestra el NOMBRE legible (`tiendaNombre`), lo que exige ampliar el
> listado backend de la feature 6 (Bloque F); SWR en cliente con fetcher = Server
> Action existente `listarOrdenes`; sin paginación/orden/filtros ni acciones por
> fila; celda sin `render` por `column.id`; `rowKey`=`row.id`; `DataTable` en
> `components/shared/DataTable.tsx`.
>
> Reparto por agente: Bloque F lo ejecuta `backend_dev` (frontera backend feature
> 6); Bloques A–E los ejecuta `frontend_dev`. Bloque F es dependencia de C1/D1.

## Bloque A — Tipo y componente `DataTable<T>` (UI pura)

- [x] **A1. Definir `Column<T>` y `DataTableProps<T>`** en
  `components/shared/DataTable.tsx` (o `components/shared/data-table.types.ts`).
  Hecho: `id`, `value`, `render?: ((row:T)=>ReactNode) | keyof T | string`, y
  props `columns/data/rowKey?/caption?/ariaLabel?/isLoading?/error?/emptyMessage?`.
  Compila en strict sin `any` público. Cubre **R1, R2, R3**.

- [x] **A2. Implementar `DataTable<T>`** en `components/shared/DataTable.tsx`
  (`'use client'`): `<table>` con `<caption>`(si) + `<thead>` de `<th scope="col">`
  (texto=`value`, en orden) + `<tbody>` de filas; función pura `resolveCell`
  (`render` función/string/ausente→`row[column.id]`); `rowKey` por defecto `row.id`.
  Depende de A1. Cubre **R5, R6, R7, R8, R9, R10, R15, R16**.

- [x] **A3. Estados vacío/carga/error** en `DataTable` con precedencia
  `error > isLoading > vacío > datos`. Depende de A2. Cubre **R11, R12, R13, R14**.

## Bloque B — Tests de componente de `DataTable` (mapa R→test)

- [x] **B1. [P] Cabeceras y orden de columnas.** Test: pasa 3 columnas, verifica 3
  `columnheader` con textos = `value` en orden (`getAllByRole('columnheader')`),
  `th` con `scope="col"`, y `getByRole('table', { name })` por `ariaLabel`.
  Cubre **R2, R5, R15, R16**.

- [x] **B2. [P] Render con `render` FUNCIÓN (componente custom).** Test: columna con
  `render: (row) => <button>...`; verifica que por cada fila se invoca y aparece el
  nodo custom en la celda. Cubre **R3(a), R6**.

- [x] **B3. [P] Render con `render` STRING (clave).** Test: columna
  `{ id:'a', value:'A', render:'nombre' }`; verifica que la celda muestra
  `row.nombre`. Cubre **R3(b), R7**.

- [x] **B4. [P] Render SIN `render` (valor por clave por defecto).** Test: columna
  `{ id:'nombre', value:'Nombre' }`; verifica celda = `row.nombre`; y celda vacía
  cuando el valor es `null`/`undefined` sin throw. Cubre **R3(c), R8**.

- [x] **B5. [P] N filas y orden preservado.** Test: `data` de N filas; verifica N
  `<tr>` en `tbody` (`getAllByRole('row')` menos cabecera) en el mismo orden.
  Cubre **R9**.

- [x] **B6. [P] Keys de fila estables.** Test: `rowKey` por `id` (y función);
  verifica render sin warning de key duplicada y que reordenar `data` mantiene
  identidad (assert observable de contenido por fila). Cubre **R10**.

- [x] **B7. [P] Estado vacío.** Test: `data=[]` → cabecera presente + `emptyMessage`
  ("No hay registros" por defecto), sin filas de datos. Cubre **R11**.

- [x] **B8. [P] Estado carga.** Test: `isLoading` → indicador de carga
  (`role="status"`/texto), distinguible del vacío. Cubre **R12**.

- [x] **B9. [P] Estado error.** Test: `error="algo"` → mensaje de error accesible
  (`role="alert"`) en lugar de datos, sin internals. Cubre **R13**.

- [x] **B10. [P] `caption`.** Test: `caption="X"` → `<caption>` presente y da nombre
  accesible a la tabla. Cubre **R14, R16**.

- [x] **B11. [P] `id` único por columna.** Test que documenta/verifica columnas con
  `id` únicos y que el render no rompe. Cubre **R4**.

(B1–B11 dependen de A2/A3; entre sí son `[P]`.)

## Bloque F — Ampliación del listado backend (feature 6): `tiendaNombre`

> `backend_dev`. Cambio leve y acotado al LISTADO; sin migración, sin RLS nueva,
> sin tocar crear/obtener/actualizar/borrar ni la autorización por rol.

- [x] **F1. `OrdenRepository.list`** incluye el nombre de la tienda vía
  `include/select` de la relación `tienda` (`Usuario.nombre`) y mapea
  `tiendaNombre` en cada item. Ajustar el tipo de retorno en
  `lib/interfaces/repositories/IOrdenRepository.ts`. Hecho: el repo devuelve
  `tiendaNombre` por item. Cubre **R25**.

- [x] **F2. DTO de listado con `tiendaNombre`** en `lib/types/orden.ts`
  (`OrdenListItemDTO = OrdenDTO & { tiendaNombre: string }`; `ListarOrdenesResult.items`
  pasa a `OrdenListItemDTO[]`). `OrdenService.listar` propaga los items enriquecidos
  SIN cambiar autorización ni `where` por rol. Depende de F1. Cubre **R25, R26, R22**.

- [x] **F3. Test del listado con nombre de tienda** (unit de repo/service, patrón
  `tests/unit/repositories/orden-repository.test.ts` / `orden-service.test.ts`):
  con fixtures de un `Usuario` tienda con `nombre`, el resultado de `listar`/`list`
  incluye `tiendaNombre` = ese nombre; verificar que la autorización por rol sigue
  igual (adminTienda solo las suyas). Cubre **R25, R26**.

## Bloque C — Columnas de orden y vista `/ordenes` (SWR)

- [x] **C1. Definir las 5 columnas de orden** en
  `app/(app)/ordenes/_components/ordenes-columns.tsx` como
  `Column<OrdenListItemDTO>[]`, en orden: `num_guia` (sin render), `num_remision`
  (render string `"numRemision"`), `estatus` (render función → `estatusValue ??
  estatusId`), `destinatario` (sin render), `tienda` (render función →
  `row.tiendaNombre`, nombre legible). Depende de A1, F2. Cubre **R17, R24** (parte
  columnas), y ejercita R6/R7/R8 vía la tabla en Bloque D.

- [x] **C2. Reemplazar placeholder `app/(app)/ordenes/page.tsx`** por Client
  Component (`'use client'`) que usa `useSWR` con fetcher que llama a la Server
  Action existente `listarOrdenes({})` (throw si `status!=='ok'`) y monta
  `<DataTable columns={ordenesColumns} data={data ?? []} rowKey="id"
  ariaLabel="Órdenes" isLoading={isLoading} error={...} emptyMessage="No hay órdenes" />`.
  Depende de A2, A3, C1. Cubre **R17, R18, R19, R20, R21, R22, R23**.

## Bloque D — Tests de la vista de órdenes (Server Action mockeada como fetcher SWR)

> Los tests mockean `@/lib/actions/ordenes` (`vi.mock`) y aíslan la cache de SWR
> (`SWRConfig provider: () => new Map()` o `dedupingInterval: 0`). Usan `findBy*`
> para esperar la resolución async de SWR.

- [x] **D1. Render de N órdenes con las 5 columnas.** Test: mock
  `{status:'ok', items:[...3]}` (items con `tiendaNombre`); verifica 5
  `columnheader` (Nº Guía, Nº Remisión, Estatus, Destinatario, Tienda) y 3 filas con
  celdas mapeadas a `OrdenListItemDTO` (numGuia por id, numRemision por
  render-string, estatus por render-función, destinatario por id, tienda =
  `tiendaNombre` por render-función), afirmando que la celda Tienda muestra el
  NOMBRE y NO el uuid `tiendaId`. Cubre **R18, R19, R24, R26** y de paso R6/R7/R8.

- [x] **D2. Estado carga (SWR).** Test: mock que resuelve diferido / `isLoading`
  inicial → indicador de carga antes de datos, distinguible del vacío. Cubre **R20**.

- [x] **D3. Estado vacío de órdenes.** Test: mock `items:[]` → "No hay órdenes",
  sin filas de datos. Cubre **R20**.

- [x] **D4. Estado error/no-ok (SWR error).** Test: mock `{status:'unauthenticated'}`
  (y `forbidden`/`validation_error`), y caso de throw del fetcher → estado error
  accesible, sin tabla de datos ni internals. Cubre **R21**.

- [x] **D5. Autorización delegada.** Test: verifica que la vista muestra exactamente
  los `items` devueltos por `listarOrdenes` (no re-filtra por rol); el mock simula
  p. ej. el subconjunto de `adminTienda`. Cubre **R22**.

- [x] **D6. Sin controles ni acciones (solo lectura).** Test: no hay controles de
  paginación/orden/filtro ni botones/enlaces de acción por fila; la tabla solo
  renderiza las filas recibidas. Cubre **R23**.

- [x] **D7. Fetcher sobre la Server Action (no API route).** Test/assert: el fetcher
  invoca la Server Action mockeada `listarOrdenes`; no se hace `fetch` a rutas
  `app/api/*`. Cubre **R18** (uso de la action existente).

## Bloque E — Verificación

- [x] **E1.** `pnpm run typecheck` sin errores (genéricos `Column<T>`/`DataTable<T>`
  en strict). 
- [x] **E2.** `pnpm run lint` sin errores.
- [x] **E3.** `pnpm test` verde (Bloques B, D y F). 
- [x] **E4.** Escribir en `progress/impl_ordenes-list.md` el mapa `R1..R26 → test`
  y pegar la salida de los tests.
- [x] **E5.** `./init.sh` en verde.

## Mapa de trazabilidad R → task/test (resumen)

| R | Task/Test |
| --- | --- |
| R1 | A1, B1 |
| R2 | A1, A2, B1 |
| R3 | A1, B2, B3, B4 |
| R4 | A1, B11 |
| R5 | A2, B1 |
| R6 | A2, B2 |
| R7 | A2, B3 |
| R8 | A2, B4 |
| R9 | A2, B5 |
| R10 | A2, B6 |
| R11 | A3, B7 |
| R12 | A3, B8 |
| R13 | A3, B9 |
| R14 | A3, B10 |
| R15 | A2, B1 |
| R16 | A2, B1, B10 |
| R17 | C1, C2 |
| R18 | C2, D1, D7 |
| R19 | C2, D1 |
| R20 | C2, D2, D3 |
| R21 | C2, D4 |
| R22 | C2, D5, F2, F3 |
| R23 | C2, D6 |
| R24 | C1, D1 |
| R25 | F1, F2, F3 |
| R26 | F2, F3, D1 |
