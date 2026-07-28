# Feature 144 — Filtros de órdenes (zona, tienda, geografía y tiempo) · design.md

> Decisiones técnicas ANTES de código.
>
> La feature entrega **dos piezas**: **(A)** un componente de filtros **genérico y
> parametrizable** (`FilterComponent`), sin dominio, reutilizable por cualquier
> consumidor y cualquier transporte; y **(B)** el **cableado en órdenes**, único
> consumidor implementado ahora.
>
> Decisiones cerradas que NO se reabren: se extiende el `filter` de la Server Action
> `listarOrdenes` (sin endpoint HTTP nuevo, sin query params en la URL del navegador
> — variante propuesta al humano y **descartada** por él, §10.1); el encadenamiento
> se resuelve en el cliente sobre datos precargados en una sola entrega; la única
> implementación de consumidor que entra aquí es órdenes.

---

# Parte A — `FilterComponent` (genérico, sin dominio)

## A.1 Qué es y qué no es

| | `MultiSelectFilter` (ya existe) | `FilterComponent` (esta feature) |
| --- | --- | --- |
| Alcance | **un** control | **N** controles |
| Estado | controlado por el padre (`value`/`onChange`) | dueño del **estado agregado** |
| Sabe de | nada | nada (tampoco de órdenes) |
| Emite | `string[]` de un filtro | selección agregada de todos los filtros |

`FilterComponent` **no** hace fetch (R4), **no** conoce claves ni entidades del
dominio (R5), **no** construye el objeto de ninguna API (R14). Recibe declaraciones,
pinta controles, mantiene el estado agregado, aplica las dependencias declaradas y
emite. Punto.

## A.2 Contrato de props

```ts
// components/shared/FilterComponent.tsx   (ubicación: pregunta abierta (n))

/** Tipos de control soportados en v1 (pregunta abierta (k)). */
export type FilterKind = "multi" | "single";

export interface FilterOption {
  /** Valor emitido tal cual (R5). Normalmente un id. */
  value: string;
  /** Texto visible y texto sobre el que busca el buscador interno. */
  label: string;
  /**
   * Valor del filtro PADRE al que pertenece esta opción. Solo lo leen los filtros
   * que declaran `dependsOn` (R15/R16). El componente NO sabe qué significa.
   */
  parentValue?: string;
}

export interface FilterDef {
  /** Clave con la que este filtro aparece en la salida (R2). */
  key: string;
  label: string;
  kind: FilterKind;
  options: FilterOption[];
  /** Clave de OTRO filtro del que este depende (R15). */
  dependsOn?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
}

/** Salida agnóstica (R11/R13/R14): clave declarada -> valores marcados. */
export type FilterSelection = Record<string, string[]>;

export interface FilterComponentProps {
  filters: FilterDef[];
  onChange: (selection: FilterSelection) => void;
  /** Deshabilita TODOS los controles (R10). */
  disabled?: boolean;
  className?: string;
}
```

Decisiones de forma, explícitas:

- **`FilterSelection` es `Record<string, string[]>` incluso para `single`** (una
  lista de 0 o 1 elemento). Una sola forma de salida = un solo camino de código en
  cada consumidor, y añadir un tipo nuevo no rompe a nadie. Alternativa evaluada:
  `string[] | string` según el tipo — obliga a cada consumidor a `Array.isArray`.
  → **pregunta abierta (l)**.
- **Las claves sin selección no aparecen** en la salida (R13). "Sin filtros" es `{}`,
  que el consumidor distingue con `Object.keys(sel).length === 0`. Es lo que permite
  a órdenes no tocar `filter` y conservar el input previo (R46).
- **Estado interno (no controlado) con `onChange`** — recomendación; ver pregunta
  abierta (j). El componente es dueño del estado agregado porque la poda transitiva
  (R18) necesita decidir sobre el conjunto, no sobre un control suelto.

## A.3 Render de cada control

- `kind: "multi"` → **`MultiSelectFilter`** existente, tal cual, sin modificarlo:
  ya trae buscador interno, casilla por opción, `role="listbox"`/`role="option"` +
  `aria-selected`, cierre por clic fuera y `Escape` (R6, R20). Su `onChange` solo se
  dispara en `alternar()` y en "Limpiar"; el buscador es estado local suyo, así que
  **R12 (no emitir al teclear) se cumple por construcción** — el test lo fija para
  que nadie lo rompa.
- `kind: "single"` → `Select` de shadcn/ui (`components/ui/select`), una opción a la
  vez (R7).
- `kind` desconocido → no se renderiza ni entra en la salida, y el resto sigue
  funcionando (R8). Se registra una advertencia en desarrollo.
- Filtro sin opciones (o cuyas opciones quedaron vacías tras el acotamiento) →
  control `disabled` (R9). `props.disabled` global gana sobre todo (R10).

## A.4 Contrato de dependencias entre filtros

Este es el punto que más fácilmente contamina el componente genérico, así que se
diseña explícito.

**Declaración:** un filtro declara `dependsOn: "<key de otro filtro>"`, y cada opción
suya trae `parentValue` = el valor del padre al que pertenece.

**Resolución** (`lib/utils/filter-dependencies.ts`, funciones puras sin React):

```ts
/** Valores del filtro `key` que se OFRECEN, dadas las selecciones actuales. */
opcionesVisibles(filters, selection, key): FilterOption[]

/** Selección EFECTIVA de un filtro: su selección si no está vacía; si está vacía,
 *  todos sus valores visibles (R16). Recursiva sobre la cadena de padres. */
seleccionEfectiva(filters, selection, key): Set<string>

/** Poda transitiva: quita de cada filtro dependiente los valores que dejaron de
 *  estar visibles (R18). Idempotente. */
podarSeleccion(filters, selection): FilterSelection
```

