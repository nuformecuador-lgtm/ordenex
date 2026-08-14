# Feature 223 — El flujo de impresión de la factura del cierre

Requisitos en notación EARS. Cada `R<n>` es verificable. Feature `frontend`,
complejidad **medium**, `depends_on: [217]`.

> **Esta ficha es la MITAD QUE FALTA de una decisión ya tomada.** La 217 garantizó que la
> hoja salga **blanca** en papel (el color) y dejó escrito, no omitido, lo que **no** cubría:
> `@page`, ocultar lo que no es la hoja, y paginar (`specs/217-…/design.md §4.6`,
> `app/globals.css:281-287`). Nació de la **Q4 de su puerta humana** (2026-08-13).
>
> **Estado: puerta de aprobación humana PASADA el 2026-08-14.** Las siete preguntas abiertas
> de la primera ronda están **CERRADAS** y **plegadas al articulado** (D1-D7, abajo). No queda
> ninguna decisión pendiente.
>
> **Esta versión 2 RENUMERA los requisitos.** La decisión D5 no cabía como apéndice: cambia
> el alcance, la semántica de la clase y añade un grupo entero (Grupo B). El mapa vigente
> `R → tarea` es el de `tasks.md`.

---

## Lo que la puerta humana cerró (2026-08-14)

| # | Decisión | Cierra | Dónde vive ahora |
| --- | --- | --- | --- |
| **D1** | **NO se añade botón «Imprimir».** Se confirma la D8 de la 217: CSS puro y `Ctrl+P`. No hay que reexpresar `factura-contraste.guardia.test.ts:265-273`. | Q1 | **R27** |
| **D2** | **`size: portrait` sin nombre de papel.** Se respeta lo que el usuario tenga configurado; forzar A4 o Carta provocaría reescalado. | Q2 | **R15**, `design.md §4.2` |
| **D3** | **Márgenes de 12 mm**, con el razonamiento de `design.md §4.3`, y el número **en un solo sitio** para que cambiarlo mañana sea una línea. | Q3 | **R16** |
| **D4** | **El límite de las pestañas se DECLARA.** Se imprime lo que está en el DOM; las pestañas no visitadas y las filas sin desplegar **no salen**, y eso va escrito como límite, no como olvido. La feature se queda en CSS. | Q4 | **R22** |
| **D5** | **La hoja compacta SÍ debe poder imprimirse como documento propio.** Va contra la recomendación del spec, y **la objeción que la motivaba sigue en pie**: si la compacta fuera documento sin más, imprimir el detalle emitiría además las N hojas de detrás. Se resuelve con **mecanismo**, no con intención: **CANDIDATA** (marca) + **ELEGIDA** (contexto). | Q5 | **Grupo B entero (R5-R9)**, `design.md §3` |
| **D6** | **El KPI animado se declara.** La ventana es de milisegundos y arreglarlo tocaría el DOM que vigila el inventario de la 217. Queda escrito que una impresión disparada en ese instante puede llevar una **cifra intermedia**. | Q6 | **R29** |
| **D7** | **Verificación: censo + mutaciones con variante inocua + UNA comprobación manual fechada, declarada fuera del gate.** Nada de prometer un E2E que no existe, y el spec dice explícitamente qué NO queda verificado. | Q7 | **R33**, `design.md §6.7` |

### Y tres correcciones del leader, plegadas también *(2026-08-14)*

| # | Corrección | Dónde vive |
| --- | --- | --- |
| **C1** | **Las dos rutas recortan.** El encargo decía que sólo la de `cierres-admin`; es falso: `Modal.tsx:258,275` y el `overflow-hidden` del `Card` recortan en las dos. El diseño ataca **las capas**, no el `:822`. | **R10, R11**, H1 |
| **C2** | La guardia que prohíbe `@page` (`tema-encendido.guardia.test.ts:331`) dice «el formato de impresión es otra ficha, no ésta». **Esa otra ficha es ésta.** Se **REEXPRESA con su motivo**, no se borra ni se relaja. | **R28**, `tasks.md` T18 |
| **C3** | Tres casos vivos anclan en «el **primer** `@media print`». Eso **es un requisito, no una nota**: los anclajes dejan de ser **posicionales** y pasan a identificar el bloque por su **contenido**. | **R24**, `tasks.md` T5 |

