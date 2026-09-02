# Feature 350 — Rediseño de la etiqueta de guía en PDF · bitácora de implementación

> Rama `feature/350-rediseno-etiquetas`, worktree `R:\wt\350`. Spec en
> `specs/350-rediseno-etiquetas/`. Todo lo que sigue está **medido en esta
> sesión** salvo donde se dice lo contrario.

---

## 0. Veredicto en una línea

El peor caso medido (dirección de **286** caracteres, producto de **138**) se
imprime **entero** en las cuatro hojas con el suelo de legibilidad en **7,0 pt**,
sin recortar nada y con **105 caracteres de margen** sobre el máximo de
producción; los dos generadores tienen **diff cero**.

---

## 1. Las cinco preguntas abiertas: cómo quedan

| | Estado | Qué se hizo |
|---|---|---|
| **Q1** — cuatro por hoja en A4/Carta | **SIGUE ABIERTA** (del humano) | La rejilla es **dato del catálogo** (`columnas`/`filas`, hoy 1 × 1 en las cuatro) + `celdaDeHoja()`. Firmarla es cambiar dos filas de una tabla. **No se ha activado.** |
| **Q2** — suelo de legibilidad | **FIRMADO: 7,0 pt** | `CUERPO_MINIMO_PT = 7.0`, absoluto en pt de página, con su justificación (térmica de 203 dpi) escrita en la constante. **El peor caso SÍ cabe a 7,0.** |
| **Q3** — si no cabe | **Fallo visible**, nunca recorte | `ErrorEtiquetaNoCabe` **nombra la guía**; los dos canales lo hacen visible. Medido cuántas etiquetas reales lo dispararían: **cero** (ver §5). |
| **Q4** — audiencia de los integradores | **Cerrada de hecho** | La única medida disponible (otra ficha, contra producción) dice **1 API key, 0 órdenes** y **0 suscripciones de webhook**. No pude re-medir hoy (§8). |
| **Q5** — vista previa del modal | **HECHA** | `EtiquetaGuia.tsx` espeja las cinco bandas, el orden y la jerarquía; test cruzado pantalla/papel. |

### Q1 — el dato que el humano necesita para decidir

La celda de una rejilla 2 × 2 mide **99 mm** de ancho en la propuesta del spec
(105 mm si se parte A4 en cuatro sin guías de corte). En los dos casos hay que
mirar el ancho, no el área: **el ancho es lo que gobierna los caracteres por
línea**, así que «4-up» **no da capacidad por línea** — da **alto** (143 mm
frente a 100) y **ahorra papel**. Ese es el argumento fuerte de Q1; la capacidad
no lo es. Está escrito en `HojaEtiqueta.columnas` y afirmado en
`etiquetas-layout.test.ts` («la celda de Q1 es MÁS ancha que la base»).

---

## 2. Archivos creados y modificados

### Módulos compartidos (el grueso)

| Archivo | Qué le pasó |
|---|---|
| `lib/pdf/etiquetas-maqueta.ts` | **(M)** Deja de ser un lienzo cuadrado: cinco bandas, cuerpos base, `CUERPO_MINIMO_PT`, `INTERLINEADO`, `GAPS_ENTRE_BANDAS`, `separacionBajoGuiaMm`. Mueren `camposYInicio`, `qrTopBase`, `textoYLimite` y las `y` absolutas. |
| `lib/pdf/etiquetas-layout.ts` | **(M)** Contrato nuevo: `celda`, `k = anchoUtil/anchoUtilBase`, `cuerpos`, `qrMm`, `barcodeMm`. Mueren `s`, `lado`, `offX`, `offY`, `escala`. |
| `lib/pdf/etiquetas-ajuste.ts` | **(M)** Gana `partirEnLineas`, `ajustarBloque`, `ErrorEtiquetaNoCabe`. **Conserva** `MARCA_CORTE`, `recortarConElipsis`, `repartirLineas` y `lineasDisponibles` (sin uso en el camino de la etiqueta). |
| `lib/pdf/etiquetas-dibujo.ts` | **(M)** Cinco bandas + recuadro del importe. Muere `drawCampos`. `drawEtiqueta` **conserva su firma**. |
| `lib/pdf/etiquetas-fuente-registro.ts` | **(M)** Gana `seguroEnFuenteEstandar` / `caracterNoEscribibleEstandar` (hallazgo §7.1). |
| `lib/config/etiquetas-hoja.ts` | **(M)** `columnas`/`filas` + `celdaDeHoja()` + `celdasPorHoja()`. |

### Los dos generadores

