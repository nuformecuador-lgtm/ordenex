# Feature 130 — analítica: componentes de gráficas · design

> Feature de **presentación pura**: cero tablas, cero migraciones, cero RLS, cero endpoints, cero
> Server Actions. §1 existe igualmente porque `docs/specs.md:22-25` la pide y el reviewer valida
> contra `CHECKPOINTS.md:22-27`.
>
> **Decisiones del humano del 2026-07-31 (D1 recharts, D2 la 129 mergeada, D3 la 135 mergeada)**
> están incorporadas como cerradas; ver `requirements.md > Decisiones del humano`. **La puerta F1.4
> se cerró el 2026-07-31**: Q1 = recharts directo sin la primitiva de shadcn (§3.2), Q2 = sólo
> tokens y **sin conmutador de tema**, Q3 = techo de 5 series (§3.3), Q4 = `TablaResumen` sí, como
> envoltorio fino (§7.1), Q5 = se arregla `KpiValorAnimado` aquí (§7.2), Q6 = tope de 62 puntos por
> serie y el tablero agrega antes (§3.4). **No queda ninguna pregunta abierta.**

## 1. Modelo de datos

**Ninguno.** Ni tabla, ni columna, ni índice, ni migración, ni `down.sql`, ni política RLS. Ninguna
ruta nueva en `app/` (la ruta ya la entregó la 129), ningún route handler, ninguna Server Action.
No se toca `db/`, `lib/services/`, `lib/repositories/` ni `lib/actions/`.

**Único archivo de producción fuera del paquete que esta feature modifica:**
`components/shared/KpiValorAnimado.tsx` (Q5, §7.2). Se dice aquí y no en un pie de página porque es
un compartido con dos consumidores vivos y el reviewer tiene que verlo en el diff sin sorpresas.

La única frontera de datos relevante es la del patrón `private/` (`docs/architecture.md:139-140`,
`CHECKPOINTS.md:36-37`): **el componente recibe los datos ya resueltos y ya autorizados por el
Server Component padre.** R2 lo convierte en un guard estático en vez de una buena intención.

## 2. Archivos

```
components/private/analytics/
  tipos.ts             # props del paquete. Re-exporta MetricaUnidad de la 135 con `import type`.
  paleta.ts            # color de serie -> token --chart-N. Puro y determinista (R16-R19).
  topes.ts             # MAX_SERIES=5, MAX_PUNTOS_SERIE=62 + recorte/errores. Puro (R30-R33).
  formato.ts           # (valor, unidad) -> string. Puro (R20, R21).
  SerieTextual.tsx     # alternativa textual compartida por las 3 graficas (R10). Sin recharts.
  KpiCard.tsx          # sin recharts.
  TablaResumen.tsx     # sobre DataTable. Sin recharts.
  GraficaBarras.tsx    # "use client" + recharts
  GraficaLineas.tsx    # "use client" + recharts
  GraficaDonut.tsx     # "use client" + recharts
  lienzo/              # los tres lienzos recharts, cargados por importacion diferida (R27)
    BarrasLienzo.tsx
    LineasLienzo.tsx
    DonutLienzo.tsx
```

`PascalCase.tsx` para componentes, nombre simple para módulos puros (`docs/conventions.md:8-10`).

Dos separaciones que no son estética:

- **`paleta.ts` y `formato.ts` aparte de los componentes**, por la misma razón por la que la 135
  separó `types.ts` de `metrics.ts`: son la parte testeable **sin DOM**, y aquí eso no es elegancia
  sino supervivencia (§6).
- **`lienzo/` aparte de la gráfica**, porque es lo único que importa `recharts`. La gráfica
  (estados, título, alternativa textual, formato) se renderiza siempre; el lienzo se carga
  diferido (§4). Sin esta partición, R27 no es implementable y R10 tampoco es fiable: si recharts
  falla o no ha cargado, la alternativa textual tiene que seguir ahí.

`private/` y no `shared/` porque lo dice la ficha y porque `docs/architecture.md:89` reserva
`private/` para «componentes con datos sensibles (datos via props)», que es literalmente el caso.

## 3. El motor de dibujo

### 3.1 Decidido: recharts (D1, 2026-07-31)

Decisión del humano. No se sigue evaluando. Lo que corresponde a esta spec es declarar la
consecuencia y acotarla (§4), no relitigarla.

### 3.2 EXCEPCIÓN RAZONADA #1 — «recharts directo, sin la primitiva de shadcn» (Q1, decidida)

**Esto es una excepción a una regla escrita del repo, y va con nombre para que nadie tenga que
adivinar por qué se saltó.**

- **Regla que se excepciona:** `docs/architecture.md:136` — «**Nunca crees un componente si ya
  existe en shadcn/ui**». La primitiva existe (`components/ui/chart.tsx`) y **no** se trae (I2).
- **Quién lo decidió:** el humano, en la puerta F1.4 del **2026-07-31**. No es criterio del
  spec_author ni del implementer.
- **Alcance de la excepción:** sólo el gráfico. `Card`, `Skeleton`, `Button`, `Table` y el resto se
  siguen tomando de shadcn como siempre. Esta excepción **no** autoriza a escribir a mano nada más.

