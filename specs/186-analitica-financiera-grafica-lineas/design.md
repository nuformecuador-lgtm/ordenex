# Feature 186 — analítica financiera: gráfica de líneas en el tablero · design

> Lee primero `requirements.md`. Las decisiones `⟨D1⟩..⟨D8⟩` de aquí son la respuesta técnica a
> esos requisitos; las `Q1..Q5` del final de `requirements.md` son lo que **no** se decide sin el
> humano.
>
> Feature de **presentación**: no crea tablas, columnas, índices, migraciones ni políticas RLS.
> Ver §5.

---

## 1. Punto de partida: qué se leyó y qué se corrigió al leerlo

La ficha manda tres lecturas y una advertencia. Las tres se hicieron **contra el árbol de esta
rama**, y dos de ellas hay que corregirlas antes de que alguien las cite de segunda mano.

**C1 — El hueco de la 132 no está en su `design.md` §5.** §5 es el *inventario de paneles* (nueve
paneles para ocho métricas) y no dice nada de un hueco. El hueco está declarado en **§7,
alternativa 6** («Pintar una gráfica de líneas… *Descartada por falta de dato, no por gusto*…
Queda como Q3 y, si se quiere, como ficha aparte») y en la **Q3 de su `requirements.md`**, cerrada
el 2026-08-03. §5 es lo que la Q3 anuncia que **cambiará** cuando el dato exista — que es hoy.
La cita de la ficha apunta al efecto, no a la declaración.

**C2 — La Q3 de la 132 remite a «la ficha 179» para el desglose por fecha.** Ese trabajo aterrizó
como la **180**; la 179 es la caché. Es el mismo desfase de numeración que la propia 132 documentó
en su §1 para otras tres fichas. Se anota para que nadie busque la serie temporal en la 179.

**C3 — El adaptador ya da hecho más de lo que parece.** `adaptar.ts` resuelve la frontera
`string → number` (`aNumero`, con su `null` para lo no finito), la selección del campo por **forma**
del importe (`cifraDeImporte`, `esVistaConNeto`) y la construcción de una serie del paquete
(`serieDeVista`, con sobrecargas que impiden pedir el `neto` de una vista que no lo publica). Esta
feature **no reescribe nada de eso**: añade una función hermana que delega en `serieDeVista` y solo
sustituye la etiqueta de cada punto (⟨D4⟩).

## 2. Hallazgo H1 — la 180 dejó una tabla de fechas encendida en el tablero

`ContenidoDeVista` decide por la forma del DTO, en este orden: vista por método → donut; vista por
tienda → barras + tabla; **`vista.filas.length === 0` → KPI**; cualquier otra → tabla.

Esa tercera rama era, hasta la 180, la de las siete métricas del desglose. Hoy esas siete traen una
fila por cubo, así que caen en la **cuarta**: con el rango por defecto (`mes`, 30 días,
granularidad `dia`) el tablero pinta una **tabla de ~30 filas de fechas** donde la 132 declaró una
tarjeta de KPI.

Ningún test se puso rojo porque los dobles de `tests/components/TableroFinanciero.test.tsx`
construyen esas vistas con `filas: []` (`vistaSinFilas`) y su comentario declara, con todas las
letras, que «el tablero NO la lee (Q4 = (a)…)». El caso que afirma el KPI mide **un DTO que el
servidor ya no publica**.

No es un defecto de la 180: su Q4 la dejaba fuera del tablero y su bitácora dice que en `app/`
solo tocó fixtures. Es el precio, previsible y ahora medido, de completar un fixture en vez de
consumir el dato. **Qué se hace con ello es la Q1**, y es lo único bloqueante de esta spec.

## 3. Decisiones

### ⟨D1⟩ Quién lleva línea lo dice `granularidad`, y nada más

El predicado es `vista.granularidad !== "no_temporal"`. No `grano === "fecha"`, no
`filas.length > 0`, no `tieneDesglosePorFecha(metricaId)`, no una lista de ids.

Por qué importa la diferencia, uno a uno:

- **`grano`** es la *dimensión* del cubo, no el grano temporal con el que están agregadas las
  filas. Son campos distintos y por eso la 180 añadió el segundo: una vista puede declarar
  `grano: "fecha"` y estar agregada por semana.