---

## Hechos VERIFICADOS contra el código (`dev`, 2026-08-13/14)

Cada anclaje se comprobó abriendo el archivo. Lo que **no** se pudo verificar está dicho como
tal.

### ⚠️ H1 — Las dos rutas NO se comportan igual, pero **las dos recortan** *(C1)*

| Ruta | Qué monta | Contenedores que recortan, de fuera a dentro |
| --- | --- | --- |
| **Admin** (`CierresAdminModule.tsx:827`) | `CierreFacturaDetalle` en un `Modal` | `Dialog.Popup` `fixed … max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-…` (`Modal.tsx:258`) → `div.min-h-0.flex-1.overflow-auto` (`Modal.tsx:275`) → `div.max-h-[70vh].overflow-y-auto` (`:822`) → `Card` `overflow-hidden` (`card.tsx:15`) |
| **Mensajero** (`CierreDiaModule.tsx:730`) | el **mismo** `CierreFacturaDetalle`, en otro `Modal` | los **mismos**, menos el `div:822` |
| **Admin, lista** (`CierresAdminModule.tsx:749`) | `CierreFacturaResumen` × N, **fuera de todo modal**, en una rejilla de hermanos | ninguno propio; hoy imprime la página entera |

**Parchear el `div:822` no arregla ninguna de las dos rutas**: el recorte sobrevive en
`Modal.tsx` y en el `Card`. Lo que se neutraliza es **la cadena de ancestros**, sea cual sea
(**R11**).

### H2 — La lista de órdenes **no es una tabla**

`cierre-factura.tsx:1288` pinta la fila de rótulos como una **rejilla de `<span>`**, hermana
de las filas; cada fila (`FilaGestion`, `:913`) es un `<div>`. No hay `<table>`, `<thead>` ni
`<tr>`: **`display: table-header-group` no aplica** (**R21**).

### H3 — Lo que está plegado **no está en el DOM**, y eso vale para las DOS hojas

- Detalle: el desglose de cada fila se monta con `{open ? … : null}` (`:952`); de las cinco
  pestañas sólo se renderiza **la activa** (`:1287`).
- **Compacta: su desglose entero —métodos, ajustes y fechas— también es `{open ? … : null}`
  (`:580-622`).** Plegada, la hoja compacta **no es un documento completo**: le faltan los
  tres bloques. Ese hecho es el que sostiene el mecanismo de **R5**.

### H4 — El diálogo se monta en un `Dialog.Portal`

`Modal.tsx:243`. El popup y el backdrop **no cuelgan del envoltorio del tema** —que además es
`display: contents` (`TemaProvider.tsx:59`)—. Que la hoja siga saliendo clara ahí dentro lo
sostiene la 217, que fijó los tokens **en la propia hoja**. *(El contenedor por defecto de
Base UI es `document.body`; **no se pudo verificar en `node_modules`** desde esta sesión y
queda como comprobación de una línea, `tasks.md` T11.)*

### H5 — El popup expone `role="dialog"`

Lo usan los tests existentes para localizarlo (`OrdenesListadoEtiquetasChain.test.tsx:187-189`,
`:256`, `:297`), y `Modal.tsx:249` le añade `aria-modal="true"`. **Es el anclaje del nivel 1
de R6**, y por eso R9 exige que deje de ser un supuesto y pase a ser un caso.

### H6 — Tres guardias vivas se mueven, y una **prohíbe justo lo que hay que crear**