| Archivo | Diff |
|---|---|
| `lib/pdf/etiquetas-pdf-lote.ts` | **CERO líneas** ✅ |
| `app/(app)/ordenes/_components/etiquetas-pdf.ts` | **CERO líneas** ✅ |

Confirmado con `git status`: ninguno de los dos aparece como modificado. Es el
rendimiento de la inversión que hizo la 282 al extraer la maqueta.

### Frontend y bordes

| Archivo | Qué le pasó |
|---|---|
| `app/(app)/ordenes/_components/EtiquetaGuia.tsx` | **(M)** Vista previa espejo del papel (Q5/R23). |
| `app/(app)/ordenes/_components/EtiquetasGuiaModal.tsx` | **(M)** Distingue «no cabe» y muestra un mensaje que **nombra la guía** (R7). Exporta `mensajeEtiquetaNoCabe`. |
| `app/api/ordenes/api-key/carga/route.ts` | **(M)** El canal best-effort distingue `ErrorEtiquetaNoCabe`: mensaje que nombra la guía + el log conserva el mensaje entero (es PII-free por construcción). |

> ⚠️ **Los tres archivos de arriba son de UI/borde y mi rol nominal es backend.**
> Se hicieron porque la tarea puso Q5 explícitamente dentro del alcance y porque
> R7 exige los dos canales. Si el leader prefiere que los revise `frontend_dev`,
> están aislados y son legibles por separado.

### Tests

| Archivo | Qué le pasó |
|---|---|
| `tests/unit/pdf/pdf-inspector.ts` | **(M)** `rectangulosDePagina()` + `imagenesDePagina()`. |
| `tests/unit/pdf/pdf-inspector.test.ts` | **(N)** Autocomprobación del lector: control positivo **y negativo** de las dos lecturas. |
| `tests/unit/pdf/etiquetas-verificacion.ts` | **(N)** V1-V6, en un solo sitio, para los DOS generadores. |
| `tests/unit/pdf/etiquetas-capacidad.test.ts` | **(N)** R8 (capacidad declarada) y R11 (monotonía). |
| `tests/fixtures/etiquetas-282.ts` | **(M)** `esperado` literal por caso + `CASO_PEOR_MEDIDO`, `CASO_PALABRA_SIN_ESPACIOS`, `CASO_PALABRA_IMPOSIBLE`, `CASO_MINIMOS`. |
| `tests/unit/pdf/etiquetas-maqueta.test.ts` | **(M)** Reescrito según §11 del design, con la sustitución de cada aserción retirada. |
| `tests/unit/components/etiquetas-layout.test.ts` | **(M)** Idem. |
| `tests/unit/pdf/etiquetas-ajuste.test.ts` | **(M)** Extendido con `partirEnLineas`, `ajustarBloque` y `ErrorEtiquetaNoCabe`. |
| `tests/unit/components/etiquetas-pdf.test.ts` | **(M)** V1-V6 × corpus × 4 hojas + R5/R10/R11/R15/R21/R22. |
| `tests/unit/pdf/etiquetas-pdf-lote.test.ts` | **(M)** V1-V6 del lado del servidor. |
| `tests/unit/pdf/etiquetas-dos-generadores.test.ts` | **(M)** Paridad ampliada a **rectángulos e imágenes**. |
| `tests/unit/guards/etiquetas-maqueta-unica.guardia.test.ts` | **(M)** Lista prohibida y control positivo ampliados; guardia nueva contra reimplementar el ajuste. |
| `tests/integration/carga-api-etiquetas.test.ts` | **(M)** R7 por el canal de la API. |
| `tests/components/EtiquetasGuiaModal.test.tsx` | **(M)** R7 por el canal del navegador. |
| `tests/components/EtiquetaGuiaPreview.test.tsx` | **(M)** R23: cruce pantalla/papel de orden y jerarquía. |
| `tests/unit/config/etiquetas-hoja.test.ts` | **(M)** El literal del catálogo gana `columnas`/`filas`. |
| `tests/unit/components/etiquetas-pdf-descarga.test.ts` | **(M)** El doble de jsPDF gana `rect`/`setLineWidth`. |

**Sin migración, sin `down.sql`, sin RLS, sin endpoint nuevo, sin zod nuevo**: la
etiqueta es un READ derivado y esta ficha sólo cambia cómo se dibuja
(`design.md` §10).

---

## 3. T1 — ¿deja `splitTextToSize` desbordar una palabra larga? **NO**

Medido con jsPDF 4.2.1 y Helvetica, script de un solo uso (borrado):

