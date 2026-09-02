# Feature 350 — Rediseño de la etiqueta de guía en PDF · requirements

> Requisitos en notación EARS. Cada `R<n>` es testeable y está mapeado a un test
> concreto en `tasks.md` (§ Trazabilidad). Sin detalles de implementación: esos
> viven en `design.md`.

## Lo que pidió el humano (literal, y es el alcance)

> «necesito que rediseñes las etiquetas que se descargan en pdf, debes tener en
> cuenta **todos los tamaños posibles** que tenemos y no solo eso sino que
> **ningún dato de los que mostramos puede estar recortado ni terminado en tres
> puntos**, es decir se debe asegurar mostrar toda la información y también debes
> considerar un mejor diseño **dándole prioridad a los datos más importantes**»

El rediseño **ya está decidido y aprobado** («está perfecto, vamos con ese
rediseño»). Este spec dice *cómo se implementa y cómo se demuestra*, no vuelve a
diseñar.

## Contexto medido — se da por cierto, no se reabre

| Hecho | Cifra |
|---|---|
| Etiquetas que se recortan **hoy** en producción | **56 de 887 (6,3 %)** |
| Longitud de `dirección` | máx **286** car., media 65, p95 119 |
| Longitud de `producto` | máx **138** car., p95 74 |
| Cupo actual de líneas para los 7 campos | **10**; el peor caso necesita **15** |
| Papel sin usar hoy: `4x6in` / `a4` / `carta` | **50,8 / 87 / 63,5 mm** |

**La causa de fondo**, en `lib/pdf/etiquetas-layout.ts`: la etiqueta es un
cuadrado de 100 × 100 escalado por un factor único `s = min(ancho, alto)/100` y
centrado; **todo** se multiplica por `s`, tipografía incluida. Consecuencia
aritmética, no opinión: **los cuatro tamaños tienen la misma capacidad de
texto**. Elegir A4 solo agranda la letra (guía a 46,2 pt) y deja 87 mm de papel
en blanco; no da ni un carácter más. Comprobado contra
`tests/unit/components/etiquetas-layout.test.ts:68-71`: `offY` vale 25,4 / 43,5 /
31,75 mm, es decir exactamente la mitad del papel desperdiciado de la tabla.

## Las tres decisiones del diseño aprobado (D1-D3, vinculantes)

- **D1 — La etiqueta deja de ser un cuadrado escalado.** Cada hoja usa su área
  real. El alto sobrante se convierte en **líneas de texto**, no en letra grande.
- **D2 — Se va la columna de rótulos del bloque de destino.** Hoy la mide el
  rótulo más ancho («MONTO A COBRAR») y se come ~24 % del ancho útil en **todas**
  las líneas. El bloque de destino se lee como una dirección: el valor usa el
  ancho completo (~33 % más caracteres por línea, y el mayor golpe de capacidad
  justo en el tamaño más apretado).
- **D3 — Jerarquía por TAMAÑO, no por orden de lista.** Guía y QR arriba;
  destinatario y teléfono grandes; **el importe en un recuadro** —hoy es una fila
  más del montón siendo lo que el mensajero tiene que cobrar—; producto y tienda
  en el cuerpo menor.

## Decisiones heredadas que esta ficha REVISA (y por qué puede)

Esto no es un detalle de forma: son requisitos **vivos y verdes** que el
rediseño contradice. Se revisan igual que la feature 282 revisó la D3 de la 150,
y por el mismo motivo: una firma posterior del humano.

| Origen | Qué decía | Cómo queda |
|---|---|---|
| **282 / R4** | «los mismos siete campos, con sus mismos rótulos y en el mismo orden; NO añadir, quitar, reordenar ni renombrar» | **REVISADO.** Los nueve datos se conservan (R17); su **orden y sus rótulos** cambian por D2/D3 |
| **282 / D2** | «se arregla lo evidenciado, no se rediseña la etiqueta» | **AGOTADO.** Esta ficha *es* el rediseño |
| **150 / R14-R17** | factor único `s`, bloque cuadrado centrado, todo escala con `s` | **SUSTITUIDO** por D1. Lo que aquellos protegían de verdad —no deformar los códigos, no salirse de la página— se conserva y se endurece (R12, R4) |
| **150 / R12, D1** | «una etiqueta por página, escalada; nunca mosaico» | **SIGUE VIGENTE** salvo que el humano cierre **Q1** (cuatro por hoja en A4/Carta) |
| **282 / R25-R27** | cupo ≥ 9 líneas, ni guía encogida ni banda de códigos comprimida | **CONSERVADO en su intención y endurecido**: R1-R5 sustituyen el «cupo» por «cabe entero»; R12 conserva las dimensiones de los códigos |