| Ancla | Qué afirma hoy | Qué le pasa |
| --- | --- | --- |
| `tema-encendido.guardia.test.ts:331` | «no se cuela un flujo de impresion por el CSS: **nada de `@page`**» | **REEXPRESAR** (**R28**, C2). |
| `tema-encendido.guardia.test.ts:100-104,205` | `reglaCon(".papel-al-imprimir")` exige **exactamente UNA** regla con ese selector | El bloque nuevo **no puede reusar ese selector** (**R23**). |
| `tema-encendido.guardia.test.ts:185,264,352` y `impresion-sin-dark.guardia.test.ts:184` | anclan en **el PRIMER `@media print`** | **Dejan de ser posicionales** (**R24**, C3). |

### H7 — `max-width` del popup viaja en un **estilo en línea**

`Modal.tsx:253-256` escribe `style={{ minWidth: "300px", maxWidth: size }}`; el detalle admin
usa el default `"75%"` (`Modal.tsx:108`). **Un estilo en línea sólo se vence con
`!important`** (**R13**).

### H8 — Las utilidades de Tailwind viven en `@layer utilities`

`globals.css` ya declara sus reglas propias **fuera** de toda capa (`:194`, `:295`, `:503`,
`:562`) y su `@layer base` explícito (`:452`). Una regla sin capa vence a cualquier utilidad
sin `!important`; **meter el bloque en un `@layer` lo apagaría en silencio** (**R26**).

### H9 — `CierreBodegaFacturaResumen` está exportado y **no se monta en `app/`**

Censo de `app/**/*.tsx`: sólo aparece su definición (`:641`). Comparte `HojaResumen`, así que
hereda la marca de candidatura de **R5** el día que alguien la monte.

---

## Grupo A — Qué llega al papel

**R1 — En el papel sólo está la hoja elegida.** CUANDO se envíe a impresión un documento que
contenga una hoja **elegida** (R6), el sistema DEBE emitir en papel **únicamente esa hoja y
los elementos que la contienen**, y NO DEBE emitir ningún otro elemento del documento —barra
lateral, cabecera de página, fondo del diálogo, título y botonera del modal, secciones
hermanas, **ni las demás hojas candidatas que estén en el DOM**—.

**R2 — Un documento sin hoja elegida imprime EXACTAMENTE como hoy.** MIENTRAS no haya
ninguna hoja elegida, el sistema NO DEBE alterar en nada la impresión de esa página. SI las
reglas de ocultamiento pudieran aplicar sin que exista una hoja elegida, ENTONCES cualquier
página del portal saldría **en blanco**; eso DEBE ser imposible **por la forma de los
selectores**, no por casualidad.

**R3 — Se decide por PERTENENCIA, no por lista de piezas a esconder.** El sistema DEBE
determinar qué se imprime por **pertenencia a la hoja elegida** (lo que la contiene, lo que
es ella y lo que está dentro), y NO DEBE enumerar piezas de la aplicación —sidebar, header,
modal, backdrop— para ocultarlas una a una. El bloque de impresión NO DEBE contener ningún
selector que nombre un componente concreto del portal.

**R4 — Lo que queda fuera va DECLARADO, no descubierto.** El sistema DEBE dejar escrita la
lista de las piezas que hoy se ven junto a la hoja y **dejarán de imprimirse**, con su ancla:
la nota del portal del mensajero (`CierreDiaModule.tsx:747`), la sección de pago al mensajero
(`CierresAdminModule.tsx:844`), la botonera de decisión (`:859`) y los botones del propio
`Modal` (`Modal.tsx:278-308`). Un ocultamiento por pertenencia **puede tragarse algo que sí
debía salir**: la lista es la contramedida, y va en el código, no sólo en este spec.

---

## Grupo B — Cuál es la hoja elegida *(D5 — la decisión de la puerta)*

> **El problema, dicho entero:** en la página del admin hay **N** hojas compactas en el DOM
> (`CierresAdminModule.tsx:747-794`), y encima puede haber un modal con la hoja del detalle.
> «La compacta también es un documento» no puede significar «se imprimen todas las que haya».
> Hace falta distinguir **la que el usuario quiere** de **las otras N**, y contestar qué pasa
> cuando hay **cero** y cuando hay **más de una**.