**Motivo, concreto.** La primitiva de shadcn resuelve el color con un objeto `ChartConfig`
(`{ [serie]: { label, color } }`) que **escribe cada llamador**, y un `ChartStyle` que inyecta un
`<style>` con variables CSS **por instancia de gráfica**. Es decir: el mapa serie→color deja de
estar en un sitio y pasa a estar en cada tablero. Eso es **exactamente lo que R16 prohíbe**, y con
131, 132 y 133 por delante serían tres o más catálogos de color divergentes mantenidos a mano.
`paleta.ts` hace lo mismo con un array y una función pura que un test puede afirmar (R17, R19).

La variante intermedia (`ChartContainer` sí, `ChartStyle` no) se descartó por ser la peor de las
tres: deja media API de shadcn en el repo y el siguiente lector no sabe cuál es la fuente del color.

**Lo que se paga por esta excepción, sin adornos:** tooltip, leyenda y contenedor responsivo se
escriben aquí en vez de heredarse; si mañana shadcn mejora su primitiva, esta feature no se
beneficia sola; y el `docs/architecture.md:136` queda con una excepción que hay que recordar. Se
acepta a cambio de que el color tenga **una sola fuente** en todo el producto. **R39** convierte
esta decisión en un guard: si alguien añade `components/ui/chart.tsx` más adelante, el test avisa y
obliga a reabrir esta discusión en vez de dejar dos fuentes de color conviviendo en silencio.

### 3.3 Techo de 5 series y qué pasa al desbordarlo (Q3, decidida)

Hay **5** tokens (`--chart-1..5`, I4) y hay métricas de **19** categorías (`ordenes_por_estado`,
I26). La decisión: **el paquete admite como máximo 5 series** (`MAX_SERIES = 5`, R30) y agrupar la
cola en «otros» es del **tablero 131** (R34). Ciclar los tokens quedó descartado porque produce dos
categorías del **mismo color en la misma leyenda**, que es peor que no colorear: el lector cree que
son la misma serie. Degradar por opacidad tiene el mismo problema con contraste peor. Ampliar
`globals.css` a 19 tokens es decisión de marca, no de esta feature (§9.14).

**Comportamiento al desbordar (R31) — decidido: ruidoso en desarrollo, degradado seguro en
producción.**

| Entorno | Qué hace | Por qué |
|---|---|---|
| `development` / `test` | lanza `SeriesExcedidasError` con el número recibido y el tope | el llamador es un tablero **nuestro** (131). Su bug tiene que morir en **su** test, no viajar a producción. Un `console.warn` no rompe ninguna build y se ignora |
| `production` | conserva las 5 primeras **en el orden recibido**, descarta el resto y **anuncia el recorte con texto** («se muestran 5 de 8 series») | tirar la pantalla entera de `/analitica` porque una métrica creció de 5 a 6 categorías sería un fallo peor que el que se intenta evitar. El aviso textual impide la mentira silenciosa: nadie lee «5 series» creyendo que son todas |

Las dos ramas son **testeables sin DOM** (`analytics-topes.test.ts` alterna `NODE_ENV`), que es
justo lo que exige R31. La alternativa «recortar siempre en silencio» se descartó: convertiría un
bug del tablero en un gráfico plausible pero falso, y nadie lo vería nunca.

### 3.4 Tope de puntos por serie: **62** (Q6, decidida)

El tablero (131) agrega antes de pasar los datos; la gráfica sólo declara el techo y lo hace
cumplir (R32, R33). El número **no** es un adorno, se elige con dos criterios que se cruzan:

1. **Calendario.** El rango máximo son 366 días (`RANGO_TOPE_DIAS`, I27). Los granos legítimos que
   el tablero puede entregar son: **mes** (≤ 12 puntos en 366 días), **semana** (≤ **53**) y **día**
   (≤ 366). El tope debe **admitir el peor caso legítimo agregado** —53 semanas— con algo de margen,
   y **rechazar** el rango diario largo, que es el error que se quiere cazar.
2. **Píxeles.** El mensajero mira esto en móvil (H2): ~360 px de ancho útil. 62 puntos ≈ **5,8 px
   por punto**; por debajo de eso una barra deja de ser distinguible y una línea se convierte en
   ruido. Más puntos no informan mejor: informan peor.

**62 = 53 semanas + margen**, y a la vez **62 = 31 × 2**, el rango **diario** más largo que sigue
siendo legible en móvil (dos meses naturales). Es el mayor número que satisface los dos criterios a
la vez, y está a 6× de distancia de 366, así que «pasar el rango crudo» falla siempre y de forma
inequívoca. Ese es el test de R32: `53 < MAX_PUNTOS_SERIE < 366`.

**Al desbordar (R33)** se aplica la misma política que en §3.3, con una diferencia deliberada: se
conservan los **últimos** puntos, no los primeros. En una serie temporal lo reciente es lo que se
está mirando; quedarse con enero cuando el usuario pidió el año sería absurdo.

## 4. El coste de recharts, dicho sin disimulo (D1 → R26, R27)

### 4.1 El problema real

Recharts arrastra el grafo de `d3-scale`, `d3-shape`, `d3-array` y `victory-vendor`. **No tengo la
cifra**: no está instalado en esta base (I1) y no voy a instalar una dependencia desde una spec.
Que el argumento central no tenga número es motivo para que **medirlo sea una task (T5.2)**, no
para afirmar de memoria.

