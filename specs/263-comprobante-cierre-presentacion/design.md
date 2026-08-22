# 263 · design — cabecera honesta y rejilla que dice quién cede

## 1. Alcance, y sobre todo NO-alcance

Un solo archivo de producción: `app/(app)/cierres-admin/_components/cierre-factura.tsx`. Tres sitios
dentro de él: la cabecera del detalle (`:1313-1321`), la rejilla de órdenes (`:1105` y `:1490`) y la
columna «Fechas» de la **tarjeta compacta** (`:691-699`).

**No hay** modelo de datos, migración, RLS, endpoint, Server Action, contrato de entrada/salida ni
integración que tocar. `CierreFacturaCabecera` (`:842-855`) ya trae `estado`, `solicitadoAt` y
`resueltoAt`; los tres se leen y ninguno cambia. No se toca `lib/`, `db/`, `app/**/actions*` ni
ninguna consulta. Por eso la ficha es `sdd: false`: **es presentación**.

Tampoco se tocan los `aria-label` de las hojas (`:1287-1291`, `:458`, `:780`, `:820`) — R6: son el
localizador de `CierreFacturaPapel.test.tsx` y del E2E, y decirle «Comprobante» a un *nombre
accesible* no es lo que el humano vio en pantalla.

---

## 2. Defecto 1 — el rótulo lo decide el estado; la pieza «Resuelto», la fecha

Son **dos criterios distintos a propósito**, no uno:

| `estado` | `resueltoAt` | rótulo del documento | línea de fechas |
| --- | --- | --- | --- |
| `solicitado` | `null` | `Solicitud #<folio>` | `Solicitado <fecha>` |
| `vencido` | `null` | `Solicitud #<folio>` | `Solicitado <fecha>` |
| `aprobado` | fecha | `Comprobante #<folio>` | `Solicitado <fecha> · Resuelto <fecha>` |
| `rechazado` | fecha | `Comprobante #<folio>` | `Solicitado <fecha> · Resuelto <fecha>` |

**Forma:** un `Record<CierreEstado, string>` junto a las constantes de rótulos ya existentes
(`:139-150`), al lado de `FACTURA_FOLIO_LABEL`, que se conserva con su valor actual («Comprobante»)
porque es el de los dos estados resueltos. El `Record` exhaustivo no es adorno: si mañana entra un
quinto valor en el enum `CierreEstado`, **el typecheck obliga a decidir su rótulo** en vez de
heredar en silencio el que había.

**Por qué «Solicitud» y no otro sustantivo** (decisión humana, 2026-08-21): no inventa vocabulario,
**reusa** el que ya está tres píxeles más abajo en la misma cabecera —«Solicitado \<fecha\>»— y que
lleva ahí desde la feature 38. Y `rechazado` **es** resuelto: tiene `resueltoAt`, alguien lo resolvió,
y el `EstadoCierreBadge` de al lado ya dice «Rechazado», así que «Comprobante» no deja nada ambiguo.
Regla final, en dos palabras: **resuelto → «Comprobante»; sin resolver → «Solicitud»**.

**La pieza «Resuelto» se pinta si y sólo si `resueltoAt` no es nulo** (R3/R4) — condición sobre el
dato, no sobre el estado. Así el guion no puede reaparecer por ninguna combinación, incluida una
incoherencia (`aprobado` sin fecha), que además queda visible: se leería «Comprobante · Solicitado
X» sin resolución, que es raro y verdadero, en vez de raro y falso.

**Por qué quitar la pieza es mejor que enseñar «Resuelto —».** El guion no es un dato: es el hueco
donde iría un dato. En una cabecera de cuatro palabras compite en jerarquía con la fecha real de
solicitud y obliga al lector a interpretarlo («¿falló?, ¿está pendiente?, ¿se perdió el dato?»),
justo cuando el badge de estado que está tres líneas más arriba (`EstadoCierreBadge`, `:1303`) ya
responde eso sin ambigüedad. Quitarla deja la cabecera con lo que sí se sabe. El precedente del
propio archivo dice lo mismo con otras palabras: `:685-687` ya se negó a rellenar la columna de
fechas con guiones porque «diría "no tiene fecha" cuando lo cierto es que este listado no la trae».

