# Requisitos — paginacion (componente separado, componible con DataTable)

> Alcance: un componente de **PAGINACIÓN GENÉRICO, reutilizable y desacoplado**
> (`Pagination`), UI pura y **controlado**, pensado para **COMPONER** junto al
> `DataTable<T>` ya existente (`components/shared/DataTable.tsx`) o junto a
> cualquier otra lista. La paginación **NO** se incrusta dentro de `DataTable`:
> es un componente independiente que se renderiza como hermano. `Pagination`
> **no obtiene datos**: recibe `page`, `pageSize` y `total` por props y emite
> eventos (`onPageChange`, `onPageSizeChange`); quién obtiene/segmenta los datos
> es responsabilidad del contenedor que lo compone.
>
> Como entregable secundario, se **cablea la paginación en la vista `/ordenes`**
> (feature 7) usando el backend YA EXISTENTE `listarOrdenes` (feature 6), que ya
> devuelve `{ items, page, pageSize, total }`. NO se toca Prisma/DB/migraciones/
> RLS ni se crean APIs nuevas.
> Complejidad: `high` (feature_list.json id 8). UI + cableado de la vista.
>
> Convenciones de verificación: cada `R<n>` se cubre con al menos un test de
> componente (Vitest + `@testing-library/react` en jsdom, patrón de
> `tests/components/`), mapeado en `tasks.md`. Los tests NO dependen de media
> queries (jsdom no evalúa layout): afirman sobre roles/`nav`/`button`/texto/
> callbacks en el DOM.

---

## Contrato del componente `Pagination` (props y desacoplamiento)

- **R1 (ubicuo):** El sistema DEBE exponer un componente `Pagination`
  **independiente** en `components/shared/`, que **NO** dependa de `DataTable`
  ni de ningún dominio (no importa tipos de `orden`), y que pueda renderizarse
  de forma autónoma junto a cualquier lista.

- **R2 (ubicuo):** El componente `Pagination` DEBE ser **controlado**: recibe el
  estado de paginación por props (`page`: entero ≥ 1, `pageSize`: entero ≥ 1,
  `total`: entero ≥ 0) y NO mantiene el número de página como fuente de verdad
  interna. El contenedor que lo compone es el dueño del estado.

- **R3 (ubicuo):** El componente `Pagination` DEBE derivar el número total de
  páginas como `totalPages = max(1, ceil(total / pageSize))` y mostrar de forma
  accesible la posición actual (p. ej. "Página X de Y"), sin exponer detalles
  internos ni datos crudos.

- **R4 (por evento):** CUANDO el usuario activa el control "siguiente", el
  sistema DEBE invocar `onPageChange(page + 1)`; CUANDO activa "anterior", DEBE
  invocar `onPageChange(page - 1)`. `Pagination` NO muta datos por sí mismo: solo
  emite el nuevo número de página al contenedor.

- **R5 (opcional):** DONDE se provean controles de "primera"/"última" página, el
  sistema DEBE invocar `onPageChange(1)` y `onPageChange(totalPages)`
  respectivamente.

- **R6 (por evento):** CUANDO el contenedor NO provee `onPageChange`, activar un
  control de navegación NO DEBE lanzar error (no-op seguro); el componente sigue
  siendo renderizable como indicador de posición de solo lectura.

## Límites: primera y última página

- **R7 (de estado):** MIENTRAS `page` sea la primera página (`page <= 1`), el
  sistema DEBE **deshabilitar** los controles "anterior" y "primera" (atributo
  `disabled` real en los `<button>`) y NO emitir `onPageChange` al activarlos.

- **R8 (de estado):** MIENTRAS `page` sea la última página (`page >= totalPages`),
  el sistema DEBE **deshabilitar** los controles "siguiente" y "última"
  (`disabled` real) y NO emitir `onPageChange` al activarlos.

- **R9 (condicional):** SI el contenedor pasa un `page` fuera de rango
  (`page < 1` o `page > totalPages`), ENTONCES el componente DEBE tratarlo de
  forma segura acotándolo a `[1, totalPages]` para el cálculo de la posición
  mostrada y de los `disabled`, sin lanzar error.

## Tamaño de página (page size)

- **R10 (opcional):** DONDE se provea `onPageSizeChange` y `pageSizeOptions`
  (lista de tamaños permitidos), el sistema DEBE renderizar un selector accesible
  de tamaño de página con esas opciones y el `pageSize` actual seleccionado.