```
{"pt":9,"ancho":88,"entrada":60,"lineas":2,"largos":[41,19],"anchoMax":85.9155,"desborda":false}
{"pt":7,"ancho":88,"entrada":60,"lineas":2,"largos":[53,7],"anchoMax":86.3812,"desborda":false}
{"pt":9,"ancho":10,"entrada":21,"lineas":3,"largos":[6,9,6],"anchoMax":9.9695,"desborda":false}
```

**Veredicto:** jsPDF **sí** parte las palabras más anchas que el cupo. O sea que
`partirEnLineas` **no compensa un defecto de la librería**. Se implementa de todas
formas el partido por carácter, y se dice por qué: el módulo del ajuste tiene que
ser **puro** (lo comparten dos runtimes y no puede llamar a un método de `jsPDF`),
la garantía de R3 pasa a ser nuestra y no heredada de la versión de una
dependencia, y el ancho se mide con la MISMA función con la que después se
comprueba la contención sobre el PDF.

De paso quedó medido el ancho medio de carácter de Helvetica sobre prosa de
dirección: **0,4479 em** (79 caracteres por línea de 88 mm a 7 pt).

---

## 4. T2 — el presupuesto MEDIDO del peor caso

### 4.1 La estimación del spec no se sostenía

`design.md` §5.5 estimaba que el peor caso entraba en 100 × 100 **a 6,0 pt con
0,9 mm de holgura**. Medido con `getTextWidth` real y los parámetros literales
del spec (margen 6, 4 separaciones × 2 mm, recuadro de 16 pt + 2 × 1,5 mm de
padding):

| Suelo | ¿cabe en 100 × 100? | Déficit |
|---|---|---|
| 8,0 pt | no | −14,50 mm |
| 7,0 pt | **no** | **−5,56 mm** |
| 6,0 pt | **no** | −0,57 mm |
| 5,5 pt | sí | +1,92 mm |

Es decir: **ni siquiera a 6,0 pt cabía** con los parámetros del spec. La
estimación fallaba porque suponía 0,5 em por carácter (real: 0,4479) pero también
porque el bloque de destino, con las razones de cuerpo bloqueadas, no podía bajar
la dirección por debajo de 7,78 pt.

### 4.2 Las dos correcciones que lo hacen entrar a 7,0 pt

Ninguna toca el margen (que es tolerancia al desalineado del medio térmico) ni
baja el suelo:

1. **Suelo POR DATO en vez de por bloque.** El bloque de destino desciende
   conservando su jerarquía, pero **cada dato se topa en su propio suelo**:
   `CUERPO_MINIMO_PT` (7,0) para dirección y ubicación, y
   `CUERPO_MINIMO_DESTACADO_PT` (7,25) para destinatario y teléfono. Ese cuarto
   de punto es lo que hace que **R14 se cumpla por construcción** en el caso
   extremo: sin él, destinatario y producto acabarían los dos en 7,0 y
   «estrictamente mayor» se violaría justo en el caso que la ficha viene a
   cerrar. **Gana 3,6 mm.**
2. **Las separaciones entre bandas se DERIVAN de las que ya se imprimían** en vez
   de estrenar 4 × 2 mm: `GAP_TEXTO_CODIGOS` (2 mm, feature 282) contra la banda
   de códigos y el `fieldGap` de la maqueta anterior (1,0 mm) entre bandas de
   texto → **6 mm en total en vez de 8**. **Gana 2 mm** sin inventar un número.
3. El recuadro del importe mide **una línea del interlineado de la maqueta**
   (`16 pt × 1,26 = 7,11 mm`) en vez de «cuerpo + 2 × 1,5 mm de padding»
   (8,64 mm). También derivado. **Gana 1,53 mm.**

### 4.3 La tabla medida, con el PDF real delante

Peor caso (`CASO_PEOR_MEDIDO`, dirección 286 / producto 138), leído del PDF con
el inspector:

| Hoja | k | ancho útil | alto útil | cabecera | recuadro | barcode | cuerpo mín. | cuerpo máx. | ¿emite? |
|---|---|---|---|---|---|---|---|---|---|
| `100x100` | 1 | 88,0 | 88,0 | 26,00 | 7,11 | 16,00 | **7,00** | 22,00 | **sí** |
| `4x6in` | 1,0182 | 89,6 | 140,4 | 26,47 | 7,24 | 16,29 | 8,15 | 22,40 | **sí** |
| `a4` | 2,25 | 198,0 | 285,0 | 58,50 | 16,00 | 36,00 | 18,00 | 49,50 | **sí** |
| `carta` | 2,317 | 203,9 | 267,4 | 60,24 | 16,48 | 37,07 | 18,54 | 50,97 | **sí** |