- **`filas.length`** es lo que rompió H1: dejó de significar «esta métrica no tiene serie» el día
  que la serie existió. Volver a apoyarse en él sería repetir el mismo error con otro signo.
- **el id de la métrica** está prohibido por R27 de la 132 y R22 de la 183, y además lo caza el
  censo (f) del guardia del tablero (§6). `tieneDesglosePorFecha` esquivaría el censo por ser una
  función importada, pero sigue siendo decidir por el nombre del catálogo: dos fuentes para la
  misma pregunta, y la del DTO es la que viaja con el dato.

Consecuencia declarada: si algún día una vista de `cod_recaudado` publicase granularidad temporal,
gana su línea sola, sin tocar el tablero. Y si la 180 se equivocara declarando `no_temporal` en una
vista que sí es temporal, el tablero **no la pinta** — que es el fallo seguro, no el plausible.

### ⟨D2⟩ Una gráfica por vista. No hay gráfica combinada, y no es una omisión

Cada vista tiene ya su `<section aria-label>` propia (`SeccionVista`), y la línea vive dentro. No
se construye ningún panel que junte varias métricas.

Tres razones independientes, cualquiera de ellas suficiente:

1. **El techo del paquete.** Seis métricas de flujo más la acumulada son **siete series**; con
   `bruto` y `neto` donde el importe los trae, más. `MAX_SERIES = 5` y `aplicarTopeSeries`
   **lanza** fuera de producción (`topes.ts`). Una gráfica combinada revienta en el primer test.
2. **No son sumables ni comparables sin más.** `ganancia_ordenex` y `ingreso_flete` miden cosas de
   escalas distintas; el DTO ni siquiera declara `sumableCon` entre métricas, solo entre vistas.
3. **La acumulada no se lee igual.** Ver ⟨D3⟩.

Esto es lo que hace que R8 sea cierto **por construcción** y no por vigilancia: no hay ningún sitio
donde dos vistas puedan compartir eje.

### ⟨D3⟩ `cuenta_por_pagar_mensajero` lleva línea, en su propia gráfica y **dicho por escrito**

Es la única de las siete que no es un flujo: su repositorio agrega **sin cota inferior** y su serie
es un acumulado corrido (⟨D5⟩ de la 180). Cada punto es el **saldo al cierre de su cubo**, no el
movimiento del cubo — «una cifra distinta, plausible y falsa, la peor combinación», en palabras de
la propia 180.

Qué se hace, y qué no:

- **Sí:** su propia gráfica en su propia sección (⟨D2⟩ ya lo garantiza) **más** un texto visible,
  solo en las acumuladas, que dice que cada punto es un saldo acumulado al cierre de su cubo (R6),
  y que **no** aparece en las de flujo (R7). El par R6/R7 es lo que hace que el test discrimine:
  sin R7, un implementer podría pintar el texto en las diez y pasar verde.
- **No:** no se toca el texto de «saldo al corte» que `CabeceraPanel` ya emite por `esAcumulado`
  (R18 de la 132). Ese habla del **total** de la cabecera; el nuevo habla de **cada punto de la
  serie**, que es otra afirmación. Reescribir el primero sería rehacer una feature `done` para
  decir algo que no dice.
- **Imposible:** ponerla en el mismo eje con otra forma de trazo. `SerieDato` es
  `{ id, etiqueta, puntos }` y **el color ni siquiera viaja en las props** (lo pone `paleta.ts` por
  orden, decisión §9.6 del design de la 130). «Otra forma» no existe en el contrato del paquete, y
  añadirla sería modificar la 130 — fuera de alcance y de zona.

### ⟨D4⟩ La etiqueta del punto es prefijo textual + la clave literal del cubo

`etiquetaDeCubo(clave, granularidad, textos)`, función **pura**, sin `Date`, sin zona horaria y sin
aritmética de calendario.

Por qué no un rango (`2026-08-10 – 2026-08-16`), que es lo primero que apetece:

