# Feature 144 — Filtros de órdenes (zona, tienda, geografía y tiempo) · design.md

> Decisiones técnicas ANTES de código. **Puerta F1.4 cerrada por el humano el
> 2026-07-28** (§0).
>
> La feature entrega **dos piezas**: **(A)** un componente de filtros **genérico y
> parametrizable** (`FilterComponent`), sin dominio, reutilizable por cualquier
> consumidor y cualquier transporte; y **(B)** el **cableado en órdenes**, único
> consumidor implementado ahora.

---

## 0. Decisiones cerradas (gate F1.4, 2026-07-28)

| # | Pregunta | Decisión del humano | Consecuencia de diseño |
| --- | --- | --- | --- |
| (a) | Filtro de tiempo: presets vs. rango | **LAS DOS.** Presets **y** rango abierto desde/hasta. Cálculo server-side; bordes: `desde` = 00:00 CR (06:00 UTC de ese día), `hasta` **inclusive** (< 06:00 UTC del día+1) | Dos filtros declarados en B (§4.1); tipo `dateRange` entra en A (§A.3); tres claves nuevas en el `filter` (§2.1); regla de precedencia (§2.5) |
| (b) | Zona: columna propia vs. derivada | **`orden.zona_id`** | `WHERE zona_id IN (...)` directo, sin JOIN (§2.2) |
| (c) | Vía del precargado | **`Promise.all` al cargar la página** → Server Component resuelve en paralelo y baja por props | Se descarta la Server Action + SWR que yo recomendaba (§3.4); ~70 KB en el RSC payload = **coste aceptado a sabiendas** (§3.2) |
| (d) | Opciones de tienda | **Todas** las cuentas dueñas posibles | Sin `SELECT DISTINCT` sobre `orden` (§3.3) |
| (e) | Tiendas inactivas | **Se incluyen**, marcadas en la etiqueta | `listCuentasTienda()` no filtra por `estado`; el label lleva sufijo (§3.3) |
| (f) | Distrito NULL | **Quedan fuera, sin opción "sin distrito"**. El humano afirma que no deberían existir NULLs | Semántica `IN (...)` intacta; **la columna SÍ es nullable hoy** → riesgo anotado (§8.6) |
| (g) | Persistencia de la selección | **Se pierde al recargar**, sin `sessionStorage` | Sin trabajo adicional |
| (h) | Cuentas apiKey en el select de tienda | **Separadas por grupo** | `group?: string` en la opción; agrupado **genérico en A** e implementado dentro de `MultiSelectFilter` (§A.6) |
| (i) | Limpiar | **Las dos:** "Limpiar todo" **y** limpiar individual | `showClearAll` en A + limpieza propia del `dateRange` (§A.5) |
| (j) | Estado del componente | **No controlado** (interno) + `onChange` | El consumidor no puede vaciar A desde fuera → fundamenta la precedencia de (§2.5) |
| (k) | Tipos de filtro en v1 | **`multi`, `single`, `dateRange`** | `FilterKind` de tres valores (§A.3) |
| (l) | Forma del payload | **`Record<string, string[]>`**, claves vacías omitidas | El `dateRange` encaja como lista de 2 posiciones (§A.4) |
| (m) | ¿Varios padres por filtro? | **Un solo padre** | `dependsOn?: string` (§A.7) |
| (n) | Ubicación del componente | **`components/shared/`**, con la 145 como segundo consumidor | Excepción documentada a la regla de las dos superficies (§A.1) |

---

# Parte A — `FilterComponent` (genérico, sin dominio)

## A.1 Qué es, qué no es y dónde vive

| | `MultiSelectFilter` (ya existe) | `FilterComponent` (esta feature) |
| --- | --- | --- |
| Alcance | **un** control | **N** controles |
| Estado | controlado por el padre | dueño del **estado agregado**, no controlado (decisión (j)) |
| Sabe de | nada | nada (tampoco de órdenes) |
| Emite | `string[]` de un filtro | selección agregada de todos los filtros |

`FilterComponent` **no** hace fetch (R4), **no** conoce claves ni entidades del dominio
(R5), **no** construye el objeto de ninguna API (R18).

**Ubicación: `components/shared/FilterComponent.tsx` (decisión (n)).**
`docs/architecture.md` pide DOS consumidores con la misma API antes de promover a
`shared/`, y hoy hay uno. **Excepción aprobada por el humano en F1.4**, justificada así:
(i) el humano pidió explícitamente que el componente naciera genérico y reutilizable;
(ii) la feature **145** ("rollout de búsqueda/filtros/export a todas las tablas") ya
existe en `feature_list.json` con `depends_on: 144` y es su segundo consumidor
declarado; (iii) nacer en `_components/` de órdenes obligaría a reescribir imports en la
145 sin ganancia. **Reviewer: esto NO es un hallazgo.**

## A.2 Ficheros de A

```
components/shared/FilterComponent.tsx      ← orquestador (nuevo)
components/shared/DateRangeFilter.tsx      ← control de rango (nuevo, §A.5)
components/shared/MultiSelectFilter.tsx    ← EXISTENTE, se le añade `group` (§A.6)
lib/utils/filter-dependencies.ts           ← motor de dependencias, puro (nuevo)
```

## A.3 Contrato de props