## Vocabulario

- **Celda**: el rectángulo de papel que ocupa **una** etiqueta. Hoy = la hoja
  entera; con Q1 abierta, podría ser un cuarto de A4.
- **Bloque de destino**: destinatario, teléfono, dirección y ubicación.
- **Cuerpo efectivo**: el tamaño tipográfico en puntos con el que un texto se
  dibuja de verdad en la página (el que declara el PDF), no el de la maqueta.
- **Peor caso medido**: una etiqueta con dirección de **286** caracteres y
  producto de **138**, las longitudes máximas medidas en producción.

---

## Requisitos

### A. Nada recortado — el requisito duro

- **R1** — El sistema NO DEBE dibujar ninguna marca de recorte en ningún texto de
  la etiqueta: ni la marca ASCII de tres puntos, ni el carácter de puntos
  suspensivos (U+2026), ni ninguna otra abreviatura de continuación.

- **R2** — CUANDO se genere una etiqueta, para cada uno de sus nueve datos la
  concatenación de las líneas realmente dibujadas —leídas del PDF producido y
  decodificadas con el mapa a Unicode que el propio documento declara— DEBE ser
  **exactamente** el valor de ese dato, salvo por los espacios en blanco que
  introduce el salto de línea. Ni un carácter menos, ni uno sustituido.

- **R3** — El sistema DEBE dibujar cada línea de texto **dentro del ancho útil**
  de su bloque: el ancho de tinta de la línea, medido con la misma fuente y el
  mismo cuerpo con los que se dibujó, NO DEBE superar ese ancho. SI una palabra
  suelta no cabe entera en el ancho útil, ENTONCES el sistema DEBE partirla y
  continuarla en la línea siguiente; NUNCA DEBE dejarla desbordar el bloque.

- **R4** — El sistema NO DEBE dibujar ningún texto ni ninguna imagen fuera de su
  celda ni dentro de la banda reservada al QR y al código de barras.

- **R5** — CUANDO se genere la etiqueta del **peor caso medido** (dirección de
  286 caracteres y producto de 138), el sistema DEBE cumplir R1, R2, R3 y R4 en
  **los cuatro tamaños** del catálogo.

- **R6** — El sistema DEBE declarar un **cuerpo tipográfico mínimo de
  legibilidad**, expresado en puntos de página (absoluto, no relativo al tamaño
  de la hoja), y NO DEBE dibujar ningún texto de la etiqueta con un cuerpo
  efectivo menor que él, en ninguna hoja del catálogo y con ningún dato de
  entrada.

- **R7** — SI el texto de una etiqueta no cabe en su celda ni siquiera con el
  cuerpo mínimo de R6, ENTONCES el sistema DEBE fallar de forma **visible** por
  los canales que ya existen —en el navegador, con mensaje y **sin** descargar
  ningún PDF; en la carga por API, con el fallo visible de la respuesta y sin
  revertir la carga— y NUNCA DEBE entregar una etiqueta con un dato recortado,
  desbordado o superpuesto.

- **R8** — El sistema DEBE declarar, medida y no estimada, la **capacidad** de
  cada tamaño del catálogo: cuántos caracteres de dirección admite antes de
  llegar al cuerpo mínimo de R6 y cuántos antes de disparar R7. La verificación
  DEBE ponerse en rojo si alguna de esas capacidades baja respecto de la
  declarada.

### B. Cada hoja usa su área real

- **R9** — El sistema DEBE dibujar la etiqueta sobre el **área real** de su
  celda. La franja de papel sin usar entre el borde de la celda y el contenido
  NO DEBE superar el margen declarado por la maqueta, en ninguno de los cuatro
  tamaños.

- **R10** — CUANDO la celda sea más alta que la celda base, el sistema DEBE
  convertir ese alto adicional en **líneas de texto disponibles**, y NO DEBE
  convertirlo únicamente en cuerpo tipográfico mayor.

- **R11** — Para un mismo dato de entrada, el número de caracteres que la
  etiqueta admite sin bajar del cuerpo base NO DEBE decrecer al pasar a una hoja
  de área mayor. Un papel más grande nunca DEBE dar menos capacidad que uno más
  pequeño.

- **R12** — El sistema NO DEBE reducir el QR ni el código de barras por debajo
  de las dimensiones con las que se imprimen hoy (26 mm de lado y 16 mm de alto
  en la celda base), NI DEBE deformarlos: el QR DEBE dibujarse cuadrado y el
  código de barras DEBE conservar la relación de aspecto de su raster. La
  densidad del raster del código de barras NO DEBE bajar de la que tiene hoy en
  la celda base.

### C. Jerarquía — prioridad a los datos importantes

