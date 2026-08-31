# 335 — Diseño

## 0. Resumen de la decisión

Tres piezas, en orden de dependencia:

1. **Un módulo PURO** `lib/utils/filtros-url.ts`: traduce `URLSearchParams → { termino,
   seleccion, activos }` contra un catálogo de `FilterDef[]`, y calcula qué claves hay
   que borrar al limpiar. Sin React, sin DOM, sin router: ahí viven R4 y R8-R16 y son
   verificables sin renderizar nada.
2. **Un hook** `hooks/useFiltrosUrl.ts`: envuelve `useSearchParams`/`useRouter`/`usePathname`
   de `next/navigation`, congela la lectura inicial y expone `borrarParams(claves)`.
3. **Dos props nuevas por componente** en los canónicos, que consumen (1) y (2) por
   dentro. Un consumidor que hoy ya cablea `filtros`/`activos`/`onActivosChange`/`onChange`
   hereda la capacidad **sin tocar una línea**.

No hay migración, ni tabla, ni RLS, ni endpoint: esta ficha no cruza la frontera de red.
No añade dependencias.

## 1. Por qué el reparto es este y no otro

El obstáculo real está medido y es estructural: **hoy nada acepta estado inicial**.

- `FilterComponent` arranca con `useState<FilterSelection>({})` (línea 322) y no expone
  ni `value` ni `defaultValue`.
- `BuscadorFiltros` arranca con `const [texto, setTexto] = useState("")` (línea 153).
- Las **claves activas** las posee el CONSUMIDOR (`activos` + `onActivosChange`), porque
  es él quien sabe traducir clave → control. Así que un param en la URL no basta con
  «cargarlo»: tiene que conseguir además que su control se **monte**.

De ahí sale el reparto:

| Quién | Qué lee de la URL | Por qué él |
| --- | --- | --- |
| `BuscadorFiltros` | el término libre y **qué claves activar** | Es el único que ve la lista OFRECIDA (`filtros: FiltroDisponible[]`) y el único que puede pedir el montaje (`onActivosChange`). También es el dueño de «Limpiar todo». |
| `FilterComponent` | los **valores** de cada clave | Es el único que ve el catálogo completo (`FilterDef[]` con `kind`, `options`, `minChars`), y sin él no se puede validar un valor (R10-R14). |

La barra emite `onActivosChange` una vez al montar; el consumidor re-renderiza con los
controles declarados; el orquestador se monta después y siembra sus valores. **El orden
funciona en las dos direcciones** gracias a la regla de siembra por clave (§3.2), así que
no depende de que el consumidor monte antes o después.

## 2. `lib/utils/filtros-url.ts` — el códec puro

Modelado sobre el precedente ya existente `app/(app)/analitica/_components/operativo/filtro-tablero.ts`,
del que se copian dos cosas y no se inventa ninguna: el separador **coma** y la interfaz
mínima de lectura (`{ get(name): string | null }`, que también cumple el objeto de
`next/navigation`). Aquí se amplía a `getAll` para R9.

```ts
/** Lo mínimo de URLSearchParams que se necesita (lo cumple el de next/navigation). */
export interface LectorParams {
  get(name: string): string | null;
  getAll(name: string): string[];
  entries(): IterableIterator<[string, string]>;
}

/** Param por defecto del término libre de la barra (decisión A1, pendiente de ratificar). */
export const PARAM_TERMINO_DEFAULT = "q";

/** Separador de valores dentro de un param (precedente: filtro-tablero.ts). */
export const SEPARADOR_VALORES = ",";

/** Trozos no vacíos de todas las apariciones del param (R8 + R9). */
export function valoresDeParam(params: LectorParams, clave: string): string[];

/** Valores YA validados contra el catálogo de ese filtro (R10-R14, R16). `[]` = ausente. */
export function valoresValidos(filtro: FilterDef, crudos: string[]): string[];

/** R3, R16: la selección precargada, solo con claves que sobrevivieron la validación. */
export function seleccionDesdeUrl(
  params: LectorParams,
  filtros: readonly FilterDef[],
): FilterSelection;

/** R2: claves OFRECIDAS presentes en la URL, en el orden en que se ofrecen (no el de la URL). */
export function activosDesdeUrl(
  params: LectorParams,
  ofrecidos: readonly { key: string }[],
): string[];

/** R1: término libre precargado, ya recortado, o "". */
export function terminoDesdeUrl(params: LectorParams, terminoKey: string): string;

/** R19/R20: la query resultante de quitar SOLO los params propios. */
export function queryTrasLimpiar(
  params: LectorParams,
  clavesPropias: readonly string[],
): string;
```