**R5 — CANDIDATA: una hoja sólo es documento cuando está COMPLETA.** El sistema DEBE marcar
como candidata a impresión: (a) **siempre**, la hoja del detalle (`HojaFactura`, `:288`); (b)
la hoja compacta (`HojaResumen`, `:469`) **sólo mientras su desglose esté desplegado**. El
sistema NO DEBE marcar una hoja compacta plegada. Motivo, y no es un truco de selección: su
desglose —métodos, ajustes y fechas— se monta con `{open ? … : null}` (`:580-622`), así que
**plegada le faltan tres bloques**; imprimirla sería emitir un comprobante incompleto. Es la
misma regla que **R22**, aplicada a la compacta.

**R6 — ELEGIDA: manda el contexto, y el diálogo gana.** El sistema DEBE elegir la hoja que se
imprime así, y en este orden:
1. **SI alguna candidata está dentro de un diálogo**, ENTONCES **esa** es la única elegida, y
   toda candidata que esté fuera del diálogo NO DEBE imprimirse.
2. **SI no hay ninguna candidata dentro de un diálogo**, ENTONCES **todas** las candidatas del
   documento son elegidas.

Un diálogo modal es, por definición, lo único con lo que el usuario está interactuando: no
hace falta que designe nada, ya lo hizo al abrirlo. Esta regla es lo que impide que imprimir
el detalle arrastre las N hojas de detrás — la objeción que motivaba la exclusión anterior.

**R7 — CERO candidatas: no pasa nada.** SI no hay ninguna candidata en el documento, ENTONCES
el sistema NO DEBE ocultar ni alterar nada (**R2**). Es el caso de la página del admin sin
ninguna hoja desplegada y sin modal abierto: se imprime como se imprimía ayer.

**R8 — VARIAS candidatas sin diálogo: cada una es un documento, y empieza en su página.**
CUANDO haya más de una candidata y ninguna esté en un diálogo, el sistema DEBE imprimirlas
**todas**, y cada una a partir de la segunda DEBE **empezar en una página nueva**. No hay
desempate arbitrario: **desplegar es el acto deliberado del usuario**, y desplegar tres es
pedir tres comprobantes.

**R9 — El anclaje del diálogo se verifica, no se supone.** El sistema DEBE sostener con un
caso ejecutable que (a) el popup del `Modal` expone `role="dialog"` —de lo que depende el
nivel 1 de R6— y (b) **cada diálogo que monte una hoja monta exactamente una**. SI Base UI
dejara de exponer ese rol, o si un diálogo montara dos hojas, ENTONCES la verificación DEBE
ponerse **roja**, porque la regla de elección habría dejado de significar lo que dice.

---

## Grupo C — El recorte y el modal

**R10 — La cadena entera deja de recortar.** CUANDO la hoja elegida se imprima, el sistema
DEBE neutralizar, **para el medio impresión y sólo para él**, todo contenedor situado entre
`<body>` y la hoja que la recorte, le limite el alto o la saque del flujo. La lista de
propiedades es **CERRADA**: `overflow`, `max-height`, `height`, `position`, `inset`,
`transform`, `width`, `max-width`, `padding`, `border`, `box-shadow` y `background`. Quitar
cualquiera DEBE poner la verificación en rojo.

**R11 — Genérico, no por contenedor conocido, y por eso vale igual en las dos rutas *(C1)*.**
El sistema DEBE neutralizar esos contenedores **recorriendo la cadena de ancestros**, sin
nombrar ninguno, y NO DEBE apoyarse en que la ruta del admin y la del mensajero tengan los
mismos contenedores: **no los tienen** (H1). La misma regla DEBE cubrir
`CierresAdminModule.tsx:827` y `CierreDiaModule.tsx:730` sin una línea distinta para cada una.

