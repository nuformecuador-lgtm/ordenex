# Feature 114 — Mensajero: buscador de guías asignadas — design

> **Sin backend.** No hay tabla, RLS, migración, endpoint ni Server Action nueva.
> No hay contrato de red. Todo es cliente: estado de UI + una función pura de
> filtrado sobre `MiAsignacionDTO[]` que ya llega por props. Por eso este diseño se
> centra en dónde vive el estado, la función de normalización/matching y la
> memoización, más las alternativas descartadas.

## Modelo de datos

No aplica. La feature no toca Postgres/Prisma/Supabase. Los campos que se filtran
(`numGuia`, `numRemision`, `destinatario`) ya existen en
`MiAsignacionDTO` (`lib/interfaces/services/IMisAsignacionesService.ts:12-16`) y ya
se pasan al módulo por props desde el Server Component
(`app/(app)/mis-asignaciones/page.tsx`). No se modifica el DTO ni el servicio.

## Rutas / endpoints / contratos I/O

Ninguno nuevo. La página `app/(app)/mis-asignaciones/page.tsx` y las Server Actions
existentes quedan intactas. El único "contrato" es el de la función pura interna
(ver §Función de normalización/matching), consumida solo por el propio módulo.

## Decisiones

### 1. Dónde vive el estado del query

Estado local en `MisAsignacionesModule` (ya es `"use client"`):

```ts
const [query, setQuery] = useState("");
```

- No se sube a URL/searchParams ni a contexto: es estado de UI efímero, de un solo
  consumidor. Subirlo sería sobre-ingeniería (`docs/architecture.md §Regla: sin
  sobre-ingeniería`).
- El input se renderiza al inicio del `return`, en su propia `<section>` con
  `aria-label`, por ENCIMA de las secciones "Por recoger" y "En reparto". Se usa la
  primitiva `components/ui/input.tsx` con `type="search"` (rol accesible `searchbox`)
  y un `<label>` "Buscar guías" (patrón de `InputRecoger.tsx`, que usa `useId` +
  `<label htmlFor>`).

### 2. Función de normalización / matching (helper puro, testeable sin DOM)

Se crea un helper colocado **sin lógica de negocio de dominio**, solo comparación de
texto: `app/(app)/mis-asignaciones/_components/mis-asignaciones-buscador.ts`.

Reutiliza el normalizador ya existente `normalizeName` (`lib/utils/normalize.ts:7`)
para NO duplicar la lógica de NFD + strip de diacríticos + `toLowerCase` + `trim` +
colapso de espacios. Contrato:

```ts
import { normalizeName } from "@/lib/utils/normalize";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

/** Texto normalizado buscable de una guía: numGuia (num→texto, null→""), numRemision y destinatario. */
export function textoBuscable(orden: MiAsignacionDTO): string {
  const guia = orden.numGuia === null ? "" : String(orden.numGuia);
  return normalizeName(`${guia} ${orden.numRemision} ${orden.destinatario}`);
}

/** `true` si el query normalizado es subcadena del texto buscable de la orden. */
export function coincideBusqueda(orden: MiAsignacionDTO, queryNormalizado: string): boolean {
  if (queryNormalizado === "") return true; // R5: query vacío ⇒ todo coincide
  return textoBuscable(orden).includes(queryNormalizado);
}

/** Filtra una lista con un query crudo (aún sin normalizar). Preserva el orden de entrada. */
export function filtrarAsignaciones(
  ordenes: MiAsignacionDTO[],
  query: string,
): MiAsignacionDTO[] {
  const q = normalizeName(query); // trim + colapso ⇒ "  " se vuelve "" (R5)
  if (q === "") return ordenes; // R5: sin filtrar (misma referencia posible)
  return ordenes.filter((o) => coincideBusqueda(o, q));
}
```

Notas de contrato:
- **R3 (parcial + insensible a mayúsculas/acentos):** se normaliza IGUAL el query y
  el texto de cada campo; la coincidencia es `String.prototype.includes` (subcadena).
- **R4 (numGuia):** `null` ⇒ se aporta `""` (no coincide por guía, pero no rompe la
  coincidencia por `numRemision`/`destinatario`); numérico ⇒ `String(numGuia)`
  (subcadena, ej. `10` ∈ `1001`).
- **R5 (query vacío/solo-espacios):** `normalizeName("   ")` ⇒ `""` ⇒ retorna la lista
  sin filtrar. Cubre "muestra todo".