Regla de `opcionesVisibles(key)`:

1. Si el filtro no declara `dependsOn`, o su padre no está declarado (R19) →
   **todas** sus opciones.
2. Si declara `dependsOn: P` → las opciones cuyo `parentValue` ∈
   `seleccionEfectiva(P)`.

`seleccionEfectiva` es lo que hace funcionar el caso "provincia marcada, cantón sin
marcar": el efectivo del cantón son *sus* opciones visibles (ya acotadas por la
provincia), así que los distritos salen acotados a esas provincias **sin** que el
componente sepa qué es una provincia (R16, R17). La recursión da profundidad
arbitraria; se protege contra ciclos con un `Set` de claves visitadas (un ciclo se
trata como "sin padre", igual que R19).

**Poda:** tras cada cambio, se aplica `podarSeleccion` **antes** de llamar a
`onChange`, en orden topológico (padres antes que hijos), de modo que lo emitido
nunca contenga un hijo huérfano (R18). Es la regla frente a la alternativa
"conservar la selección oculta": un valor seleccionado pero invisible produce
resultados inexplicables — exactamente el problema que el humano señaló.

**Alternativa evaluada y descartada:** que el **consumidor** recalcule las opciones
de los hijos y las vuelva a pasar por props en cada `onChange` (componente
totalmente "tonto"). Descartada porque (i) obliga a cada consumidor a reimplementar
acotamiento + poda + coherencia de la salida, que es justo la lógica que se quiere
compartir; (ii) crea un lazo `onChange → recalcular → props → poda → onChange`
propenso a renders en cascada y a emitir salidas transitorias incoherentes; (iii) el
componente seguiría necesitando la poda de todos modos para no emitir huérfanos, así
que no se ahorra nada. La declaración `dependsOn` + `parentValue` mantiene el
componente ignorante del dominio con una sola pieza de metadato por opción.

## A.5 Lo que NO entra en A

Sin conocimiento de provincias/cantones/distritos, sin "createdAt", sin `filter`, sin
`status_id`, sin Server Actions, sin SWR, sin ids de dominio. Todo eso vive en B.
El test de esta pieza usa filtros de fantasía (`color` → `talla`), y el reviewer
rechaza el bloque A si sus tests importan dominio.

---

# Parte B — Cableado en órdenes

## 1. Modelo de datos

### 1.1 Sin tablas nuevas, sin columnas nuevas

Todo lo que la feature filtra ya está en `orden`:

| Filtro | Columna | Nulabilidad | Notas |
| --- | --- | --- | --- |
| zona | `orden.zona_id` | NOT NULL | FK → `zona`. Valor **congelado** al crear la orden. |
| tienda | `orden.tienda_id` | NOT NULL | FK → `usuario` (dueño; `adminTienda` o `apiKey`). |
| provincia | `orden.provincia_id` | NOT NULL | FK → `provincia`. |
| cantón | `orden.canton_id` | NOT NULL | FK → `canton`. |
| distrito | `orden.distrito_id` | **NULL** | único FK geográfico opcional. |
| tiempo | `orden.created_at` | NOT NULL | `DateTime` en UTC, default `now()`. |

No hay RLS nueva que declarar: no se crean tablas. Las tablas leídas
(`zona`, `provincia`, `canton`, `distrito`, `usuario`, `orden`) mantienen su política
actual; la autorización de negocio sigue viviendo en los services (patrón del repo).

### 1.2 Migración: **SÍ, una**, y es solo de índices

`orden` tiene índices en `tienda_id`, `estatus_id`, `created_at`,
`mensajero_sugerido_id`, `mensajero_asignado_id` y `(mensajero_asignado_id,
asignado_at)`. **No** tiene índice en `zona_id`, `provincia_id`, `canton_id` ni
`distrito_id`, y esta feature los pone en el `WHERE` de una ruta caliente
(`/ordenes`, con `findMany` + `count` por cada cambio de filtro). Un `WHERE ... IN`
sobre columnas sin índice en la tabla más grande del sistema es exactamente el
anti-patrón que `docs/architecture.md` manda rechazar.

Migración `db/migrations/<ts>_orden_indices_filtros/`:

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

Con los `@@index([zonaId]) / @@index([provinciaId]) / @@index([cantonId]) /
@@index([distritoId])` correspondientes en `db/schema.prisma` (el schema y el SQL no
pueden divergir).

**No** se crean índices compuestos con `created_at`: sin datos de producción sobre la
combinación real de filtros sería adivinar. Se deja anotado como seguimiento.

## 2. Contrato del `filter` (lo que viaja)

### 2.1 Forma extendida

`ordenFilterSchema` (`lib/types/orden.ts`) sigue siendo `.strict()` — esa propiedad
es la que hace que R22 se cumpla sin código extra — y pasa de una clave a siete:

```ts
export const ORDEN_FILTER_FIELDS = [
  "status_id",
  "zona_id",
  "tienda_id",
  "provincia_id",
  "canton_id",
  "distrito_id",
  "created_range",   // nombre provisional: depende de la pregunta (a)
] as const;

const idList = z.array(z.string().min(1)).nonempty();

export const ordenFilterSchema = z
  .object({
    // `status_id` conserva la unión escalar|lista por retrocompatibilidad (R33).
    status_id:    z.union([z.string().min(1), idList]).optional(),
    // Los cinco nuevos nacen SOLO como lista: no hay contrato previo que preservar.
    zona_id:      idList.optional(),
    tienda_id:    idList.optional(),
    provincia_id: idList.optional(),
    canton_id:    idList.optional(),
    distrito_id:  idList.optional(),
    created_range: z.enum(CREATED_RANGE_VALUES).optional(), // NO lista (R29)
  })
  .strict();
```

Puntos que NO se degradan respecto de la 63:

- `.strict()` ⇒ clave desconocida = `ZodError` = `validation_error` **antes** de
  construir el `where` (R22, R31).
- `.nonempty()` ⇒ lista vacía = `validation_error`, no "sin filtro" (R23). El front
  **omite la clave** en lugar de mandar `[]` (R46) — y eso sale gratis de R13 de A.
- Ningún valor del `filter` se usa jamás como nombre de columna: la traducción es un
  mapa explícito (§2.2).

### 2.2 Traducción a `WHERE` (service → repository)

`OrdenService.listar` amplía el mapa explícito, único punto que conoce los nombres
internos:

```ts
const FILTER_TO_COLUMN = {
  status_id:    "estatusId",
  zona_id:      "zonaId",
  tienda_id:    "tiendaId",
  provincia_id: "provinciaId",
  canton_id:    "cantonId",
  distrito_id:  "distritoId",
} as const;
```

`OrdenRepository.list` extiende su `where` con el patrón vigente para `estatusId`:
lista → `{ in: [...] }`, escalar → igualdad, ausente → clave omitida.
`deletedAt: null` sigue siempre presente, y **`count` usa el mismo objeto `where`**
que `findMany` (R32).

Semántica resultante, explícita:

- **Entre filtros distintos: AND.** Son claves hermanas del mismo objeto `where` de
  Prisma (R24).
- **Dentro de un filtro multi-valor: OR**, materializado como `IN (...)` (R25).
- **Id inexistente o ajeno: falla cerrado.** Un id que no existe no aparece en
  ninguna fila ⇒ `IN` no lo selecciona ⇒ el resultado se estrecha, nunca se ensancha
  (R26). No se comprueba existencia contra el catálogo: sería una query extra por
  request y **no aporta seguridad** (el peor caso ya es "cero filas"). Lo que sí se
  prueba con test es que un id inventado NO se degrada a "sin filtro".

### 2.3 Precedencia y scoping por rol

El orden de construcción del `where` en `listar` no cambia y es lo que garantiza
R27/R28:

1. `estatusId` escalar heredado (si viene).
2. `filter.*` traducido (gana sobre el escalar en `status_id`, como hoy).
3. **Scoping por rol, escrito AL FINAL**, sobre las mismas claves:
   `adminTienda` ⇒ `where.tiendaId = actor.usuarioId`;
   `mensajero` ⇒ `where.mensajeroAsignadoId = actor.usuarioId`.

Si un `adminTienda` inyecta `filter.tienda_id = [otraTienda]`, el asignado posterior
**pisa** el filtro y devuelve solo lo suyo. El filtro nunca amplía el alcance del
rol. Se blinda con test explícito (R27), porque es la línea entre "filtro" y "fuga
de datos". Igual para `mensajero` (R28).

> Nota para el implementer: hoy `where.tiendaId` es `string`. Al admitir `tienda_id`
> como lista, el tipo pasa a `string | string[]`; el scoping por rol debe
> **sobrescribir** con el escalar propio (no "componer"), que es exactamente la
> semántica que R27 exige.

### 2.4 Filtro de tiempo y los bordes del día

`created_at` se guarda en UTC; la operación es Costa Rica, UTC−6 **fijo** (sin
horario de verano; `lib/utils/fecha-cr.ts` ya lo documenta y explota).

Con **presets relativos** (opción recomendada, pregunta (a)) el borde es:

```
desde = medianoche de CR del día (hoy_CR − (N−1) días)
      = startOfDayCR(now) − (N−1) días + 6 h      // +6 h = 00:00 CR en UTC
```

Ojo con la trampa ya presente en el repo: `startOfDayCR(now)` devuelve la
**medianoche UTC de la fecha calendario de CR** (convención de `@db.Date` de la
feature 46), no el instante "00:00 en CR". Para comparar contra un `timestamp` UTC
como `created_at` hay que sumar las 6 h. Sin ese ajuste, "últimos 7 días" incluiría
de más las órdenes creadas entre 18:00 y 24:00 CR del día frontera. Se añade
`inicioDelDiaCREnUtc()` a `lib/utils/fecha-cr.ts` (junto a los existentes, no en un
módulo nuevo) y se prueba con casos de borde (`05:59:59Z` vs `06:00:00Z`).

El cómputo del borde es **server-side**: el cliente envía el preset (`"7d"`, `"15d"`,
`"30d"`, `"90d"`), no una fecha. Así el resultado no depende del reloj ni del huso
del navegador, y el valor es whitelistable con `z.enum` (R29).

**El filtro de tiempo es, en A, un `kind: "single"` normal** sobre cuatro opciones
dadas. Que sus valores signifiquen "margen desde `createdAt`" es decisión de B: el
componente genérico no lo sabe (R5).

## 3. Catálogo precargado

### 3.1 Qué se entrega

Una sola respuesta plana (no un árbol anidado): el encadenamiento se resuelve con el
`parentValue` que pide el contrato de A, y una lista plana se mapea a
`FilterOption[]` sin recorrer nada.