Y hay un agravante que conviene no maquillar (H2 en `requirements.md`): **`mensajero` es uno de
los cinco roles con acceso a `/analitica`** (`lib/analytics/types.ts:54-62`). No se puede prometer
"esto no le llega al móvil del mensajero". Lo que sí se puede garantizar es **dónde** y **cuándo**.

### 4.2 Las tres barreras, en orden de eficacia

1. **Segmentación por ruta (R26).** Next.js App Router divide el bundle por ruta: un módulo sólo
   entra en el chunk de las rutas que lo importan. Si `recharts` sólo se importa desde
   `components/private/analytics/lienzo/*`, y ese paquete sólo lo importa `/analitica`, entonces
   `/mis-asignaciones` y el resto de la app **no lo cargan**. Esto es lo que más pesa, y su
   garantía es un **guard estático** (R26): un test que censa los imports del repo. Sin el guard,
   un día alguien mete un `KpiCard` con gráfica en el portal del mensajero y la barrera cae en
   silencio.
2. **Importación diferida dentro de la propia ruta (R27).** Los tres lienzos se montan con
   `next/dynamic` (o `React.lazy`), de modo que recharts sale del *First Load JS* de `/analitica` y
   viaja en un chunk propio. Efecto secundario **buscado**: mientras el chunk carga, el usuario ya
   ve el título, el estado y la alternativa textual (R10) — la información llega antes que el
   dibujo, no después.
3. **Nada de importar recharts desde un módulo de barril del paquete.** Si `tipos.ts` o un
   `index.ts` re-exportara los lienzos, cualquier import del paquete arrastraría recharts y las dos
   barreras anteriores se evaporan. **Por eso el paquete no tiene `index.ts`**: cada consumidor
   importa el archivo que necesita. Es feo y es deliberado.

### 4.3 Cómo se verifica

`next build` imprime, por ruta, el tamaño y el *First Load JS*. T5.2 exige:

- medir **antes** de instalar recharts (línea base) y **después**;
- registrar las dos tablas en `progress/impl_130.md` (`docs/verification.md:15-20`);
- afirmar explícitamente que el *First Load JS* de `/mis-asignaciones` **no cambia**.

Un umbral numérico en una spec se degrada solo, así que aquí no se fija ninguno: lo que se exige es
que la cifra quede **escrita**, para que el siguiente que la empeore tenga contra qué compararse.
La alternativa —un test que falle si el bundle crece— no existe hoy en este repo y montarla sería
otra feature.

## 5. Contrato de props, derivado de la 135 (D3)

`lib/analytics/types.ts:34` declara `MetricaUnidad` y su comentario dice, literalmente, que existe
«para la 130 (formato de gráfica)». Con D3 eso es contrato vigente: **se importa, no se copia.**

```ts
// components/private/analytics/tipos.ts
import type { MetricaUnidad } from "@/lib/analytics/types";   // D3 / R3. SOLO tipo: cero runtime.

/** Un punto: categoria (eje X / segmento) + valor. `null` = dato ausente, NO cero (R11). */
export interface PuntoDato {
  readonly categoria: string;   // ya formateada por el llamador (fecha CR, nombre de zona…)
  readonly valor: number | null;
}

/** Una serie con nombre. El color NO viaja en la prop: lo pone `paleta.ts` (R16). */
export interface SerieDato {
  readonly id: string;
  readonly etiqueta: string;
  readonly puntos: readonly PuntoDato[];
}

/** Estados comunes a las tres graficas (R5-R8). */
export interface EstadoVisual {
  readonly cargando?: boolean;
  readonly error?: string | null;   // ya saneado por el llamador (DataTable.tsx:116)
}

export interface GraficaProps extends EstadoVisual {
  readonly titulo: string;             // nombre accesible OBLIGATORIO (R9)
  readonly series: readonly SerieDato[];
  readonly unidad: MetricaUnidad;      // de la 135
  readonly className?: string;         // R24
}

export interface KpiCardProps extends EstadoVisual {
  readonly etiqueta: string;
  readonly valor: number | null;       // null => marcador de ausente (R14)
  readonly unidad: MetricaUnidad;
  readonly variacion?: { readonly delta: number; readonly etiqueta: string };   // R15
  readonly className?: string;
}
```

Cuatro decisiones que conviene ver escritas:

1. **Se importa `types.ts`, NUNCA `metrics.ts` (R3).** El catálogo son 23 métricas con
   `descripcion`, `alcance` por los 5 roles, `fuente` y nombres de tabla
   (`lib/analytics/metrics.ts:553-615`). Eso es **dato de servidor**: no tiene por qué viajar al
   navegador, y menos al del mensajero. El componente recibe `titulo`/`etiqueta` y `unidad` **ya
   resueltos** por quien sí puede llamar a `getMetrica(id)` server-side. `import type` se borra en
   compilación: coste de runtime cero.
2. **El color no es una prop.** Si el llamador pudiera pasar `color`, en tres tableros habría tres
   catálogos de color a mano y R16 moriría ahí. El llamador pasa **orden**; el orden determina el
   token.
3. **La categoría llega ya formateada.** El componente no sabe de fechas ni de
   `America/Costa_Rica`; el tablero sí, porque tiene el `RangoResuelto` de la 135. Meter aquí
   `fecha-cr` sería crear la segunda aritmética de fechas que la 135 se esforzó en evitar
   (su `design.md §7.2`).
