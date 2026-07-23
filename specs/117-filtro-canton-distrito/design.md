# Feature 117 — Diseño técnico

> Frontend puro, sin backend. Todo el filtrado y la derivación de opciones ocurre en
> cliente sobre los `MiAsignacionDTO[]` que el Server Component padre ya entrega a
> `MisAsignacionesModule` (datos sensibles por props; sin fetch de cliente).

## 1. Modelo de datos y migraciones

**Ninguna.** No hay tablas, columnas, RLS ni migraciones. Los campos necesarios ya
existen en `MiAsignacionDTO`:

- `cantonNombre: string` — siempre presente.
- `distritoNombre: string | null` — puede faltar.

Fuente: `lib/interfaces/services/IMisAsignacionesService.ts:30-31`, poblados en
`lib/services/MisAsignacionesService.ts:407-408`. No se toca el service, el repo ni el
contrato del DTO.

## 2. Endpoints / rutas

**Ninguno.** No hay Server Actions nuevas ni route handlers. R12 exige filtrado 100%
en cliente. La página `app/(app)/mis-asignaciones/page.tsx` no cambia (sigue haciendo
el pre-fetch server-side y pasando las dos listas por props).

## 3. Lógica pura de derivación y filtrado (unit-testable sin React)

Nuevo módulo `lib/utils/filtro-canton-distrito.ts` con funciones puras (sin estado, sin
side effects), fáciles de testear en `tests/unit` y reutilizables:

```ts
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import { normalizeName } from "@/lib/utils/normalize";

export interface OpcionFiltro { value: string; label: string } // value = nombre original

/** R2/R13: cantones únicos (dedup por nombre normalizado), ordenados alfabéticamente. */
export function derivarCantones(ordenes: MiAsignacionDTO[]): OpcionFiltro[];

/** R4: distritos únicos (no nulos) del cantón dado, dedup + ordenados. */
export function derivarDistritos(
  ordenes: MiAsignacionDTO[],
  cantonNombre: string,
): OpcionFiltro[];

/** R6/R7: aplica el filtro combinado. canton==="" y distrito==="" = sin filtro. */
export function filtrarAsignaciones(
  ordenes: MiAsignacionDTO[],
  filtro: { canton: string; distrito: string },
): MiAsignacionDTO[];
```

Reglas de las funciones:

- **Dedup y orden.** Se agrupa por `normalizeName(nombre)` conservando el primer nombre
  visto como etiqueta; se ordena con `localeCompare("es", { sensitivity: "base" })`.
- **`derivarDistritos`** compara `cantonNombre` con `normalizeName` para tolerar
  diferencias de acento/caso, y omite `distritoNombre === null`.
- **`filtrarAsignaciones`**: si `canton === ""` devuelve la lista intacta (R7). Con
  cantón, compara por `normalizeName`. Con distrito, exige además
  `distritoNombre !== null` y coincidencia por `normalizeName` (R6).
- El `value` de cada opción es el **nombre original** (no normalizado), que es también
  el valor guardado en el estado del filtro; la comparación siempre re-normaliza.

## 4. Estado, encadenamiento y memoización (React)

Toda la orquestación de estado vive en un hook colocado
`app/(app)/mis-asignaciones/_components/useFiltroCantonDistrito.ts`:

- Estado: `const [canton, setCanton] = useState("")` y
  `const [distrito, setDistrito] = useState("")` (`""` = "todos", R7).
- `setCantonYReset(v)`: fija cantón y **resetea distrito a `""`** (R5).
- Opciones memoizadas con `useMemo`:
  - `cantones = useMemo(() => derivarCantones(union), [union])` (R2/R13; `union` es la
    concatenación `[...porRecoger, ...porGestionar]`, memoizada).
  - `distritos = useMemo(() => canton ? derivarDistritos(union, canton) : [], [union, canton])`
    (R3/R4).
- `hayFiltro = canton !== "" || distrito !== ""` (R9).
- `limpiar()`: `setCanton("")` + `setDistrito("")` (R8).
- Devuelve helpers de aplicación: `aplicar(lista)` = `filtrarAsignaciones(lista, { canton, distrito })`.

Presentación en un componente nuevo colocado
`app/(app)/mis-asignaciones/_components/FiltroCantonDistrito.tsx`:

- Dos `Select` (de `components/ui/select.tsx`) con `aria-label` "Filtrar por cantón" y
  "Filtrar por distrito" (rol `combobox`, testeable por nombre accesible como en el
  helper `elegirEnSelect` de `tests/components/MisAsignacionesModule.test.tsx:141`).