```ts
interface OpcionCatalogo { id: string; nombre: string }
interface OpcionConPadre extends OpcionCatalogo { padreId: string }

interface CatalogoFiltrosOrdenesDTO {
  zonas:      OpcionCatalogo[];   // id, nombre
  tiendas:    OpcionCatalogo[];   // id, nombre  (SIN email/teléfono, R41)
  provincias: OpcionCatalogo[];
  cantones:   OpcionConPadre[];   // padreId = provinciaId
  distritos:  OpcionConPadre[];   // padreId = cantonId
}
```

Orden determinista: `nombre asc` en cada colección (mismo criterio que
`GeoRepository`/`UserRepository`), R37.

### 3.2 Dimensión real del payload (número, no adjetivo)

Checksum del catálogo de CR en el repo (`public/geografia-cr-completa-NOTAS.md`,
fuente IGN/DTA): **7 provincias + 84 cantones + 491 distritos = 582 filas**.

| Colección | Filas | Bytes/fila aprox. (uuid 36 + nombre + padreId + JSON) | Subtotal |
| --- | ---: | ---: | ---: |
| provincias | 7 | ~70 B | ~0,5 KB |
| cantones | 84 | ~120 B | ~10 KB |
| distritos | 491 | ~120 B | ~59 KB |
| zonas | decenas | ~70 B | <3 KB |
| tiendas | decenas | ~70 B | <5 KB |

**Total ≈ 70–80 KB sin comprimir; ≈ 12–20 KB con la compresión que ya aplica Vercel
(gzip/brotli).** Es una entrega única por carga de la página de órdenes, de datos que
cambian con frecuencia trimestral o menor. **No es preocupante**, y es
sustancialmente más barato que "una consulta por selección" (descartada, §10.2). Si
en el futuro molestara, la palanca obvia es servir los distritos bajo demanda por
provincia, pero eso contradice la decisión cerrada del humano y NO se hace aquí.

### 3.3 De dónde salen los datos

- **Zonas:** `ZonaRepository` (id + nombre). **No** se reusa `ZonaService.listar`: es
  `maestro`-only y devuelve el CRUD paginado con tarifas.
- **Geografía:** `GeoRepository` gana `listCatalogoPlano()` (tres `findMany` en
  paralelo, proyección id/nombre/padre). **No** se reusa `listarArbolGeografico()`
  (`lib/actions/geografia.ts`): es `maestro`-only, anida y arrastra la zona de cada
  distrito, que aquí no hace falta.
- **Tiendas:** `UserRepository` gana `listCuentasTienda()` = usuarios con
  `rol.value IN ('adminTienda','apiKey')`, proyección `{id, nombre}` (R38, R41). Se
  reusa el patrón de `listByRol`, que hoy filtra a un solo rol y a `estado: 'activo'`
  (ver pregunta (e)).

### 3.4 Por dónde llega al cliente

Recomendación (pregunta (c)): **Server Action propia**
`listarCatalogoFiltrosOrdenes()` en `lib/actions/ordenes-filtros.ts`, consumida por
`OrdenesListado` con SWR y key fija `"ordenes:catalogo-filtros"`.

Motivos: (i) `OrdenesListado` ya es un Client Component que resuelve así el catálogo
de estados (`"order-status:catalogo"`), y la simetría vale; (ii) SWR deduplica entre
montajes, así que el payload de ~70 KB no se repite al navegar dentro de la SPA;
(iii) pasarlo como prop desde el Server Component lo incrustaría en el RSC payload
del HTML **en cada** carga de `/ordenes`, sin caché entre navegaciones.

Autorización de la action (nuevo `FiltrosOrdenesService`, DI por constructor,
testeable sin DB): `maestro` / `admin` / `adminTienda` → `ok`; sin sesión →
`unauthenticated` (R39); cualquier otro rol (`mensajero`, `adminSatelite`, `apiKey`)
→ `forbidden` sin datos (R40). Es el mismo conjunto que `ROLES_CON_FILTRO_ESTADO` de
`app/(app)/ordenes/page.tsx`.

Nótese que esta autorización es de **B**: `FilterComponent` no sabe de roles ni de
catálogos (R4).

## 4. La barra de filtros de órdenes

### 4.1 Dónde vive lo específico de órdenes

`app/(app)/ordenes/_components/ordenes-filtros-def.ts` — función **pura** que
convierte el catálogo (§3.1) + el rol en `FilterDef[]`:

```ts
export function construirFiltrosOrdenes(
  catalogo: CatalogoFiltrosOrdenesDTO,
  opts: { incluirTienda: boolean },
): FilterDef[] {
  return [
    { key: "zona_id",      label: "Zona",      kind: "multi",
      options: catalogo.zonas.map(o => ({ value: o.id, label: o.nombre })) },
    ...(opts.incluirTienda ? [{ key: "tienda_id", label: "Tienda", kind: "multi",
      options: catalogo.tiendas.map(o => ({ value: o.id, label: o.nombre })) }] : []),
    { key: "provincia_id", label: "Provincia", kind: "multi",
      options: catalogo.provincias.map(o => ({ value: o.id, label: o.nombre })) },
    { key: "canton_id",    label: "Cantón",    kind: "multi", dependsOn: "provincia_id",
      options: catalogo.cantones.map(o => ({ value: o.id, label: o.nombre,
                                            parentValue: o.padreId })) },
    { key: "distrito_id",  label: "Distrito",  kind: "multi", dependsOn: "canton_id",
      options: catalogo.distritos.map(o => ({ value: o.id, label: o.nombre,
                                             parentValue: o.padreId })) },
    { key: "created_range", label: "Creadas en", kind: "single",
      options: CREATED_RANGE_OPTIONS },   // 7/15/30/90 días (pregunta (a))
  ];
}
```