- **R11 (por evento):** CUANDO el usuario cambia el tamaño de página, el sistema
  DEBE invocar `onPageSizeChange(nuevoTamaño)` con un entero de la lista
  permitida. La decisión de reubicar la página (p. ej. volver a la página 1) es
  responsabilidad del contenedor, NO del componente.

- **R12 (condicional):** SI NO se provee `onPageSizeChange` (o no se pasan
  `pageSizeOptions`), ENTONCES el selector de tamaño de página NO se renderiza y
  el resto de controles de navegación funcionan igual.

## Estado vacío y de una sola página

- **R13 (de estado):** MIENTRAS `total === 0` (lista vacía), el sistema DEBE
  seguir siendo renderizable sin lanzar error: muestra la posición "Página 1 de 1"
  (o un texto de "sin resultados" accesible) y mantiene deshabilitados TODOS los
  controles de navegación.

- **R14 (de estado):** MIENTRAS `totalPages === 1` (una sola página con datos),
  el sistema DEBE deshabilitar los controles de navegación (no hay a dónde ir),
  manteniendo visible el indicador de posición y, si aplica, el selector de
  tamaño de página (R10).

## Accesibilidad de los controles

- **R15 (ubicuo):** El sistema DEBE envolver los controles de paginación en un
  elemento de navegación semántico con nombre accesible (`<nav aria-label="…">`,
  rol `navigation`), localizable por `getByRole('navigation', { name })`.

