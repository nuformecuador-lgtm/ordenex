# Diseño — paginacion (componente separado y componible con DataTable)

## Enfoque general

Feature de **UI** con un **cableado** de la vista `/ordenes`. NO se toca `db/`,
Prisma, migraciones, RLS, `app/api/` ni `middleware.ts`. Se REUTILIZA el backend
existente de la feature 6: `listarOrdenes` (`lib/actions/ordenes.ts`) **ya**
acepta `{ page, pageSize }` y devuelve `{ status:'ok', items, page, pageSize,
total }` (ver `lib/types/orden.ts`: `listarOrdenesSchema` y `ListarOrdenesResult`).
Es decir, la capacidad de paginar **ya está en el servidor**; esta feature aporta
la **UI de paginación** y su cableado.

Entregables:

1. Un componente **separado, genérico y controlado** `Pagination`
   (`components/shared/Pagination.tsx`), UI pura. NO se acopla a `DataTable`: se
   compone como hermano. No obtiene datos; recibe `page/pageSize/total` y emite
   `onPageChange/onPageSizeChange`.
2. (Opcional/útil) un hook `usePagination` (`hooks/usePagination.ts`) para el
   **modo client-side**: segmenta un array en memoria y produce las props que
   `Pagination` espera. Permite componer paginación con cualquier lista sin
   backend paginado.
3. El **cableado de `/ordenes`**: la vista pasa a mantener estado `page/pageSize`,
   consulta `listarOrdenes({ page, pageSize })` vía SWR y renderiza
   `<DataTable/>` + `<Pagination/>` como hermanos.

Stack idéntico al repo: Next.js App Router, TypeScript strict, Tailwind v4,
primitivas de `components/ui/` (shadcn/ui), tests de componente con Vitest +
`@testing-library/react` en jsdom (patrón `tests/components/`).

## Decisión clave: componente controlado y transport-agnostic (soporta ambos modos)

`Pagination` es **presentacional y controlado**. Solo conoce tres números
(`page`, `pageSize`, `total`) y dos callbacks. **No sabe** de dónde vienen los
datos ni cómo se segmentan. Por eso soporta **client-side y server-side sin
cambios**:

- **Server-side** (elegido para `/ordenes`): el backend segmenta; la vista pasa
  `page/pageSize/total` reales del `listarOrdenes` y `DataTable` recibe solo las
  filas de esa página. Correcto para PII y escala (no baja toda la tabla al
  cliente).
- **Client-side** (para listas pequeñas no sensibles): `usePagination(items,
  pageSize)` segmenta en memoria y entrega `page/pageSize/total` +
  `pagedItems`; se pasan `pagedItems` a `DataTable` y el resto a `Pagination`.

Esto respeta el requisito central: la paginación es un componente **separado**
que **compone** con `DataTable` (o cualquier lista), sin acoplarse.

## Desacoplamiento de DataTable (composición, no herencia de props)

`components/shared/DataTable.tsx` **NO** se modifica: sigue recibiendo únicamente
`columns/data/rowKey/caption/ariaLabel/isLoading/error/emptyMessage`. La
paginación NO entra en su contrato. La composición vive en el contenedor:

```
<section>
  <DataTable columns={...} data={pageRows} ... />
  <Pagination page={page} pageSize={pageSize} total={total}
              onPageChange={setPage} onPageSizeChange={...} />
</section>
```

Regla de `docs/architecture.md` ("sin sobre-ingeniería"): `Pagination` va a
`components/shared/` porque es explícitamente **genérico y reutilizable** entre
features (igual que `DataTable`). La lógica específica de órdenes (estado, keys de
SWR, opciones de tamaño) vive junto a la página `/ordenes`, no en `shared/`.

## Estructura de archivos

```
components/shared/
  Pagination.tsx           Pagination (client component). UI pura, controlada, sin dominio.
                           Props: page, pageSize, total, onPageChange?, onPageSizeChange?,
                           pageSizeOptions?, disabled?, ariaLabel?, labels?  (contrato abajo)
hooks/
  usePagination.ts         Hook opcional para modo CLIENT-SIDE: segmenta array en memoria.
app/(app)/ordenes/
  page.tsx                 Se AMPLÍA: estado page/pageSize + SWR con {page,pageSize} + Pagination.
  _components/
    (sin cambios en ordenes-columns.tsx)
```