4. **El error llega saneado**, copiando el contrato de `components/shared/DataTable.tsx:116`
   («Mensaje de error ya saneado por el consumidor»). El componente no traduce códigos
   (`docs/conventions.md:18-22`).

## 6. Testabilidad en jsdom — **el punto que puede hundir la feature**

D1 no resuelve esto: lo hace obligatorio. Dicho sin rodeos: **si la verificación depende de leer el
SVG que dibuja recharts, esta feature no se puede verificar en este repo.**

### 6.1 Por qué

1. `vitest.config.ts:10` corre en `node`; los tests de componente activan jsdom por archivo
   (`tests/components/EmptyState.test.tsx:1`).
2. jsdom **no calcula layout**: `offsetWidth`, `clientWidth` y `getBoundingClientRect()` devuelven
   `0` para todo. `pretendToBeVisual: true` (`vitest.config.ts:28`) activa `requestAnimationFrame`,
   **no** un motor de layout.
3. `ResponsiveContainer` de recharts mide su contenedor y, con ancho o alto `0`, **no renderiza
   nada**. No lanza: devuelve vacío. Un test que busque barras encontrará un DOM limpio y un
   mensaje de fallo inútil.
4. **El stub de `ResizeObserver` que ya existe NO resuelve esto.** Está en
   `tests/setup/jest-dom.ts:45-55` y su `observe(){}` está **vacío**: nunca notifica. Se añadió
   para que el `DataTable` (`components/shared/DataTable.tsx:288-296`) no reviente, no para dar
   tamaños. Creer que "ya está cubierto porque el stub existe" es la trampa concreta de esta
   feature, y por eso queda escrita aquí antes de empezar.

Es el mismo patrón que la 163 documentó con `IntersectionObserver`
(`tests/setup/jest-dom.ts:62-82`) y que el repo ya resolvió con `react-countup` (`:16-24`):
**cuando la librería externa no coopera con jsdom, se prueba el contrato, no la librería.**

### 6.2 Cómo se resuelve

Tres capas, en orden de importancia:

1. **R10 — la alternativa textual vive en el componente, no en el lienzo.** Cada gráfica renderiza,
   junto al lienzo, una entrada por punto (`SerieTextual.tsx`). No es un truco de test: es
   accesibilidad real (un SVG de barras es opaco para un lector de pantalla) y es lo que hace
   afirmable «esta gráfica muestra estos datos» con `screen.getByText`, midan 0×0 o no. Y como el
   lienzo va diferido (§4.2), esta capa es además **lo que el usuario ve primero**.
2. **`paleta.ts` y `formato.ts` puros.** Color por serie y formato por unidad se testean en
   `tests/unit/components/` sin renderizar nada (R17, R21). Ahí vive la lógica que puede
   equivocarse de verdad.
3. **El lienzo se afirma mínimamente**: que el componente lo intente montar, y poco más. **Ninguna
   aserción debe depender de coordenadas, anchos, ni de que recharts haya pintado N `<rect>`.**
   Esto ya no es un consejo: es **R41**.

### 6.2.1 La trampa concreta: una aserción que no mide nada

Merece un apartado propio porque es el error que esta feature va a cometer si nadie lo escribe
antes. Con el stub de `ResizeObserver` vacío (I11), `ResponsiveContainer` **no lanza: renderiza
vacío**. Consecuencia práctica:

- `expect(container.querySelector("svg")).toBeNull()` **pasa siempre**, tanto si el lienzo está bien
  como si el componente ni siquiera lo monta. Es una aserción decorativa.
- `expect(screen.queryByText("120")).toBeNull()` sobre un valor que sólo pinta recharts **también**
  pasa siempre. Verde permanente, cobertura cero.

Por eso R41 exige, para la única aserción admisible sobre el lienzo («se intenta montar»), una
**comprobación de mutación**: quitar el montaje del lienzo y ver el test **rojo**, con el resultado
anotado en `progress/impl_130.md` (T4.5). Un test que nunca ha fallado no es un test
(`docs/verification.md:21-24`). Y como esa aserción es la única que toca el lienzo, todo lo demás
—contenido, formato, color, topes— se afirma sobre la alternativa textual (R10) y sobre las
funciones puras, que sí miden algo.

### 6.3 Si hay que tocar el setup global

Puede hacer falta un mock de `ResponsiveContainer` (a un `div` de tamaño fijo) o un
`getBoundingClientRect` con dimensiones. **Preferencia dura: mock LOCAL al archivo de test de
analítica**, con `vi.mock("recharts", …)` en `tests/components/AnalyticsGraficas.test.tsx`.

`tests/setup/jest-dom.ts` es **global a toda la suite**: tocarlo puede mover tests ajenos, y esta
feature no puede permitírselo. Si acaba siendo inevitable, T4.3 obliga a comparar la suite completa
antes y después y a dejar la comparación escrita, como hizo la 163 al añadir su stub.

### 6.4 Lo que este diseño NO cubre — dicho antes, no en la review

Un fallo puramente visual (barras desalineadas, donut invertido, leyenda encima del eje, serie con
color ilegible sobre el fondo oscuro) **no lo detecta la suite**. Se detecta mirando la pantalla.
Cualquier promesa contraria sería falsa. La alternativa honesta sería Playwright con captura
visual, que hoy el repo no usa para componentes y que `CHECKPOINTS.md:19-21` no exige aquí.