- **El DTO no publica el fin del cubo.** `FilaFinanciera` es `{ cubo, importe }` y nada más.
- **El primero y el último cubo están truncados al rango** (`trocear`: el primer cubo semanal
  empieza en `desdeFecha` aunque no sea lunes, y el último se corta en `rango.hasta`). Un rango
  calculado sería **falso justo en los dos extremos**, que es donde el usuario mira para saber si
  el período está completo.
- **Calcularlo sería una segunda definición del día CR en el frontend**, exactamente lo que ⟨D4⟩ de
  la 180 existe para impedir. El off-by-one de seis horas entraría por la puerta de atrás y por una
  capa donde ningún guardia de `lib/analytics` mira.

«Semana del `<clave>`» es cierto en **todos** los cubos, incluidos los truncados: el cubo empieza
donde dice su clave, siempre. Y conserva la clave literal, que es lo que R24 de la 132 exige (el
identificador del cubo se pinta tal cual, sin enriquecerlo desde otra fuente).

El texto lo pone el **llamador** por parámetro, no el módulo puro: mismo patrón y misma razón que
`agruparCola(puntos, tope, etiquetaOtros)` en el archivo de al lado. Así `adaptar.ts` sigue sin
escribir una sola cadena de UI y el día que haya i18n se toca un objeto.

### ⟨D5⟩ La serie temporal **delega** en `serieDeVista` y solo reemplaza la categoría

```
serieTemporalDeVista(vista, campo, textos)
  = serieDeVista(vista, campo)  →  { ...serie, puntos: puntos.map(relabel) }
```

Así la conversión de importes, el manejo del ausente y las sobrecargas por forma del importe
siguen viviendo en **un solo sitio**. Escribir una segunda función que leyera `fila.importe` por su
cuenta duplicaría la frontera `string → number`, que es justo el punto del archivo donde una
feature de dinero puede mentir sin que se note.

Límite declarado, porque es real: `serieDeVista` sigue siendo invocable sobre una vista temporal y
devolvería las claves crudas. El tipo no lo impide sin romper a sus llamadores actuales. Lo cubren
el censo de R15 (los valores de granularidad viven en un módulo) y el test de comportamiento de R4,
no el compilador.

### ⟨D6⟩ El tablero **no** recorta puntos, y eso es una decisión

`agruparCola` **no** se aplica a una serie temporal: fusionar fechas en una categoría «Otros» no
significa nada en un eje de tiempo, y perdería el final de la serie, que es lo que se mira.

El techo lo garantiza el **servidor**: R19 de la 180 afirma que ningún rango admisible produce más
de `TOPE_PUNTOS_SERIE` filas, y R20 ata ese número a `MAX_PUNTOS_SERIE` con un test que lee las dos
fuentes (`cubo-temporal-tope.guardia.test.ts`). Recortar aquí sería recortar dos veces y, peor,
**esconder el día que esa garantía se rompa**: si el servidor enviara 63 puntos, lo correcto es que
`aplicarTopePuntos` lance fuera de producción, que es lo que el paquete está escrito para hacer.

Por eso el test de R9 incluye el caso de **62 puntos exactos**: fija la frontera por el lado bueno.

### ⟨D7⟩ Dónde se inserta la rama, y por qué la primera

En `ContenidoDeVista`, **antes** de las dos ramas de `cod_recaudado`:

```
if (esVistaTemporal(vista))  → <PanelKpi/> + <GraficaLineas/>
if (vista.id === VISTA_COD_RECAUDADO_POR_METODO) → donut
if (vista.id === VISTA_COD_RECAUDADO_POR_TIENDA) → barras + tabla
if (vista.filas.length === 0) → KPI
                              → tabla
```

Primera porque es la única rama que pregunta por una propiedad **general** del DTO; las otras dos
preguntan por ids de vista concretos. Hoy no hay solape (las dos de `cod_recaudado` son
`no_temporal`), y ponerla primera hace que, si algún día lo hubiera, gane la respuesta general en
vez de depender del orden. Las dos últimas ramas **no se tocan**: siguen sirviendo a
`cuenta_por_pagar_tienda` y a cualquier vista sin filas.

El KPI se conserva encima de la línea (R13): es el panel que la 132 declaró en su §5 para estas
métricas, y el `total` del DTO ya viaja en él sin sumar nada (R14 de la 132). La línea **se añade**.

