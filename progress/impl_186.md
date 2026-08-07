# Feature 186 — analítica financiera: gráfica de líneas en el tablero · bitácora

> Rama `feature/186-tablero-financiero-grafica-lineas`, con `dev` mergeado (incluye el hotfix
> PR #305, en producción desde el 2026-08-06).
> Spec: `specs/186-analitica-financiera-grafica-lineas/`. Decisiones de la puerta humana:
> `progress/decision_186.md`.

---

## 1. Baseline (T0.1) — medido antes de tocar nada

`pnpm exec vitest run` sobre los tres archivos que la feature iba a ampliar, en el árbol de esta
rama y sin una sola línea cambiada:

| Archivo | Resultado |
|---|---|
| `tests/components/TableroFinanciero.test.tsx` | verde |
| `tests/unit/analytics/tablero-financiero-adaptar.test.ts` | verde |
| `tests/unit/guards/tablero-financiero.guardia.test.ts` | verde |
| **Total** | **3 archivos, 121 casos, 0 rojos** |

Y como control lateral (los otros dos que el diseño declara sensibles):
`tests/components/AnaliticaPage.test.tsx` + `tests/unit/components/analytics-paquete-guard.test.ts`
→ **2 archivos, 67 casos, 0 rojos**.

**`ContenidoDeVista` coincide con `design.md` §2**, comprobado leyendo el archivo: cuatro ramas,
en este orden — donut por `VISTA_COD_RECAUDADO_POR_METODO`, barras + tabla por
`VISTA_COD_RECAUDADO_POR_TIENDA`, `esSerieTemporal(vista) || vista.filas.length === 0 → PanelKpi`,
y tabla en el resto —, con `esSerieTemporal(vista) { return vista.granularidad !== "no_temporal" }`
local al archivo. No hubo que parar.

## 2. Archivos tocados

**Producción (2 archivos, los dos que `design.md` §4.3 anticipó):**

- `app/(app)/analitica/_components/financiero/adaptar.ts` — recibe `esVistaTemporal` (mudada),
  `VistaTemporal`, `TextosCubo`, `etiquetaDeCubo` y `serieTemporalDeVista`.
- `app/(app)/analitica/_components/financiero/TableroFinanciero.tsx` — pierde `esSerieTemporal`,
  gana cuatro textos, `PanelLineas`, `MotivoSinSerie` y la prop `esAcumulado` en
  `ContenidoDeVista`.

`cargar.ts`, `rango.ts`, `PanelConciliacion.tsx`, `AnaliticaShell.tsx` y `page.tsx` **no se
tocaron**. Ni `lib/`, ni `db/`, ni `components/private/analytics/`.

**Pruebas (4 archivos):**

- `tests/components/TableroFinanciero.test.tsx` — +24 casos y el doble semanal.
- `tests/unit/analytics/tablero-financiero-adaptar.test.ts` — +25 casos.
- `tests/unit/guards/tablero-financiero.guardia.test.ts` — censo (g) + su autocomprobación.
- `tests/unit/analytics/tablero-financiero-rango.test.ts` — el censo se afina por la colisión de
  homónimos (§5).
- `tests/unit/guards/tablero-lineas-trazabilidad.guardia.test.ts` — **nuevo**.

**Bitácoras:** `progress/decision_186.md` (nuevo), este archivo (nuevo).

## Mapa completo `R1..R18` → test

> Escrito **abriendo los tests**, no copiando la tabla de `requirements.md` §4. Donde el nombre
> final difiere del previsto, se dice en la última columna.

| Req | Caso(s), con el nombre tal como quedó escrito, y su archivo | Nota |
|---|---|---|
| R1 | `` `%s`: una vista temporal de metrica de flujo trae su grafica de lineas dentro de su seccion `` (`it.each` sobre las seis de flujo), `son SEIS: la septima temporal es la acumulada, y esa no lleva linea` y `una vista temporal con neto emite DOS series en su linea, y una sin neto UNA`, los tres en `tests/components/TableroFinanciero.test.tsx` | el previsto no llevaba el prefijo `%s`, que es del `it.each`; los dos contrapesos son añadidos |
| R2 | `las vistas no_temporal no traen ninguna grafica de lineas, ni vacia` — `tests/components/TableroFinanciero.test.tsx` | literal |
| R3 | `la cuenta por pagar de mensajero NO trae grafica y dice en pantalla por que` y `el texto de «saldo al corte» de la 132 sigue donde estaba, y son dos frases distintas` — `tests/components/TableroFinanciero.test.tsx` | literal, con un caso más que fija ⟨D3⟩ |
| R4 | `el motivo no aparece en las seis de flujo ni en la cuenta por pagar de tienda` y **`una vista no_temporal de una metrica ACUMULADA que llega al KPI tampoco trae el motivo`** — `tests/components/TableroFinanciero.test.tsx` | el segundo NO estaba previsto y es el que de verdad mata la mutación: §4, M-10 |
| R5 | `una granularidad que el tablero no conoce se trata como serie, no como tabla` y `y su serie se rotula como grano NO DECLARADO, nunca como si fuera un dia` en `tests/components/TableroFinanciero.test.tsx`; `una granularidad que este binario no conoce se trata como SERIE, no como desglose` en `tests/unit/analytics/tablero-financiero-adaptar.test.ts` | literal; el unitario es añadido |
| R6 | `una vista de grano tienda con granularidad dia SI lleva linea, y una de grano fecha con no_temporal NO` en `tests/components/TableroFinanciero.test.tsx`; `` `esVistaTemporal` no mira el grano, ni el numero de filas, ni el id de la vista `` en `tests/unit/analytics/tablero-financiero-adaptar.test.ts`; `ningun archivo decide por el id de una metrica financiera` (censo (f)) en `tests/unit/guards/tablero-financiero.guardia.test.ts` | el censo (f) **ya existía** y no se reescribe |
| R7 | `la etiqueta del MISMO cubo cambia entre dia y semana`, `las dos etiquetas conservan la clave del DTO LITERAL, sin traducirla ni acortarla` y `la serie entera se rotula con el grano de SU vista, punto a punto` en `tests/unit/analytics/tablero-financiero-adaptar.test.ts`; `la alternativa textual de una vista semanal no lee sus puntos como dias` en `tests/components/TableroFinanciero.test.tsx` | literal |
| R8 | `la etiqueta nombra UNA sola fecha: la clave del cubo, y ninguna calculada`, `ninguna etiqueta de una serie semanal nombra una segunda fecha` y `el rotulador es PURO: la misma entrada da la misma salida y no depende del reloj` — `tests/unit/analytics/tablero-financiero-adaptar.test.ts` | literal |
| R9 | `una granularidad desconocida no se rotula como si fuera un dia`, `y aun asi conserva la clave del cubo, que es el unico dato cierto que hay` y `el default se distingue de la etiqueta diaria incluso con el prefijo diario VACIO` — `tests/unit/analytics/tablero-financiero-adaptar.test.ts` | literal; el tercero es contrapeso añadido |
| R10 | `un punto por fila, en el orden del DTO, sin cola agrupada`, `una serie de 62 puntos llega entera y no lanza` y `el orden es el del DTO: no se reordena por clave ni por valor` en `tests/unit/analytics/tablero-financiero-adaptar.test.ts`; `la vista semanal pinta TODOS sus cubos, sin agrupar ninguna cola` en `tests/components/TableroFinanciero.test.tsx` | literal; el de componente es añadido |
| R11 | `un importe ilegible es dato ausente y nunca cero` y `el valor es el del campo pedido de SU fila, sin derivarlo del total ni del vecino` — `tests/unit/analytics/tablero-financiero-adaptar.test.ts` | literal |
| R12 | `ningun archivo pasa avisoRecorte ni ninguna otra prop-funcion a un componente cliente` (censo (b)) — `tests/unit/guards/tablero-financiero.guardia.test.ts` | **ya existía**, no se reescribe |
| R13 | `una vista temporal sin filas muestra el vacio con su texto, no un lienzo mudo` — `tests/components/TableroFinanciero.test.tsx` | literal |
| R14 | `la vista temporal conserva su KPI junto a la linea y sigue sin tabla` y `el KPI va ANTES que la linea en el orden del documento` — `tests/components/TableroFinanciero.test.tsx` | literal; el segundo es añadido |
| R15 | `ningun archivo escribe un simbolo de moneda, un codigo ISO ni un locale` (censo (c)) — `tests/unit/guards/tablero-financiero.guardia.test.ts` | **ya existía**; la carpeta se recorre, así que cubre lo nuevo |
| R16 | `solo un modulo de la region nombra los valores de granularidad`, `y ese modulo SI los nombra: el censo no puede pasar por vacio`, `(g) detecta el valor de granularidad entrecomillado en sus formas reales` y `(g) no marca el campo, ni el TIPO, ni el texto de UI que empieza igual` — `tests/unit/guards/tablero-financiero.guardia.test.ts` | censo (g), **nuevo** |
| R17 | **(a)** `la fixture declara temporales EXACTAMENTE las siete que la 180 desgloso por fecha` y `la serie de la fixture es DENSA: una fila por dia del rango, treinta para treinta dias` — **los dos ya existían y NO se reescribieron**; **(b)** `la fixture declara acumuladas EXACTAMENTE las dos que el contrato acumula`; **(c)** `los dobles cubren las TRES granularidades, semana incluida`; **(d)** `ninguna vista de la fixture mezcla formas de importe entre su total y sus filas`. Todos en `tests/components/TableroFinanciero.test.tsx` | (b)(c)(d) literales |
| R18 | `el mapa R1..R18 esta completo, sin saltos ni repetidos, y cita tests que existen` y `cada fila nombra el CASO, no solo el archivo: el mapa se escribio abriendo los tests` — `tests/unit/guards/tablero-lineas-trazabilidad.guardia.test.ts` | literal, **nuevo** |

## 4. Evidencia de mutación

Cada mutación se sembró **en el código de producción**, se ejecutó, y se revirtió con **la
edición inversa exacta** (nunca `git checkout`). Tras cada reversión se comprobó el **hash** del
archivo (`sha256sum`) contra el valor previo, y al cerrar cada tanda, `git diff --stat`.

Hash de referencia de `adaptar.ts` durante toda la campaña:
`f00fa6312436632237277302c3cf1142d1a56503edd6b03fc7936d27c99e3be6` — restaurado y verificado
después de cada una de las mutaciones que lo tocan.

| # | Mutación sembrada | Dónde | Veredicto |
|---|---|---|---|
| M-1 | la etiqueta **ignora `granularidad`** (`case "semana"` rotula con el texto diario) | `adaptar.ts`, `etiquetaDeCubo` | **muere**: 2 rojos de R7 |
| M-2 | la etiqueta con **rango calculado** `clave – clave+6` (con `Date` y aritmética) | `adaptar.ts`, `etiquetaDeCubo` | **muere**: 2 rojos de R8 |
| M-3 | la rama **`default` devuelve la clave cruda** | `adaptar.ts`, `etiquetaDeCubo` | **muere**: 2 rojos de R9 |
| M-4 | **`agruparCola` sobre la serie temporal** (tope 5, etiqueta «Otros») | `adaptar.ts`, `serieTemporalDeVista` | **muere**: 3 rojos (R10 ×2, R8 ×1) |
| M-5 | **`?? 0` en la conversión** (`Number.isFinite(v) ? v : 0`) | `adaptar.ts`, `aNumero` | **muere**: 4 rojos (R11 + 3 heredados de R15/132) |
| M-6 | **la señal en positivo** (`=== "dia" \|\| === "semana"`) | `adaptar.ts`, `esVistaTemporal` | **muere**: 1 rojo unitario (R5) + 2 rojos de componente (R5). **Ningún rojo en el bloque del hotfix**, tal como el spec anticipaba |
| M-7 | **decidir por `grano`** (`vista.grano === "fecha"`) | `adaptar.ts`, `esVistaTemporal` | **muere**: 2 rojos (R6 de componente + R6 unitario) |
| M-8 | **línea también en la acumulada** (quitar `!esAcumulado`) | `TableroFinanciero.tsx` | **muere**: 2 rojos (R3 + el caso del hotfix conservado para la acumulada) |
| M-9 | **no renderizar la gráfica** (`false &&` delante de la condición) | `TableroFinanciero.tsx` | **muere**: 14 rojos (R1, R7, R10, R13, R14) |
| M-10 | **el motivo en TODA métrica acumulada** (quitar `esVistaTemporal(vista) &&`) | `TableroFinanciero.tsx` | **SOBREVIVIÓ** a la primera versión de R4 → ver abajo. Con el caso añadido, **muere**: 1 rojo |
| M-11 | **KPI sustituido por la gráfica** (borrar `<PanelKpi/>` de la rama) | `TableroFinanciero.tsx` | **muere**: 17 rojos (R14 + 10 heredados de la 132/183 y del hotfix) |
| M-12 | **nombrar la granularidad en un segundo módulo** (`vista.granularidad === "dia"` en el tablero) | `TableroFinanciero.tsx` | **muere**: 2 rojos (censo (g) de R16 + el censo de rango de la 132) |
| M-13 | **quitar la vista semanal del juego de dobles** | `TableroFinanciero.test.tsx` | **muere**: 1 rojo (R17 c) |

### Las dos mutaciones que sobrevivieron a la primera versión de su test

Se anotan porque son el único hallazgo real de la campaña, y porque las dos son de la misma
familia: **un requisito escrito, un test con el nombre correcto, y ninguna rama ejercitada**.

**M-5 (`?? 0`) sobrevivió a la primera versión de R11.** El caso usaba un importe `""` como
«ilegible», y `""` sale por la guarda del vacío (`if (recortado === "") return null`), no por la
comprobación de finitud, que es donde vivía la mutación. Se reescribió el caso para ejercitar
**las dos** formas de ilegible —`""` y `"no-es-un-numero"`— y entonces murió. La lección, escrita
en el propio test: un test que no ejercita la rama no la protege, aunque su nombre diga que sí.

**M-10 (motivo en toda métrica acumulada) sobrevivió a los 91 casos.** El motivo vive dentro de
la rama del KPI, y la otra métrica acumulada de la fixture (`cuenta_por_pagar_tienda`) **trae
filas**, así que cae en `PanelTabla` y nunca entra en esa rama: la condición `esVistaTemporal(vista) &&`
se podía borrar entera sin que nada se pusiera rojo. Se añadió
`panelAcumuladoNoTemporalSinFilas` —acumulada, `no_temporal` y **sin filas**, que sí entra en la
rama del KPI por la segunda condición del hotfix— y con ella la mutación murió. R4 estaba escrito
en el spec y no lo protegía nada.

## 5. Los tres puntos donde la implementación se separó del spec, y por qué

Ninguno cambia una decisión: los tres son cosas que el spec no podía saber hasta escribir el
código. **No se ha editado ningún archivo de `specs/`.**

### 5.1 El bloque del hotfix: una de sus seis aserciones es incompatible con R1

`design.md` §3 ⟨D1⟩ pone como criterio de hecho que «los seis casos del bloque `Hotfix — …` sigan
verdes **sin tocarlos**». **Ese criterio se cumplió donde aplica**: al cerrar T A.1 —la muda de
`esVistaTemporal`, que es de lo que ⟨D1⟩ habla— los 67 casos del archivo pasaron sin tocar una
línea. Queda anotado como evidencia: el movimiento fue puro.

Al aterrizar la Tanda C, un caso del bloque se puso rojo, y es **estructural, no un descuido**:

> `` `%s` NO pinta las fechas de la serie `` afirmaba
> `expect(seccion.textContent).not.toContain(CUBO_INTERMEDIO)`.

R1 exige la gráfica **dentro de la sección de la vista**, y `SerieTextual` emite su alternativa
textual —«serie, categoría: valor»— en el DOM (`sr-only`), que es donde un lector de pantalla lee
la gráfica. Con la línea puesta, la fecha del cubo **tiene** que estar en el `textContent` de la
sección; si no estuviera, la gráfica sería muda. Las dos afirmaciones no pueden ser ciertas a la
vez, y R1 es la que manda.

**Qué se hizo, y por qué no es una relajación:** el caso pasa a exigir que la fecha no sea el
texto **propio** de ningún elemento —`queryByRole("cell", …)` y `queryByText(…)`, que es
exactamente como la pintaba `PanelTabla` (`<td>2026-07-20</td>`)—, y **conserva la aserción vieja
literal** en la métrica acumulada, que por Q2 = (b) no lleva línea. Medido: M-8 (poner línea en la
acumulada) pone rojo ese resto conservado, y M-9/M-11 ponen rojo el caso entero. El defecto
original —treinta fechas donde va la cifra— sigue matando este caso.

### 5.2 Un segundo caso preexistente cambió de forma, hacia más estrecho

`Feature 132 (R22) — cada panel muestra las fechas calendario del propio DTO` buscaba cada fecha
por separado (`getByText(/2026-07-05/)`). Desde que hay línea, `2026-07-05` es además la clave del
primer punto de la serie, así que la búsqueda encontraba **dos** elementos y fallaba por ambigua
—no por incorrecta—. Pasa a afirmar sobre la cabecera entera: las dos fechas **juntas**, en el
orden del DTO y sin ningún dígito en medio (lo que impediría que una tercera fecha calculada se
colara). Es más estrecho que antes, no menos.

### 5.3 Colisión de vocabularios que ningún `design.md` previó: `dia` y `semana` son homónimos

`RangoPreset` (de la 135) y `GranularidadVista` (de la 180) **comparten dos literales**: `dia` y
`semana`. Significan cosas distintas —qué ventana se consulta vs. con qué grano viene agregada la
respuesta— y viven en contratos distintos. Al mudar el rotulador a `adaptar.ts`, el censo de
`tests/unit/analytics/tablero-financiero-rango.test.ts` («ningún otro archivo de la región escribe
un preset») marcó ese archivo como si escribiera un preset de rango. **Falso positivo por
homonimia**: `adaptar.ts` no importa `rango.ts`, no construye ningún filtro y no nombra `mes` ni
`personalizado`.

**Lo que NO se hizo:** excluir `adaptar.ts` del censo, ni sacar `dia`/`semana` del patrón. Las dos
dejarían entrar un preset de verdad.

**Lo que se hizo:** partir el dominio y exigir más donde se puede.

- los presets **sin homónimo** (`mes`, `personalizado`) se marcan en cualquier archivo ≠ `rango.ts`;
- la clave `rango: "…"` se marca **en todos**, `adaptar.ts` incluido — o sea, **sin excepción
  posible**, que es más estricto que el censo original;
- los dos homónimos se admiten **solo** en el único módulo que R16 autoriza a nombrar la
  granularidad, y que ese módulo sea uno solo no se supone: lo garantiza el censo (g).

Con autocomprobación sobre texto sintético y con un caso que se pone rojo el día que los dos
dominios dejen de compartir exactamente esos dos literales.

## 6. Lo que NO se relajó (T E.2)

`git diff tests/unit/guards/tablero-financiero.guardia.test.ts`, filtrado por líneas retiradas,
devuelve **una sola**:

```
-import { IDS_FINANCIERAS_SERVIDAS } from "@/lib/types/analitica-financiera";
```

…sustituida por el mismo import en forma multilínea, que **conserva
`IDS_FINANCIERAS_SERVIDAS`** y añade `type GranularidadVista`. **Ninguna aserción retirada,
ninguna cuenta anclada cambiada, censos (a)–(f) intactos.** Lo añadido: el bloque del censo (g)
(3 casos) y sus dos autocomprobaciones. El archivo pasa de 24 a 29 casos.

En `tests/components/TableroFinanciero.test.tsx` se conservan **los dos casos de R17(a)** del
hotfix, palabra por palabra. Los dos casos que cambiaron de forma están en §5.1 y §5.2, cada uno
con el motivo y con la medición que demuestra que siguen mordiendo.

## 7. Decisiones de implementación que conviene poder citar

- **⟨D5⟩ está implementado con defaults opuestos, y hay un test por cada uno.**
  `esVistaTemporal` pregunta por la negativa (lo desconocido cae en **serie**: caer en «tabla» es
  el defecto de producción del 2026-08-06). `etiquetaDeCubo` pregunta en positivo con `default`
  (lo desconocido cae en **grano no declarado**: caer en «día» sería afirmar un grano que no
  sabemos). Los dos `as` de los tests que construyen un valor fuera del dominio llevan escrito
  **por qué** están ahí.
- **La vista semanal vive en su propia fixture, no dentro de `panelesOk()`.** Con el filtro fijo
  en `mes` (Q4 = (a)), el servicio no produce una vista semanal para el rango por defecto: meterla
  en «los paneles todo bien» declararía un DTO que el servicio no emite, que es exactamente la
  clase de mentira que costó siete horas de producción. Ningún esperado preexistente cambió por
  añadirla.
- **El dominio de `GranularidadVista` se declara como `Record<GranularidadVista, true>`** en los
  dos sitios que lo necesitan en runtime (el guardia y el test de componente). No hay constante
  exportada que importar —el contrato lo publica como unión de literales—, y el registro
  exhaustivo es lo más cerca que se puede estar: un cuarto valor **rompe la compilación** de esos
  archivos en vez de dejarlos censando tres de cuatro en silencio. Es el mismo mecanismo que
  `DTOS` sobre `MetricaFinancieraId`.
- **No se pasa `avisoRecorte`** (R12) y **no se aplica `agruparCola`** a la serie temporal (⟨D7⟩).
  El techo de puntos lo garantiza el servidor (R19/R20 de la 180); recortar aquí escondería el día
  en que esa garantía se rompa.

## 8. Deuda que esta feature NO cierra

- **La de `design.md` §7.3**, íntegra: los dobles se comparan contra **constantes publicadas**,
  nunca contra lo que el servicio produce de verdad. Ficha propuesta al leader en §9.
- **El rango del tablero financiero sigue siendo la constante `mes`** (slot de la 131). La
  granularidad `semana` **no es alcanzable en producción**: se construye y se prueba con dobles, y
  queda dicho en el propio test.
- **El cubo en curso no se marca como parcial**: el DTO no publica ese marcador (Q2 de la 180).
- **La discrepancia de centavos entre el `total` del KPI y la Σ de los puntos** mientras la 187 no
  envuelva `deCaja`/`deTesoreria` en una transacción. Esta feature **no** deriva el total de los
  puntos para cuadrarlo: eso convertiría el R12 de la 180 en una tautología.
- **`listasDeIdsAMano` sigue exigiendo dos o más ids** (deuda declarada en `design.md` §6). No se
  toca: el censo (f) cubre la decisión por id suelto en los archivos de esta región.

## 9. Ficha propuesta al leader (T F.5)

No se escribe en `feature_list.json` desde aquí.

> **«tests: perfil de forma del DTO financiero, compartido entre el servicio y el tablero»**
> · zona `fullstack` · complejidad `medium` · `depends_on: [180, 186, 187]`.
>
> Extraer los dobles de DTO del tablero (`tests/components/TableroFinanciero.test.tsx` y
> `tests/components/AnaliticaPage.test.tsx`) a `tests/fixtures/analitica-financiera-dtos.ts`,
> derivar un *perfil de forma* por métrica —`{ tipo, nº de vistas, granularidad de cada una, si
> trae filas, forma del importe, esAcumulado }`— de la salida **real** del servicio con los dobles
> de repositorio que ya existen (`tests/unit/services/_dobles-analitica-financiera.ts`), y ponerlos
> rojos cuando divergen.
>
> **Motivo, escrito como incidente:** el 2026-08-05 la 180 cambió la forma del DTO, editó la
> fixture del tablero para que compilara y la suite entera siguió verde mientras producción
> pintaba una tabla de treinta fechas donde va «Dinero en caja» (⟨H1⟩; hotfix PR #305, siete horas
> vivo). Hoy la fixture se compara contra **constantes publicadas**, nunca contra lo que el
> servicio produce: si mañana `serieDensa` emitiera cubos semanales para un rango de 30 días, los
> dobles seguirían declarando 30 cubos diarios y **los casos del hotfix seguirían verdes**, porque
> comparan la fixture con una constante derivada del mismo rango. Es un espejo bien construido, y
> un espejo no contradice.
>
> No entró en la 186 porque exige extraer los dobles a un módulo compartido y construir una
> `ConsultaAnalitica` real en un test de la zona frontend: una reforma de arquitectura de pruebas
> que cruza las dos zonas y choca con la 187. Hacerlo con prisa dentro de una feature `low` de
> presentación es exactamente cómo nació ⟨H1⟩.

## 10. Verificación

### Lo que corrió el implementer

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | limpio, en cada tanda |
| `pnpm lint` | **0 errores**; 48 warnings, todos `no-unused-vars` preexistentes y en archivos ajenos. Ni uno en `financiero/` ni en `adaptar` |
| `pnpm exec vitest run` de los archivos de la feature | ver abajo |

Perímetro de la feature, al cierre:

| Archivo | Casos |
|---|---|
| `tests/components/TableroFinanciero.test.tsx` | 92 (baseline 67) |
| `tests/unit/analytics/tablero-financiero-adaptar.test.ts` | 49 (baseline 24) |
| `tests/unit/guards/tablero-financiero.guardia.test.ts` | 29 (baseline 24) |
| `tests/unit/analytics/tablero-financiero-rango.test.ts` | 8 (baseline 6) |
| `tests/unit/guards/tablero-lineas-trazabilidad.guardia.test.ts` | 7 (nuevo) |
| `tests/unit/analytics/tablero-financiero-cargar.test.ts` | sin cambios, verde |
| `tests/components/AnaliticaPage.test.tsx` | sin cambios, verde |
| `tests/unit/components/analytics-paquete-guard.test.ts` | sin cambios, verde |

**Delta de rojos en el perímetro: 0.**

### Lo que NO corrió el implementer, y queda para el leader

- **`pnpm exec next build`** a mano (T F.3), con la salida pegada aquí. **Nunca `pnpm build`**, que
  encadena `migrate deploy` contra una base real. Es el agujero que la 132 declaró en su R11: la
  frontera RSC no la ve ningún test, y esta feature monta un Client Component nuevo
  (`GraficaLineas`) desde un Server Component. Los censos (a) y (b) del guardia cubren la mitad
  estática; el build es la otra mitad.
- **La suite completa** y **`./init.sh` completo antes del PR** (T F.4).

**No se abrió PR.**