## 7. Las dos piezas que no son gráficas (Q4 y Q5, decididas)

### 7.1 `TablaResumen`: se queda aquí, como envoltorio fino (Q4 = (a))

No es una gráfica, y conviene decirlo en vez de arrastrarlo.

`DESIGN.md:30` es tajante: «DataTable: única tabla para listas… Las tablas crudas se migran a
esta». Y `DataTable` (`components/shared/DataTable.tsx:236-525`) ya trae skeleton (`:331-365`),
`EmptyState` (`:366-381`), error (`:321-330`), scroll horizontal con flechas (`:485-522`) y
descarga opt-in (`:433-442`) — que además es justo lo que la 134 (export CSV) va a querer.
Reimplementar una tabla aquí sería deuda el día uno.

**Decidido (a): envoltorio fino en esta feature.** `TablaResumen` = `DataTable` + formato por
unidad (`formato.ts`, R38) + fila de totales por función pura (R23). Se descartaron (b) «que 131 y
132 usen `DataTable` directo» y (c) «es de otra feature» por el mismo motivo: sin esta pieza, el
formateo por `MetricaUnidad` se escribiría **dos veces**, una en cada tablero, y divergiría — el
mismo tipo de duplicación que motiva §3.2.

**Condición que hace válida la decisión:** la fila de totales y el formateo por unidad tienen que
ser **reales**. Un `TablaResumen` que se limite a re-exportar `DataTable` es un archivo de más
(`docs/architecture.md:142-145`) y el reviewer debe rechazarlo. R38 es exactamente esa condición
escrita como requisito: si el llamador tuviera que pasar formateadores, la pieza no sirve.

### 7.2 `KpiValorAnimado`: se arregla aquí (Q5), con red de no-regresión

**Decidido:** `components/shared/KpiValorAnimado.tsx` deja de hardcodear `const SIMBOLO = "₡"`
(`:14`) y resuelve la moneda con `lib/config/moneda.ts` (R35). Es una violación viva de
`docs/architecture.md:28-29` («sin hardcode de contexto») que esta feature iba a rozar de todos
modos, y arreglarla es más barato que documentar por qué se rodea.

**Lo que hace peligroso el cambio, en orden:**

1. **Es compartido y tiene dos consumidores en producción** (I29): el portal del mensajero
   (`KpisMensajero.tsx:27,32,37,42`) y los cierres (`cierre-factura.tsx:9,210`). Ambos usan la
   variante `moneda`. **`app/(app)/mis-asignaciones/_components/KpiValorAnimado.tsx` es SOLO un
   re-export** del compartido (`:2-5`, `:7-9`), **no una copia divergente**: arreglar
   `components/shared/KpiValorAnimado.tsx` cubre a los dos consumidores de una vez y **no hay que
   tocar nada en el portal del mensajero**. Que quede escrito para que nadie salga a cazar un
   duplicado que no existe.
2. **No tiene test propio** (I30). La premisa de la puerta decía que sí; es falsa. Su única red son
   los tests de sus consumidores: `tests/components/MisAsignacionesPage.test.tsx:97-119` y
   `tests/components/CierresAdminModule.test.tsx`.
3. **El string cambia** (I31): hoy `` `${SIMBOLO} ${n}` `` con `minimumFractionDigits: 0` produce
   «₡ 3.500»; `formatMonto` usa `style: "currency"` y produce «₡3.500,00» — **sin espacio y con
   decimales siempre**. Cualquier aserción de igualdad exacta sobre ese texto se rompe.
4. **El mock global de `react-countup`** (`tests/setup/jest-dom.ts:16-24`) llama a `formattingFn(end)`
   y renderiza su resultado. Sigue funcionando con el nuevo formateo **sin tocarlo**, porque el
   contrato `formattingFn` no cambia. Si alguien siente la tentación de tocar ese archivo, se aplica
   T4.3 (medir la suite antes y después): es global.

**Que se arregle no significa que el `KpiCard` de analítica lo monte.** Q5 decidió *arreglar el
compartido*, no *reusarlo*. `KpiCard` (R12–R15) formatea con `formato.ts` y **no anima**: animar
exigiría además enseñarle a `KpiValorAnimado` a respetar `prefers-reduced-motion` (R28), que es
ampliar todavía más el radio de un cambio compartido, sin que nadie lo haya pedido. Si el tablero
131 quiere el número animado, monta `KpiValorAnimado` —ya arreglado— dentro del slot de valor; el
paquete no se lo impide y no hereda su animación.

**Plan de no-regresión (R36, R37), en este orden:**

1. **Primero el test que falta.** Se escribe `tests/components/KpiValorAnimado.test.tsx` **contra el
   comportamiento actual**, antes de tocar el componente. Un test escrito después del cambio sólo
   certifica el cambio; escrito antes, certifica que se entendió lo que había.
2. **Se mide la suite antes** (conteo de archivos y de tests, no sólo «verde»: una corrida con
   *unhandled errors* omite archivos enteros y parece casi verde).
3. **Se aplica el cambio** y se ajustan **sólo** las aserciones que dependen del formato de moneda.
   Hoy no hay ninguna que lo haga por igualdad exacta: `grep "₡ "` en `tests/` da **0** resultados
   (I32), y `MisAsignacionesPage.test.tsx` usa `toHaveTextContent("350")`, que es subcadena de
   «₡350,00» y **sigue pasando**. Se espera delta 0; **si el delta no es 0, el cambio se revierte y
   Q5 vuelve a la puerta**, no se «arreglan» tests ajenos para que encajen.