**Ahí está toda la cadena geográfica**: dos `dependsOn`. El componente genérico no
sabe qué es una provincia (R42, R43). `incluirTienda: false` para `adminTienda`
(R49).

### 4.2 Traducción de la salida al `filter` (responsabilidad de B)

`OrdenesListado` recibe `FilterSelection` (`Record<string, string[]>`) y la traduce.
La traducción vive en `app/(app)/ordenes/_components/seleccion-a-filter.ts`, pura y
testeable:

```ts
export function seleccionAFilter(sel: FilterSelection): Partial<OrdenFilterInput> {
  const out: Record<string, string[] | string> = {};
  for (const [key, values] of Object.entries(sel)) {
    if (values.length === 0) continue;                 // defensa (A ya lo garantiza)
    out[key] = key === "created_range" ? values[0]! : values; // single -> escalar
  }
  return out as Partial<OrdenFilterInput>;
}
```

Las claves de `FilterDef` se eligieron **iguales** a las del `filter` de órdenes, así
que la traducción es casi la identidad; la única transformación real es
lista-de-uno → escalar para el filtro único. Aun así vive en B **por contrato**: el
día que otro consumidor use `FilterComponent` con otro transporte (query string, body
REST, GraphQL), su propia traducción vive en su propio lado (R45, R14).

En `OrdenesListado`:

```ts
const filter = { ...(estados.length ? { status_id: estados } : {}),
                 ...seleccionAFilter(seleccion) };
<OrdenesModule filter={Object.keys(filter).length ? filter : undefined} … />
```

De ahí salen R34 (combinar con estado) y R46 (sin filtros → `filter` ausente → input
idéntico al previo).

Si el catálogo no cargó, `OrdenesListado` monta `FilterComponent` con `disabled` (o
con `filters: []`) y el listado sigue sin filtros (R50), igual que hoy hace el filtro
de estado con `opciones.length === 0`.

> El filtro de **estado** se deja donde está (su propio `MultiSelectFilter` en
> `OrdenesListado`), NO se migra a `FilterComponent` en esta feature: migrarlo tocaría
> el camino ya probado de la 63 sin que nadie lo haya pedido, y R33/R46 exigen
> demostrar cero regresión. Es candidato natural para la 145.

### 4.3 Key de SWR y reset de página

`OrdenesModule` hoy deriva `statusKey` de `filter.status_id` y usa el patrón "ajustar
estado durante el render" (`statusKeyPrevio`) para volver a página 1 y limpiar la
selección de filas. Los filtros nuevos **heredan ese mecanismo**, no lo reinventan:
se generaliza `statusKey` a un `filterKey` que serializa el `filter` COMPLETO con la
misma disciplina de estabilidad:

```ts
function serializarFiltro(filter?: OrdenFilterInput): string {
  if (!filter) return "";
  return Object.keys(filter).sort()                       // claves ordenadas
    .map((k) => {
      const v = filter[k];
      return `${k}=${Array.isArray(v) ? [...v].sort().join(",") : v}`;
    })
    .join("&");
}
```

Claves ordenadas + valores ordenados ⇒ dos selecciones equivalentes producen la misma
key ⇒ comparten caché y no refetchean en cada render (R48). `filterKeyPrevio`
sustituye a `statusKeyPrevio` y dispara `setPage(1)` + `setSeleccionIds(new Set())`
ante el cambio de CUALQUIER filtro (R47). La key SWR pasa de
`["ordenes:list", statusKey, page, pageSize]` a
`["ordenes:list", filterKey, page, pageSize]`; el `mutate` por prefijo de
`revalidarTablas()` (`key[0] === "ordenes:list"`) sigue funcionando sin cambios.

**Sin regresión (R33/R46):** con `filter` ausente, `serializarFiltro` devuelve `""` y
`ordenesFetcher` llama `listarOrdenes({page, pageSize})` exactamente como hoy; con
solo `status_id`, la key es `status_id=a,b` en vez de `a,b` — cambia el string, no el
comportamiento (la key es interna a SWR, no viaja al servidor).

---

## 5. Capas tocadas (resumen)

| Bloque | Capa | Archivo | Cambio |
| --- | --- | --- | --- |
| A | UI genérica | `components/shared/FilterComponent.tsx` | **nuevo** (ubicación: pregunta (n)) |
| A | Utils | `lib/utils/filter-dependencies.ts` | **nuevo**, puro, sin dominio |
| B | Types/borde | `lib/types/orden.ts` | `ORDEN_FILTER_FIELDS` + `ordenFilterSchema` a 7 claves |
| B | Service | `lib/services/OrdenService.ts` | `FILTER_TO_COLUMN` ampliado; `where` tipado; tiempo → rango |
| B | Repository | `lib/repositories/OrdenRepository.ts` | `where` con `in` por lista + `createdAt: { gte }` |
| B | Interfaces | `lib/interfaces/repositories/IOrdenRepository.ts` | `ListOrdenesParams.where` ampliado |
| B | Service nuevo | `lib/services/FiltrosOrdenesService.ts` | catálogo + autorización por rol |
| B | Repos | `GeoRepository`, `UserRepository`, `ZonaRepository` | métodos de proyección plana |
| B | Action | `lib/actions/ordenes-filtros.ts` | `listarCatalogoFiltrosOrdenes()` |
| B | Utils | `lib/utils/fecha-cr.ts` | `inicioDelDiaCREnUtc()` |
| B | UI órdenes | `_components/ordenes-filtros-def.ts`, `_components/seleccion-a-filter.ts` | declaraciones + traducción |
| B | UI órdenes | `OrdenesListado.tsx`, `OrdenesModule.tsx` | cableado + `filterKey` |
| B | DB | `db/schema.prisma` + migración | 4 índices (+ `down.sql`) |