### 2.1 La tarjeta compacta entra en el alcance (R13)

`:691-699` pinta `LineaFecha` de «Resuelto» con `fecha(resueltoAt ?? null)`, o sea el **mismo guion**,
en la **misma pantalla**, a nueve líneas del otro. Se arregla aquí, con la misma condición sobre el
dato: sin fecha, la línea no se renderiza (la columna «Fechas» se queda con «Solicitado», que sigue
siendo cierto; la columna entera ya sabe desaparecer cuando no hay fechas, `:685-688`).

**Por qué se amplía el alcance** aunque la ficha citara sólo `:1315-1319`: el humano no reportó un
número de línea, reportó *«sale esto arriba y es súper confuso»*. Dejar fuera la tarjeta por
literalismo produciría algo peor que el defecto: quien vea la cabecera corregida y la tarjeta sin
corregir leerá **dos comportamientos deliberados** y buscará la diferencia que los explica. No la hay.

**El sustantivo NO se toca en la tarjeta compacta:** su rótulo visible es «Cierre del día»
(`FACTURA_TITULO`, `:457`), no «Comprobante»; ahí no hay contradicción que arreglar. Lo único que
sobra es el guion.

### Alternativas descartadas (defecto 1)

- **Un solo criterio: `resueltoAt !== null` decide también el sustantivo.** Es más corto y elimina el
  `Record`. Descartada: el sustantivo es semántica del **estado**, no de un campo de fecha; con un
  dato incoherente llamaría «Solicitud» a un cierre `aprobado`, que es exactamente la clase de
  mentira que esta ficha viene a quitar. Y pierde la propiedad de «estado nuevo ⇒ typecheck rojo».
- **Cambiar sólo el sustantivo y dejar «Resuelto —».** Descartada: el guion es la mitad de la
  contradicción que reportó el humano, no un daño colateral.
- **Ocultar la cabecera entera en los estados sin resolver.** Descartada: el folio y la fecha de
  solicitud son la identidad del documento (R5) y son ciertos en los cuatro estados; sin ellos la
  hoja impresa deja de identificar de qué cierre habla (feature 223, comentario `:1293-1296`).

---

## 3. Defecto 2 — la rejilla

### 3.0 La trampa de los dos sitios, verificada

`grid-cols-[40px_1.4fr_1fr_1fr_24px]` aparece **exactamente dos veces** en todo el repo, con el
mismo valor: `:1105` (la fila, dentro del `<button>`) y `:1490` (la cabecera de columnas). Son dos
rejillas **independientes** —cada fila es su propio contenedor `grid`, y la cabecera otro—; hoy
quedan alineadas sólo porque los cinco tracks son valores que no dependen del contenido. Tocar uno
sin el otro descuadra la cabecera de sus filas.

### 3.1 Una sola fuente para la plantilla

La plantilla pasa a una constante del módulo (p. ej. `FILA_GRID_COLS`) consumida por los dos sitios.
No es estilo: es lo que hace que la trampa **no pueda** volver a activarse por descuido, y es
afirmable con una guardia (§5, R10).

### 3.2 La columna de guía: de caja fija a `auto` con piso

- Track de la guía: `auto` (deja de ser `40px`).
- Celda de la guía (fila **y** cabecera): un **piso en px** idéntico en los dos sitios, servido por
  la misma constante, dimensionado para **9 dígitos** — punto de partida **80 px** (9 dígitos a 13 px
  con `tabular-nums` ≈ 68 px, más holgura). **El valor final se fija midiendo en el navegador** (§4),
  no a ojo.

  **Por qué 9 y no 8.** Medido contra producción el **2026-08-21**: 163 órdenes con guía, mínimo
  8 dígitos y máximo 8 dígitos (`10187406` … `99619074`), y la secuencia avanza dentro de ese rango.
  Eso es una **foto, no una ley**: en ningún sitio del repo —schema, tipos, validación, importador—
  hay una declaración de que la guía tenga 8 dígitos para siempre, así que el dato de hoy no autoriza
  a apretar el ancho contra él. Un dígito de holgura cuesta 12 px de cabecera; quedarse corto cuesta
  exactamente el defecto que esta ficha está arreglando. Quien relea esto dentro de un año: **el
  número de arriba caducó el día que se midió.**