En `100x100`, el peor caso queda así (líneas base en mm desde el borde superior):

```
  y= 8.82  pt= 8   GUÍA    FECHA  2026-08-25    REMISIÓN
  y=16.58  pt=22   19887910                     REM-2201 (pt=10)
  [QR 26 x 26 mm en x=68..94, y=6..32]
  y=37.18  pt= 9      José Andrés Peña Rodríguez Villalobos
  y=40.93  pt= 8.31   8888 7777
  y=44.16  pt= 7      Del supermercado La Central de Barrio Escalante, doscientos metros al sur y
  y=47.27  pt= 7      ciento cincuenta al oeste, casa esquinera de dos plantas color verde agua con
  y=50.39  pt= 7      portón negro y tapia baja, frente al parqueo del taller de motos, entrada por el
  y=53.50  pt= 7      callejón sin salida contiguo a la panadería Ríos 24
  y=56.61  pt= 7      GAM / San José / Montes de Oca / San Pedro
  [recuadro 88 x 7,11 mm en y=58.55]
  y=64.20  pt=16      COBRAR                                       ₡18.000
  y=69.13  pt= 7      Producto: Juego de sartenes antiadherentes de cinco piezas con tapa de
  y=72.25  pt= 7      vidrio templado, mango desmontable y estuche de cartón reforzado azul marino.
  y=75.36  pt= 7      Tienda: Comercializadora de Electrodomésticos del Valle
  [barcode 88 x 16 mm en y=78..94]
```

Márgenes medidos sobre el PDF: **6,00 mm exactos por los cuatro lados** en las
cuatro hojas (R9). El papel que A4 dejaba en blanco —87 mm— ha desaparecido: su
alto útil pasa de 88 mm a **285 mm**.

---

## 5. T13 — capacidad declarada (R8) y monotonía (R11)

Medido por búsqueda binaria sobre el largo de la dirección, con los demás campos
en su forma corta. **Cada número está comprobado por sus dos lados** en
`etiquetas-capacidad.test.ts`: con ese largo la propiedad se cumple y con **uno
más** deja de cumplirse.

| Hoja | área (mm²) | sin bajar del cuerpo base | antes de llegar al suelo | antes de disparar R7 |
|---|---|---|---|---|
| `100x100` | 10.000 | **106** | **286** | **391** |
| `4x6in` | 15.484 | **699** | **1.266** | **1.765** |
| `carta` | 60.322 | **3.618** | **6.200** | **7.639** |
| `a4` | 62.370 | **4.115** | **6.729** | **8.864** |

Las tres columnas **crecen estrictamente** con el área (el orden por área es
`100x100 < 4x6in < carta < a4`: A4 tiene más papel que Carta aunque sea más
estrecha). La maqueta anterior habría salido **verde por empate** —10 líneas en
las cuatro hojas— y con `>` habría salido roja.

Coincidencia que conviene mirar: la capacidad «antes de llegar al suelo» de la
celda base es **286**, exactamente el máximo medido en producción. Es decir, el
peor caso real cae **justo** en el punto donde la tipografía toca el suelo, y
todavía le quedan **105 caracteres** hasta el fallo visible.

### ⚠️ R11 tiene dos lecturas y una es imposible

Si «sin bajar del **cuerpo base**» se leyera como el cuerpo base **ya escalado
por `k`** (13 × k = 29,25 pt en A4), R11 sería **aritméticamente imposible** junto
con §5.1. Medido: **106 / 699 / 645 (a4) / 538 (carta)** — *decrece* al pasar de
4 × 6 in a A4. La causa no es un defecto: con la tipografía proporcional al
ancho, el texto disponible medido en líneas de la celda base es `altoUtil / k`,
que depende de la **relación de aspecto** de la hoja (1,566 en 4 × 6 in contra
1,439 en A4), no de su área. Se implementa la lectura del cuerpo base
**absoluto**, con la que la monotonía sí se cumple y con la que la segunda frase
de R11 —«un papel más grande nunca debe dar menos capacidad»— es verdadera. Queda
dicho en el propio test, no escondido.

---

## 6. T16 — el coste, contra el presupuesto de la 282/R24

`(t_render + f) × N ≤ 36.000 ms`. Medido en esta máquina con las librerías
reales (`qrcode` + `bwip-js` + jsPDF con `compress: true`):

