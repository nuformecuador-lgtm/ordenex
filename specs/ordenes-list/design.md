# Diseño — ordenes - list (tabla genérica + página de órdenes)

## Enfoque general

Feature mayormente de **UI**, con un **ajuste menor del listado backend** de la
feature 6 (R25). No se toca `db/`, Prisma, migraciones, RLS, `app/api/` ni
`middleware.ts`. Se REUTILIZA el backend existente de la feature 6 (`listarOrdenes`
en `lib/actions/ordenes.ts`, que ya resuelve el actor de sesión y aplica la
autorización por rol R19–R24). Esta feature añade:

1. Un componente genérico y reutilizable `DataTable<T>` (data-driven, UI pura).
2. La página `/ordenes` que define columnas concretas de orden y monta la tabla
   con los datos del listado (SWR sobre la Server Action existente).
3. Una **ampliación mínima del listado** (`OrdenRepository.list` / `OrdenService.listar`
   / `OrdenDTO` o un DTO de listado) para incluir `tiendaNombre` (nombre del
   usuario tienda), sin tocar el resto del CRUD ni la autorización.

Stack idéntico al resto del repo: Next.js App Router, TypeScript strict, Tailwind
v4, primitivas de `components/ui/` (shadcn/ui sobre `@base-ui/react`), tests de
componente con Vitest + `@testing-library/react` en jsdom (patrón
`tests/components/`).

## Estructura de archivos

```
components/shared/
  DataTable.tsx         DataTable<T> genérico (client component). UI pura, sin dominio.
                        Props: columns: Column<T>[], data: T[], caption?, ariaLabel?,
                        isLoading?, error?, emptyMessage?, rowKey?  (ver contrato abajo)
app/(app)/ordenes/
  page.tsx              Reemplaza el placeholder. Client Component: SWR + DataTable.
  _components/
    ordenes-columns.tsx Definición de las 5 columnas concretas de OrdenDTO.
    useOrdenes.ts       (opcional) hook SWR que envuelve la Server Action listarOrdenes.
```

Decisiones cerradas por el humano (antes P1–P7):
- **P1:** columna sin `render` → celda por `row[column.id]`.
- **P2:** `rowKey` por defecto `row.id`; órdenes usan `OrdenDTO.id`.
- **P3:** 5 columnas exactas: `num_guia`, `num_remision`, `estatus`,
  `destinatario`, `tienda`.
- **P4:** carga con **SWR en cliente**, fetcher = Server Action `listarOrdenes`.
- **P5:** sin paginación/orden/filtros en la UI.
- **P6:** sin acciones por fila.
- **P7:** `components/shared/DataTable.tsx`.

`DataTable` va a `components/shared/DataTable.tsx` porque es explícitamente
**genérico y reutilizable** entre features — es incluso el ejemplo nombrado en
`docs/architecture.md` (`components/shared/ (DataTable...)`). La definición de
columnas de orden vive junto a la página (`_components/`), no en `shared/`, porque
es específica del dominio orden (regla "sin sobre-ingeniería").

## Contrato del tipo `Column<T>` y props (R1–R4)

```ts
import type { ReactNode } from "react";

export interface Column<T> {
  /** Identificador único de columna. También clave de acceso por defecto (P1). */
  id: string;
  /** Etiqueta de cabecera mostrada en el <th scope="col">. */
  value: string;
  /**
   * Cómo renderizar la celda:
   *  - función (row) => ReactNode: componente/contenido custom (R6)
   *  - string: clave de acceso al dato de la fila, row[render] (R7)
   *  - undefined: valor por la clave por defecto (column.id), row[id] (R8, P1)
   */
  render?: ((row: T) => ReactNode) | keyof T | string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  /** Origen de la key de fila (P2). Por defecto intenta (row as {id?}).id o índice. */
  rowKey?: keyof T | ((row: T) => string);
  caption?: string;      // R14 -> <caption>
  ariaLabel?: string;    // R16 nombre accesible si no hay caption
  isLoading?: boolean;   // R12
  error?: string | null; // R13
  emptyMessage?: string; // R11 (default "No hay registros")
}
```