## Contrato público de `Pagination` (props)

```ts
export interface PaginationLabels {
  first?: string;    // aria-label control "primera"   (default "Primera página")
  previous?: string; // aria-label control "anterior"  (default "Página anterior")
  next?: string;     // aria-label control "siguiente" (default "Página siguiente")
  last?: string;     // aria-label control "última"    (default "Última página")
  /** Render del indicador de posición. Default: `Página ${page} de ${totalPages}`. */
  status?: (page: number, totalPages: number, total: number) => string;
}

export interface PaginationProps {
  /** Página actual (1-based, ≥ 1). Fuente de verdad en el contenedor (R2). */
  page: number;
  /** Tamaño de página actual (≥ 1). */
  pageSize: number;
  /** Total de elementos del conjunto completo (≥ 0). */
  total: number;
  /** Emite el nuevo número de página (R4/R5). Sin él, navegación es no-op (R6). */
  onPageChange?: (nextPage: number) => void;
  /** Emite el nuevo tamaño de página (R11). Sin él, no se renderiza selector (R12). */
  onPageSizeChange?: (nextPageSize: number) => void;
  /** Opciones del selector de tamaño (R10). Requerido para mostrar el selector. */
  pageSizeOptions?: number[];
  /** Deshabilita todos los controles (p. ej. mientras carga, R23). */
  disabled?: boolean;
  /** Mostrar botones "primera"/"última" (R5). Default false. */
  showFirstLast?: boolean;
  /**
   * Nº de vecinos a cada lado de la página actual en la ventana numérica
   * (R26). Provisto (incl. 0) => se renderiza la ventana de botones numéricos;
   * `undefined` => NO se renderiza la ventana (solo indicador + navegación).
   * Default `undefined`. Valor típico en `/ordenes`: 1.
   */
  siblingCount?: number;
  /** Nombre accesible del <nav> (R15). Default "Paginación". */
  ariaLabel?: string;
  /** Etiquetas/aria-labels personalizables (i18n) (R16, R17). */
  labels?: PaginationLabels;
}
```

**Derivaciones puras (sin estado interno de página):**

```
totalPages   = Math.max(1, Math.ceil(total / pageSize))     // R3, R13 (total=0 -> 1)
safePage     = clamp(page, 1, totalPages)                    // R9
isFirst      = safePage <= 1                                 // R7
isLast       = safePage >= totalPages                        // R8
emptyDataset = total === 0                                   // R13 -> todos disabled
```

Handlers (solo emiten; nunca mutan datos):
```
goFirst   -> if (!isFirst && !disabled) onPageChange?.(1)
goPrev    -> if (!isFirst && !disabled) onPageChange?.(safePage - 1)
goNext    -> if (!isLast  && !disabled) onPageChange?.(safePage + 1)
goLast    -> if (!isLast  && !disabled) onPageChange?.(totalPages)
changeSize-> onPageSizeChange?.(Number(value))               // R11 (reubicar página = contenedor)
```

## Render (accesibilidad, R15–R18)

- Raíz: `<nav aria-label={ariaLabel} role="navigation">` (R15).
- Controles: `<button type="button">` reales con `aria-label` de `labels` y
  `disabled` calculado (R16, R18). Reutiliza la primitiva `components/ui/button.tsx`.
- Indicador de posición: elemento con `aria-live="polite"` que muestra el texto de
  `labels.status(safePage, totalPages, total)` (R17). Ej. "Página 2 de 5".
- Selector de tamaño (si `onPageSizeChange` + `pageSizeOptions`): control accesible
  con `aria-label` (p. ej. `<select aria-label="Elementos por página">` con
  `<option>` por opción; el `pageSize` actual seleccionado) (R10, R12). Se usa
  `<select>` nativo (accesible por defecto, sin instalar primitiva nueva).

Precedencia visual: el indicador de posición siempre visible; botones deshabilitados
según límites (R7/R8/R14) o dataset vacío (R13) o `disabled` global (R23).