| Escenario | ms por etiqueta | N = 300 | N = 1.000 (techo duro) |
|---|---|---|---|
| Consolidado, caso típico | 41,8 | **12.546 ms** ✅ | 45.855 ms ❌ |
| Consolidado, peor caso medido | 60,3 | **18.211 ms** ✅ | 60.703 ms ❌ |
| Individual, peor caso medido | 58,9 | **20.145 ms** ✅ | 67.149 ms ❌ |

**Cabe en el tope por defecto (300) con 1,8× de margen incluso en el peor caso, y
NO cabe en el techo duro de 1.000.** Ahora el reparto, que es lo que decide de
quién es el problema:

- **Rasterizado (no lo toca esta ficha): 18,9 ms/etiqueta** (QR 16,7 + barcode
  2,3), medido aparte.
- **Dibujo + `output()` (lo que esta ficha cambia): 2,7 ms** en el caso típico y
  **8,4 ms** en el peor caso medido, medido con PNG de relleno.
- El resto (~20 ms) es `addImage` de dos PNG de 512 px + deflate, tampoco de esta
  ficha.

Es decir: **el techo duro de 1.000 ya estaba desbordado antes de esta ficha**
(39,3 s sólo con el rasterizado y el ensamblado) y la parte atribuible al ajuste
nuevo es del orden del **6 %** del total. **No se aplica la mitigación** que
`design.md` §13 tenía descrita (arrancar la búsqueda por estimación de área):
cabe en el tope real y aplicarla de antemano sería optimizar sin necesidad.

**Riesgo declarado y no mitigado:** el coste del ajuste crece con el largo del
texto (la búsqueda descendente recompone el bloque en cada paso). Medido: una
dirección de **8.864** caracteres en A4 cuesta **1,26 s** de dibujo. Son 31 veces
el máximo medido en producción, pero una carga por API de 300 órdenes con
direcciones así superaría el presupuesto. Queda escrito; si aparece, la
mitigación está descrita.

---

## 7. Hallazgos que no estaban en el spec

### 7.1 jsPDF **borra en silencio** 27 caracteres de cp1252 (fallo mudo, cerrado)

Medido uno a uno los 216 code points imprimibles de cp1252 con Helvetica
estándar, leyendo el resultado **del PDF**: sobreviven ASCII `0x20-0x7E` y
Latin-1 `0xA0-0xFF` (acentos y eñe incluidos) y **jsPDF borra los 27 del bloque
`0x80-0x9F`**:

```
€ ‚ ƒ „ … † ‡ ˆ ‰ Š ‹ Œ Ž ‘ ’ “ ” • – — ˜ ™ š › œ ž Ÿ
```

No los sustituye ni avisa: `"a—b"` acaba escrito `"ab"`, y `getTextWidth` sigue
devolviendo el ancho del carácter que no va a imprimir. Es **el mismo fallo mudo
que la 282 encontró con el símbolo de moneda**, pero en la fuente estándar, donde
nadie estaba mirando.

**Cómo se descubrió:** V1 lo cazó al primer intento. El marcador de «sin
dirección» del código actual es `—` (U+2014, uno de los 27), así que **hoy una
orden sin dirección imprime una línea VACÍA** en el papel.

**Cómo se cierra:** cualquier valor que la fuente estándar no pueda escribir se
dibuja **entero con la fuente embebida** (su subconjunto es cp1252 completo),
pasando por `exigirCobertura` antes de escribir un byte (R21). La elección es
función **pura del texto**, así que medir y dibujar nunca usan métricas
distintas. Los rótulos y el número de guía van en negrita y del artefacto
embebido no hay negrita: ahí se falla de forma visible en vez de imprimir un
hueco. Verificado con dos invariantes observables sobre el PDF: ningún texto
`Type0` la usa sin necesitarla y ningún texto en la estándar lleva un carácter
que ésta borre.

Impacto real hoy: el alfabeto medido en producción el 2026-08-25 no tiene ninguno
de los 27. Pero esa medida «es la foto de un día y CADUCA», y un apóstrofo
tipográfico `’` pegado en el nombre de una tienda entra por copiar y pegar.

### 7.2 El caso adversarial del spec no era adversarial

`CASO_PALABRA_SIN_ESPACIOS` son 60 caracteres, el número que pedía el spec. Pero
medido con la fuente real ocupa **74,9 mm a 7 pt**, o sea **cabe** en los 88 mm
del ancho útil: el ajuste se limita a bajar el cuerpo y el partido por carácter
**nunca llega a ejercerse**. Lo demostró la mutación M3, que **sobrevivió en
verde** con ese caso. Se añadió `CASO_PALABRA_IMPOSIBLE` (110 caracteres,
**133,5 mm a 7 pt**), que sí obliga a partir, y con él M3 sale roja. Los dos casos
se conservan.