### 2.1 Validación por `kind` (R10-R14)

| `kind` | Regla |
| --- | --- |
| `multi` | se conservan los valores que existen en `options[].value`; el resto se descarta |
| `single` | primer valor que existe en `options[].value`; el resto se descarta |
| `boolean` | se acepta exclusivamente `BOOLEAN_MARCADO` (`"true"`) |
| `text` | valor recortado, aceptado solo si `length >= (minChars ?? 0)` |
| `dateRange` | terna `atajo,desde,hasta` rellenada a 3 posiciones; atajo ∈ `options[].value` o `""`; extremos vacíos o `YYYY-MM-DD`; `desde > hasta` invalida la terna entera; los tres vacíos = ausente |
| otro | `kind` no soportado: se descarta (coherente con `KINDS_SOPORTADOS`) |

El orden importa: la validación se hace contra el catálogo **tal como está declarado en
el momento de la siembra**. Un filtro con `dependsOn` cuyo padre no está seleccionado ve
todas sus opciones visibles, así que su valor se acepta y la poda existente
(`podarSeleccion`) resuelve después cualquier incoherencia; no se duplica esa lógica.

### 2.2 Lo que el códec NO hace

- **No escribe.** No existe `aSearchParams`: la dirección es una sola (decisión del
  humano). La única salida es `queryTrasLimpiar`, que RESTA.
- **No escapa el separador.** Ver A2 en requirements: un valor con coma es inexpresable y
  cae por R14. Se documenta como límite conocido en el propio archivo.

## 3. Cambios en los canónicos

### 3.1 `BuscadorFiltros` — props nuevas

```ts
/** Lee el estado inicial de la URL al entrar y limpia sus params al «Limpiar todo». */
leerDeUrl?: boolean;          // default true (R23 es el opt-out)
/** Nombre del query param del término libre. Default PARAM_TERMINO_DEFAULT. */
terminoKey?: string;
```

Implementación:

- El texto inicial se resuelve en el **inicializador perezoso** del `useState`:
  `useState(() => (leerDeUrl ? terminoDesdeUrl(params, terminoKey) : ""))`. **No hay
  `setState` en efecto** (R25): `useSearchParams()` ya devuelve un valor de render, no
  una fuente mutable externa, así que no procede `useSyncExternalStore` (ese patrón —
  `usePreferenciaColumnasManifiesto` — existe para `localStorage`/`matchMedia`, que sí lo
  son). Congelar en el inicializador es además lo que implementa R7 de forma estructural:
  un cambio posterior de los params no puede reabrir esa puerta.
- `emitido.current` se inicializa con ese mismo término, para que la guarda de «sin
  cambio» siga siendo cierta y limpiar el campo emita `""` una sola vez.
- La activación de claves y la emisión inicial del término se hacen en **un efecto de
  montaje con guarda de una sola pasada** (`useRef` booleano): llama a
  `onActivosChange(activosDesdeUrl(...))` y a `onChange(termino)` una vez y nunca más
  (R5, R2). Emitir hacia el consumidor desde un efecto es el patrón que el propio
  `FilterComponent` ya usa para su poda (líneas 387-398); no es una novedad de estilo.