**Resolución de celda (única función pura, R6–R8):**

```
resolveCell(column, row):
  if typeof column.render === 'function' -> column.render(row)          // R6
  else if typeof column.render === 'string' -> row[column.render]        // R7
  else -> row[column.id]                                                 // R8 (default, P1)
  (si el valor es null/undefined -> render vacío, sin throw)
```

Nota de tipado: `render` admite `keyof T | string`. Al leer `row[key]` con una
clave `string` arbitraria se accede de forma indexada; el valor se coacciona a
`ReactNode` para su render (si es objeto no-nodo se renderiza vacío/`String(...)`,
decisión menor a fijar en implementación, sin `any` cruzando el borde público).

## Render de tabla (R5, R9, R10, R15, R16)

- `<table>` con `<caption>` (si `caption`) + `<thead><tr>` de `<th scope="col">`
  (uno por columna, texto = `value`, en orden) + `<tbody>` con un `<tr>` por fila.
- Cada `<tr>` de datos usa `key` derivada de `rowKey` (P2); cada `<td>` renderiza
  `resolveCell(column, row)`.
- Nombre accesible: `caption` o `aria-label={ariaLabel}` para que
  `getByRole('table', { name })` funcione en tests.
- Se puede envolver con las primitivas de `table` de shadcn si se instalan (ver
  alternativa descartada), pero el marcado semántico (`table/thead/tbody/th/td`)
  es el mismo y es lo que se testea.

## Estados (R11–R14)

- **Vacío (R11):** `data.length === 0` y no `isLoading`/`error` → una fila
  `<tr><td colSpan={columns.length}>{emptyMessage}</td></tr>` (o mensaje
  accesible), manteniendo la cabecera.
- **Carga (R12):** `isLoading` → fila/indicador de carga (`role="status"` o texto
  "Cargando…") distinguible del vacío.
- **Error (R13):** `error` truthy → mensaje de error accesible (`role="alert"` o
  `Alert` de `components/ui/alert.tsx`) en lugar de los datos, sin internals.
- Precedencia sugerida: `error` > `isLoading` > `vacío` > datos.

## Página `/ordenes` — obtención de datos con SWR (R17–R24)

**Decisión CERRADA (P4):** la página es un **Client Component** (`'use client'`)
que usa **SWR** para obtener el listado. El `fetcher` de SWR invoca la **Server
Action existente** `listarOrdenes` de la feature 6 **directamente desde el
cliente** (las Server Actions son invocables desde componentes cliente como
funciones async; Next serializa la llamada al servidor). NO se crea ningún API
route ni se toca backend/DB. La autorización por rol la sigue aplicando
`listarOrdenes` con la cookie de sesión del request (R22).

`listarOrdenes` devuelve un **resultado discriminado** (no lanza en errores de
dominio): el fetcher lo normaliza para que SWR distinga carga/datos/error:
- Si `res.status === 'ok'` → devuelve `res.items` (SWR pasa a `data`).
- Si `res.status !== 'ok'` → el fetcher **lanza** un Error con un mensaje genérico
  (SWR pasa a `error`), sin filtrar internals (R21).
- Un throw real del transporte (red) también cae en `error` de SWR.

Flujo:

```
app/(app)/ordenes/page.tsx  ('use client')
  const { data, error, isLoading } = useSWR('ordenes:list', ordenesFetcher);
  return (
    <DataTable
       columns={ordenesColumns}          // 5 columnas de OrdenDTO (R24)
       data={data ?? []}
       rowKey="id"                        // OrdenDTO.id (R10, P2)
       ariaLabel="Órdenes"
       isLoading={isLoading}              // R20 -> estado carga (R12)
       error={error ? "No se pudieron cargar las órdenes" : null} // R21 -> estado error (R13)
       emptyMessage="No hay órdenes"      // R20 -> estado vacío (R11)
    />
  );

// ordenesFetcher (cliente): llama a la Server Action existente
async function ordenesFetcher(): Promise<OrdenListItemDTO[]> {
  const res = await listarOrdenes({});   // sin controles de paginación/orden en UI (R23)
  if (res.status !== 'ok') throw new Error('list_failed'); // -> SWR error, sin internals
  return res.items;                       // items incluyen tiendaNombre (R25/R26)
}
```

