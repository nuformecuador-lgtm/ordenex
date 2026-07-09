# Requisitos — ordenes - list (UI: tabla reutilizable + página de órdenes)

> Alcance: un componente de **TABLA GENÉRICA, reutilizable y data-driven**
> (`DataTable<T>`), UI pura, que recibe por props las **columnas normalizadas**
> (`id`, `value`, `render` opcional) y los **datos** (filas), y los renderiza; y
> la **página `/ordenes`** que define columnas concretas de orden y muestra el
> listado consumiendo el backend YA EXISTENTE de la feature 6 (`listarOrdenes`,
> `lib/actions/ordenes.ts`, que ya aplica autorización por rol). NO se toca
> Prisma/DB/migraciones/RLS ni se crean APIs nuevas. ÚNICA excepción backend
> (R25): se amplía el **listado** para incluir `tiendaNombre` en el DTO
> (select/join de `Usuario.nombre` en repositorio/service del listado + sus tests);
> el resto del CRUD y la autorización por rol NO cambian.
> Complejidad: `high` (feature_list.json id 7). UI + ajuste menor del listado.
>
> Convenciones de verificación: cada `R<n>` se cubre con al menos un test de
> componente (Vitest + `@testing-library/react` en jsdom, patrón de
> `tests/components/`), mapeado en `tasks.md`.
>
> Decisiones de producto CERRADAS por el humano (antes eran preguntas abiertas):
> - Columnas de `/ordenes` (exactamente 5): `num_guia`, `num_remision`, `estatus`,
>   `destinatario`, `tienda`.
> - SIN paginación/orden/filtros en la UI y SIN acciones por fila por ahora.
> - Carga con **SWR en cliente**: la página es Client Component y su fetcher SWR
>   invoca la **Server Action existente** `listarOrdenes` (feature 6), sin crear
>   API routes ni tocar backend/DB.
> - Clave por defecto de celda sin `render` = `column.id`; `rowKey` = `row.id`;
>   `DataTable` genérico vive en `components/shared/DataTable.tsx`.

---

## Contrato de la tabla genérica: tipo `Column<T>` y props

- **R1 (ubicuo):** El sistema DEBE exponer un componente genérico `DataTable<T>`
  que reciba por props un arreglo de **columnas** `columns: Column<T>[]` y un
  arreglo de **filas** `data: T[]`, sin acoplarse a ningún dominio concreto
  (no importa tipos de `orden`).

- **R2 (ubicuo):** El sistema DEBE definir el tipo de columna con, al menos, los
  campos: `id` (identificador único de columna, string), `value` (etiqueta de
  cabecera a mostrar en el `<th>`, string) y `render` (OPCIONAL). El `id` DEBE
  usarse además como `key` de React de la columna y ser único entre las columnas.

- **R3 (ubicuo):** El sistema DEBE aceptar en `render` uno de tres casos:
  (a) una **función** `(row: T) => ReactNode` que renderiza contenido custom;
  (b) un **string** que actúa como clave de acceso al dato de la fila; o
  (c) **ausente/undefined**. Tipado: `render?: ((row: T) => ReactNode) | keyof T | string`.

- **R4 (condicional):** SI dos columnas comparten el mismo `id`, ENTONCES el
  contrato lo considera uso incorrecto; el sistema DEBE, como mínimo, no romper
  el render (renderiza ambas cabeceras) y el requisito de unicidad de `id` (R2)
  se verifica con un test que documente el `id` único por columna.

## Render de cabeceras (thead) y celdas (tbody)

- **R5 (por evento):** CUANDO se renderiza la tabla con `columns`, el sistema DEBE
  renderizar una fila de cabecera con un `<th>` por columna cuyo texto sea el
  `value` de esa columna, en el mismo orden del arreglo `columns`.