- Celda de la guía: `whitespace-nowrap` + `tabular-nums`. **Prohibido** sobre ella: `truncate`,
  `overflow-hidden`, `break-words`, `break-all`.

**Por qué `auto` + piso y no `max-content` a secas.** La cabecera y cada fila son rejillas
independientes: un track que dependa del contenido se resuelve **por separado en cada una**, así que
una fila con guía de 6 dígitos y otra de 8 tendrían columnas de dinero desplazadas entre sí y
respecto de la cabecera (rompe R10). Con `auto` + piso, en el caso normal (guías de ≤8 dígitos) el
piso gana en todas y **todas resuelven al mismo número**: alineadas. Y si algún día llega una guía
más larga que el piso, esa fila **crece** —queda un par de píxeles desalineada, feo pero legible— en
vez de pintarse encima del vecino. Es la diferencia entre degradar y mentir.

### 3.3 Quién cede: el destinatario, con elipsis

Precedente del repo, feature 258, `MensajeroCard.tsx:79-111`: el **nombre propio** cede con
`truncate` («ahí la elipsis es aceptable») y **la cifra lleva `shrink-0`**, prohibido encoger. Aquí
se aplica igual, en versión grid:

- Track del destinatario: `minmax(0, 1.4fr)` (hoy `1.4fr`, que es `minmax(auto, 1.4fr)`: su mínimo
  automático es el min-content del texto, y por eso el destinatario tampoco puede ceder hoy).
- Celda del destinatario: `min-w-0`, y `truncate` en sus **dos** líneas (nombre y
  `remisión · producto`). Sin `min-w-0`, `truncate` no llega a activarse nunca — lección literal de
  la 258.
- Las dos columnas de dinero: `minmax(0, 1fr)` por el mismo motivo; su contenido es corto y
  `tabular-nums`, así que en la práctica no ceden nada.

No hace falta `title` con el texto completo: el `aria-label` del botón (`:1099-1103`) ya lleva
remisión y destinatario enteros, y el texto sigue completo en el DOM (R12).

### Alternativas descartadas (defecto 2)

- **Subir el fijo de 40 px a 72 px y ya.** Un cambio de un carácter, y arregla la captura. Descartada:
  es el mismo defecto aplazado —caja fija + contenido que no cabe + nadie que ceda—, que es la
  familia que ya lleva tres apariciones en dos días (258, y esta ficha lo dice). No declara quién
  cede, así que el desenlace vuelve a depender del azar del ancho del texto.
- **`truncate` / `overflow-hidden` sobre la guía.** Descartada sin discusión: es **literalmente** el
  primer defecto de la 258, donde el `overflow-x-clip` se comía la cifra en silencio y los 16.800
  tests pasaban. Un número a medias es un número falso, y peor que uno que se sale.
- **Rejilla única para cabecera + filas (`subgrid`).** Es la solución teóricamente correcta al
  desalineado. Descartada por coste estructural: cada fila es un `<button>` dentro de una tarjeta con
  borde y panel desplegable (`:1093-1130`), y llegar a un `subgrid` obliga a rehacer el componente y
  su `break-inside-avoid` de impresión (feature 223). Desproporcionado para una ficha de presentación.
- **Envolver el número de guía en dos líneas.** Descartada: `35424629` es una sola palabra sin puntos
  de corte; forzarlo exige `break-all`, que es partir el número por dentro — R7 lo prohíbe.

---

## 4. Cómo se verifica el defecto 2: en el navegador, no deducido

**No se puede medir en la suite:** jsdom no hace layout y `scrollWidth`/`clientWidth` valen 0 para
todo (así está escrito ya en `tests/components/TableroDiaTarjetas.test.tsx:491-496`). Lo que la
suite fija es la **anatomía** que produce el resultado; la medición es una sesión de navegador.