- La tabla genérica NO importa nada de `orden`; recibe `Column<OrdenListItemDTO>[]`
  y `OrdenListItemDTO[]` desde la página. Reutilizable = otra feature podría pasar
  sus propias `Column<X>[]` y `X[]`.
- La página NO expone controles de paginación/orden/filtros ni acciones por fila
  (R23); `listarOrdenes({})` usa los defaults del backend (page 1, `created_at desc`).

### Columnas concretas de orden (`ordenes-columns.tsx`, R24)

`Column<OrdenListItemDTO>[]` con exactamente 5 columnas, en orden. Se ejercita el
contrato genérico completo (render función / render string / sin render):

| `id`          | `value`        | `render`                                  | Caso genérico |
| ------------- | -------------- | ----------------------------------------- | ------------- |
| `numGuia`     | "Nº Guía"      | ausente → `row.numGuia`                   | sin render (R8) |
| `numRemision` | "Nº Remisión"  | `"numRemision"` (string/clave)            | render string (R7) |
| `estatus`     | "Estatus"      | `(row) => row.estatusValue ?? row.estatusId` | render función (R6) |
| `destinatario`| "Destinatario" | ausente → `row.destinatario`              | sin render (R8) |
| `tienda`      | "Tienda"       | `(row) => row.tiendaNombre` (nombre legible, R24/R25) | render función (R6) |

Notas:
- `estatus` usa función porque su `id` (`estatus`) no coincide con ningún campo del
  DTO (`estatusValue`/`estatusId`); la función resuelve el dato legible (R6).
- `tienda` usa función porque `id=tienda` no es campo del DTO; muestra
  `row.tiendaNombre` (nombre legible del usuario tienda), NO el uuid `tiendaId`
  (R24). `tiendaNombre` lo provee el listado ampliado (R25).
- `numGuia`/`destinatario` sin `render`: leen por `column.id` = campo del DTO (R8).
- `numRemision` con `render:"numRemision"`: ejercita render-string (R7); coincide
  con la clave a propósito para probar ese camino del contrato.

## Ampliación del listado backend — `tiendaNombre` (R25/R26)

Cambio **leve y acotado** al backend de la feature 6 (NO a esta UI). La relación
`Orden.tienda → Usuario` ya existe en el esquema Prisma (feature 6), por lo que es
un `select`/`include` adicional, sin migración, sin modelo nuevo, sin RLS nueva.

Archivos afectados de la feature 6 (frontera backend, capa por capa):

- `lib/repositories/OrdenRepository.ts` — método `list(...)`: en la query Prisma
  del listado, incluir el nombre de la tienda, p. ej.
  `include: { tienda: { select: { nombre: true } } }` (o `select` equivalente), y
  mapear al resultado `tiendaNombre = row.tienda.nombre`. Solo el listado; no se
  altera `findById`/`create`/`update`/`softDelete`.
- `lib/types/orden.ts` — el elemento de listado expone `tiendaNombre: string`. Dos
  opciones (a decidir en implementación, sin impacto en la UI que solo lee
  `tiendaNombre`):
  - (a) añadir `tiendaNombre` a `OrdenDTO` como opcional, o
  - (b) introducir un `OrdenListItemDTO extends`/deriva de `OrdenDTO` con
    `tiendaNombre: string` y tipar `ListarOrdenesResult.items: OrdenListItemDTO[]`.
    **Preferida (b)**: mantiene `OrdenDTO` (crear/obtener) sin cambiar y expresa que
    el nombre de tienda es específico del listado (evita joins innecesarios en
    obtener/crear).