4. **Se mide la suite después** y se pega la comparación en `progress/impl_130.md`.

**Lo que este arreglo NO consigue (H3), dicho aquí y no en la review:** `loadMonedaConfig` lee
`process.env[name]` con clave **dinámica** (`lib/config/moneda.ts:8`) y Next sólo inlinea
`NEXT_PUBLIC_*` y sólo en accesos estáticos, así que en cliente la configuración cae a su *default*
`es-CR`/`CRC`. **Eso no lo estrena esta feature:** `formatMonto`/`loadMonedaConfig` tienen 13
consumidores de producción y **cinco ya son `"use client"`** —`EtiquetaGuia`, `ChatConversacion`,
`PosOrderCardDetalle`, `PosOrderCardMosaico`, `SateliteOrderCard`— (I33, corregido contra
`origin/dev` el 2026-07-31). `KpiValorAnimado` sería el **sexto**, no el primero. Es decir: el
arreglo **alinea el KPI con lo que ya hacen sus vecinos**, y el símbolo deja de estar escrito en el
componente, que es lo que pedía `architecture.md:28-29`. Que la moneda sea configurable **en
cliente** es una ficha propia sobre `lib/config/moneda.ts`, con seis consumidores a revisar: **fuera
de alcance de la 130**, y no se disimula.

## 8. Encaje con el consumidor real (D2)

### 8.1 El shell que existe

`AnaliticaShell.tsx` en `origin/dev` (`git show origin/dev:app/(app)/analitica/_components/AnaliticaShell.tsx`,
`:7-12`; el `design.md` de la 129 declara lo mismo en `:82-87`):

```tsx
export interface AnaliticaShellProps {
  filtros?: ReactNode;    // "La enchufa la 131"
  operativo?: ReactNode;  // "Los enchufa la 131"
}
```

Server Component, sin `"use client"`. Monta `AppPage` y dos `<section aria-label>` con
`className="flex flex-col gap-4"`. Cada slot vacío cae a un `EmptyState` propio del shell.

Consecuencias directas para esta feature:

- **R24**: el contenedor de destino es una columna flex. Un componente con ancho fijo en píxeles
  rompe ahí. Nada de `w-[600px]`; ancho fluido y alto por `aspect-ratio` o por una prop de alto con
  default en `rem`.
- **R25**: el shell ya dice «llega en una entrega posterior» cuando el slot está vacío. El vacío de
  una gráfica significa otra cosa —*hay panel, no hay datos en este rango*— y repetir el texto del
  shell haría la pantalla ilegible. Son dos vacíos distintos.
- El shell es Server Component y los lienzos son cliente: eso funciona (un servidor puede
  renderizar un componente cliente), pero confirma que **el `"use client"` empieza en la gráfica**,
  no se contagia hacia arriba.

### 8.2 Hallazgo H1 — sigue sin haber llamador

El propio shell lo dice en su comentario (`:19-25`): «La 130 aporta los componentes… **La 131**
cablea las Server Actions y pasa esos componentes por `filtros` y `operativo`».

Es decir: D2 da **destino contractual**, no llamador. Al mergear, el grafo será `AnaliticaShell`
(existe) ← `131` (no existe) ← `130` (esta feature). No habrá ni un `import` de estos componentes
en producción hasta la 131. Es aceptable —son bloques de construcción con un punto de aterrizaje
definido y verificable— y está escrito; lo inaceptable sería venderlo como "ya integrado".

Efecto práctico: R26 (guard de imports) empieza vigilando un paquete que nadie importa. No es
inútil — es precisamente cuando conviene poner la valla.

### 8.3 El dominio financiero ya está decidido — no es un hueco

El shell no declara slot financiero, y eso **no es una omisión que haya que reportar**: es una
decisión tomada, escrita y razonada por la 129 (`specs/129-…/design.md:97-101`, y el mismo
razonamiento en el comentario del archivo, `:27-37`). Su motivo, citado:

> «no se deja prop muerta ni región vacía "por si acaso": una región financiera visible y vacía en
> un portal donde el dinero es sensible es peor que no tenerla — sugiere una cifra que no existe y
> expone una sección de plata a roles que ni siquiera deberían saber que existe el panel.»

Encaja además con D7 de la 135, que **prohíbe** el dominio financiero a `adminSatelite`,
`adminTienda` y `mensajero`. Añadir ese slot es trabajo de la feature que traiga el tablero
financiero, en los tres pasos mecánicos que la 129 dejó documentados.

Para la 130 la consecuencia es sencilla y no cambia nada: un `KpiCard` con `unidad: "moneda"`
funciona igual que cualquier otro; **quién puede verlo** se resuelve aguas arriba y este paquete no
lo anticipa ni deja props muertas.

## 9. Alternativas descartadas

1. **SVG a mano.** Descartada **por decisión del humano (D1, 2026-07-31)**. Tenía a favor cero
   dependencias, testabilidad total en jsdom (los `<path>` se generan en render, no se miden) y
   ningún `ResizeObserver`; en contra, escribir ejes, ticks, tooltip accesible, leyenda y foco por
   teclado a mano, contra `docs/architecture.md:136`. No se relitiga.