### ⟨D8⟩ Nombres accesibles: la gráfica no puede llamarse igual que su sección

`GraficaMarco` emite su propia `<section aria-label={titulo}>`, así que una gráfica cuyo título sea
el de la sección que la contiene produce dos regiones indistinguibles para un lector de pantalla.
El tablero ya resuelve esto con el patrón `${titulo} · ${TEXTOS.<pieza>}` (`Distribución`,
`Comparativa por categoría`, `Detalle por categoría`). La línea añade una pieza más al mismo objeto
`TEXTOS`, con el mismo patrón. Ningún archivo nuevo escribe texto de UI fuera de ahí.

---

## 4. Contratos

### 4.1 `adaptar.ts` — lo que se añade (módulo PURO, sin React, sin I/O)

```ts
/** Los dos valores de `GranularidadVista` que SÍ describen una serie temporal. */
export const GRANULARIDADES_TEMPORALES = ["dia", "semana"] as const
  satisfies readonly GranularidadVista[];

export type GranularidadTemporalVista = (typeof GRANULARIDADES_TEMPORALES)[number];

/** Una vista cuya granularidad describe una serie en el tiempo. */
export type VistaTemporal = Omit<VistaFinanciera, "granularidad"> & {
  readonly granularidad: GranularidadTemporalVista;
};

/** Predicado por la FORMA del DTO. Hermano exacto de `esVistaConNeto` (⟨D1⟩). */
export function esVistaTemporal(v: VistaFinanciera): v is VistaTemporal;

/** Textos de UI que pone el llamador, como `etiquetaOtros` en `agruparCola`. */
export interface TextosCubo {
  readonly dia: string;      // puede ser "" — la clave se lee sola
  readonly semana: string;   // prefijo; la clave se concatena LITERAL
}

/** Etiqueta publicable de un cubo. Pura: sin `Date`, sin zona, sin aritmética (⟨D4⟩). */
export function etiquetaDeCubo(
  clave: string,
  granularidad: GranularidadTemporalVista,
  textos: TextosCubo,
): string;

/** Serie de una vista temporal: `serieDeVista` + reetiquetado (⟨D5⟩). */
export function serieTemporalDeVista(v: VistaTemporal & VistaConNeto, campo: CampoImporte, textos: TextosCubo): SerieDato;
export function serieTemporalDeVista(v: VistaTemporal, campo: "bruto", textos: TextosCubo): SerieDato;
```

Las sobrecargas replican las de `serieDeVista`: de una vista sin `neto` solo se puede pedir el
`"bruto"`, y pedir el otro **no compila**. Es el mecanismo que la 183 dejó montado y que aquí se
reutiliza sin inventar uno nuevo.

`esVistaTemporal` se implementa agotando el dominio con un `switch` sin rama por defecto: si
`GranularidadVista` ganara un cuarto valor, deja de compilar en vez de caer en silencio del lado
«no temporal». Es el mismo criterio que `normalizar` en `cargar.ts` aplica a las cuatro respuestas
del borde.

### 4.2 `TableroFinanciero.tsx` — lo que se añade

- Tres entradas nuevas en `TEXTOS`: el nombre de la pieza (para ⟨D8⟩), el prefijo de cubo semanal
  y la advertencia de saldo acumulado por punto (R6).
- Una rama en `ContenidoDeVista` (⟨D7⟩) y un componente local `PanelLineas` que compone
  `<PanelKpi/>` + `<GraficaLineas/>` y, si `datos.esAcumulado`, el texto de R6.
- `<GraficaLineas>` recibe `titulo`, `series`, `unidad` y `vacio`. **No recibe `avisoRecorte`**
  (R11) ni ninguna otra prop-función: una función no cruza la frontera RSC y falla en render, no en
  compilación. Es la misma abstinencia que el archivo ya practica y declara en su cabecera.
- Las series salen de reutilizar el patrón que ya existe: dos donde el importe trae los dos campos,
  una donde no (`esVistaConNeto`), igual que `seriesComparativas`.

### 4.3 Lo que NO cambia