```ts
/** Tipos soportados en v1 (decisión (k)). */
export type FilterKind = "multi" | "single" | "dateRange";

export interface FilterOption {
  /** Valor emitido tal cual (R5). Normalmente un id. */
  value: string;
  /** Texto visible y texto sobre el que busca el buscador interno. */
  label: string;
  /**
   * Valor del filtro PADRE al que pertenece esta opción. Solo lo leen los filtros
   * que declaran `dependsOn` (R21/R22). El componente NO sabe qué significa.
   */
  parentValue?: string;
  /**
   * Grupo al que pertenece la opción (decisión (h), R26). Puro contrato de opciones:
   * el componente no sabe qué es un grupo más allá de una cabecera con nombre.
   */
  group?: string;
}

export interface FilterDef {
  key: string;                 // clave en la salida (R2)
  label: string;
  kind: FilterKind;
  /** Obligatorio en "multi"/"single"; ignorado en "dateRange". */
  options?: FilterOption[];
  dependsOn?: string;          // un solo padre (decisión (m))
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
}

/** Salida agnóstica y uniforme (R14/R16/R17/R18, decisión (l)). */
export type FilterSelection = Record<string, string[]>;

export interface FilterComponentProps {
  filters: FilterDef[];
  onChange: (selection: FilterSelection) => void;
  /** Muestra la acción "Limpiar todo" (decisión (i), R20). Default: false. */
  showClearAll?: boolean;
  disabled?: boolean;          // R13
  className?: string;
}
```

## A.4 Forma de la salida, incluido el borde del `dateRange`

`FilterSelection` es `Record<string, string[]>` **para los tres tipos** (decisión (l)),
con esta convención, que es el punto donde una forma uniforme podría romperse y por eso
queda fijada sin ambigüedad y trazada a test (R17):

| `kind` | Qué emite | Ejemplos |
| --- | --- | --- |
| `multi` | N valores de catálogo | `{ zona_id: ["z1","z2"] }` |
| `single` | exactamente 1 valor | `{ created_preset: ["30d"] }` |
| `dateRange` | **exactamente 2 posiciones** `[inicial, final]`, `""` en el extremo no fijado | `{ created_range: ["2026-07-01","2026-07-28"] }`, `{ created_range: ["2026-07-01",""] }`, `{ created_range: ["","2026-07-28"] }` |

Reglas duras:

- **Clave omitida** si el filtro no tiene selección (R16). Para `dateRange`, "sin
  selección" = **ambos** extremos vacíos; nunca se emite `["",""]`.
- **La posición es el significado**: índice 0 = inicial, índice 1 = final. Nunca se
  compacta la lista quitando el extremo vacío (eso volvería ambiguo `["2026-07-01"]`).
- El componente **no interpreta** las fechas más allá de la comparación de orden (R10):
  no las convierte a instantes, no aplica husos, no las normaliza. Eso es server-side
  (decisión (a), §2.4).
- Los valores del `dateRange` son los únicos que **no** son ids de catálogo. El
  componente no lo nota: para él son cadenas (R5).

## A.5 Control de rango de fechas — **sin dependencias nuevas** (recomendado)

El humano dijo «usá el dateRange de shadcn». Verificado contra el repo, ese camino **no
es gratis**:

- `components/ui/` **no** tiene `calendar`, `popover` ni `command`.
- El date-range de shadcn = `Calendar` (que es **`react-day-picker`**) + `Popover` (que
  en shadcn es **`@radix-ui/react-popover`**).
- `package.json` **no tiene ni un solo paquete de Radix**: las primitivas de este repo
  se construyeron sobre **`@base-ui/react` ^1.6.0** (`components/ui/select.tsx`,
  `dialog.tsx`). Traer Radix metería una **segunda librería de primitivas** conviviendo
  con Base UI: drift de foco/portales/estilos y peso extra, para un solo control.
- El repo ya tiene un patrón vigente y probado para fechas: **`<Input type="date">`**, en
  6 componentes, incluido `app/(app)/wallet/_components/WalletFiltros.tsx`, que ya
  implementa un **desde/hasta** con dos inputs nativos y un botón "Limpiar".

**Recomendación (y decisión de diseño): construir `DateRangeFilter` con dos
`<Input type="date">`** + botón "Limpiar" propio, reusando `components/ui/input.tsx` y
`components/ui/label.tsx`. **Dependencias nuevas: NINGUNA.** Se obtiene el calendario
nativo del sistema operativo (accesible, localizado, táctil en móvil), formato
`YYYY-MM-DD` ya normalizado por el navegador, y `onChange` que dispara al **completar**
la fecha, no por tecla (satisface el espíritu de R15).

Si el humano exige el calendario visual de shadcn pese a lo anterior, el camino de menor
daño es: **`react-day-picker` (1 dependencia)** dentro de un panel propio construido con
el mismo patrón de `MultiSelectFilter` (que ya resuelve clic-fuera + `Escape` sin
ninguna primitiva) — **y explícitamente NO** `@radix-ui/react-popover`. Eso es una task
extra y se decide antes de TA.4; no es lo que este spec presupuesta.

Limpieza individual (decisión (i), R19): el `DateRangeFilter` tiene su propio botón
"Limpiar" que vacía ambos extremos y emite. Validación: si inicial > final, el control
se marca `aria-invalid` con mensaje y **no** emite esa combinación (R10).

## A.6 Agrupado de opciones (decisión (h)) — **capacidad genérica de A**