- **R6 (por evento):** CUANDO una columna define `render` como **función**, el
  sistema DEBE, por cada fila, invocar `render(row)` y renderizar su resultado
  (`ReactNode`, p. ej. un componente custom) dentro de la celda correspondiente.

- **R7 (por evento):** CUANDO una columna define `render` como **string** (clave),
  el sistema DEBE, por cada fila, leer el valor `row[render]` y renderizarlo como
  contenido de la celda.

- **R8 (por evento):** CUANDO una columna **no** define `render`, el sistema DEBE
  leer el valor de la fila por la clave **`column.id`** (`row[column.id]`) y
  renderizarlo como contenido de la celda; si el valor es `null`/`undefined` DEBE
  renderizar una celda vacía (sin lanzar error).

- **R9 (por evento):** CUANDO se renderizan `N` filas de `data`, el sistema DEBE
  renderizar `N` filas `<tr>` en el `<tbody>`, cada una con una celda por columna
  y en el mismo orden de columnas, preservando el orden de `data`.

- **R10 (ubicuo):** El sistema DEBE asignar a cada fila una `key` de React estable
  derivada de la fila mediante la prop `rowKey` (por defecto `row.id`), sin usar el
  índice del arreglo como key cuando exista un identificador de fila. En la tabla
  de órdenes la key es `OrdenDTO.id`.

## Estados: vacío, carga, error