### 7.3 El error de «no cabe» decía el número equivocado

La primera versión reportaba siempre milímetros de alto, incluso cuando el
problema era de **ancho** (una palabra que no entra en la línea). `AjusteBloque`
gana `motivo: "alto" | "ancho"` y el mensaje dice cuál de los dos, porque mandan a
mirar sitios distintos.

---

## 8. Q4 — la audiencia de los integradores, medida

**No pude re-medir hoy**: desde este worktree no tengo acceso a la base ni al MCP
de Supabase. La única medida disponible es la que dejó otra ficha **contra
producción** (`progress/history.md`):

> «Dos consultas de sólo lectura contra producción: **0 suscripciones de webhook**
> —ni activas ni de baja— y **una sola API key**, la de Dropi, creada el
> 2026-08-20 y **con 0 órdenes**.»

Con 0 órdenes creadas por esa key, esa key **nunca ha pedido un PDF de
etiquetas**: el bloque `etiquetasPdf` sólo se genera tras una carga con órdenes.
Súmese que producción se vació a propósito el 2026-08-25 para el arranque
comercial.

**Audiencia medida del cambio de aspecto del PDF por API: cero.** No hay a quién
avisar y la pregunta se cierra sola, como el propio spec anticipaba. Si el leader
quiere el número de hoy, hace falta una consulta de sólo lectura contra
producción que yo no puedo lanzar.

---

## 9. T19 — verlo con los ojos (y qué NO cubre)

Generados los PDF **con QR y código de barras REALES** (`qrcode` + `bwip-js`, no
los PNG de relleno de los tests), del peor caso y del caso mínimo en las cuatro
hojas:

```
<scratchpad>/etiquetas-350/peor-caso-medido-{100x100,4x6in,a4,carta}.pdf
<scratchpad>/etiquetas-350/minimos-{100x100,4x6in,a4,carta}.pdf
```

(`<scratchpad>` = `C:\Users\ArqDev\AppData\Local\Temp\claude\R--job-singularis-projects-ordenex\55e63929-d3dd-40b8-841b-9adbea4331aa\scratchpad`)

Comprobado **con el inspector** sobre esos bytes: nada cortado, nada fuera de la
celda, márgenes de 6,00 mm por los cuatro lados, el importe dentro de su recuadro,
QR cuadrado de 26 mm arriba a la derecha y barcode de 88 × 16 mm a todo el ancho.
En el caso mínimo el ajuste **sube** los cuerpos a su base (13 / 12 / 10 / 9 / 16
/ 8) en vez de quedarse en el suelo, y el marcador `—` de «sin dirección» sale
impreso.

**Lo que esto NO cubre, y hay que decirlo:** no los he abierto con ojos humanos ni
he escaneado el QR con un móvil. La verificación es geométrica y de contenido,
leída del PDF. Queda pendiente esa mirada de un minuto antes de la release.

Un dato relacionado: la **zona de silencio** del QR no empeora. Antes vivía abajo
a la izquierda con 6 mm de margen a dos lados y 2 mm arriba; ahora vive arriba a
la derecha con 6 mm a dos lados y 2 mm por los otros dos. El peor lado sigue
siendo 2 mm en los dos diseños.

---

## 10. T18 — las ocho mutaciones, con su salida real

Aplicadas una a una sobre el árbol, corridas, y **revertidas** (verificado con
`git status`: ningún archivo de producción quedó tocado).

| # | Mutación | Resultado | Evidencia |
|---|---|---|---|
| **M1** | Volver a `recortarConElipsis` en el bloque de destino | 🔴 **9 tests rojos** | `caso «peor-caso-medido» en 100x100: se recorto ["…verde agua con..."]` y `el dato «direccion» NO se reconstruye desde el PDF` |
| **M2** | Suelo a 12 pt | 🔴 **49 tests rojos**, todos por **excepción**, ninguno por recorte | `ErrorEtiquetaNoCabe: La etiqueta de la guia 1042 no cabe en la hoja «100x100» ni con el cuerpo minimo de legibilidad: bloque de destino … No se emite: antes que una etiqueta con un dato recortado, ninguna.` |
| **M3** | Quitar el partido de palabras largas | 🔴 **8 + 4 rojos** (tras §7.2) | `caso «palabra-imposible» en 100x100` → `ErrorEtiquetaNoCabe … guia 19887913`; y en T9 `expected 45 to be less than or equal to 25` |
| **M4** | `k` vuelve al lado menor (el `s` de la 150) | 🔴 **10 rojos** | `4x6in: la capacidad SUBIO de la declarada (sinBajarBase aguanta 700 caracteres o mas)` + `k de 4x6in: expected 1.016 to be close to 1.0181…` |
| **M5** | El recuadro sólo en el generador de cliente | 🔴 **8 rojos** | `expected { rectangulos: [], imagenes: […] } to deeply equal { rectangulos: [ {…} ], … }` |
| **M6** | Destinatario y producto al mismo cuerpo | 🔴 **32 rojos** | `evidencia/a4: destinatario 29.25 pt no supera a producto 29.25 pt` |
| **M7** | El importe se envuelve en dos líneas | 🔴 **39 rojos** | `expected [ Array(18) ] to include '₡18.000'` + `no se encontro la fila del monto en el content stream` |
| **M8** | Quitar UN carácter del final de la dirección | 🔴 **33 rojos** | `evidencia/100x100: el dato «direccion» NO se reconstruye… dibujado [… "con porton negr" …]` |