**R12 — La pantalla no se toca.** El sistema NO DEBE conseguir R10 quitando ni relajando el
desplazamiento en pantalla. DEBEN seguir existiendo `max-h-[70vh]` y `overflow-y-auto` en
`CierresAdminModule.tsx:822` y `overflow-auto` en `Modal.tsx:275`.

**R13 — `!important` sólo donde un estilo en línea obligue, y con su nombre.** El sistema DEBE
usar `!important` **exclusivamente** en las declaraciones que compiten contra un estilo en
línea, y DEBE dejar escrito cuál y por qué. Hoy hay **una**: `max-width`, contra
`Modal.tsx:253-256` (H7). El resto DEBE ganar por la cascada de capas (H8). Censo objetivo: el
número de `!important` del bloque es **exactamente** el de la lista declarada.

**R14 — La ruta de fragmentación queda en disposición de bloque.** El sistema DEBE dejar en
`display: block` los ancestros de la hoja elegida al imprimir. Es seguro **porque R1 lo hace
seguro**: tras el ocultamiento, cada ancestro tiene exactamente **un** hijo visible. El
sistema NO DEBE cambiar el `display` de la hoja ni de su interior: eso sería rediseñarla. Y
SI una regla de ocultamiento y una de disposición pudieran alcanzar al mismo elemento,
ENTONCES DEBE ganar el ocultamiento —por orden dentro del bloque y por especificidad—, y eso
DEBE quedar verificado.

---

## Grupo D — `@page`

**R15 — Una `@page`, dentro de `@media print`, con orientación y sin nombre de papel *(D2)*.**
El sistema DEBE declarar **exactamente una** regla `@page` en `app/globals.css`, dentro del
bloque `@media print` de esta feature, con **orientación vertical** y **sin** nombre de papel:
NO DEBE forzar `A4` ni `Letter`. Forzar un papel que no es el cargado hace que el navegador
reescale y encoja el texto; el papel lo decide el usuario en su diálogo.

**R16 — Márgenes de 12 mm, en un solo sitio y con su porqué *(D3)*.** El margen de página DEBE
ser **12 mm**, DEBE estar declarado **una sola vez** y su razón DEBE estar escrita junto a la
regla (`design.md §4.3`). El sistema NO DEBE declarar `margin: 0`: la hoja perdería texto por
el borde físico en cuanto la impresora no sea la del que lo escribió.

**R17 — Lo que `@page` NO controla, declarado junto a la regla.** El sistema DEBE dejar
escrito, en el propio CSS, que quedan fuera de su alcance: el encabezado y el pie que imprime
el navegador (URL, fecha, nº de página), la escala, la opción «gráficos de fondo» y el
**tamaño de papel que el usuario elija**. Una regla que promete lo que no puede cumplir manda
al siguiente a buscar un bug inexistente.

---

## Grupo E — Paginación

**R18 — Un cierre largo se reparte en páginas y no se recorta.** CUANDO la hoja elegida no
quepa en una página, el sistema DEBE permitir que continúe en las siguientes, y NO DEBE dejar
sobre ella ni sobre ninguno de sus ancestros nada que la vuelva **infragmentable**: ni
`overflow` distinto de `visible` (hoy `Card` trae `overflow-hidden`, `card.tsx:15`, y lo
traen las **dos** hojas), ni `break-inside: avoid` en la raíz.

**R19 — Se evita el corte dentro de las piezas de una lista CERRADA.** El sistema DEBE evitar
el salto de página **dentro** de: la fila de una orden (`:913`), cada bloque de renglones de
la liquidación, la rejilla de KPI (`:249`), el bloque de cabecera de la hoja y la franja del
pie (`:1317`). La lista DEBE ser **enumerada y cerrada**: una pieza que la reciba sin estar en
la lista, o una de la lista que la pierda, DEBE poner la verificación en rojo.

**R20 — Prohibido evitar el corte donde no cabe.** El sistema NO DEBE aplicar
`break-inside: avoid` a ningún contenedor que pueda superar el alto de una página —las dos
hojas, la sección de órdenes (`:1272`), el panel de la pestaña (`:1287`) y la cadena de
ancestros—. Es la forma más rápida de reintroducir el recorte que esta ficha cierra.