**Es genérico, no del filtro de tienda.** Es puro contrato de opciones (`group?: string`),
así que cualquier filtro de cualquier consumidor puede agrupar sin que A sepa de qué.

Se implementa **dentro de `MultiSelectFilter`** (es el único que renderiza una lista de
opciones): si alguna opción trae `group`, la lista se parte en secciones preservando el
orden de aparición de los grupos; si ninguna lo trae, se renderiza plana **exactamente
como hoy** (R26 y sin regresión para el filtro de estado de la 63).

ARIA: `listbox > group > option` es una composición válida. La estructura pasa de

```html
<ul role="listbox"> <li><button role="option" …>…</button></li> … </ul>
```

a, cuando hay grupos:

```html
<ul role="listbox" aria-multiselectable>
  <li role="group" aria-label="Cuentas tienda">
    <div aria-hidden>Cuentas tienda</div>          <!-- cabecera visual -->
    <ul> <li><button role="option" aria-selected=…>…</button></li> … </ul>
  </li>
  <li role="group" aria-label="Integraciones (API)"> … </li>
</ul>
```

Los `role="option"` y sus `aria-selected` **no cambian**, así que los tests existentes de
`MultiSelectFilter` y del filtro de estado siguen verdes (R63).

## A.7 Contrato de dependencias entre filtros

**Declaración:** un filtro declara `dependsOn: "<key de otro filtro>"` (un solo padre,
decisión (m)), y cada opción suya trae `parentValue` = el valor del padre al que
pertenece.

**Resolución** (`lib/utils/filter-dependencies.ts`, funciones puras sin React):

```ts
opcionesVisibles(filters, selection, key): FilterOption[]
seleccionEfectiva(filters, selection, key): Set<string>
podarSeleccion(filters, selection): FilterSelection
```

Regla de `opcionesVisibles(key)`:

1. Sin `dependsOn`, o con padre no declarado (R25) → **todas** sus opciones.
2. Con `dependsOn: P` → las opciones cuyo `parentValue` ∈ `seleccionEfectiva(P)`.

`seleccionEfectiva(P)` = selección de P si no está vacía; si está vacía, **todos sus
valores visibles** (recursivo). Eso es lo que hace funcionar "provincia marcada, cantón
sin marcar": el efectivo del cantón son *sus* opciones visibles (ya acotadas por la
provincia), así que los distritos salen acotados sin que A sepa qué es una provincia
(R22, R23). Profundidad arbitraria; ciclos cortados con un `Set` de visitados (un ciclo
se trata como "sin padre", igual que R25). Los filtros `dateRange` no participan en
dependencias (no tienen opciones).

**Poda:** tras cada cambio se aplica `podarSeleccion` **antes** de llamar a `onChange`,
en orden topológico (padres antes que hijos), de modo que lo emitido nunca contenga un
hijo huérfano (R24). Es la regla frente a "conservar la selección oculta": un valor
seleccionado pero invisible produce resultados inexplicables — el problema que el humano
señaló.

**Alternativa evaluada y descartada:** que el **consumidor** recalcule las opciones de
los hijos y las repase por props (componente "tonto"). Descartada porque (i) obliga a
cada consumidor a reimplementar acotamiento + poda, que es justo lo que se quiere
compartir; (ii) crea un lazo `onChange → recalcular → props → poda → onChange` propenso a
renders en cascada; (iii) A necesitaría la poda igualmente para no emitir huérfanos.

## A.8 Lo que NO entra en A

Sin provincias/cantones/distritos, sin `createdAt`, sin `filter`, sin `status_id`, sin
Server Actions, sin husos horarios. Los tests de A usan filtros de fantasía (`color` →
`talla`) y **no pueden importar** `lib/types/orden`, `lib/actions/*` ni
`app/(app)/ordenes/*`.

---

# Parte B — Cableado en órdenes

## 1. Modelo de datos

### 1.1 Sin tablas nuevas, sin columnas nuevas

| Filtro | Columna | Nulabilidad | Notas |
| --- | --- | --- | --- |
| zona | `orden.zona_id` | NOT NULL | decisión (b): valor **congelado** de la orden |
| tienda | `orden.tienda_id` | NOT NULL | FK → `usuario` (`adminTienda` o `apiKey`) |
| provincia | `orden.provincia_id` | NOT NULL | |
| cantón | `orden.canton_id` | NOT NULL | |
| distrito | `orden.distrito_id` | **NULL** | decisión (f); ver riesgo §8.6 |
| tiempo | `orden.created_at` | NOT NULL | `DateTime` en UTC |

No hay RLS nueva: no se crean tablas. La autorización de negocio sigue en los services.

### 1.2 Migración: **SÍ, una**, y es solo de índices

`orden` no tiene índice en `zona_id`, `provincia_id`, `canton_id` ni `distrito_id`, y
esta feature los pone en el `WHERE` de una ruta caliente (`findMany` + `count` por cada
cambio de filtro). Un `WHERE ... IN` sin índice en la tabla más grande del sistema es el
anti-patrón que `docs/architecture.md` manda rechazar.

`db/migrations/<ts>_orden_indices_filtros/`:

```sql
-- migration.sql (UP)
CREATE INDEX "orden_zona_id_idx"      ON "orden"("zona_id");
CREATE INDEX "orden_provincia_id_idx" ON "orden"("provincia_id");
CREATE INDEX "orden_canton_id_idx"    ON "orden"("canton_id");
CREATE INDEX "orden_distrito_id_idx"  ON "orden"("distrito_id");
```