### Dos mutaciones **SOBREVIVIERON** antes de arreglar la verificación

Se cuentan porque son la información valiosa:

1. **M3 sobrevivió en verde** contra el corpus del spec (`Tests 57 passed`). El
   caso de 60 caracteres **cabe** en la línea, así que la red de seguridad de
   `ajustarBloque` (bajar el cuerpo hasta que entra) absorbía la mutación. Se
   arregló añadiendo `CASO_PALABRA_IMPOSIBLE` **medido**, no estimado (§7.2).
2. **M5 sobrevivió en verde** en su primera formulación (envolver el `doc.rect`
   en `typeof document !== "undefined"`): los dos generadores corren en el MISMO
   proceso jsdom en el test de paridad, así que el discriminante no discriminaba.
   Se reformuló como la divergencia realista —sacar el recuadro del módulo
   compartido y dibujarlo en el generador de cliente— y ahí sí sale roja. Es la
   forma exacta en que este repo ya divergió una vez.

---

## 11. Trazabilidad R → test

| R | Qué fija | Test que lo cubre |
|---|---|---|
| R1 | ninguna marca de recorte | `etiquetas-verificacion.ts` **V6**, corrido en `etiquetas-pdf.test.ts` y `etiquetas-pdf-lote.test.ts` × corpus × 4 hojas |
| R2 | reconstrucción exacta de cada dato | **V1** (literal del fixture, nunca la función que lo genera) |
| R3 | ninguna línea excede el ancho; palabras largas partidas | `etiquetas-ajuste.test.ts > partirEnLineas (R3)` + **V2** con `CASO_PALABRA_IMPOSIBLE` |
| R4 | nada fuera de la celda ni en la banda de códigos | **V3** (contra el rectángulo REAL de las dos imágenes) |
| R5 | el peor caso medido, en las cuatro hojas | `etiquetas-pdf.test.ts > R5 — el PEOR CASO MEDIDO` + V1-V6 sobre `CASO_PEOR_MEDIDO` × 4 |
| R6 | suelo de legibilidad, absoluto | `etiquetas-maqueta.test.ts > R6` + **V4** |
| R7 | no cabe ⇒ fallo visible en los dos canales | `EtiquetasGuiaModal.test.tsx > R7 (feature 350)` + `carga-api-etiquetas.test.ts > R7` + `etiquetas-capacidad.test.ts > uno mas que la capacidad lanza` |
| R8 | capacidad declarada por hoja | `etiquetas-capacidad.test.ts > R8` (12 casos, cada número por sus dos lados) |
| R9 | la celda se usa entera | `etiquetas-layout.test.ts > la franja sin usar es EXACTAMENTE el margen` + **V3** |
| R10 | el alto extra se vuelve líneas | `etiquetas-pdf.test.ts > R10/R11 — el alto extra…` + `etiquetas-layout.test.ts > el alto util crece con el area` |
| R11 | más papel nunca da menos capacidad | `etiquetas-capacidad.test.ts > R11` (las tres métricas) |
| R12 | QR y barcode no encogen ni se deforman | `etiquetas-layout.test.ts > QR y codigo de barras (R12)` + **V3** (el QR se identifica por ser cuadrado) |
| R13 | las cinco bandas y su orden | `etiquetas-maqueta.test.ts > R13` + **V3** (intervalos disjuntos y ordenados, y el orden de los datos) |
| R14 | destinatario/teléfono > producto/tienda | **V5** × corpus × 4 hojas + `etiquetas-maqueta.test.ts > el suelo de los datos DESTACADOS` |
| R15 | importe en recuadro y en una línea | **V5** (contención en el rectángulo leído del PDF) + `R15/R22 — el importe` |
| R16 | sin columna de rótulos en el destino | **V1** (no hay más rótulos que los seis declarados) + **V2** + `EtiquetaGuiaPreview.test.tsx > el bloque de destino NO tiene columna de rotulos` |
| R17 | los diez datos siguen impresos | **V1** los recorre todos |
| R18 | una sola fuente de verdad de la geometría | `etiquetas-maqueta-unica.guardia.test.ts` (lista prohibida ampliada + control positivo + guardia nueva contra reimplementar el ajuste) |
| R19 | los dos generadores dibujan lo mismo | `etiquetas-dos-generadores.test.ts` (texto + cuerpos + **rectángulos** + **imágenes**) |
| R20 | el lote conserva firma y página | `etiquetas-pdf-lote.smoke.test.ts` **sin tocarlo** + `etiquetas-maqueta.test.ts > crearLayoutBase` |
| R21 | cobertura exigida a todo texto con fuente embebida | `etiquetas-pdf.test.ts > R21` (los dos invariantes observables) |
| R22 | el importe no se convierte ni se reconstruye | `R15/R22 — el texto del importe es EL del formateador` + las guardias de dinero vivas |
| R23 | la vista previa refleja orden y jerarquía | `EtiquetaGuiaPreview.test.tsx > R23` (orden cruzado pantalla/papel, ranking de tamaños, recuadro del importe) |
| R24 | no se pierde lo vigente de la 282 y la 295 | `R24 (282/R1)`, `R24 (282/R19)`, `R24 (feature 295)` (4 tests) + `R6/R7/R26/R34` intacto |