- **R13** — El sistema DEBE disponer la etiqueta en bandas verticales, en este
  orden de arriba abajo: (1) cabecera con el número de guía y el QR, (2) bloque
  de destino, (3) importe a cobrar, (4) producto y tienda, (5) código de barras.

- **R14** — El sistema DEBE dibujar el destinatario y el teléfono con un cuerpo
  efectivo **estrictamente mayor** que el del producto y el de la tienda, en
  todas las hojas del catálogo y con cualquier dato de entrada.

- **R15** — El sistema DEBE dibujar el importe a cobrar **dentro de un recuadro
  visible** y en **una sola línea**: el importe NUNCA DEBE partirse entre dos
  líneas ni salirse del recuadro. El texto del importe DEBE quedar contenido en
  el rectángulo dibujado, medido sobre el PDF.

- **R16** — El sistema NO DEBE reservar una columna de rótulos en el bloque de
  destino: el valor de cada dato de ese bloque DEBE disponer del ancho útil
  completo de la celda.

- **R17** — El sistema DEBE seguir imprimiendo los **nueve datos** que imprime
  hoy: número de guía, número de remisión, fecha de creación, destinatario,
  teléfono, dirección, ubicación geográfica, producto, importe a cobrar y tienda.
  Ninguno DEBE desaparecer del papel por efecto del rediseño.

### D. Los dos generadores, sin volver a divergir

- **R18** — Los dos generadores de PDF —el de cliente y el server-side del
  lote— DEBEN tomar de **una única fuente de verdad** toda la geometría nueva:
  bandas, reparto de altos, cuerpos base, cuerpo mínimo, márgenes y recuadro del
  importe. Ninguno de los dos DEBE declarar por su cuenta un valor que el otro
  también declara.

- **R19** — Para una misma etiqueta y en la celda base de 100 × 100 mm, los dos
  generadores DEBEN producir **el mismo dibujo**: las mismas líneas base de
  texto, el mismo texto, los mismos cuerpos y **los mismos rectángulos**. SI uno
  de los dos cambia su maqueta sin el otro, ENTONCES la verificación DEBE
  ponerse en rojo.

- **R20** — El generador server-side del lote DEBE conservar su firma pública de
  un solo parámetro, su página de 100 × 100 mm, su tope de etiquetas por PDF y
  su política best-effort de fallo visible. NO DEBE ganar un parámetro de tamaño
  de hoja.

### E. Dinero y fuente embebida

- **R21** — SI el rediseño dibuja con la fuente embebida algún texto que hoy no
  se dibujaba con ella, ENTONCES el sistema DEBE exigir que el subconjunto
  embebido cubra **ese texto completo** antes de escribir un solo byte del PDF, y
  DEBE fallar de forma visible si no lo cubre.

- **R22** — El sistema DEBE tomar el texto del importe tal como lo produce el
  formateador de moneda y NO DEBE convertirlo a número, re-parsearlo ni
  reconstruirlo para decidir el ajuste: ninguna decisión de maquetación DEBE
  alterar los caracteres del importe.

### F. La vista previa no puede mentir sobre el papel

- **R23** — CUANDO se muestre la vista previa de etiquetas en pantalla, DEBE
  presentar los mismos datos, en el **mismo orden** y con la **misma jerarquía de
  tamaños** que el PDF: si un dato se dibuja destacado en el papel, en pantalla
  NO DEBE verse como uno más de la lista.

### G. No-regresión de lo que sigue vigente

- **R24** — El sistema DEBE conservar lo que las features 282 y 295 dejaron
  verificado y esta ficha no sustituye: el número de guía NO DEBE pisar la línea
  siguiente, el símbolo de moneda DEBE seguir imprimiéndose con glifo real, y la
  fecha de creación DEBE seguir apareciendo en el papel.

---

## Preguntas abiertas

Estas cinco **no se resuelven en el spec**: requieren firma. El diseño está
escrito de forma que las dos salidas de Q1 son posibles sin rehacer nada.

### Q1 — ¿Cuatro etiquetas por hoja en A4 y Carta? *(la que el humano dejó pendiente)*

La propuesta era **2 × 2 celdas de 99 × 143 mm** en A4 y Carta, casi el estándar
de envío. Lo que hay que saber antes de firmar:

1. **Reabre la D1 de la feature 150**, firmada por el humano y hoy blindada por
   `tests/unit/components/etiquetas-pdf.test.ts:206-233` («produce tantas páginas
   como etiquetas, en los cuatro tamaños (nunca mosaico)»). Aquella decisión ya
   evaluó el mosaico y lo descartó por tres motivos escritos: exige guías de
   corte, cambia la semántica «una etiqueta = una página» en la que se apoya el
   flujo de impresión térmica, y multiplica los casos de borde (última hoja
   incompleta, lotes que no son múltiplo de 4).