`cargar.ts`, `rango.ts`, `PanelConciliacion.tsx`, `AnaliticaShell.tsx` y `page.tsx` **no se tocan**.
La feature no cambia qué se consulta, ni con qué rango, ni quién lo ve. El diff de producción cabe
en dos archivos.

---

## 5. Modelo de datos

**Ninguna migración. Ninguna tabla, columna o índice nuevo. Ningún cambio de RLS. Ningún
`down.sql`.** Esta feature no lee la base: consume un DTO que ya cruza el borde de la 122/127 con su
alcance por rol aplicado, y lo hace desde el mismo Server Component y el mismo Server Action que la
132 dejó cableados.

Frontera de seguridad, por si alguien la busca aquí: no cambia. La región financiera la ven
exactamente los roles que `esAccesoTotal` acepta, el gate sigue en `page.tsx` y la defensa real
sigue siendo el `forbidden` del borde. La serie no introduce ninguna dimensión de entidad —cada
clave de cubo es una fecha (R24/R28 de la 180)—, así que **no hay ningún identificador de persona
que pudiera filtrarse por esta vía**.

---

## 6. La guardia de censo del tablero: qué cubre de verdad

La ficha avisa de que `listasDeIdsAMano` solo marca arrays de dos o más ids y que la 180 tuvo que
escribir censo propio por eso. **Lo verifiqué y hay que matizarlo, porque la conclusión práctica
para esta feature es la contraria.**

**Lo que es cierto:** `listasDeIdsAMano` (censo (d) de `tests/unit/guards/tablero-financiero.guardia.test.ts`)
exige `presentes.length >= 2`. Un id suelto no es una lista para ese censo, y su propia
autocomprobación lo fija («detecta una lista de ids a mano y **no un id suelto**»). Es deuda real y
sigue sin dueño.

**Lo que la ficha no dice:** el **mismo archivo** tiene un censo (f), `decisionesPorIdDeMetrica`,
que la 183 añadió justamente para esto y que marca **un id suelto** en cinco formas —comparación en
los dos órdenes, `case`, pertenencia (`includes`/`startsWith`/`indexOf`) y literal de array **con
uno solo basta**—, con su autocomprobación al lado. Para los archivos que ese guardia censa, una
decisión por id suelto **no** pasa verde.

**Y por qué la medición de la 180 no contradice esto:** su mutación 18 sembró
`consulta.metrica.id === "egresos"` en `lib/services/AnaliticaFinancieraService.ts`. Ese archivo
**no está en el censo del guardia del tablero**, que recorre
`app/(app)/analitica/_components/financiero/` más `AnaliticaShell.tsx` y `page.tsx`. El guardia pasó
24/24 porque **no miraba ese archivo**, no porque su detector sea ciego. La 180 hizo bien en
escribir censo propio para `lib/`; de ahí no se sigue que el del tablero no sirva para `app/`.

**Conclusión para esta feature, en dos mitades:**

1. **No hace falta censo propio para «decisión por id de métrica».** El censo (f) ya cubre los dos
   archivos que esta feature toca, y además la carpeta se **recorre** (hay un caso que lo exige),
   así que cualquier archivo nuevo entra solo.
2. **Sí hace falta un censo nuevo, y es otro:** ningún guardia mira hoy los valores de
   `GranularidadVista`. Un `granularidad === "dia"` escrito en `TableroFinanciero.tsx` además del
   que vive en `adaptar.ts` es exactamente cómo «día» y «semana» acaban siendo el mismo píxel en un
   segundo sitio, y no lo detecta nada. Se **añade** al guardia existente un censo (g) que exige que
   solo un módulo de la región nombre esos valores, importando el dominio de
   `GRANULARIDADES_TEMPORALES` en vez de reescribirlo —misma técnica que el censo (e) usa con
   `RolValue`—, con su autocomprobación sobre texto prohibido y texto limpio.

**Regla para el implementer:** al ampliar ese archivo **no se retira ni se relaja ninguna
aserción**, y las cuentas ancladas que ya tiene se conservan. Si el censo (g) obliga a tocar algo
más, se dice en la bitácora.