**No se toca** `components/shared/MultiSelectFilter.tsx` (se reusa tal cual), ni
`TableFilters.tsx`, ni `DataTable`, ni ninguna otra superficie (R51).

## 6. Contratos de entrada/salida (backend)

**Entrada** (`listarOrdenes`, sin cambios estructurales):

```jsonc
{
  "page": 1,
  "pageSize": 25,
  "filter": {
    "status_id": ["<uuid>"],
    "zona_id": ["<uuid>", "<uuid>"],
    "tienda_id": ["<uuid>"],
    "provincia_id": ["<uuid>"],
    "canton_id": ["<uuid>"],
    "distrito_id": ["<uuid>"],
    "created_range": "30d"
  }
}
```

**Salida:** sin cambios — `{status:"ok", items, total, page, pageSize}`. La feature no
altera el DTO de la orden.

**Errores:** los ya existentes del arnés — `validation_error` (con `fieldErrors`),
`unauthenticated`, `forbidden`. Sin códigos nuevos.

## 7. Integraciones externas

Ninguna. Sin Supabase Auth nuevo, sin Meta, sin WhatsApp, sin webhooks, sin crons.

## 8. Riesgos

1. **Contaminación de dominio en A.** El riesgo principal de esta reconciliación.
   Mitigado por el criterio de corte de `requirements.md` + una regla dura de review:
   ningún test de R1–R20 puede importar dominio, y `FilterComponent` no puede
   importar nada de `lib/types/orden` ni de `app/(app)/ordenes`.
2. **Ensanchar el alcance por accidente.** Mitigado por el orden de escritura del
   `where` (§2.3) + tests de rol (R27/R28) que fallan si el filtro pisa el scoping.
3. **Payload del catálogo en conexiones móviles.** Cuantificado (§3.2): ~70 KB, ~15 KB
   comprimido, una vez por sesión de página gracias a SWR.
4. **Off-by-one horario.** El repo YA tiene la trampa (`startOfDayCR` es medianoche
   UTC de la fecha CR). Mitigado con helper propio + tests de borde.
5. **Regresión silenciosa en la key de SWR.** Mitigado con test de estabilidad de
   `serializarFiltro`.
6. **Sobre-generalizar A con un solo consumidor.** Se acota a lo que órdenes necesita
   HOY (dos tipos de control + dependencias declaradas); todo lo demás queda como
   pregunta abierta (k)/(m), no se implementa "por si acaso".

## 9. Alternativas descartadas

### 9.1 URL del navegador (query params) + Server Action — **DESCARTADA por el humano**

Guardar la selección en `?zona=...&provincia=...` daría filtros compartibles por
enlace, back/forward del navegador y estado recuperable al recargar. **El humano la
evaluó y la descartó explícitamente**: se extiende `filter` y punto. Consecuencias
asumidas: la selección no es enlazable ni sobrevive a un refresh (pregunta (g)).

### 9.2 Una consulta al servidor por cada selección (cantones de la provincia X)

Es lo que hoy ofrece `GeoService.listCantones(provinciaId)` /
`listDistritos(cantonId)`. Descartada: el humano fijó "precargar todo y encadenar en
el front", y los números lo respaldan — 582 filas / ~70 KB una vez, contra un
round-trip por cada clic en un select múltiple (marcar N provincias = N consultas,
con parpadeo y estados de carga anidados en pleno panel abierto).

### 9.3 Encadenamiento hardcodeado dentro del componente

La versión anterior de este diseño resolvía provincia→cantón→distrito con utilidades
que conocían esos tres nombres. Descartada tras la corrección del humano: acopla el
componente al dominio de órdenes y lo vuelve inservible para el siguiente consumidor.
Sustituida por el contrato `dependsOn` + `parentValue` (§A.4).

### 9.4 Componente "tonto": que el consumidor recalcule las opciones y las repase por props

Evaluada en detalle en §A.4 y descartada: duplica acotamiento + poda en cada
consumidor, crea un lazo `onChange → props → onChange` y no ahorra la poda (que el
componente necesita igual para no emitir huérfanos).

### 9.5 Filtro genérico dentro de `DataTable`

Descartada: la ficha genérica de la 144 ("DataTable: búsqueda y filtros") está
RETIRADA, y acoplar los filtros a la tabla impediría usarlos en superficies sin
`DataTable`. `FilterComponent` es independiente de cómo se pinte el resultado; el
consumidor decide dónde lo monta.

### 9.6 Validar contra el catálogo cada id recibido (existencia + propiedad)

Descartada por coste sin beneficio: 1–6 queries extra por listado, y el peor caso de
un id inventado ya es "cero filas" (§2.2). La seguridad la da el scoping por rol
(§2.3), no la existencia del id. Se conserva la garantía dura de que un id no
reconocido **jamás** se degrada a "sin filtro".