```sql
-- down.sql (DOWN, OBLIGATORIO)
DROP INDEX IF EXISTS "orden_distrito_id_idx";
DROP INDEX IF EXISTS "orden_canton_id_idx";
DROP INDEX IF EXISTS "orden_provincia_id_idx";
DROP INDEX IF EXISTS "orden_zona_id_idx";
```

Más los `@@index([zonaId] / [provinciaId] / [cantonId] / [distritoId])` en
`db/schema.prisma` (schema y SQL no pueden divergir). `created_at` ya está indexado. Sin
índices compuestos por ahora (§9.9).

## 2. Contrato del `filter`

### 2.1 Forma extendida

`ordenFilterSchema` sigue `.strict()` —esa propiedad es la que da R29 sin código extra—
y pasa de 1 a 9 claves:

```ts
export const ORDEN_FILTER_FIELDS = [
  "status_id",
  "zona_id", "tienda_id", "provincia_id", "canton_id", "distrito_id",
  "created_preset",          // decisión (a): presets
  "created_desde",           // decisión (a): rango abierto
  "created_hasta",
] as const;

const idList = z.array(z.string().min(1)).nonempty();
const fechaCalendario = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CREATED_PRESETS = ["7d", "15d", "30d", "90d"] as const;

export const ordenFilterSchema = z
  .object({
    status_id:    z.union([z.string().min(1), idList]).optional(), // retrocompat (R43)
    zona_id:      idList.optional(),
    tienda_id:    idList.optional(),
    provincia_id: idList.optional(),
    canton_id:    idList.optional(),
    distrito_id:  idList.optional(),
    created_preset: z.enum(CREATED_PRESETS).optional(),            // NO lista (R36)
    created_desde:  fechaCalendario.optional(),                    // R37
    created_hasta:  fechaCalendario.optional(),
  })
  .strict()
  .refine(
    (f) => !(f.created_desde && f.created_hasta) || f.created_desde <= f.created_hasta,
    { path: ["created_hasta"], message: "El rango de fechas está invertido" },     // R37
  );
```

Notas: la comparación `desde <= hasta` con cadenas `YYYY-MM-DD` es correcta
lexicográficamente. El cliente **nunca** manda instantes ni offsets (R41).

### 2.2 Traducción a `WHERE`

```ts
const FILTER_TO_COLUMN = {
  status_id: "estatusId", zona_id: "zonaId", tienda_id: "tiendaId",
  provincia_id: "provinciaId", canton_id: "cantonId", distrito_id: "distritoId",
} as const;
```

`OrdenRepository.list` extiende su `where` con el patrón vigente: lista → `{ in: [...] }`,
escalar → igualdad, ausente → clave omitida; `deletedAt: null` siempre; **`count` con el
mismo objeto `where`** (R42). Las tres claves temporales NO están en el mapa: el service
las convierte a `createdAt: { gte, lt }` (§2.4).

Semántica explícita:

- **Entre filtros distintos: AND** (claves hermanas del `where`) — R31.
- **Dentro de un filtro multi-valor: OR** (`IN`) — R32.
- **Id inexistente: falla cerrado.** No aparece en ninguna fila ⇒ el resultado se
  estrecha, nunca se ensancha (R33). No se comprueba existencia contra el catálogo: sería
  una query extra y no aporta seguridad (el peor caso ya es "cero filas"). Sí hay test de
  que un id inventado NO se degrada a "sin filtro".
- **Distrito NULL** (decisión (f)): `distrito_id IN (...)` las excluye por semántica SQL.
  No se añade opción "sin distrito".

### 2.3 Precedencia y scoping por rol

Orden de construcción del `where` (no cambia; es lo que garantiza R34/R35):

1. `estatusId` escalar heredado.
2. `filter.*` traducido (gana sobre el escalar en `status_id`, como hoy).
3. **Scoping por rol, escrito AL FINAL:** `adminTienda` ⇒ `where.tiendaId =
   actor.usuarioId`; `mensajero` ⇒ `where.mensajeroAsignadoId = actor.usuarioId`.

Si un `adminTienda` inyecta `filter.tienda_id = [otraTienda]`, el asignado posterior
**pisa** el filtro. El filtro nunca amplía el alcance del rol; test explícito (R34/R35),
porque es la línea entre "filtro" y "fuga de datos".

> Nota para el implementer: hoy `where.tiendaId` es `string`; al admitir lista pasa a
> `string | string[]`, y el scoping por rol debe **sobrescribir** con el escalar propio
> (no componer). Es exactamente la semántica que R34 exige.

### 2.4 Bordes temporales en horario de Costa Rica

`created_at` está en UTC; la operación es CR, **UTC−6 fijo** (sin DST; `fecha-cr.ts` ya
lo documenta y explota). La trampa del repo: `startOfDayCR(now)` devuelve la **medianoche
UTC de la fecha calendario CR** (convención `@db.Date` de la feature 46), no el instante
"00:00 en CR". Para comparar contra un `timestamp` UTC hay que **sumar 6 h**.

Helper nuevo en `lib/utils/fecha-cr.ts` (no en un módulo aparte):