**Límite declarado:** el censo cubre `app/(app)/analitica/`. Si el código de la región se moviera
fuera de esa carpeta, saldría del censo sin que nada se ponga rojo. Es la misma propiedad —y el
mismo límite— que el guardia ya tenía antes de esta feature.

---

## 7. Alternativas descartadas

1. **Una sola gráfica de líneas con las seis métricas de flujo (o con las siete) juntas.**
   *Descartada, y no por gusto:* siete series superan `MAX_SERIES = 5` y `aplicarTopeSeries`
   **lanza** fuera de producción, así que el primer test revienta; el DTO no declara sumabilidad
   entre métricas; y el tablero está construido como una sección por vista, de modo que una gráfica
   transversal obligaría a inventar un panel que no pertenece a ninguna métrica. Ver ⟨D2⟩.

2. **Rotular el cubo semanal con su rango de fechas (`2026-08-10 – 2026-08-16`).** *Descartada:*
   el DTO no publica el fin del cubo y el primero y el último están **truncados al rango**, así que
   el rótulo sería falso justo en los dos extremos; y calcularlo metería una segunda definición del
   día de Costa Rica en el frontend, que es contra lo que ⟨D4⟩ de la 180 está escrito. Ver ⟨D4⟩.

3. **Decidir qué vistas llevan línea por `grano === "fecha"`, por `filas.length > 0` o por
   `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` / `tieneDesglosePorFecha`.** *Descartada:* `grano` es la
   dimensión y no el grano temporal (por eso la 180 añadió un campo nuevo); `filas.length` es
   literalmente lo que produjo H1; y la lista de ids es decidir por el nombre del catálogo, que R27
   de la 132 y R22 de la 183 prohíben. Ver ⟨D1⟩.

4. **Aplicar `agruparCola` a la serie temporal «por si acaso» el servidor manda de más.**
   *Descartada:* una categoría «Otros» que funde fechas no significa nada en un eje de tiempo, se
   comería el final de la serie —que es lo que se mira— y **escondería** el día en que la garantía
   del servidor (R19/R20 de la 180) se rompa, que es justo cuando queremos que el paquete lance.
   Ver ⟨D6⟩.

5. **Declarar la granularidad solo en el título de la gráfica y dejar los puntos con la fecha
   cruda.** *Descartada:* el eje X y la alternativa textual (`SerieTextual` dicta
   `"<serie>, <categoría>: <valor>"` a un lector de pantalla) son lo que el usuario lee **punto a
   punto**. Un título correcto encima de un eje que dice «2026-08-10» para siete días de dinero
   sigue siendo la mentira que la ficha nombra, solo que mejor presentada.

6. **Formatear la fecha con `toLocaleDateString(...)` o `Intl.DateTimeFormat("es-CR", …)`.**
   *Descartada por dos motivos independientes:* pondría **rojo** el censo (c) del guardia del
   tablero (literal de locale, `["'][a-z]{2}-[A-Z]{2}["']`), y el repo no tiene formateador de
   fechas de UI que reutilizar —`formato.ts` formatea números y dinero—. Escribir uno aquí sería
   crear la primera política de formato de fechas del repo dentro de una feature `low` de
   presentación, sin que nadie lo haya pedido. La clave `YYYY-MM-DD` es la que el DTO publica y R24
   de la 132 pide pintar el identificador del cubo tal cual.

7. **Escribir un censo propio para «decisión por id suelto», calcado del de la 180.**
   *Descartada tras medirlo:* el censo (f) del guardia del tablero ya lo cubre para los archivos de
   esta región, y duplicarlo daría dos censos con el mismo nombre y detectores distintos —el
   problema que `roles-analitica-acceso-vs-dominio.test.ts` existe para recordar—. Lo que sí falta
   es el censo de los valores de granularidad, y ese sí se escribe. Ver §6.

---

## 8. Impacto en lo que ya está verde