**R21 — Las cabeceras de columna repetidas NO se prometen.** El sistema NO DEBE afirmar que la
fila de rótulos se repite en cada página: la lista no es una tabla (H2) y conseguirlo exigiría
reescribir su marcado y sus nombres accesibles. El límite DEBE quedar declarado junto a la
regla, con su razón.

**R22 — Lo que no está montado no se imprime *(D4)*.** El sistema DEBE dejar declarado que la
hoja impresa contiene **sólo lo que está en el DOM**: en el detalle, las filas plegadas
(`:952`) y las cuatro pestañas no visitadas (`:1287`) **no existen** y no salen. Ningún
requisito DEBE redactarse como si el CSS pudiera traerlas: esta feature **se queda en CSS**.

---

## Grupo F — Convivencia con la 217 y la 221

**R23 — Lo suyo no se toca.** El sistema NO DEBE modificar la regla `.papel-al-imprimir` ni
ninguna de sus declaraciones, ni `@custom-variant dark`, ni `.dark`, ni `.tema-sistema`, ni
`.tema-claro`. En particular, el bloque nuevo **NO DEBE reusar el selector
`.papel-al-imprimir`**: hay una guardia que exige exactamente una regla con ese selector (H6)
y romperla no señalaría ningún defecto real.

**R24 — Los anclajes dejan de ser POSICIONALES *(C3)*.** El sistema DEBE reexpresar los tres
casos que hoy localizan el bloque de la 217 como «el primer `@media print`»
(`tema-encendido.guardia.test.ts:185` —usado en `:264` y `:352`— e
`impresion-sin-dark.guardia.test.ts:184`) para que identifiquen ese bloque **por su
contenido** —la regla que declara los tokens de `.papel-al-imprimir`— y no por su posición.
Además, el sistema DEBE mantener como invariante que en `app/globals.css` hay **exactamente
dos** bloques `@media print` y que los **dos** están antes de `.dark`. SI los anclajes
siguieran siendo posicionales, ENTONCES bastaría añadir un bloque delante para que esos casos
vigilaran el bloque equivocado **en verde**.

**R25 — Cero tokens dentro del bloque nuevo.** El sistema NO DEBE declarar ninguna propiedad
personalizada (`--…`) dentro del bloque de esta feature. `quitarBloquesDeImpresion()`
(`tests/fixtures/contraste.ts:127`) borra toda at-rule que nombre `print` antes de leer los
tokens de pantalla: un token declarado ahí desaparecería del lector y las medidas pasarían a
medir otra cosa **en verde**.

**R26 — El bloque vive FUERA de toda capa.** El sistema NO DEBE anidar el bloque dentro de un
`@layer`. Dentro de una capa, el bloque **compilaría, no rompería nada y dejaría de hacer su
trabajo** (H8).

**R27 — Sigue sin haber botón ni llamada a la API de impresión *(D1)*.** El sistema NO DEBE
añadir un botón «Imprimir» ni `window.print()`. Los dos censos que hoy lo defienden
(`factura-contraste.guardia.test.ts:265-273`) DEBEN seguir verdes **sin ser tocados**.

---

## Grupo G — Lo que se declara en vez de arreglarse

**R28 — La prosa y la guardia que afirman lo contrario se REEXPRESAN, no se relajan *(C2)*.**
El sistema NO DEBE dejar en el código ninguna afirmación de que no existe flujo de impresión.
Alcanza como mínimo `app/globals.css:281-287` y `cierre-factura.tsx:111-117`. Y la guardia
`tema-encendido.guardia.test.ts:331` —«nada de `@page`… el formato de impresión es otra ficha,
no ésta»— DEBE quedar **reescrita de modo que siga defendiendo lo que sigue siendo cierto**
(que el formato no se mezcla con el bloque de tokens de la 217 y que no aparece por sorpresa
en un tercer sitio), y NO DEBE borrarse ni debilitarse.