- **R7:** la función se aplica por separado a `porRecoger` y a `porGestionar`; no hay
  cruce de grupos.
- Concatenar los tres campos en un solo `textoBuscable` es equivalente a OR entre los
  tres para subcadenas que no cruzan el separador (se usa un espacio como separador y
  `numGuia` no contiene espacios); mantiene el matcher O(1) por orden y trivial de testear.

### 3. Memoización

En el módulo, dos `useMemo` derivan las listas filtradas (patrón ya usado ahí para
`paradasMapa` y `detalleOrden`):

```ts
const porRecogerFiltrado = useMemo(
  () => filtrarAsignaciones(porRecoger, query),
  [porRecoger, query],
);
const porGestionarFiltrado = useMemo(
  () => filtrarAsignaciones(porGestionar, query),
  [porGestionar, query],
);
```

- Se recomputan solo al cambiar la lista fuente o el `query`.
- `paradasMapa`, `detalleOrden` y toda la lógica de puntero/bloqueo siguen
  dependiendo de los arrays **SIN filtrar** (`porGestionar`/`porRecoger`). Esto
  materializa **R8**: la búsqueda solo cambia lo que se lista.

### 4. Render de cada grupo (scope R8)

- **Por recoger:** se pasa `ordenes={porRecogerFiltrado}` a `PorAceptarSection`
  (hoy `MisAsignacionesModule.tsx:214`). El componente compartido NO se modifica. El
  mensaje de vacío se vuelve dependiente del query para cubrir **R6**:
  `vacio={query.trim() ? "Ninguna guía por recoger coincide con la búsqueda." : "No hay órdenes por recoger."}`.
- **En reparto:** la grilla usa `porGestionarFiltrado.map(...)` en lugar de
  `porGestionar.map(...)` (hoy `:296`). El mensaje inline de vacío
  (hoy "No hay órdenes en reparto." en `:291-294`) pasa a ser dependiente del query:
  con query activo y sin coincidencias muestra
  "Ninguna guía en reparto coincide con la búsqueda." (**R6**).
- El panel de detalle (`GestionarOrdenPanel`) y el mapa (`RutaMapa`) NO cambian su
  fuente de datos: siguen sobre `detalleOrden`/`paradasMapa` derivados del array
  completo (**R8**).

### 5. i18n / textos

Textos en español, extraídos como constantes junto al módulo (patrón `BLOQUEO_AVISO`
en `MisAsignacionesModule.tsx:59`). Nada de la sigla "SLA" ni jerga; lenguaje claro
(memoria del proyecto).

## Alternativas descartadas

### A. Filtrar TAMBIÉN el mapa de ruta y el panel de detalle (descartada)

Se consideró que la búsqueda redujera `paradasMapa` y forzara `detalleOrden` a una
orden coincidente.
**Rechazada** porque: (1) rompe el invariante "siempre hay una orden en el panel
mientras haya órdenes en reparto" y podría chocar con el puntero de bloqueo 1-a-1
(`ordenEnGestionId`), reabriendo un flujo ya cerrado (features 36/98/111); (2) la ruta
optimizada es un recorrido completo — recortarlo por un texto de búsqueda confunde más
de lo que ayuda; (3) amplía el riesgo y el alcance de una feature declarada `low` y
"buscador de listas". El buscador filtra LISTAS, no el estado de gestión ni el mapa (R8).

### B. Crear un `SearchInput` compartido o dar capacidad de búsqueda a `PorAceptarSection` (descartada)

Se consideró un componente de búsqueda reutilizable en `components/shared/` o meter la
lógica de filtrado dentro del componente compartido `PorAceptarSection`.
**Rechazada** por `docs/architecture.md §Regla: sin sobre-ingeniería`: el buscador se
usa en UN solo lugar y no hay una segunda feature que lo necesite con la misma API.
Además, tocar `PorAceptarSection` (compartido por mensajero y adminSatelite, feature
63) arriesga regresiones y conflictos de paralelismo fuera del alcance de la 114. Se
mantiene el estado y el input inline en el módulo, y se reutiliza `normalizeName` (ya
existente) en vez de inventar un normalizador nuevo.

## Verificación

- `tests/unit/components/mis-asignaciones-buscador.test.ts` — función pura (R3, R4, R5)
  sin jsdom.
- `tests/components/MisAsignacionesModule.test.tsx` — render/interacción (R1, R2, R5,
  R6, R7, R8) con Testing Library, en el mismo estilo ya existente en ese archivo.
- `./init.sh` en verde + suite de tests.