| Artefacto | Impacto | Acción |
|---|---|---|
| `tests/components/TableroFinanciero.test.tsx` | Sus dobles de las siete métricas declaran `filas: []`, que ya no es lo que el servidor publica (H1) | Actualizarlos a filas por cubo y añadir una vista `semana` (R16). **Ampliar, no relajar**: los casos de la 132 y la 183 sobre KPI, formas de importe y totales siguen intactos |
| `tests/unit/analytics/tablero-financiero-adaptar.test.ts` | Verde y sin tocar; se le **añaden** los casos del adaptador temporal | Añadir bloques de R4, R5, R9, R10 |
| `tests/unit/guards/tablero-financiero.guardia.test.ts` | Verde; gana el censo (g) de §6 | Ampliar sin retirar ninguna aserción |
| `tests/unit/components/analytics-paquete-guard.test.ts` | **No se toca y debe seguir verde.** Prohíbe consultar nodos de recharts en tests cuyo nombre case `Analytics\|analytics-`, y exige que los tres lienzos sean los únicos que hablan recharts | Afirmar sobre nombres accesibles y texto; el lienzo se dobla como ya hacen los tests del tablero con barras y donut |
| `tests/components/AnaliticaPage.test.tsx` | Verde; esta feature no cambia el gate ni el pre-fetch | Sin cambios previstos |
| `tests/unit/analytics/tablero-financiero-cargar.test.ts`, `-rango.test.ts` | Sin relación: `cargar.ts` y `rango.ts` no se tocan | Sin cambios |

**Riesgo que ningún test del repo cubre:** la frontera RSC. Es el mismo que la 132 declaró en su
R11, y esta feature monta un Client Component nuevo (`GraficaLineas`) desde un Server Component.
Se cubre con el censo (a)/(b) del guardia **más** un `pnpm exec next build` a mano cuya salida se
pega en `progress/impl_186.md`. **Nunca `pnpm build`.**

---

## 9. Interacciones declaradas con las fichas vivas

| Ficha | Estado | Interacción |
|---|---|---|
| **180** | done | Se consume su DTO tal cual. Esta feature es la que su Q4 = (a) mandó abrir. No se le devuelve trabajo: H1 es colateral suyo, pero se repara aquí (Q1) porque el arreglo vive en `app/`. |
| **187** | pending | Envuelve las dos lecturas de `deCaja`/`deTesoreria` en una transacción de solo lectura (⟨L3⟩ de la 180). **Sin intersección**: no cambia la forma del DTO. Ojo a la lectura conjunta: mientras la 187 no aterrice, el `total` del KPI y la Σ de los puntos de la línea pueden discrepar en centavos por una escritura entre ambas consultas. Esta feature **no lo tapa** y **no debe** derivar el total de los puntos para hacerlo cuadrar: eso convertiría el R12 de la 180 en una tautología. |
| **179** | pending | Caché del dominio financiera. Esta feature no añade ni retira ningún `cacheTag`. |
| **184** | pending | Export de la analítica financiera. Consumirá la misma serie; la etiqueta de cubo de ⟨D4⟩ es de **presentación** y el export debe exportar la clave cruda, no el rótulo. Declarado aquí para que no se copie la función. |
| **131 / 133** | done | El slot `filtros` y el recorte por rol no se tocan. El filtro financiero sigue siendo la constante `mes` (Q4). |

---

## 10. Verificación

Además de la tabla `R<n> → test` de `requirements.md` §4:

- **Tests puros del adaptador** para todo lo que puede mentir sin renderizar nada: la etiqueta que
  ignora la granularidad, la etiqueta que inventa una segunda fecha, el punto que se pierde o se
  agrupa, el importe ilegible convertido en cero.
- **Tests de componente** sobre **nombres accesibles y texto**, nunca sobre nodos de recharts
  (lo prohíbe `analytics-paquete-guard.test.ts`): la alternativa textual de la gráfica
  (`SerieTextual`) emite `"<serie>, <categoría>: <valor>"` en una `<ul aria-label>`, que es
  exactamente donde se comprueba que el eje dice lo que debe.
- **Contrapeso de cobertura de los dobles** (R16): el juego de fixtures cubre los tres valores de
  granularidad y ninguna vista temporal viene con filas vacías. Sin esto, todos los casos de arriba
  podrían pasar por vacío.
- **`pnpm exec next build`** a mano, con la salida en la bitácora.
- `./init.sh --rapido` por tanda; **`./init.sh` completo antes del PR**.