### 9.7 Enviar nombres en vez de ids (patrón de la feature 117)

La 117 filtra por `cantonNombre` porque opera sobre un array ya en el cliente. Aquí el
filtrado es server-side sobre FKs, y el humano pidió ids explícitamente. Los nombres
además son ambiguos en CR (varios cantones "Central") y no son estables.

### 9.8 Migrar YA el filtro de estado a `FilterComponent`

Descartada en esta feature (§4.2): tocaría el camino probado de la 63 sin petición, y
R33/R46 exigen demostrar cero regresión. Candidato para la 145.

### 9.9 Índices compuestos `(zona_id, created_at)` etc.

Descartada por ahora: sin telemetría de las combinaciones reales de filtros, elegir el
compuesto sería adivinar y costaría escrituras en la tabla más caliente. Se empieza
por los cuatro índices simples (§1.2).

### 9.10 Rango de fechas libre (desde/hasta) como única forma del filtro de tiempo

No descartada del todo: es la pregunta abierta (a). Se descarta **como diseño
cerrado** hasta la puerta F1.4.

---

## Preguntas abiertas

> Se cierran en la **puerta humana F1.4**, no antes. Cada una lleva mi recomendación
> razonada. Regla 6 de `CLAUDE.md`: lo que no está en el código, `docs/` o `specs/` es
> desconocido y se marca, no se rellena.
>
> (a)–(h) son las de la versión previa del spec y **siguen en pie tal cual**;
> (i)–(n) nacen del contrato genérico.

### (a) Forma del filtro de tiempo: presets relativos vs. rango desde/hasta

**Recomendación: presets relativos (7 / 15 / 30 / 90 días), calculados server-side.**

- **Presets.** El cliente manda `"30d"`; el servidor calcula
  `desde = 00:00 CR del día (hoy_CR − 29)` convertido a UTC (= `startOfDayCR` + 6 h) y
  filtra `created_at >= desde`. Bordes: el día empieza a las 06:00 UTC; una orden
  creada a las `2026-07-15T05:59:59Z` (23:59:59 CR del 14) cae en el día 14. No hay
  borde superior (siempre hasta "ahora"), así que no hay ambigüedad de "hasta
  inclusive". Whitelistable con `z.enum` ⇒ superficie de ataque nula. El resultado no
  depende del reloj del navegador.
- **Rango desde/hasta.** Más potente, pero el cliente manda dos fechas `YYYY-MM-DD` y
  hay que decidir e implementar: `desde` = 00:00 CR de esa fecha (06:00 UTC de ese
  día) y `hasta` = **inclusive**, es decir `< 00:00 CR del día siguiente` (= 06:00 UTC
  del día+1). El error clásico —`hasta` como `<= 00:00 UTC`— perdería todas las
  órdenes del último día creadas después de las 18:00 CR del día anterior. Además
  exige un date-picker de rango que **no existe** en `components/ui/` (habría que
  añadir `calendar`/`popover` de shadcn) **y un tipo de filtro nuevo en A**
  (pregunta (k)).

Recomiendo presets en v1 y dejar el rango para después. **Si el humano prefiere rango,
la regla de bordes es la del párrafo anterior, hay que presupuestar el date-picker y A
gana un `kind` nuevo.**

### (b) Zona: `orden.zona_id` (congelada) vs. derivada del distrito

**Recomendación: filtrar por `orden.zona_id`.**

Verificado: `orden.zona_id` **existe y es NOT NULL** (no es un campo hipotético), y la
relación distrito→zona es N:M vía `zona_distrito` (la columna escalar
`distrito.zona_id` se eliminó en `20260713000000`). Son **dos caminos posibles y
distintos**:

1. `orden.zona_id` — la zona con la que la orden se creó/operó. `WHERE` directo sobre
   columna indexada. Coincide con lo que el usuario ve en la tabla y con lo que usan
   las acciones por lote (`row.zonaId`, `zonaEsGam`).
2. Derivar por el distrito (`orden.distrito_id → zona_distrito → zona_id`) — refleja el
   mapeo VIGENTE. Requiere JOIN, falla para órdenes con `distrito_id = NULL`, y un
   distrito puede pertenecer a **varias** zonas (N:M), así que "la zona de la orden"
   deja de ser única.

Filtrar por (2) mostraría en "zona X" órdenes que se operaron en "zona Y" porque
alguien reasignó el distrito después. Recomiendo (1). **Pregunta:** ¿existe algún caso
operativo donde se espere lo contrario (re-zonificación retroactiva)? Si lo hay, es
una feature de backfill de `orden.zona_id`, no de este filtro.

### (c) Vía del precargado: prop desde el Server Component vs. Server Action cacheada

**Recomendación: Server Action propia + SWR con key fija** (razonado en §3.4: simetría
con el catálogo de estados, deduplicación entre navegaciones dentro de la SPA, y no
inflar el RSC payload de cada carga de `/ordenes` con ~70 KB).

Contra: una petición extra al montar (mitigada por SWR y porque el listado se pinta
sin esperarla). **Pregunta:** ¿se acepta que los filtros aparezcan deshabilitados
durante los primeros ms, o se exige que estén operativos en el primer paint (lo que
forzaría la prop desde el servidor)?

### (d) Opciones del filtro de tienda: todas las cuentas vs. solo las que tienen órdenes

**Recomendación: todas las cuentas dueñas posibles** (`adminTienda` + `apiKey`), por
ser una consulta trivial e indexada, frente a un `SELECT DISTINCT tienda_id FROM orden`
que es caro y varía con el resto de filtros. Coste: el usuario puede elegir una tienda
sin órdenes y ver 0 resultados. **Pregunta:** ¿aceptable?