- **R16 (ubicuo):** Cada control de navegación DEBE ser un `<button>` real con
  nombre accesible (texto o `aria-label`, p. ej. "Página anterior", "Página
  siguiente"), accionable por teclado, y NO un `div`/`span` con `onClick`.

- **R17 (ubicuo):** El indicador de posición actual DEBE anunciarse de forma
  accesible (p. ej. `aria-live="polite"` o texto asociado), de modo que un test
  pueda leer "Página X de Y" tras un cambio de página.

- **R18 (ubicuo):** El estado deshabilitado de un control DEBE reflejarse de forma
  accesible (`disabled`/`aria-disabled`), de manera que la tecnología de asistencia
  y los tests lo detecten.

## Cableado en la vista `/ordenes` (composición con DataTable)

- **R19 (ubicuo):** El sistema DEBE renderizar `Pagination` en la vista
  `/ordenes` como **hermano** de `DataTable` (composición), sin modificar el
  contrato público de `DataTable` (`components/shared/DataTable.tsx` no gana props
  de paginación). `DataTable` sigue recibiendo únicamente las filas de la página
  actual.

- **R20 (por evento):** CUANDO se monta `/ordenes`, el sistema DEBE mantener el
  estado de paginación (`page`, `pageSize`) en la vista y obtener el listado con
  **SWR en el cliente**, cuyo fetcher invoca la Server Action existente
  `listarOrdenes({ page, pageSize })` (feature 6). El `total` de páginas se deriva
  del `total` que devuelve `listarOrdenes`. NO se crean API routes ni se accede a
  Prisma/DB desde la UI.

- **R21 (por evento):** CUANDO el usuario cambia de página en `/ordenes`, el
  sistema DEBE actualizar `page`, re-consultar `listarOrdenes({ page, pageSize })`
  vía SWR (nueva key) y renderizar en `DataTable` las filas de la nueva página,
  reflejando la nueva posición en `Pagination`.

- **R22 (por evento):** CUANDO el usuario cambia el tamaño de página en
  `/ordenes`, el sistema DEBE volver a la **página 1** y re-consultar
  `listarOrdenes({ page: 1, pageSize })`, respetando el `MAX_PAGE_SIZE` que ya
  aplica el backend (el backend acota `pageSize`; la UI no reimplementa ese clamp).

- **R23 (de estado):** MIENTRAS `listarOrdenes` esté cargando una página, el
  sistema DEBE mostrar el estado de **carga** de `DataTable` (feature 7) y NO DEBE
  perder ni corromper el estado de `Pagination`; los controles pueden deshabilitarse
  durante la carga (`disabled`) para evitar dobles disparos.

- **R24 (de estado):** MIENTRAS el listado devuelva `total === 0` (sin órdenes),
  el sistema DEBE mostrar el estado **vacío** de `DataTable` ("No hay órdenes") y
  el `Pagination` en su estado vacío (R13), sin controles activos.

- **R25 (ubicuo):** El sistema DEBE respetar la **autorización por rol existente**:
  la paginación opera sobre exactamente el conjunto que `listarOrdenes` devuelve
  para el actor de sesión (feature 6). La UI NO reimplementa filtros por rol ni
  recalcula `total` por su cuenta; usa el `total` del backend.

## Ventana de números de página (control genérico del componente)

- **R26 (opcional):** DONDE se solicite la ventana de páginas numeradas (prop de
  activación, p. ej. `siblingCount` provisto), el componente `Pagination` DEBE
  renderizar una lista de botones numéricos que incluya SIEMPRE la **primera**
  (`1`) y la **última** (`totalPages`) página, más una ventana centrada en la
  página actual con `k` vecinos a cada lado (`safePage - k … safePage + k`,
  acotados a `[1, totalPages]`).

- **R27 (condicional):** SI entre la ventana visible y la primera/última página
  existe un hueco de más de una página, ENTONCES el componente DEBE renderizar un
  separador de **elipsis** (`…`) no accionable (no es `<button>`; no emite eventos
  y no recibe foco), en lugar de listar todos los números intermedios.

- **R28 (por evento):** CUANDO el usuario activa un botón numérico de página `n`,
  el componente DEBE invocar `onPageChange(n)` con ese entero; si `n` es la página
  actual o no hay `onPageChange`, la activación es un no-op seguro (no lanza error).

- **R29 (de estado):** MIENTRAS un botón numérico corresponda a la página actual
  (`n === safePage`), el componente DEBE marcarlo con `aria-current="page"` y el
  resto de botones numéricos NO DEBEN llevar `aria-current`, de modo que un test
  identifique inequívocamente la página activa.

- **R30 (de estado):** MIENTRAS `disabled` global esté activo (p. ej. carga,
  R23) o el dataset esté vacío (`total === 0`, R13), TODOS los botones numéricos
  DEBEN quedar deshabilitados (`disabled` real) y no emitir `onPageChange`.

## Cableado firme en `/ordenes` (decisiones humanas 2026-07-09)

- **R31 (ubicuo):** El sistema DEBE cablear `/ordenes` en modo **server-side**: la
  vista pasa `{ page, pageSize }` a `listarOrdenes` y el backend segmenta. El modo
  client-side (`usePagination`) NO se usa como default de órdenes; se conserva solo
  como capacidad reutilizable para otras listas.

- **R32 (ubicuo):** El sistema DEBE renderizar en `/ordenes` el `Pagination` con
  los controles "primera" y "última" **activos** (`showFirstLast=true`) y con la
  **ventana de números de página** habilitada (R26–R30).

- **R33 (ubicuo):** El sistema DEBE exponer en `/ordenes` el selector de tamaño de
  página con las opciones `[10, 25, 50]`, acotadas por `MAX_PAGE_SIZE` de
  `ordenesConfig`: cualquier opción que exceda `MAX_PAGE_SIZE` DEBE filtrarse o
  acotarse antes de pasarse como `pageSizeOptions`, de modo que ninguna opción
  ofrecida supere el máximo permitido por el backend.

- **R34 (por evento):** CUANDO el usuario cambia el tamaño de página en `/ordenes`
  a un valor de `[10, 25, 50]`, el sistema DEBE volver a la **página 1** y
  re-consultar `listarOrdenes({ page: 1, pageSize })` (refina R22 con el conjunto
  de opciones firme).

## Criterios de aceptación verificables

Cada `R<n>` se considera cumplido solo si existe un test que lo ejercita (test de
componente de `Pagination`, o de la vista `/ordenes` con `listarOrdenes` mockeada
como fetcher de SWR), según el mapa de `tasks.md`. Un requisito sin test es un
fallo de la feature (`docs/verification.md`).

## Preguntas abiertas

Ninguna. Las preguntas Q1–Q4 fueron resueltas por decisión humana (2026-07-09) y
promovidas a requisitos firmes: server-side (R31), botones primera/última activos
(R32), selector `[10,25,50]` con reset a página 1 (R33, R34) y ventana numérica
con elipsis + `aria-current` (R26–R30).