2. **Otra librería (`visx`, `nivo`, `@observablehq/plot`).** Descartada por D1 y, además, sin
   precedente en el repo ni respaldo de `architecture.md`.
3. **`chart.js` o cualquier motor de `<canvas>`.** Descartada con independencia de D1: un
   `<canvas>` es opaco para jsdom **y** para un lector de pantalla. Mataría R10 y §6 de un golpe.
4. **Adoptar la primitiva `components/ui/chart.tsx` de shadcn.** Descartada **por decisión del
   humano (Q1, puerta F1.4, 2026-07-31)**, como **excepción razonada** a
   `docs/architecture.md:136` documentada en §3.2. Motivo: su `ChartConfig` obliga a declarar
   `label` + `color` por serie en **cada llamador** y su `ChartStyle` inyecta un `<style>` por
   instancia → catálogos de color divergentes a mano en 131/132/133, justo lo que R16 impide.
   Guard: **R39**.
5. **Importar `@/lib/analytics/metrics` desde el componente** para resolver `etiqueta` y `unidad`
   por `id`. Descartada: mandaría al navegador 23 métricas con su `alcance` por rol, su `fuente` y
   nombres de tabla (`metrics.ts:553-615`) — información de servidor, en la ruta que también abre
   el mensajero (I28). El llamador resuelve server-side y pasa dos strings. Sí se importa
   `types.ts`, pero con `import type`: coste de runtime cero (R3).
6. **Pasar el color por props (`color="#f26419"` o `color="chart-2"`).** Descartada: reintroduce el
   catálogo a mano que R16 prohíbe. El llamador pasa orden, no color.
7. **Que cada gráfica lea el tema con `matchMedia` y elija paleta clara u oscura en JS.**
   Descartada por tres motivos acumulativos: (i) duplicaría los valores ya declarados en
   `app/globals.css:109-113` y `:149-153`; (ii) exigiría estado sincronizado con fuente externa, y
   `react-hooks/set-state-in-effect` es ERROR aquí (`components/ui/carousel.tsx:42-53`); (iii)
   parpadeo en la hidratación. Los tokens CSS hacen esto gratis y sin JavaScript.
8. **Un `index.ts` de barril en el paquete.** Descartada: cualquier import del paquete arrastraría
   recharts y anularía R26/R27 en silencio (§4.2, punto 3).
9. **Renderizar las gráficas en el servidor como SVG estático.** Tentadora por peso y por
   testabilidad perfecta, e incompatible con D1 en la práctica: mata tooltip y hover, que el
   tablero de la 131 va a querer.
10. **Reusar `components/shared/KpiValorAnimado.tsx` sin tocarlo.** Descartada **por decisión del
    humano (Q5)**: hardcodea `"₡"` (`:14`) contra `docs/architecture.md:28-29` teniendo
    `lib/config/moneda.ts:36-42` disponible, y se **arregla en esta feature** (§7.2, R35–R37).
    También descartada la tercera vía que recomendaba el spec_author («no tocarlo, ticket aparte»):
    dejaba la deuda viva en un compartido que esta feature roza igual.
11. **Meter los componentes en `components/shared/`.** Descartada: la ficha dice `private/` y
    `docs/architecture.md:89` reserva `private/` para datos sensibles por props, que es el caso.
12. **Extender `DataTable` con una prop `variant="resumen"`.** Descartada: metería dominio de
    analítica en la tabla genérica, contra su propio contrato
    (`components/shared/DataTable.tsx:82-90`: «Si al cablear una tabla nueva hiciera falta ampliar
    este contrato, es señal de que el diseño falló, no permiso para meter dominio aquí»).
13. **Escribir un E2E de Playwright.** Descartada: `CHECKPOINTS.md:19-21` lo reserva a flujos
    críticos. Esto es presentación sin ruta propia. El E2E corresponde a 131/132.
14. **Añadir `--chart-6..--chart-19` a `app/globals.css` para cubrir `ordenes_por_estado`.**
    Descartada **por decisión del humano (Q3)**: tocar la paleta del sistema de diseño para que
    quepa una métrica es una decisión de marca, no de esta feature. Y 19 colores distinguibles
    entre sí, accesibles y coherentes con la identidad no salen de una generación automática. En su
    lugar: techo de 5 + «otros» en el tablero (§3.3, R30, R34).
15. **Ciclar los 5 tokens cuando hay más de 5 series** (`indice % 5`). Descartada (Q3): dos
    categorías con el **mismo color en la misma leyenda** se leen como la misma serie. Es peor que
    no colorear, y peor que mostrar menos series diciéndolo (R31).
16. **Recortar en silencio al techo, sin avisar.** Descartada: convierte el bug de un tablero en un
    gráfico plausible pero falso, que nadie detecta jamás. De ahí la política doble de R31/R33:
    error con nombre fuera de producción, recorte **anunciado con texto** en producción.
17. **Agregar por semana/mes dentro del componente cuando el rango es largo.** Descartada (Q6): el
    componente es presentación pura (R2) y agregar exige saber de fechas, zona horaria y del
    `RangoResuelto` de la 135 — todo eso lo tiene el tablero 131 y ninguno el componente. Sería la
    segunda aritmética de fechas del producto, justo la que la 135 se esforzó en evitar. R34 lo
    prohíbe explícitamente aquí.