```ts
/** Instante UTC del comienzo (00:00 CR) de la fecha calendario `YYYY-MM-DD`. */
export function inicioDelDiaCREnUtc(fecha: string): Date;   // -> `${fecha}T06:00:00.000Z`
/** Instante UTC del comienzo del día SIGUIENTE (cota superior exclusiva). */
export function inicioDelDiaSiguienteCREnUtc(fecha: string): Date;
```

Traducción en el service:

| Entrada | `where.createdAt` |
| --- | --- |
| `created_preset: "Nd"` | `{ gte: inicioDelDiaCREnUtc(fechaCalendarioCR(now − (N−1) días)) }` (R38) |
| `created_desde: "D"` | `{ gte: inicioDelDiaCREnUtc(D) }` |
| `created_hasta: "H"` | `{ lt: inicioDelDiaSiguienteCREnUtc(H) }` — **hasta inclusive** (R39) |
| solo uno de los dos | rango abierto por el otro lado (R39) |

Casos de borde trazados a test: `2026-07-15T05:59:59Z` (23:59:59 CR del 14) **no** entra
en `desde = 2026-07-15`; `2026-07-15T06:00:00Z` **sí**. Y `hasta = 2026-07-15` incluye
`2026-07-16T05:59:59Z`. El error clásico —`hasta` como `<= 06:00 UTC` del mismo día—
perdería todo el día indicado salvo su primer segundo.

### 2.5 Precedencia preset ↔ rango (R40)