- `limpiarTodo()` añade, antes de lo que ya hace, la llamada a `borrarParams([terminoKey,
  ...filtros.map(f => f.key)])` (R19-R22). Los params ajenos no entran en esa lista, así
  que sobreviven (R20).

### 3.2 `FilterComponent` — props nuevas

```ts
leerDeUrl?: boolean;   // default true
```

Siembra **por clave y una sola vez por clave**, con un `useRef<Set<string>>` de claves ya
sembradas:

- El estado inicial se calcula en el inicializador perezoso:
  `useState(() => (leerDeUrl ? seleccionDesdeUrl(params, montados) : {}))`, y esas claves
  entran de salida en el set de sembradas.
- Cuando `filters` **crece** (porque la barra activó una clave, o porque el usuario pidió
  un control), se siembran las claves nuevas que estén en la URL y **no** en el set.
  Esto es lo que hace que el resultado no dependa del orden de montaje.
- La siembra **se cierra para siempre** en cuanto llega el primer cambio originado por el
  usuario. Sin ese cierre, quitar un control y volver a ponerlo resucitaría el valor de la
  URL que el usuario ya había descartado.
- **Convivencia con la poda** (R17): la poda borra las claves que dejan de estar
  declaradas. Como la siembra sucede sobre claves **ya declaradas** (`montados`), la poda
  no las ve como sobrantes. El caso peligroso —sembrar una clave que aún no está
  declarada— no puede ocurrir porque `seleccionDesdeUrl` recibe `montados`, no la URL
  cruda.
- La emisión inicial de la selección precargada usa el camino de siempre (`emitir`), con
  su debounce, para que el consumidor no tenga que distinguir «esto vino de la URL».

### 3.3 `hooks/useFiltrosUrl.ts`

```ts
export function useFiltrosUrl(activo: boolean): {
  params: LectorParams;               // vacío si !activo o si no hay fuente (R24)
  borrarParams: (claves: readonly string[]) => void;
};
```

- `useSearchParams()` puede devolver `null` fuera del App Router y en algunos entornos de
  test: se sustituye por `new URLSearchParams()` (R24), sin lanzar.
- `borrarParams` usa `router.replace(cadena ? \`${pathname}?${cadena}\` : pathname,
  { scroll: false })` — copiado literal del patrón de `TableroDiaModule.cerrarDetalle`
  (R21, R22).

## 4. Riesgo conocido: `useSearchParams` y `Suspense`

`useSearchParams` en un componente cliente obliga a que la página esté envuelta en
`Suspense` **si Next intenta prerenderizarla estáticamente**; si no, el build falla o cae
a CSR entera. Al meterlo en los canónicos, ese requisito lo heredan de golpe las ocho
superficies que los montan.

Evidencia a favor de que no explota: los precedentes actuales
(`FiltrosOperativos`, `PanelesOperativos`, `CierresAdminModule`, `TableroDiaModule`) usan
`useSearchParams` **sin ningún `Suspense`** alrededor —`grep Suspense` en
`app/(app)/analitica` no devuelve nada— y todas esas rutas viven bajo `(app)`, que es
autenticada y por tanto dinámica.

No se da por bueno de palabra: **hay una task explícita de correr `pnpm exec next build`**
(nunca `pnpm build`, que encadena `migrate deploy` contra una base real) y de revisar el
resultado antes de dar la ficha por hecha. Si alguna ruta se queja, la salida es
`leerDeUrl={false}` en ese consumidor o un `Suspense` local — no revertir el diseño.

## 5. Alternativas descartadas

### 5.1 `nuqs` (o cualquier librería de query state) — DESCARTADA

No existe hoy en el repo (verificado en `package.json`). Su modelo es **bidireccional**:
el estado y la URL se sincronizan en los dos sentidos, que es exactamente lo contrario de
la decisión del humano («solo leer al entrar; la URL no se reescribe al filtrar»). Usarla
significaría o bien pelear con su modelo o bien traicionar la decisión. Añade una
dependencia y un segundo vocabulario de query state al lado del códec puro que el repo ya
tiene escrito y probado (`filtro-tablero.ts`). Coste alto, beneficio nulo.