## Ventana de números de página (R26–R30)

Activada cuando `siblingCount` está definido. Es un helper **puro** (sin estado)
que produce la lista de "items" a renderizar; el render la traduce a botones y
separadores. Se implementa como función testeable aparte (p. ej.
`buildPageItems(safePage, totalPages, siblingCount)`), reutilizable y con test
unitario propio.

**Algoritmo `buildPageItems(current, totalPages, siblingCount)`:**

```
k        = max(0, siblingCount)
first    = 1
last     = totalPages
start    = clamp(current - k, first, last)
end      = clamp(current + k, first, last)

items = []
// primera siempre visible
push(1)
// hueco izquierdo: si entre 1 y start hay más de una página -> elipsis;
// si hay exactamente una página oculta (start === 3) -> se muestra el número 2.
if (start > first + 1) push('ellipsis-left')
else if (start === first + 1) push(first + 1)   // sin hueco real, muestra el número
// ventana central (excluyendo duplicados de first/last)
for (n = start; n <= end; n++) if (n !== first && n !== last) push(n)
// hueco derecho, simétrico
if (end < last - 1) push('ellipsis-right')
else if (end === last - 1) push(last - 1)
// última siempre visible (si totalPages > 1)
if (last > first) push(last)
// dedup defensivo por si k grande hace solaparse los rangos
return unique(items)
```

Reglas derivadas:

- **Primera (`1`) y última (`totalPages`) SIEMPRE presentes** mientras
  `totalPages > 1` (R26). Con `totalPages === 1` la lista es solo `[1]`.
- **Elipsis** solo cuando el hueco es de **más de una** página (R27). Si el hueco
  es de exactamente una página se muestra ese número (evita "1 … 2 3" cuando cabía
  "1 2 3"). La elipsis se renderiza como `<span aria-hidden="true">…</span>` (no
  `<button>`, sin foco, no emite eventos).