Si llegan **ambos**, **gana el rango explícito** y el preset se ignora. Motivo: con el
estado de A **no controlado** (decisión (j)) el consumidor no puede vaciar el preset al
fijar un rango, de modo que la combinación es alcanzable con uso normal de la UI;
convertirla en `validation_error` sería castigar al usuario por un límite de
arquitectura. El rango es el dato más específico y explícito, así que manda. Está
documentado en el JSDoc del schema, en la etiqueta del control ("el rango sustituye al
preset") y trazado a test.

Alternativa descartada: `validation_error` con ambos (§9.11).

## 3. Catálogos precargados (decisión (c))

### 3.1 Qué se entrega

Listas planas (no árbol): el encadenamiento se resuelve con `parentValue`, y una lista
plana se mapea a `FilterOption[]` sin recorrer nada.

```ts
interface OpcionCatalogo  { id: string; nombre: string }
interface OpcionConPadre  extends OpcionCatalogo { padreId: string }
interface CuentaTiendaDTO extends OpcionCatalogo { esApiKey: boolean; activa: boolean }

interface CatalogoFiltrosOrdenesDTO {
  zonas:      OpcionCatalogo[];
  tiendas:    CuentaTiendaDTO[];   // `esApiKey` -> grupo (h); `activa` -> etiqueta (e)
  provincias: OpcionCatalogo[];
  cantones:   OpcionConPadre[];    // padreId = provinciaId
  distritos:  OpcionConPadre[];    // padreId = cantonId
}
```

`esApiKey` y `activa` son **banderas**, no PII (R52); el mapeo a `group` y al sufijo
"(inactiva)" ocurre en el cliente, en la capa de declaración de B (§4.1).
Orden determinista: `nombre asc` en cada colección (R47).

### 3.2 Peso del payload — coste **aceptado a sabiendas**

Checksum del repo (`public/geografia-cr-completa-NOTAS.md`, IGN/DTA): **7 provincias + 84
cantones + 491 distritos = 582 filas**.

| Colección | Filas | Bytes/fila aprox. | Subtotal |
| --- | ---: | ---: | ---: |
| provincias | 7 | ~70 B | ~0,5 KB |
| cantones | 84 | ~120 B | ~10 KB |
| distritos | 491 | ~120 B | ~59 KB |
| zonas | decenas | ~70 B | <3 KB |
| tiendas | decenas | ~90 B | <5 KB |

**≈ 70–80 KB sin comprimir, ≈ 12–20 KB con la compresión de Vercel**, incrustados en el
**RSC payload de cada carga de `/ordenes`** (decisión (c): no hay caché SWR entre
navegaciones). El humano lo aceptó explícitamente a cambio de que los filtros estén
operativos en el primer paint. **No se re-litiga.**

**Optimizaciones DENTRO de la decisión** (no la cambian, solo bajan el peso):

1. **Campos mínimos** — se entregan solo `id`/`nombre`/`padreId` (+2 banderas booleanas
   en tiendas). Nada de `createdAt`, `deletedAt`, zona del distrito, etc. *(Ya asumido
   arriba; es lo que evita duplicar el peso.)*
2. **Normalizado, no denormalizado** — el distrito referencia su cantón por `padreId` en
   vez de repetir nombre de cantón y provincia en cada fila. Repetirlos costaría ~491 ×
   ~30 B ≈ **+15 KB**.
3. **Palanca opcional: codificación en tuplas.** Las claves JSON (`"id"`, `"nombre"`,
   `"padreId"`) se repiten 582 veces ≈ **~14 KB solo de nombres de clave**. Emitir
   `[["id","nombre","padreId"], …]` y rehidratar en el cliente lo elimina.
   **Recomendación: NO hacerlo en v1** — cuesta legibilidad y un test más para ahorrar
   ~3 KB comprimidos. Queda anotado como palanca si el peso molesta en producción.

### 3.3 De dónde salen los datos

- **Zonas:** proyección `{id, nombre}` en `ZonaRepository`. No se reusa
  `ZonaService.listar` (es `maestro`-only y pagina con tarifas).
- **Geografía:** `GeoRepository.listCatalogoPlano()` — tres `findMany` con proyección
  mínima. No se reusa `listarArbolGeografico()` (es `maestro`-only, anida y arrastra la
  zona del distrito).
- **Tiendas:** `UserRepository.listCuentasTienda()` — `rol.value IN
  ('adminTienda','apiKey')`, **sin filtrar por `estado`** (decisión (e)), proyectando
  `{id, nombre, esApiKey, activa}` (R48). Nada de email/teléfono (R52).

### 3.4 Cómo llega al cliente (decisión (c))

**Server Component + `Promise.all` + props.** En `app/(app)/ordenes/page.tsx`:

```tsx
const actor = await resolveActorFromSession();
// … guardias de rol vigentes (mensajero / adminSatelite -> notFound) …
const catalogo = await obtenerCatalogoFiltrosOrdenes(actor);   // Promise.all dentro
return <OrdenesListado catalogoFiltros={catalogo} … />;
```

`FiltrosOrdenesService.obtenerCatalogo(actor)` (DI por constructor, testeable sin DB)
autoriza `maestro`/`admin`/`adminTienda` → `ok`; sin sesión → `unauthenticated` (R50);
cualquier otro rol → `forbidden` sin datos (R51) — mismo conjunto que
`ROLES_CON_FILTRO_ESTADO`. Dentro:

```ts
const [zonas, tiendas, provincias, cantones, distritos] = await Promise.all([
  zonaRepo.listLite(), userRepo.listCuentasTienda(), geoRepo.listProvinciasLite(),
  geoRepo.listCantonesLite(), geoRepo.listDistritosLite(),
]);
```

Cinco queries en paralelo, no cinco secuenciales: es literalmente lo que pidió el humano
y lo que evita que el TTFB de `/ordenes` sume latencias. La página **no falla** si el
catálogo falla: el service devuelve el resultado y `page.tsx` pasa `null`, con lo que la
barra se monta deshabilitada (R62).

**Se descarta la Server Action + SWR** que este diseño recomendaba antes (§9.12): la
decisión (c) la sustituye.

## 4. La barra de filtros de órdenes

### 4.1 Declaración (todo lo específico de órdenes vive aquí)

`app/(app)/ordenes/_components/ordenes-filtros-def.ts` — función **pura**:

```ts
export function construirFiltrosOrdenes(
  cat: CatalogoFiltrosOrdenesDTO,
  opts: { incluirTienda: boolean },
): FilterDef[] {
  return [
    { key: "zona_id", label: "Zona", kind: "multi",
      options: cat.zonas.map(o => ({ value: o.id, label: o.nombre })) },

    ...(opts.incluirTienda ? [{                                   // R60
      key: "tienda_id", label: "Tienda", kind: "multi" as const,
      options: cat.tiendas.map(o => ({
        value: o.id,
        label: o.activa ? o.nombre : `${o.nombre} (inactiva)`,     // decisión (e), R49
        group: o.esApiKey ? "Integraciones (API)" : "Cuentas tienda", // decisión (h)
      })),
    }] : []),

    { key: "provincia_id", label: "Provincia", kind: "multi",
      options: cat.provincias.map(o => ({ value: o.id, label: o.nombre })) },
    { key: "canton_id", label: "Cantón", kind: "multi", dependsOn: "provincia_id",
      options: cat.cantones.map(o => ({ value: o.id, label: o.nombre,
                                        parentValue: o.padreId })) },
    { key: "distrito_id", label: "Distrito", kind: "multi", dependsOn: "canton_id",
      options: cat.distritos.map(o => ({ value: o.id, label: o.nombre,
                                         parentValue: o.padreId })) },

    { key: "created_preset", label: "Creadas en", kind: "single",
      options: [
        { value: "7d",  label: "Últimos 7 días" },
        { value: "15d", label: "Últimos 15 días" },
        { value: "30d", label: "Últimos 30 días" },
        { value: "90d", label: "Últimos 90 días" },
      ] },
    { key: "created_range", label: "Rango de creación", kind: "dateRange" },
  ];
}
```

Toda la cadena geográfica son **dos `dependsOn`** (R53, R54). El agrupado de tienda son
**dos strings** en `group`. `FilterComponent` no sabe qué es una provincia ni una API key.

### 4.2 Traducción al `filter` (responsabilidad de B, R56)

`app/(app)/ordenes/_components/seleccion-a-filter.ts`, pura y testeable:

```ts
export function seleccionAFilter(sel: FilterSelection): Partial<OrdenFilterInput> {
  const out: Record<string, unknown> = {};
  for (const [key, values] of Object.entries(sel)) {
    if (values.length === 0) continue;                  // defensa (A ya lo garantiza)
    if (key === "created_preset") { out.created_preset = values[0]; continue; }
    if (key === "created_range") {                      // ["desde","hasta"] -> 2 claves
      const [desde, hasta] = values;
      if (desde) out.created_desde = desde;
      if (hasta) out.created_hasta = hasta;
      continue;
    }
    out[key] = values;                                  // listas de ids, tal cual
  }
  return out as Partial<OrdenFilterInput>;
}
```

Las claves de catálogo se eligieron **iguales** a las del `filter`, así que ahí la
traducción es la identidad; las dos transformaciones reales (único → escalar, rango → dos
claves) demuestran por qué esto vive en B: otro consumidor con otro transporte (query
string, body REST) escribirá la suya (R18/R56).

En `OrdenesListado`:

```tsx
const filter = { ...(estados.length ? { status_id: estados } : {}),
                 ...seleccionAFilter(seleccion) };
<FilterComponent filters={defs} onChange={setSeleccion} showClearAll />   {/* R61 */}
<OrdenesModule filter={Object.keys(filter).length ? filter : undefined} … />
```

De ahí salen R44 (combina con estado) y R57 (sin filtros → `filter` ausente → input
idéntico al previo). Con `catalogoFiltros === null`, la barra se monta `disabled` y la
tabla sigue viva (R62).

> El filtro de **estado** se deja donde está (su `MultiSelectFilter` en `OrdenesListado`)
> y NO se migra a `FilterComponent` en esta feature: tocaría el camino probado de la 63
> sin petición, y R43/R57 exigen demostrar cero regresión. Candidato natural para la 145.

### 4.3 Key de SWR y reset de página

Se generaliza `statusKey` → `filterKey` con la misma disciplina de estabilidad que hoy
tiene el estado:

```ts
function serializarFiltro(filter?: OrdenFilterInput): string {
  if (!filter) return "";
  return Object.keys(filter).sort()
    .map((k) => {
      const v = filter[k];
      return `${k}=${Array.isArray(v) ? [...v].sort().join(",") : v}`;
    })
    .join("&");
}
```

Claves ordenadas + valores ordenados ⇒ dos selecciones equivalentes producen la misma key
⇒ comparten caché y no refetchean en cada render (R59). `filterKeyPrevio` sustituye a
`statusKeyPrevio` y dispara `setPage(1)` + `setSeleccionIds(new Set())` ante el cambio de
CUALQUIER filtro (R58). La key pasa de `["ordenes:list", statusKey, page, pageSize]` a
`["ordenes:list", filterKey, page, pageSize]`; el `mutate` por prefijo
(`key[0] === "ordenes:list"`) sigue igual.

**Sin regresión (R43/R57):** con `filter` ausente, `serializarFiltro` devuelve `""` y
`ordenesFetcher` llama `listarOrdenes({page, pageSize})` exactamente como hoy.

## 5. Capas tocadas

| Bloque | Archivo | Cambio |
| --- | --- | --- |
| A | `components/shared/FilterComponent.tsx` | **nuevo** |
| A | `components/shared/DateRangeFilter.tsx` | **nuevo** (2 `<Input type="date">`) |
| A | `components/shared/MultiSelectFilter.tsx` | **modificado**: soporte `group` (sin grupos = idéntico a hoy) |
| A | `lib/utils/filter-dependencies.ts` | **nuevo**, puro, sin dominio |
| B | `lib/types/orden.ts` | `ORDEN_FILTER_FIELDS` + `ordenFilterSchema` a 9 claves + `refine` |
| B | `lib/services/OrdenService.ts` | `FILTER_TO_COLUMN` ampliado + rango temporal |
| B | `lib/repositories/OrdenRepository.ts` | `where` con `in` + `createdAt: { gte, lt }` |
| B | `lib/interfaces/repositories/IOrdenRepository.ts` | `ListOrdenesParams.where` ampliado |
| B | `lib/services/FiltrosOrdenesService.ts` | **nuevo**: `Promise.all` + autorización |
| B | `GeoRepository`, `UserRepository`, `ZonaRepository` | proyecciones planas |
| B | `lib/utils/fecha-cr.ts` | `inicioDelDiaCREnUtc`, `inicioDelDiaSiguienteCREnUtc` |
| B | `app/(app)/ordenes/page.tsx` | resuelve el catálogo y lo pasa por props |
| B | `_components/ordenes-filtros-def.ts`, `_components/seleccion-a-filter.ts` | **nuevos** |
| B | `OrdenesListado.tsx`, `OrdenesModule.tsx` | cableado + `filterKey` |
| B | `db/schema.prisma` + migración | 4 índices (+ `down.sql`) |

**No se toca** `TableFilters.tsx`, `DataTable`, ni ninguna otra superficie (R63).

## 6. Contratos de entrada/salida (backend)

```jsonc
// listarOrdenes
{
  "page": 1, "pageSize": 25,
  "filter": {
    "status_id": ["<uuid>"],
    "zona_id": ["<uuid>", "<uuid>"],
    "tienda_id": ["<uuid>"],
    "provincia_id": ["<uuid>"], "canton_id": ["<uuid>"], "distrito_id": ["<uuid>"],
    "created_preset": "30d",
    "created_desde": "2026-07-01", "created_hasta": "2026-07-28"
  }
}
```

Salida sin cambios (`{status:"ok", items, total, page, pageSize}`). Errores: los del arnés
(`validation_error` con `fieldErrors`, `unauthenticated`, `forbidden`). Sin códigos nuevos.

## 7. Dependencias nuevas a instalar

**NINGUNA.** Verificado contra `package.json` y `components/ui/`:

- No hace falta `react-day-picker` ni `@radix-ui/react-popover`: el `dateRange` se
  construye con `<Input type="date">` (patrón vigente en 6 componentes del repo,
  `WalletFiltros` incluido) — §A.5.
- No hace falta `Popover`/`Command`: `MultiSelectFilter` ya trae su panel propio con
  clic-fuera + `Escape`.
- No hace falta nada para el agrupado: es markup + ARIA dentro de `MultiSelectFilter`.
- El repo es **pnpm**; si el humano revirtiera la decisión de §A.5, el añadido mínimo
  sería `pnpm add react-day-picker` **y nada de Radix** (chocaría con `@base-ui/react`).

## 8. Riesgos

1. **Contaminación de dominio en A** — riesgo principal. Mitigado por el criterio de corte
   + regla dura de review: ningún test de R1–R27 importa dominio, y `FilterComponent` no
   importa `lib/types/orden` ni `app/(app)/ordenes/*`.
2. **Ensanchar el alcance por accidente** — mitigado por el orden de escritura del `where`
   (§2.3) + tests de rol (R34/R35).
3. **Peso del RSC payload** — cuantificado (§3.2) y **aceptado** en (c). Palanca de tuplas
   documentada por si molesta.
4. **Off-by-one horario** — la trampa ya existe en el repo (`startOfDayCR`). Mitigada con
   helpers propios + tests de borde `05:59:59Z` / `06:00:00Z` y `hasta` inclusive.
5. **Regresión de `MultiSelectFilter`** — se modifica un componente que hoy usa el filtro
   de estado de la 63. Mitigado: sin `group` en las opciones, el render y el ARIA son
   idénticos; los tests existentes deben pasar **sin tocarlos**.
6. **`orden.distrito_id` es NULLABLE (decisión (f)).** El humano afirma que "no deberían
   haber null". **Verificado en `db/schema.prisma`: `distritoId String?` — la columna SÍ
   admite NULL hoy.** Este spec NO cambia esa nulabilidad ni añade la opción "sin
   distrito": mantiene la semántica `IN (...)`, que las excluye. **Confirmar cuántas
   órdenes tienen `distrito_id IS NULL` y, si son cero, migrar la columna a `NOT NULL`, es
   trabajo de OTRA feature**, fuera del alcance de esta. Mientras exista algún NULL, esas
   órdenes serán invisibles bajo el filtro de distrito (y visibles sin él).
7. **Regresión silenciosa en la key de SWR** — mitigada con test de estabilidad de
   `serializarFiltro`.

## 9. Alternativas descartadas

**9.1 URL del navegador (query params) + Server Action.** Daría filtros enlazables,
back/forward y estado tras recargar. **Descartada explícitamente por el humano**: se
extiende `filter`. Consecuencia asumida: la selección se pierde al recargar (decisión (g)).

**9.2 Una consulta por selección** (`GeoService.listCantones(provinciaId)`). Descartada: el
humano fijó precargar todo y encadenar en el front. 582 filas / ~70 KB una vez, contra un
round-trip por cada clic en un select múltiple.

**9.3 Encadenamiento hardcodeado dentro del componente.** Descartada tras la corrección del
humano: acopla A al dominio y lo inutiliza para el siguiente consumidor. Sustituido por
`dependsOn` + `parentValue`.

**9.4 Componente "tonto"** (el consumidor recalcula opciones y las repasa por props).
Descartada (§A.7): duplica lógica en cada consumidor y crea un lazo de renders.

**9.5 Filtro genérico dentro de `DataTable`.** Descartada: la ficha genérica de la 144 está
RETIRADA y acoplarlo a la tabla impediría usarlo en superficies sin `DataTable`.

**9.6 Validar contra el catálogo cada id recibido.** Descartada: 1–6 queries extra por
listado; el peor caso de un id inventado ya es "cero filas". La seguridad la da el scoping
por rol.

**9.7 Enviar nombres en vez de ids** (patrón de la 117). Descartada: aquí el filtrado es
server-side sobre FKs; los nombres son ambiguos en CR (varios cantones "Central").

**9.8 Migrar YA el filtro de estado a `FilterComponent`.** Descartada en esta feature
(§4.2); candidata para la 145.

**9.9 Índices compuestos `(zona_id, created_at)`.** Descartada por ahora: sin telemetría de
las combinaciones reales sería adivinar, y cuesta escrituras en la tabla más caliente.

**9.10 Date-range de shadcn (`Calendar` + `Popover`).** Descartada (§A.5): arrastraría
`react-day-picker` **y Radix** a un repo cuyas primitivas son `@base-ui/react`, para un
control que el repo ya resuelve con `<Input type="date">` en 6 sitios.

**9.11 `validation_error` cuando llegan preset y rango a la vez.** Descartada (§2.5): con
el estado de A no controlado, esa combinación es alcanzable con uso normal de la UI;
convertirla en error castigaría al usuario. Gana el rango.

**9.12 Server Action del catálogo + SWR con key fija.** Era mi recomendación en (c);
**descartada por decisión del humano** a favor de `Promise.all` en el Server Component.
Ventaja perdida: deduplicación entre navegaciones. Ventaja ganada: filtros operativos en el
primer paint.

**9.13 Codificación en tuplas del catálogo.** No descartada del todo: es la palanca de
§3.2(3); no se implementa en v1 por legibilidad frente a ~3 KB comprimidos.

---

## Preguntas abiertas

**Ninguna bloqueante.** Las 14 preguntas (a)–(n) están cerradas en §0. Los dos puntos que
este spec decide por su cuenta (precedencia preset↔rango §2.5, y el riesgo del
`distrito_id` nullable §8.6) están señalados en `requirements.md > Preguntas abiertas`
por si el humano quiere lo contrario; ninguno bloquea la implementación.