### 5.2 Resolverlo en cada consumidor (un hook por vista) — DESCARTADA

Es la opción que el humano vetó por escrito («ligada al componente, no a una vista»), y
además está medida como enfermedad activa: la ficha **326** existe precisamente porque hay
ocho buscadores reimplementados fuera de los compartidos. Ocho copias del códec serían
ocho sitios donde el formato de un `dateRange` puede divergir.

### 5.3 Volver `FilterComponent` totalmente controlado (`value` + `onChange`) — DESCARTADA

Sería la solución «limpia» de libro, pero su radio de impacto es todo el repo: obliga a que
los ocho consumidores pasen a poseer la selección, choca de frente con la ficha **328**
(que va a introducir un «modo aplicar» con borrador local para las cuatro barras de wallet
sobre cifras de dinero) y con la **326**, que está migrando consumidores ahora mismo.
Sembrar un valor inicial es estrictamente más pequeño y no cierra ninguna puerta: el día
que exista `value`, el valor inicial pasa a ser el fallback del modo no controlado, que es
el contrato normal de React.

### 5.4 Params con prefijo (`?f.zona=…`) — DESCARTADA

Haría trivial el borrado de «Limpiar todo» (bastaría con el prefijo) y eliminaría de raíz
el riesgo de choque con un param ajeno. Se descarta porque la ficha lo prohíbe
explícitamente: «la clave del param es la MISMA clave del filtro que viaja al back». Un
enlace `?mensajero_id=…` es legible y coincide con el contrato del endpoint; `?f.mensajero_id=…`
no es ni una cosa ni la otra.

## 6. Nota de colisión con la ficha 326 (`in_progress`, misma zona)

La 326 migra consumidores ad-hoc **hacia** estos mismos canónicos. Solape y mitigación:

| Archivo | 335 | 326 | Riesgo |
| --- | --- | --- | --- |
| `components/shared/BuscadorFiltros.tsx` | añade 2 props + rama en `limpiarTodo` | probable: no lo toca, lo consume | **bajo**, si la 335 solo AÑADE props opcionales |
| `components/shared/FilterComponent.tsx` | añade 1 prop + siembra en el estado inicial | probable: no lo toca, lo consume | **bajo**, misma razón |
| Consumidores (`app/(app)/**`) | **ninguno** | todos | **nulo** por construcción |
| `lib/utils/filtros-url.ts`, `hooks/useFiltrosUrl.ts` | archivos nuevos | — | nulo |

Mitigación, en una frase: **la 335 no toca ni un archivo bajo `app/`.** Todo su diff vive
en dos archivos compartidos —y solo por adición de props opcionales con default— más dos
archivos nuevos y sus tests. Si la 326 aterriza primero, la 335 rebasa sin conflicto
semántico; si aterriza la 335 primero, los consumidores que la 326 migre heredan la
capacidad gratis. La ficha **328** (huecos del canónico) es vecina pero no bloqueante: su
hueco 1 pide un vaciado *controlado* desde fuera y su nota dice literalmente que hoy
«bloquea cualquier pantalla que quiera sembrar el término desde la URL» — la 335 lo
resuelve por la vía del valor **inicial**, que no requiere control y no invade su diseño.

## 7. Contratos de I/O (resumen)

**Entrada:** la query string de la ruta actual + el catálogo declarado por el consumidor.
**Salida hacia el consumidor:** exactamente los callbacks que ya existen —`onChange`
(término), `onActivosChange` (claves), `onChange` (selección)—, con los valores
precargados, una sola vez.
**Salida hacia el navegador:** un único `router.replace` sin scroll, y solo en «Limpiar
todo».
**Nada viaja a la red por causa de esta ficha:** la traducción de la selección al contrato
del servidor sigue siendo del consumidor, sin cambios.