18. **Añadir un conmutador de tema (claro/oscuro) en esta feature.** Descartada (Q2): «theme-aware»
    se agota en usar los tokens de `app/globals.css` en sus dos temas (R16–R18). Hoy nadie aplica
    `.dark` (I16) y esta feature no lo va a cambiar; el conmutador es otra ficha. R40 lo cierra
    para que no reaparezca como hallazgo.

## 10. Integraciones

Ninguna externa (Supabase, Meta, WhatsApp, Shopify, Telegram). Internas:

| Con | Cómo | Estado |
|---|---|---|
| `app/(app)/analitica/_components/AnaliticaShell` | destino final, vía slot `operativo` de la 131 | existe en `dev` (D2); **no importa la 130 todavía** (H1) |
| `lib/analytics/types` | `MetricaUnidad` con `import type` (R3) | existe en `dev` (D3) |
| `lib/analytics/metrics` | **prohibido** en el paquete (R3, §9.5) | existe en `dev`, se usa server-side |
| `components/shared/EmptyState` | estado vacío (R5, R25) | existe |
| `components/shared/DataTable` | base de `TablaResumen` (R22) | existe |
| `components/ui/skeleton` | estado de carga (R6) | existe (`DataTable.tsx:16`) |
| `lib/config/moneda.ts` | formato de moneda y marcador de ausente (R13, R14) | existe (`:20-42`) |
| `components/shared/KpiValorAnimado.tsx` | **se modifica** en esta feature: moneda por configuración (R35–R37, §7.2) | existe, con 2 consumidores (I29) y sin test propio (I30) |
| `app/globals.css` `--chart-1..5` | paleta de series (R18) | existe, **sin consumidores** hoy |
| `recharts` | motor de dibujo (D1) | **a instalar** — T1.1 |

## 11. Riesgos

1. **jsdom no dibuja (§6).** El riesgo número uno. Si el implementer intenta afirmar sobre el SVG,
   se atasca; y el stub de `ResizeObserver` que ya existe **no** le va a ayudar (§6.1.4). Mitigado
   por R10 + módulos puros, al precio explícito de no cubrir el aspecto visual (§6.4).
2. **Bundle en el móvil del mensajero (D1, H2).** El mensajero **sí** entra a `/analitica`. Las
   barreras de §4.2 acotan el daño a esa ruta y lo difieren, pero la cifra **no está medida**: si
   T5.2 se salta, R27 se convierte en una afirmación sin respaldo.
3. **El techo de 5 series traslada trabajo a la 131 (Q3).** La regla ya está decidida (§3.3), pero
   depende de que el tablero agrupe en «otros». Si la 131 no lo hace, en desarrollo verá el error de
   R31 —que es el objetivo— y en producción verá 5 de 19 series con su aviso. Mitigación: T0.1 lo
   comunica al dueño de la 131 **antes** de que lo descubra programando.
4. **Tocar `tests/setup/jest-dom.ts` mueve la suite entera** (§6.3).
5. **La 130 se mergea sin llamador (H1).** El contrato de props (§5) se diseña contra un tablero
   que aún no existe; si la 131 lo desmiente, hay que rehacer props y tests. Mitigación real:
   derivar de la 135 (D3) en vez de inventar, que es lo que hace §5.
6. **Esta feature toca un compartido vivo (Q5).** `KpiValorAnimado` lo usan el portal del mensajero
   y los cierres (I29) y **no tiene test propio** (I30): el cambio de formato viaja sobre la
   cobertura indirecta de otras dos pantallas. Es el riesgo con más superficie fuera del alcance de
   la 130. Mitigado por el orden de §7.2 (test primero, medición antes y después) y por la regla de
   corte: **delta ≠ 0 ⇒ se revierte**, no se retocan tests ajenos.
7. **"Theme-aware" sin conmutador de tema.** Se puede cumplir R16–R18 al 100% y que nadie vea nunca
   el modo oscuro. **Decidido (Q2): es así a propósito**, el conmutador es otra ficha y R40 lo deja
   escrito. Riesgo residual: que alguien lo lea como feature incompleta en la review.
8. **Citar scratchpads ajenos en vez de `origin/dev`.** Riesgo metodológico, ya materializado una
   vez en esta misma spec (`requirements.md > Nota metodológica`): produjo un hallazgo falso sobre
   la 129. Con varias sesiones vivas sobre este repo, un archivo suelto en el scratchpad de otra
   sesión puede ser un respaldo obsoleto. Todo hecho de inventario debe reproducirse con
   `git show origin/dev:<ruta>`.

## 12. Verificación

`tests/components/*.test.tsx` (jsdom, declarado por archivo — `tests/components/EmptyState.test.tsx:1`)
para los componentes —incluido el **nuevo** `KpiValorAnimado.test.tsx` (R37)—;
`tests/unit/components/*.test.ts` para `paleta.ts`, `formato.ts`, `topes.ts` (R30–R33) y los guards
estáticos. R27 se verifica con la salida de `next build`, no con vitest (T5.2). Cierre con
`./init.sh` (`docs/verification.md:6-13`) y mapa `R<n> → test` en `progress/impl_130.md`
(`CHECKPOINTS.md:11-13`). Sin tests de integración (no hay DB ni HTTP) y sin E2E (§9.13).