### (e) Estado de las cuentas tienda en las opciones

`UserRepository.listByRol` filtra hoy `estado: 'activo'`. Una tienda desactivada puede
tener órdenes históricas: si se copia ese filtro, esas órdenes se vuelven infiltrables.
**Recomendación: incluir también las inactivas**, marcándolas en la etiqueta (p. ej.
`"Tienda X (inactiva)"`). **Pregunta:** ¿o se prefiere la simetría con el resto de
selects (solo activas)?

### (f) Órdenes con `distrito_id = NULL` bajo el filtro de distrito

`distrito_id` es el único FK geográfico nullable. Con `distrito_id IN (...)` esas
órdenes quedan **fuera**, que es la semántica correcta de SQL y la que ya adoptó la
feature 117 (R6: "las órdenes con `distritoNombre === null` quedan excluidas bajo
distrito"). **Recomendación: mantenerla y documentarla en la UI.** **Pregunta:** ¿hace
falta una opción explícita "sin distrito"? Recomiendo que no en v1.

### (g) Persistencia de la selección de filtros

Descartada la URL (decisión cerrada del humano), la selección **se pierde** al recargar
o al navegar fuera de `/ordenes` y volver. **Recomendación: aceptarlo en v1** (es el
comportamiento actual del filtro de estado, así que no hay regresión ni
inconsistencia). **Pregunta:** ¿se quiere persistirla en `sessionStorage`? Es barato,
pero introduce un estado invisible que confunde ("¿por qué veo pocas órdenes?").

### (h) ¿`admin` ve el filtro de tienda con las cuentas `apiKey` mezcladas?

Las cuentas de integración por API key son usuarios reales con nombre, pero no son
"tiendas" en el sentido de la UI. **Recomendación: mostrarlas en la misma lista** (son
dueñas de órdenes; excluirlas haría infiltrables las órdenes de la 88), ordenadas
alfabéticamente junto al resto. **Pregunta:** ¿se quiere distinguirlas visualmente
(sufijo "(API)") o agruparlas aparte?

### (i) ¿`FilterComponent` ofrece "Limpiar todo"?

Cada `MultiSelectFilter` ya trae su propio "Limpiar" por filtro. Con 6 filtros
encadenados, volver a cero cuesta hasta 6 clics. **Recomendación: sí, un "Limpiar
todo" opcional por prop** (`showClearAll`, default `false` para no alterar a nadie),
que vacía la selección y emite `{}` una sola vez. Añadiría un requisito a A.3.
**Pregunta:** ¿se quiere en v1?

### (j) ¿Estado controlado, no controlado o híbrido?

**Recomendación: no controlado (estado interno) + `onChange`**, porque la poda
transitiva (R18) necesita decidir sobre el conjunto y un padre que "corrija" la
selección entre renders reintroduce el lazo de §9.4. Contra: el consumidor no puede
resetear los filtros desde fuera (p. ej. al cambiar de pestaña) salvo remontando el
componente con una `key`. Híbrido posible: `defaultValue` + `onChange` (no controlado
con valor inicial). **Pregunta:** ¿hace falta control externo hoy?

### (k) ¿Qué tipos de filtro soporta v1?

`multi` y `single` cubren los seis filtros de órdenes. Candidatos evidentes para
después: `text` (búsqueda libre), `dateRange` (ver (a)), `boolean`.
**Recomendación: solo `multi` y `single` en v1**, con `FilterKind` como unión abierta a
extender y R8 (tipo desconocido = se ignora sin romper) como red de seguridad.
**Pregunta:** ¿se necesita alguno más desde ya (en particular `dateRange`, que depende
de (a))?

### (l) Forma exacta del payload emitido

**Recomendación: `Record<string, string[]>` para todos los tipos** (el `single` emite
lista de 0 o 1), con las claves vacías omitidas. Alternativas: `Record<string, string[]
| string>` (obliga a `Array.isArray` en cada consumidor) o
`Array<{key, values}>` (más verboso, sin ventaja). **Pregunta:** ¿se confirma el mapa
con listas siempre?

### (m) ¿Un filtro puede declarar más de un padre?

Hoy `dependsOn` es **una** clave y `parentValue` **un** valor, que es todo lo que la
cadena provincia→cantón→distrito necesita. Un `dependsOn: string[]` (con `parentValues:
string[]` por opción y semántica AND/OR entre padres) es una generalización real, pero
sin consumidor que la pida. **Recomendación: un solo padre en v1** (regla del arnés: no
sobre-ingeniería). **Pregunta:** ¿hay algún filtro previsto que dependa de dos?

### (n) ¿Dónde vive `FilterComponent`?

`docs/architecture.md` exige DOS consumidores con la misma API antes de promover a
`components/shared/`, y hoy hay uno (órdenes). Pero el humano pidió explícitamente que
nazca genérico y reutilizable, y la feature 145 (rollout a todas las tablas) es su
segundo consumidor declarado en `feature_list.json` (`depends_on: 144`).
**Recomendación: `components/shared/FilterComponent.tsx` desde ya**, porque el diseño
genérico ya está pagado y moverlo después significaría reescribir imports en la 145.
**Pregunta:** ¿se acepta la excepción a la regla de las dos superficies, o se prefiere
que nazca en `app/(app)/ordenes/_components/` y lo promueva la 145?