**Receta** (la de la 258, `progress/impl_258_frontend.md:526-553`): Playwright, sesión `admin`
(`admin.qa@ordenex.test`) para `/cierres-admin` y sesión de mensajero para `/cierre-dia`, con una
orden de guía de **8 dígitos** (el caso real de la captura) **y otra de 9** (el caso de R14) en la
pestaña visible.

**Criterio, que son dos cosas y no una:**

1. `scrollWidth > clientWidth + 1 || scrollHeight > clientHeight + 1`, y
2. **ninguna palabra rota dentro de sí misma** — una palabra partida NO desborda: cabe,
   rompiéndose, y por eso el criterio (1) le da verde. Se comprueba que la guía renderizada tiene los
   mismos dígitos, en el mismo orden, en una sola línea.

**Y se aplica sobre la CAJA QUE CONTIENE**, no sólo sobre la pieza tocada: la celda de la guía, la
celda del destinatario **y el `<button>` de la fila entero**. Ahí falló la primera sonda de la 258.

**Dos trampas heredadas, a evitar por escrito:**

- **Falso positivo de `sr-only`:** un nodo `sr-only` mide 1×1 con overflow oculto ⇒ da «recortado»
  siempre y no significa nada. Se filtra por `getComputedStyle(n).position === "absolute"`.
- **Falso negativo por medir la pieza:** si sólo se mide el `<span>` de la guía, un `span` sin
  overflow declarado nunca «desborda» (se sale, que es distinto). El solapamiento se detecta en la
  caja contenedora y comparando `getBoundingClientRect()` de celdas vecinas: `guía.right <=
  destinatario.left`.

**Alineación (R10):** comparar `getBoundingClientRect().left` de la celda de guía y de la de
destinatario entre la cabecera y **todas** las filas visibles, con guías de longitudes distintas en
la misma pestaña. Tolerancia ≤1 px.

**Anchos:** 1440, 1280, 1024, 768 y 390. **Audiencias:** `admin` y `mensajero` (la vista del
mensajero usa la misma rejilla con otras columnas de dinero, `:1494-1498`).

---

## 5. Qué fija la suite (y qué no puede fijar)

Los tests van a `tests/components/CierreFacturaPapel.test.tsx`, que ya monta `CierreFacturaDetalle`
y ya tiene los helpers de localización por `role="region"`.

- **Cabecera (R1–R5):** aserciones de texto por estado, con los cuatro estados. Sirve `getByText` /
  `queryByText`: aquí el texto **sí** distingue el defecto del arreglo (a diferencia del defecto 2).
  La ausencia se afirma explícitamente: en `solicitado` y `vencido`, `queryByText(/Comprobante/)` en
  la cabecera es `null` y **no existe ningún nodo con «Resuelto»**.
- **Tarjeta compacta (R13):** el mismo par de casos sobre `CierreFacturaResumen` desplegado —con
  fecha, sale la línea «Resuelto»; sin fecha, no existe ni la línea ni el guion—.
- **Anatomía de la rejilla (R7/R8/R11/R12):** sobre las clases, como en la 258 — la celda de la guía
  no contiene `truncate` ni `break-`; la del destinatario sí contiene `truncate` y `min-w-0`; guía y
  destinatario son dos nodos distintos.
- **Los dos sitios (R10, mitad estructural):** una aserción de que la cabecera de columnas y la fila
  usan **la misma constante** — p. ej. que su `className` contiene idéntico fragmento
  `grid-cols-[...]`, leído del DOM de ambas, no escrito a mano en el test (si se escribe a mano, el
  test se vuelve una copia del literal y deja de comparar los dos sitios entre sí).
- **Lo que la suite NO puede fijar:** que no haya solapamiento ni desalineado real. Eso vive en la
  medición del §4 y se documenta en `progress/impl_263.md`.

⚠️ **Aserción contra su propia fuente, prohibida:** los tests de texto comparan contra **literales
escritos en el test**, no contra el `Record` de rótulos importado del componente. Importar el
`Record` haría que el test siguiera verde con cualquier texto.