**R29 — El KPI animado: límite declarado junto a la pieza *(D6)*.** El sistema DEBE dejar
escrito, **junto a `KpiFactura`** (`cierre-factura.tsx:249-253`), que el valor se anima al
montar (`KpiValorAnimado`) y que **una impresión disparada en esa ventana de milisegundos
puede llevar al papel una cifra intermedia**. El sistema NO DEBE corregirlo en esta feature:
tocaría el DOM de la hoja, que el inventario cerrado de la 217 vigila. Un límite conocido y no
escrito es indistinguible de un bug que nadie ha visto.

---

## Grupo H — Cómo se verifica, y qué NO se promete

**R30 — Ningún censo puede anclar en una mención dentro de un comentario.** Todo censo DEBE
leer el **código** con el quitador compartido (`quitarComentarios` / `codigoSinComentarios`,
`tests/fixtures/sin-comentarios.ts`), y NO DEBE usar un quitador propio. Aquí el riesgo es
máximo: la prosa de `globals.css:281-287` nombra hoy `@page`, `márgenes`, `saltos de página` y
`overflow-y-auto` en una sola frase, y el caso R15 de la 217 llegó a estar **verde sin poder
ponerse rojo** por anclar en un comentario (`tema-encendido.guardia.test.ts:246-256`).

**R31 — Toda guardia nueva DEBE verse ROJA, y cada mutación DEBE traer su VARIANTE INOCUA.**
El sistema NO DEBE dar por verificada ninguna guardia sin haberla visto morder ante una
mutación concreta y anotada. CADA mutación obligatoria DEBE ir acompañada de una **variante
inocua**: un cambio que a un censo ingenuo le parecería suficiente —el bloque puesto donde no
sirve, la regla presente pero con la clase que nadie estampa, la declaración escrita en un
comentario, **la regla de elección que selecciona la hoja equivocada**— y que también DEBE
ponerla roja. La lista mínima vive en `design.md §6.6`.

**R32 — Un solo parser de reglas CSS en todo `tests/`.** El sistema DEBE extraer el parser de
reglas con ancestros que hoy vive dentro de una guardia (`reglasDe`, `selectoresDe`,
`declaracionesDe` — `tema-encendido.guardia.test.ts:34-95`) a un **fixture compartido**, y la
guardia existente DEBE pasar a consumirlo **sin que ninguno de sus casos cambie de nombre ni
de aserción**. Una segunda copia es lo que la feature 209 vino a cerrar.

**R33 — La verificación es ESTRUCTURAL, y se llama así *(D7)*.** El sistema NO DEBE afirmar,
en ningún test ni documento de esta feature, que el resultado impreso es correcto. Ninguna
pieza del gate renderiza en un motor de impresión: jsdom no compone estilos, no resuelve
`@media print` ni `:has()`, y la suite E2E no corre en el gate (`init.sh`,
`docs/verification.md`). Lo verificable es que la regla existe, dónde vive, qué declara, qué
no declara, qué clase lleva cada hoja y **qué forma tiene el DOM que la regla supone**. La
comprobación en un motor real DEBE ser **UNA, manual, fechada, con su alcance escrito y
declarada fuera del gate**; y lo que **no** queda verificado DEBE estar listado, no omitido.

---

## Trazabilidad R → test

El mapa propuesto está en `tasks.md §Mapa R → verificación`. Se completa con rutas reales en
`progress/impl_223.md`. Ningún requisito puede quedar sin dueño.

---

## Preguntas abiertas

**Ninguna.** Las siete de la primera ronda se cerraron en la puerta humana del **2026-08-14**
y viven como D1-D7. Si al implementar aparece que el mecanismo de elección del Grupo B **no se
puede sostener sólo con CSS** —por ejemplo, que el anclaje `role="dialog"` no exista donde se
supone (R9)—, la regla es **volver a la puerta con el coste**, no meter JavaScript en una
ficha que se aprobó como CSS puro.