- Botón "Limpiar filtros" visible solo si `hayFiltro` (R9).
- **Opción "todos".** El `Select` de base-ui trata `value === ""` como placeholder, por lo
  que el estado "sin filtro" se representa con `""` y placeholders "Todos los cantones" /
  "Todos los distritos". Para poder **revertir a "todos" desde el dropdown** se antepone
  una opción con valor centinela `TODOS = "__todos__"`; el handler traduce
  `next === TODOS -> ""` (R8). El distrito va `disabled` cuando `canton === ""` (R3).

## 5. Integración en `MisAsignacionesModule.tsx` (EDIT)

Cambios mínimos y localizados:

1. Instanciar el hook con `porRecoger`/`porGestionar`.
2. Renderizar `<FiltroCantonDistrito ... />` cerca del tope del módulo (después del aviso
   de bloqueo, antes de "Por recoger"). Se agrupa en un `<section aria-label="Filtros">`.
3. Calcular listas visibles memoizadas:
   - `porRecogerVisible = aplicar(porRecoger)`.
   - `porGestionarVisible`: `aplicar(porGestionar)` y, si `ordenEnGestionId !== null` y la
     orden activa quedó fuera, **reinsertarla** preservando el orden (R10).
4. Sustituir las fuentes de render por las versiones visibles:
   - `PorAceptarSection ordenes={porRecogerVisible}` (con `vacio` condicional para R11).
   - El `.map` de las cards de "En reparto" itera `porGestionarVisible`.
   - `paradasMapa` y `detalleOrden` se derivan de `porGestionarVisible` en vez de
     `porGestionar` (R14) — mantiene coherencia panel/mapa/cards.
5. Mensaje "sin coincidencias" (R11): cuando `porGestionarVisible.length === 0` y
   `hayFiltro`, mostrar "No hay órdenes que coincidan con el filtro." en lugar de
   "No hay órdenes en reparto." Idéntico criterio para el `vacio` de "Por recoger".

No se cambia ninguna Server Action, ni la lógica de recoger/escoger/gestionar/liberar,
ni el contrato de props del módulo.

## 6. Interacción con otros filtros/buscador

- Hoy no existe buscador ni "modo foco" en el módulo (features 113/114 aún `pending`, sin
  spec). Este diseño deja el punto de composición claro: cuando la 114 aterrice, ambos
  filtros de cliente se componen aplicando `filtrarAsignaciones` y el filtro de texto en
  cadena (AND) sobre las mismas listas visibles. No se introduce dependencia dura.
- El filtro es puramente presentacional: no muta estado servidor, así que permanece
  disponible aun cuando `bloqueado === true` (las listas siguen visibles en modo lectura).

## 7. Accesibilidad y UX

- Selects con `aria-label`; el de distrito con `disabled` real cuando no hay cantón (R3).
- Orden alfabético estable (es, insensible a acentos) para no "saltar" opciones.
- "Limpiar filtros" como `Button variant="ghost"`; aparece/desaparece según `hayFiltro`.

## 8. Alternativas descartadas

**A. Filtrado server-side vía query params en la ruta.** Descartada: la descripción exige
"sin backend" y "filtro en cliente" (R12). Añadiría un round-trip de red y complejidad
(revalidación, `searchParams`, re-fetch) sin beneficio, dado que los DTOs ya están
cargados en el cliente. El volumen (asignaciones de UN mensajero) es pequeño y el filtrado
en memoria es instantáneo.

**B. Filtrar solo el grid de cards de "En reparto" y dejar el mapa y el panel de detalle
sobre el conjunto SIN filtrar.** Descartada: produce incoherencia visible (las cards
muestran un subconjunto pero el mapa dibuja paradas y el panel abre una orden que no está
en la lista filtrada). Se prefiere R14 (mapa/panel reflejan el conjunto filtrado) con la
salvaguarda R10 (la orden en gestión nunca desaparece), que mantiene un modelo mental
único: "veo lo que filtré".

**C. Representar "todos" con una opción de valor vacío dentro del `Select`.** Descartada:
la primitiva base-ui (`components/ui/select.tsx`) mapea `value === ""` a `null`
(placeholder), y sus `Item` requieren valor no vacío; una opción con `value=""` no sería
seleccionable de forma fiable. Se usa el centinela `"__todos__"` traducido a `""` en el
handler, más el placeholder como estado por defecto.
</content>