- `lib/services/OrdenService.ts` — `listar(...)`: sigue aplicando la autorización y
  el `where` por rol EXACTAMENTE igual (adminTienda solo las suyas, etc.);
  simplemente propaga los items ya enriquecidos por el repo. Sin cambios de
  autorización (R22 intacto).
- `lib/interfaces/repositories/IOrdenRepository.ts` — ajustar el tipo de retorno de
  `list` para incluir `tiendaNombre` (coherencia de interfaz).

Contrato resultante del listado:

```ts
type OrdenListItemDTO = OrdenDTO & { tiendaNombre: string };
type ListarOrdenesResult =
  | { status: 'ok'; items: OrdenListItemDTO[]; page; pageSize; total }
  | ActionError;
```

Regla mantenida: `num_guia` crudo, PII solo para consumidor autorizado, sin exponer
`deletedAt`. `tiendaNombre` es el `nombre` del usuario tienda (no email/uuid).

## Testabilidad (jsdom)

- La `Server Action` `listarOrdenes` se mockea en los tests de la página
  (`vi.mock("@/lib/actions/ordenes", ...)`) devolviendo `{status:'ok', items:[...]}`
  o un estado de error, para afirmar el render de SWR (carga/datos/vacío/error) sin
  DB ni sesión. SWR se usa con `SWRConfig` de `provider: () => new Map()` (cache
  aislada por test) o `dedupingInterval: 0` para evitar cache compartida entre tests.
- Los tests de `DataTable` son de UI pura: se le pasan columnas y datos de un tipo
  de prueba `type Row = { id; nombre; ... }`, se verifican `th`/`td`/render
  función/string/default/estados con `getByRole('table')`, `getAllByRole('row')`,
  `columnheader`, `cell`.
- Nada depende de media queries (jsdom no evalúa layout).

## Alternativas descartadas

1. **Instalar y usar el componente `table` de shadcn/ui
   (`npx shadcn add table`) como base obligatoria del `DataTable`.** Descartada
   como requisito. Hoy `components/ui/` solo tiene `button/input/label/card/alert`;
   el `table` de shadcn es únicamente un wrapper de estilos sobre `<table>` nativo.
   Para cumplir R1–R16 basta el marcado semántico `<table>` con clases Tailwind;
   añadir la primitiva ahora es superficie extra sin requisito que la justifique
   ("sin sobre-ingeniería"). Se puede adoptar luego para estilos sin cambiar el
   contrato de props ni los tests (que afirman sobre roles/semántica, no clases).
   Se documenta la revisión de shadcn como exige `docs/architecture.md`.

2. **Página `/ordenes` como Server Component con pre-fetch de `listarOrdenes` y
   paso de `items` por props (sin SWR).** Era la opción recomendada por PII, pero
   el humano DECIDIÓ SWR en cliente (P4). Se documenta como descartada: el fetcher
   de SWR consume la **misma Server Action** existente `listarOrdenes` desde el
   cliente (no un API route), por lo que la autorización por rol y la lectura de
   sesión siguen ejecutándose en el servidor dentro de la action; el navegador solo
   recibe el `OrdenDTO[]` ya autorizado. La opción Server Component sigue siendo
   válida técnicamente, pero SWR aporta estados carga/error/revalidación en el
   cliente sin controles extra. El `DataTable` es idéntico en ambos casos (recibe
   `data` por props); solo cambia quién orquesta la obtención.

3. **Tabla NO genérica, acoplada a órdenes (`OrdenesTable` que conoce `OrdenDTO`
   y hardcodea columnas).** Descartada: contradice el requisito central de la
   feature ("tabla reutilizable que recibe la data normalizada con id/value/render").
   La genericidad `DataTable<T>` con `Column<T>` es el entregable; el acoplamiento
   a orden vive solo en la definición de columnas de la página.

4. **`render` que recibe `(value, row)` en vez de `(row)`.** Descartada por ahora:
   la descripción indica "render(función que renderiza la información)"; pasar la
   fila completa `(row) => ReactNode` es más general (la función puede leer
   cualquier campo). Se puede ampliar la firma después sin romper llamadas
   existentes si se añade un segundo argumento opcional.