- **R11 (de estado):** MIENTRAS `data` esté vacío (`[]`), el sistema DEBE renderizar
  la cabecera y un **estado vacío** (una fila/mensaje accesible, p. ej. "No hay
  registros"), sin filas de datos y sin lanzar error.

- **R12 (opcional):** DONDE la tabla reciba una prop opcional `isLoading`, el
  sistema DEBE, MIENTRAS `isLoading` sea verdadero, mostrar un indicador de
  **carga** en lugar (o encima) de las filas, distinguible del estado vacío.

- **R13 (opcional):** DONDE la tabla reciba una prop opcional de **error**
  (p. ej. `error` / `errorMessage`), el sistema DEBE, SI hay error, mostrar un
  mensaje de error accesible en lugar de los datos, sin filtrar detalles internos.

- **R14 (opcional):** DONDE la tabla reciba una prop opcional `caption`, el sistema
  DEBE renderizar un `<caption>` con ese texto asociado a la tabla.

## Accesibilidad de la tabla

- **R15 (ubicuo):** El sistema DEBE renderizar la tabla como un `<table>` semántico
  con `<thead>`, `<tbody>` y `<tr>`/`<th>`/`<td>` reales (rol `table` accesible),
  no `div`s con estilos; las cabeceras DEBEN ser `<th scope="col">`.

- **R16 (ubicuo):** El sistema DEBE proveer un nombre accesible a la tabla (vía
  `caption` cuando se pasa, o `aria-label`/`aria-labelledby`), de modo que sea
  localizable por `getByRole('table', { name })` en los tests.

## Página de órdenes (`/ordenes`) que consume el backend existente

- **R17 (ubicuo):** El sistema DEBE reemplazar el placeholder actual
  `app/(app)/ordenes/page.tsx` por una vista que muestre las órdenes usando el
  componente genérico `DataTable`, definiendo EN LA PÁGINA su conjunto de columnas
  concretas (ver R24) y pasándolas como props a la tabla; la tabla NO conoce el
  dominio orden.

- **R18 (por evento):** CUANDO se monta la vista `/ordenes`, el sistema DEBE
  obtener el listado con **SWR en el cliente**, cuyo fetcher invoca la **Server
  Action existente** `listarOrdenes` de la feature 6 (que devuelve
  `{ status:'ok'; items: OrdenDTO[]; page; pageSize; total }`), llamándola desde el
  cliente. El sistema NO DEBE crear API routes ni acceder a Prisma/DB desde la UI.

- **R19 (por evento):** CUANDO el resultado del listado es `status:'ok'`, el sistema
  DEBE renderizar una fila por cada `OrdenDTO` de `items`, mapeando las 5 columnas
  definidas (R24) a los campos del DTO.

- **R20 (de estado):** MIENTRAS SWR esté cargando (sin datos aún), el sistema DEBE
  mostrar el estado de **carga** de la tabla (R12); y MIENTRAS `items` esté vacío
  (respuesta ok sin filas), DEBE mostrar el estado **vacío** (R11) con un mensaje
  adecuado para órdenes (p. ej. "No hay órdenes"). Ambos estados DEBEN ser
  distinguibles entre sí.

- **R21 (condicional):** SI el fetcher SWR falla (rechazo/throw) o el resultado del
  listado NO es `status:'ok'` (`unauthenticated`, `forbidden`, `validation_error`),
  ENTONCES la vista DEBE mostrar un estado de **error** accesible (R13) en lugar de
  la tabla de datos, sin exponer detalles internos.

- **R22 (ubicuo):** El sistema DEBE respetar la **autorización por rol ya existente**:
  la vista NO reimplementa reglas de visibilidad; muestra exactamente las órdenes
  que `listarOrdenes` devuelve para el actor de sesión (p. ej. `adminTienda` solo
  ve las suyas, `mensajero`/`admin`/`maestro` según la matriz de la feature 6). La
  UI no filtra por rol por su cuenta.

- **R23 (ubicuo):** El sistema NO DEBE exponer controles de paginación, orden,
  filtros NI acciones por fila (ver/editar/borrar) en esta iteración: la vista es
  de solo lectura y la tabla genérica solo renderiza las filas que recibe. (El
  backend puede paginar, pero la UI no expone controles todavía.)

- **R24 (ubicuo):** El sistema DEBE definir para `/ordenes` exactamente estas 5
  columnas, en este orden: `num_guia`, `num_remision`, `estatus`, `destinatario`,
  `tienda`. La columna `tienda` DEBE mostrar el **nombre legible** de la tienda
  (`tiendaNombre`, tomado de `Usuario.nombre` del usuario tienda), NO el `tiendaId`
  (uuid).

- **R25 (ubicuo):** El sistema DEBE ampliar el **listado de órdenes** de la feature
  6 (`listarOrdenes` + su service/repositorio/DTO) para incluir en cada elemento un
  campo legible de la tienda, `tiendaNombre`, obtenido de la relación
  `Orden.tiendaId → Usuario.nombre`. Esto implica un select/join adicional en el
  repositorio del listado y un campo nuevo (`tiendaNombre: string`) en el DTO de
  salida del listado. El resto del CRUD de la feature 6 (crear/obtener/actualizar/
  borrar), la autorización por rol y las reglas de visibilidad NO cambian.

- **R26 (por evento):** CUANDO `listarOrdenes` devuelve `status:'ok'`, cada elemento
  de `items` DEBE incluir `tiendaNombre` con el nombre del usuario tienda
  correspondiente a su `tiendaId`.

## Criterios de aceptación verificables

Cada requisito se considera cumplido solo si existe un test que lo ejercita
(test de componente de `DataTable`, o de la vista de órdenes con `listarOrdenes`
mockeada como fetcher de SWR), según el mapa de `tasks.md`. Un requisito sin test
es un fallo de la feature (`docs/verification.md`). Los tests NO deben depender de
media queries (jsdom no evalúa layout): afirman sobre roles/`th`/`td`/texto en el
DOM.

## Notas (menores, no bloqueantes)

- **N1 — Alcance backend de R25:** ampliar el listado (`tiendaNombre` en el DTO) es
  una modificación **leve** al backend de la feature 6 (repositorio/service/DTO del
  listado + sus tests), no una feature nueva. No cambian Prisma/migraciones/RLS ni
  el resto del CRUD. La relación `Orden.tienda → Usuario` ya existe en el esquema
  (feature 6), así que es un `select`/`include` de `usuario.nombre`, no un modelo
  nuevo.