- Cada número es `<button type="button">` con `aria-label` (p. ej. "Ir a la
  página n"), `onClick -> onPageChange(n)` salvo que `n === safePage` (no-op) o
  falte `onChange`/esté `disabled`/vacío (R28, R30).
- El botón cuya `n === safePage` lleva `aria-current="page"`; los demás no lo
  llevan (R29). Test: `getByRole('button', { current: 'page' })` o
  `getByRole('button', { name }).getAttribute('aria-current')`.
- La ventana comparte el `disabled` global y el estado vacío con el resto de
  controles (R30 = R13/R23 aplicados a los numéricos).

Encaje en el contrato: la ventana **no añade props nuevas** salvo `siblingCount?`.
Todo el resto (page/pageSize/total/onPageChange/disabled) ya existe. Un contenedor
que no pase `siblingCount` obtiene exactamente el comportamiento previo
(retrocompatible, no rompe tests existentes).

## Cableado de `/ordenes` (server-side, R19–R25)

La vista `app/(app)/ordenes/page.tsx` (Client Component, `'use client'`) pasa a:

```
const [page, setPage] = useState(1);
const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

// Opciones firmes [10,25,50] acotadas por MAX_PAGE_SIZE de ordenesConfig (R33):
// se filtra cualquier opción que exceda el máximo del backend.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter((s) => s <= MAX_PAGE_SIZE);

const { data, error, isLoading } = useSWR(
  ["ordenes:list", page, pageSize],                 // key incluye page/pageSize (R21)
  () => ordenesFetcher(page, pageSize),
);

// ordenesFetcher(page, pageSize):
//   const res = await listarOrdenes({ page, pageSize });   // Server Action existente
//   if (res.status !== 'ok') throw new Error('list_failed');
//   return { items: res.items, total: res.total, pageSize: res.pageSize };

return (
  <section>
    <DataTable columns={ordenesColumns} data={data?.items ?? []} rowKey="id"
      ariaLabel="Órdenes" isLoading={isLoading}
      error={error ? "No se pudieron cargar las órdenes" : null}
      emptyMessage="No hay órdenes" />
    <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0}
      disabled={isLoading}
      showFirstLast                                   // R32: primera/última activos
      siblingCount={1}                                // R32: ventana numérica (±1) con elipsis
      onPageChange={setPage}                          // R21
      onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} // R22/R34 (vuelve a pág 1)
      pageSizeOptions={PAGE_SIZE_OPTIONS} />           // R33: [10,25,50] acotado por MAX_PAGE_SIZE
  </section>
);
```

Decisiones humanas fijadas (2026-07-09): server-side (R31), `showFirstLast`
activo (R32), `siblingCount={1}` para la ventana numérica (R32), selector
`[10,25,50]` acotado por `MAX_PAGE_SIZE` (R33) y reset a página 1 al cambiar el
tamaño (R34). Ya no hay puntos "sujetos a Q2".

- `total` viene del backend (R25); la UI no lo recalcula.
- El backend ya acota `pageSize` a `MAX_PAGE_SIZE` (transform en
  `listarOrdenesSchema`); la UI no reimplementa ese clamp (R22).
- La autorización por rol la sigue aplicando `listarOrdenes` con la cookie de
  sesión (R25). El navegador solo recibe los items ya autorizados.
- `disabled={isLoading}` evita dobles disparos durante la carga (R23).

## Modo client-side (hook `usePagination`, para reutilización)

Para listas pequeñas no sensibles que ya tienen todos los datos en cliente:

```ts
function usePagination<T>(items: T[], initialPageSize: number) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pagedItems = items.slice(start, start + pageSize);
  return { page: safePage, pageSize, total, pagedItems, setPage, setPageSize };
}
```

`pagedItems` → `DataTable.data`; `{page,pageSize,total,setPage,setPageSize}` →
`Pagination`. Mismo componente `Pagination`, distinto origen de datos. Confirma que
el componente es transport-agnostic.

## Alternativas descartadas

1. **Incrustar la paginación DENTRO de `DataTable` (props `page/pageSize/total/
   onPageChange` en `DataTableProps`).** DESCARTADA: contradice el requisito
   central de la feature ("paginación como componente SEPARADO, para componer").
   Acoplar paginación a la tabla obliga a que toda tabla arrastre estado de
   paginación aunque no lo use, complica el contrato ya cerrado de `DataTable`
   (feature 7) y rompe su naturaleza de "UI pura data-driven". Mantenerlos como
   hermanos componibles es más flexible (la paginación sirve para tablas, grids,
   listas de tarjetas, etc.).

2. **Paginación client-side como modo por defecto en `/ordenes` (traer todas las
   órdenes y segmentar en memoria).** DESCARTADA para `/ordenes`: las órdenes son
   datos potencialmente grandes y sensibles (PII, filtrados por rol); bajar todo
   al cliente para segmentar desperdicia el paginado que el backend YA ofrece
   (`listarOrdenes({page,pageSize})` con `total`) y expondría más datos de lo
   necesario. Se elige **server-side**. El modo client-side se conserva como
   capacidad reutilizable (`usePagination`) para otras listas pequeñas, no como
   default de órdenes.

3. **Instalar la primitiva `pagination` de shadcn/ui (`npx shadcn add
   pagination`) como base obligatoria.** DESCARTADA como requisito: la de shadcn
   es un conjunto de estilos sobre `<a>`/enlaces orientado a navegación por URL,
   no a un control controlado por callbacks con `disabled` semántico. Para cumplir
   R1–R18 basta `<nav>` + `<button>` reutilizando `components/ui/button.tsx`
   (ya existe) y un `<select>` nativo accesible. Se documenta la revisión de
   shadcn como exige `docs/architecture.md`; se puede adoptar estilos luego sin
   cambiar el contrato de props ni los tests (que afirman sobre roles/semántica).

4. **Sincronizar `page/pageSize` con la URL (querystring `?page=&pageSize=`) vía
   `useSearchParams`/`router`.** DESCARTADA en esta iteración: añade acoplamiento
   a `next/navigation` y superficie de test extra sin requisito que lo pida. El
   estado local (`useState`) cumple R20–R22. Se puede añadir después envolviendo
   la vista sin tocar el componente `Pagination` (que seguiría siendo controlado).