2. **Cambia el comportamiento observable del PDF**: hoy es una orden por página.
   Un operador que imprime 7 etiquetas pasaría de 7 páginas a 2.
3. **Coste de capacidad**: una celda de 99 × 143 mm es **más angosta** que la
   hoja de 100 × 100 actual (99 < 100). El ancho manda sobre los caracteres por
   línea, así que en A4 «4-up» la capacidad por línea sería la de la celda base,
   no mayor. La ganancia sería de alto (143 mm frente a 100), es decir de
   **líneas**; el papel ahorrado es el argumento fuerte, no la capacidad.
4. **Con «4-up» hay que decidir además**: ¿se dibujan guías de corte?, ¿la última
   hoja incompleta deja celdas vacías o se rellena?, ¿el nombre del archivo lo
   refleja?

**Ninguna de estas cuatro se contesta aquí.** El diseño deja A4 y Carta en 1 × 1
por defecto y la rejilla como **dato del catálogo** (`design.md` §3), de modo que
firmar Q1 sea cambiar dos filas de una tabla y no reescribir el motor.

### Q2 — ¿Cuál es el cuerpo mínimo de legibilidad, y con qué autoridad?

R6 exige un número. **El repo no tiene ninguna fuente sobre legibilidad en
papel.** Lo único medido es que hoy se imprimen y se leen rótulos a **8 pt** en
la celda base.

La propuesta del spec es **6,0 pt**, y es una elección del autor del spec, no un
dato heredado: son 2 pt por debajo de lo único ya validado en papel, y con ella
la aritmética preliminar del peor caso cabe en 100 × 100 (`design.md` §5).
**Hace falta que el humano lo firme o lo corrija**, porque encoger sin suelo es
otra forma de perder el dato. Alternativas con su coste en `design.md` §5.2.

### Q3 — Si ni con el cuerpo mínimo cabe, ¿fallo visible o etiqueta imperfecta?

R7 propone **fallo visible**: no se descarga nada y se avisa. Es la doctrina del
repo (`exigirCobertura` ya lanza antes de escribir un byte). Pero tiene un coste
real que hay que aceptar con los ojos abiertos: ese operador **se queda sin
etiqueta** para esa orden, mientras que hoy obtendría una con tres puntos.

Con la medición de R8 sobre la mesa, la pregunta se vuelve concreta: si la
capacidad de 100 × 100 resulta ser, por ejemplo, 340 caracteres de dirección
frente a los 286 del máximo medido, R7 no se dispara nunca en la práctica y el
coste es teórico. **Si la capacidad quedara por debajo del máximo medido, se
para y se pregunta**: no se elige mitigación en silencio.

### Q4 — ¿El PDF que reciben los integradores por API también cambia de aspecto?

La geometría es compartida **a propósito** (feature 282 / R21), así que el
rediseño **cambia también el PDF consolidado de la carga por API**, no solo el
del modal. Eso es lo correcto técnicamente —un espejo a mano ya divergió una vez—
pero es un cambio visible para terceros.

No se propone bloquear la ficha por esto. Se pide **medir la audiencia antes de
decidir si hay que avisar**: cuántos integradores consumen hoy `etiquetasPdf` de
la carga por API. Si son cero, no hay a quién avisar y la pregunta se cierra
sola.

### Q5 — ¿La vista previa del modal entra en esta ficha?

R23 la incluye, y no por simetría: el propio código declara el principio
(`EtiquetaGuia.tsx:112-123`, feature 295) — «la vista previa sirve para decidir
si imprimir, así que tiene que parecerse al papel». Si el PDF se rediseña y la
pantalla no, la vista previa pasa a mentir sobre lo que va a salir impreso.

El coste es acotado (los tests actuales de la vista previa afirman **valores**,
no la estructura `dt`/`dd`), pero **amplía el alcance de la ficha al frontend**.
Si el humano prefiere dejarlo fuera, R23 sale y la divergencia pantalla/papel
queda declarada como deuda con su fecha.

---

## Lo que este spec NO decide y tampoco necesita firma

Decisiones tomadas por el autor del spec, argumentadas en `design.md` y
revisables en la puerta de aprobación:

1. Producto y tienda conservan un rótulo **en línea, sin columna alineada**; el
   bloque de destino no lleva ninguno (§4.2).
2. La fecha y el número de remisión siguen en la cabecera, donde la feature 295
   los dejó (§4.1).
3. `MARCA_CORTE` y `recortarConElipsis` **no se borran** del repo: se dejan sin
   uso en el camino de la etiqueta y la verificación exige que no se usen (§7).
   Borrarlos arrastraría sus tests, y en este repo eso ya costó una regresión.