**Los 24 mapeados; ninguno sin test.**

### Aserciones retiradas (§11 del design), fila a fila

Cada una dejó **en su sitio** un comentario con qué afirmaba, qué la sustituye y
por qué el relevo es igual o más fuerte. Las ocho filas de `design.md` §11 están
cubiertas, más dos que el design no listaba y que también se documentan: las dos
aserciones horizontales de la feature 295 («REMISIÓN acaba en el margen derecho»
y «el par FECHA va centrado en el lienzo»), que ahora se miden contra el borde de
la **columna de texto** de la cabecera porque el QR pasa a ocupar la derecha.

---

## 12. Verificación ejecutada

```
$ npx tsc --noEmit -p tsconfig.json
TYPECHECK_EXIT=0          (sin salida)

$ npx eslint .
LINT_EXIT=0
✖ 150 problems (0 errors, 150 warnings)     <- las 150 son heredadas

$ npx vitest run <las 22 suites de etiquetas>
TEST_EXIT=0
 Test Files  22 passed (22)
      Tests  325 passed (325)
```

Radio de impacto ampliado (todo lo que importa alguno de los módulos tocados:
`tests/integration`, `tests/unit/{api,components,config,guards,pdf,services,types}`,
`tests/components/Ordenes*`):

```
 Test Files  3 failed | 794 passed (797)
      Tests  3 failed | 11826 passed (11829)
```

Los tres rojos, uno a uno:

1. `superficie-de-uso.guardia.test.ts` → `lib/actions/tarifas.ts:67 obtenerTarifa`.
   **Heredado**, el único rojo tolerado por el encargo.
2. `recuperar-contrasena-form.test.tsx` y `tablero-dia-aislamiento.test.ts`.
   **Flakes de carga**: los dos pasan en aislado (`Tests 15 passed`). Nada que
   ver con esta ficha (auth y un test de Postgres).

**No he corrido `./init.sh --rapido`**: el encargo pedía typecheck y lint, y el
gate lo pasa el leader (además de que corriéndolo yo mientras el árbol está
mutable el veredicto no valdría).

---

## 13. Lo dudoso, dicho

1. **R11 tiene una lectura imposible** y he elegido la otra (§5). Está razonado y
   medido, pero es una **interpretación mía** de un requisito ambiguo.
2. **Tres archivos de UI/borde tocados** desde un rol nominalmente backend (§2).
3. **El techo duro de 1.000 etiquetas no cabe en el presupuesto** de la 282/R24
   (§6) — y ya no cabía antes de esta ficha. No lo he arreglado ni me lo pidieron;
   queda escrito.
4. **No he mirado los PDF con ojos humanos** ni escaneado el QR (§9).
5. **La audiencia de Q4 no la he medido hoy**: reutilizo la medida de otra ficha
   porque no tengo acceso a la base desde aquí (§8).
6. **El coste del ajuste crece con el largo del texto** y con una dirección
   patológica (8.864 caracteres) sube a 1,26 s por etiqueta (§6).
