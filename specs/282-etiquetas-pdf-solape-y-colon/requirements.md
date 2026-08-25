# Feature 282 — Etiquetas PDF: solape del número de guía y símbolo del colón

> Requisitos en notación EARS. Cada `R<n>` es testeable y está mapeado a un test
> concreto en `tasks.md` (§ Trazabilidad). Sin detalles de implementación: esos
> viven en `design.md`.

## Contexto (medido el 2026-08-25, no se reabre)

La evidencia es una etiqueta real de producción descargada desde el modal
«Imprimir etiquetas». Dos defectos en el mismo PDF, ambos en el generador de
**cliente** `app/(app)/ordenes/_components/etiquetas-pdf.ts` (+ su aritmética de
escalado `etiquetas-layout.ts`).

**Defecto 1 — solape.** Confirmado leyendo el código en esta sesión:
`MAQUETA_BASE.margin = 6`, el número de guía se dibuja en `y = margin + 10 = 16`
con `fontGuia = 22` pt, y el bloque de campos arranca en `CAMPOS_Y_INICIO = 18`
con `fontValor = 9` pt / `fontRotulo = 8` pt. Son **2 mm** entre líneas base para
un cuerpo de 22 pt (**7,76 mm**). Ocurre en TODAS las etiquetas, no en un caso
raro.

**Defecto 2 — colón.** El símbolo sale de `monedaConfig.simbolo`
(`lib/config/moneda.ts`, default `₡` = **U+20A1**) a través de `formatMonto`.
Las 14 fuentes estándar de jsPDF sólo cubren WinAnsi/cp1252, donde U+20A1 no
existe: por eso se imprime `¡`. Confirmado en esta sesión: no hay ni un
`addFont` / `addFileToVFS` en todo el repo, y la factura de cierre no sufre el
problema porque es HTML, no jsPDF.

### Decisiones dadas (firmadas por el humano, vinculantes)

- **D1** — **Se embebe una fuente con el glifo `₡`**, contra la recomendación de
  imprimir sólo la cifra. No se reabre. Lo que este spec sí debe resolver es
  el **coste en bytes** y **cómo se verifica que el glifo sale de verdad en el
  papel**, no que el código lo intenta.
- **D2** — **Se arregla lo evidenciado, no se rediseña la etiqueta.** No cambian
  qué campos se imprimen, ni su orden, ni su redacción.
- **D3** — ~~Alcance: sólo el generador de cliente.~~ **REVISADO el 2026-08-25
  al cerrarse Q1: ENTRAN LOS DOS GENERADORES.** El de cliente
  (`app/(app)/ordenes/_components/etiquetas-pdf.ts`) y el server-side del lote
  (`lib/pdf/etiquetas-pdf-lote.ts`, feature 136, consumido por
  `EtiquetasLotePdfService` y por `app/api/ordenes/api-key/carga/route.ts`).
  Medido: el segundo tiene **el mismo `CAMPOS_Y_INICIO = 18`** (línea 53), el
  mismo número de guía en `MARGIN + 10` a 22 pt (líneas 128-131) y el mismo
  `formatMonto` con `₡` (línea 152). Arreglar uno solo deja el defecto vivo
  según qué botón se pulse. **La ficha pasa de `frontend` a `fullstack`** y se
  secuencia backend → frontend.
- **D4** — El arreglo del solape debe valer para **los cuatro tamaños** del
  catálogo (feature 150: `100x100`, `4x6in`, `a4`, `carta`), y debe **derivarse**
  del cuerpo tipográfico, no fijarse a ojo.

## Caso de referencia (la etiqueta de la evidencia)

Se usa como fixture en los tests. De la evidencia constan: número de guía
`19887906`, dirección que ocupa **dos líneas**, fila `MONTO A COBRAR` con importe
`₡18.000` (es decir `montoCobrar = 18000`) y ubicación
`GAM / San José / Mora / Colón`. El destinatario, el teléfono, el producto, la
tienda y el número de remisión **no constan** (PII / recortados): el fixture los
rellena con valores cualesquiera y **ningún requisito afirma nada sobre ellos**.

---

## Requisitos

### A. Defecto 1 — el número de guía no puede pisar la primera fila

- **R1** — El sistema DEBE dibujar el número de guía y la primera fila del bloque
  de campos con sus líneas base separadas por, como mínimo, el cuerpo tipográfico
  del número de guía expresado en milímetros (1 em; con 22 pt son 7,76 mm en el
  lienzo base).

- **R2** — El sistema DEBE **derivar** esa separación del cuerpo del número de
  guía: SI el cuerpo del número de guía cambia, ENTONCES la línea base de la
  primera fila de campos DEBE desplazarse en la misma medida, sin que nadie
  tenga que ajustar un número a mano.

- **R3** — CUANDO se genere el PDF con cualquiera de los cuatro tamaños del
  catálogo, la separación de R1 DEBE cumplirse **medida sobre el PDF resultante**
  (escalada por el factor de esa hoja), no sólo sobre el lienzo base.

- **R4** — El sistema DEBE seguir imprimiendo los mismos siete campos con sus
  mismos rótulos y en el mismo orden que hoy (Destinatario, Teléfono, Dirección,
  Ubicación, Producto, Monto a cobrar, Tienda). NO DEBE añadir, quitar, reordenar
  ni renombrar ninguno.

- **R5** — MIENTRAS el bloque de campos arranque en su nueva línea base, ninguna
  línea de texto DEBE invadir la banda del QR y del código de barras, en ninguno
  de los cuatro tamaños del catálogo.

- **R6** — CUANDO la etiqueta lleve los siete campos y la dirección ocupe hasta
  **tres** líneas, el sistema DEBE imprimirlos completos, sin marca de recorte
  (`...`).

- **R7** — CUANDO se genere la etiqueta del caso de referencia (guía `19887906`,
  dirección de dos líneas, `MONTO A COBRAR` `₡18.000`, ubicación
  `GAM / San José / Mora / Colón`), el sistema DEBE imprimir sus nueve datos
  completos, sin recorte y cumpliendo R1.

### B. Defecto 2 — el símbolo de moneda tiene que salir impreso

- **R8** — CUANDO el valor de «Monto a cobrar» contenga el símbolo de moneda
  configurado, el PDF generado DEBE representarlo con una **fuente embebida en el
  propio documento**, y NO con una de las fuentes estándar del generador de PDF.

- **R9** — El texto de la fila del monto, decodificado a través del mapa a
  Unicode que **el propio PDF declara**, DEBE ser exactamente la cadena que
  produce el formateador de moneda para ese importe —símbolo incluido (U+20A1
  por defecto)— sin caracteres perdidos ni sustituidos.

- **R10** — El glifo con el que el PDF representa ese símbolo DEBE tener
  **contorno no vacío** en el programa de fuente embebido en el documento. No
  basta con que el símbolo esté declarado en un mapa: un glifo en blanco imprime
  papel en blanco.

- **R11** — La fuente embebida DEBE tener glifo de contorno no vacío para **todo
  carácter imprimible que la fuente estándar cubre hoy** en ese campo (juego
  WinAnsi/cp1252) y, además, para el símbolo de moneda que declare la
  configuración. Ningún carácter que hoy se imprime en esa fila puede
  desaparecer.

- **R12** — Los rótulos y los otros seis valores DEBEN seguir dibujándose con la
  misma fuente que hoy: el reparto de líneas y el punto de corte de una dirección
  larga NO DEBEN cambiar respecto del comportamiento actual.

### C. El coste, con número y con tope

- **R13** — El sistema NO DEBE incluir los bytes de la fuente en la carga inicial
  de la pantalla de órdenes: DONDE el usuario abra la pantalla y no genere el
  PDF, el navegador NO DEBE descargar esos bytes.

- **R14** *(REVISADO el 2026-08-25 al cerrarse Q6: manda la cobertura, el peso se
  reporta)* — El artefacto de fuente DEBE declarar en el repositorio su peso
  exacto en bytes, y el sistema de verificación DEBE ponerse en rojo si el peso
  real deja de coincidir con el declarado. El objetivo es **≤ 45 KB** y el aviso
  está en **80 KB**, pero SI cumplir la cobertura de R11 obliga a superarlos,
  ENTONCES el sistema DEBE conservar la cobertura, actualizar el peso declarado y
  **reportar la cifra**; el peso NO es una puerta que bloquee la feature. La
  cifra medida DEBE quedar registrada en `progress/impl_282.md` junto con el peso
  del chunk diferido y el «First Load JS» de la ruta antes y después.

- **R15** — El programa de fuente embebido **dentro de cada PDF** DEBE ser un
  subconjunto de glifos: NO DEBE superar **12 KB por documento**, sea cual sea el
  número de páginas del lote.

- **R16** — SI la fuente no puede cargarse en el navegador, ENTONCES el sistema
  DEBE informar al usuario de que la descarga no se pudo completar y NO DEBE
  descargar ningún PDF; nunca DEBE descargar en silencio uno con el monto sin
  símbolo.

### D. Procedencia y no-regresión

- **R17** — DONDE se embeba una fuente de terceros, el repositorio DEBE incluir
  su licencia, su procedencia (nombre, versión, origen y huella del archivo) y el
  procedimiento con el que se regenera el subconjunto.

- **R18** *(REVISADO el 2026-08-25 al cerrarse Q1: el lote ahora SÍ cambia)* —
  Del generador server-side del lote DEBE conservarse todo lo que esta feature no
  arregla: su firma pública, su página de 100 × 100 mm, su tope de etiquetas por
  PDF, su política best-effort de fallo visible (HTTP 200 con
  `etiquetasPdf: { error }` y la carga nunca revertida) y el contenido de los
  nueve datos. NO DEBE cambiar nada más que lo que exigen R19-R20.

### E. Los dos generadores (Q1)

- **R19** — El generador server-side del lote DEBE cumplir R1 y R2 (separación
  derivada del cuerpo del número de guía) en su página de 100 × 100 mm, medido
  sobre el PDF que produce.

- **R20** — CUANDO el generador server-side dibuje el valor de «Monto a cobrar»
  con el símbolo de moneda configurado, DEBE cumplir R8, R9 y R10 —fuente
  embebida, texto recuperable por el `/ToUnicode` del propio documento y glifo de
  contorno no vacío— verificado sobre los bytes de **su** PDF, no sobre los del
  navegador.

- **R21** — Los dos generadores DEBEN tomar de **una única fuente de verdad** la
  geometría de la maqueta: línea base del número de guía, línea base de inicio de
  los campos, cuerpos tipográficos, interlineado, separación entre campos,
  separación entre rótulo y valor, lado del QR y límite superior de la banda de
  códigos. Ninguno de los dos DEBE declarar por su cuenta un valor que el otro
  también declara.

- **R22** — Para una misma etiqueta y en la hoja de 100 × 100 mm, los dos
  generadores DEBEN producir **las mismas líneas base de texto y el mismo texto**.
  SI uno de los dos cambia su maqueta sin el otro, ENTONCES la verificación DEBE
  ponerse en rojo.

- **R23** — El generador server-side DEBE obtener la fuente **sin leer del
  sistema de archivos en tiempo de ejecución**: no DEBE depender de que el
  despliegue arrastre un archivo suelto hasta la función.

- **R24** — El coste que la fuente añade en la ruta del servidor DEBE ser de
  **un solo documento**: constante por PDF y **cero por página adicional**. El
  coste por PDF DEBE medirse y DEBE cumplirse que
  `(coste_de_render_por_etiqueta + coste_de_fuente_por_PDF) × tope_de_etiquetas`
  siga cabiendo en el presupuesto de tiempo de la ruta, tanto en el modo
  consolidado (un PDF) como en el modo individual (un PDF por orden, que es el
  peor caso: paga la fuente N veces).

### F. El cupo, que ya no se recorta en silencio (Q3)

- **R25** — El sistema DEBE conservar un cupo de al menos **9 líneas** para los
  siete campos, en los dos generadores y en las cuatro hojas del catálogo.

- **R26** — CUANDO cualquier caso del corpus de referencia declarado obligue a
  recortar un valor, la verificación DEBE fallar. Ningún caso del corpus DEBE
  imprimirse con marca de recorte.

- **R27** — El sistema NO DEBE resolver la falta de sitio encogiendo el número de
  guía ni comprimiendo la banda del QR y del código de barras: sus dimensiones
  DEBEN quedar exactamente como hoy.

### G. El símbolo configurado, cubierto o fallo visible (Q5)

- **R28** — SI un texto que se va a dibujar con la fuente embebida contiene algún
  carácter que el subconjunto embebido no cubre, ENTONCES el sistema DEBE fallar
  de forma **visible** —en el navegador, con mensaje y **sin** descargar nada; en
  el servidor, con el fallo visible de la respuesta y sin revertir la carga— y
  NUNCA DEBE imprimir la etiqueta con ese carácter perdido o sustituido.

- **R29** — El artefacto de fuente DEBE declarar la cobertura de caracteres que
  realmente tiene, **derivada del propio archivo** y no escrita a mano; la
  cobertura declarada DEBE coincidir con la del archivo embebido, y la
  comprobación de R28 DEBE usar esa declaración.

- **R30** — El archivo de fuente elegido DEBE verificarse **antes** de darse por
  bueno: DEBE comprobarse que contiene U+20A1 con contorno no vacío. SI no lo
  contiene, ENTONCES DEBE elegirse otro archivo; NO DEBE continuarse con él. La
  licencia del archivo elegido DEBE quedar citada por su nombre en el
  repositorio.

---

## Preguntas cerradas (2026-08-25)

| # | Cómo quedó |
|---|---|
| Q1 | **Entran los dos generadores.** La ficha pasa a `fullstack`. R19-R24. |
| Q2 | La fuente **se mide, no se afirma**: R30 es la puerta. |
| Q3 | **Se cede la línea de cupo** (11 → 10, peor caso conocido 9). Sin encoger la guía ni la banda de códigos. R25-R27. |
| Q4 | **Sin dependencia nueva**: la comprobación de contorno no vacío basta. |
| Q5 | Símbolo no cubierto = **fallo visible**, no nota al pie. R28-R29. |
| Q6 | Si no cabe en 80 KB, **manda la cobertura** y se reporta el número. R14 revisado. |

## Preguntas abiertas

- **Q7 — El corpus de casos reales de R26.** Tengo **una** etiqueta real (la de
  la evidencia). El corpus que propongo lo completo con **formas**, no con datos
  reales: dirección de una, dos y tres líneas, ubicación con los cuatro niveles,
  destinatario y producto largos. Para que R26 se ponga rojo ante un caso real
  de verdad haría falta un export de N etiquetas de producción (sin PII o
  anonimizado). **¿Se puede sacar ese export, o el corpus de formas es
  suficiente?** No lo relleno con datos inventados haciéndolos pasar por reales.

- **Q8 — Si el coste de la fuente por PDF no cabe en el peor caso del servidor.**
  Medido en el repo: el render cuesta ~18 ms por etiqueta y el tope duro es 1000
  PDFs en modo individual, con `maxDuration = 60`. Dejando 40 % del presupuesto
  para la inserción del lote, la fuente sólo puede costar **≤ 102 ms por PDF con
  el tope por defecto (300)** y **≤ 18 ms con el techo duro (1000)**
  (`design.md` §11.3). Ese coste se paga **por documento** porque jsPDF
  descodifica y parsea el TTF en cada `addFont`
  (`jspdf.node.js:26783-26797`). SI la medición se pasa de ahí, ¿qué prefieres:
  estrechar el subconjunto (debilita R11), bajar el techo duro por variable de
  entorno, o excluir el modo individual del arreglo?

- **Q9 — El PDF individual engorda.** Cada documento embebe su propio
  `/FontFile2`, así que un PDF de **una** etiqueta pasa de ~3,3 KB (cifra medida
  en la feature 136) a del orden de 8-15 KB: **×3-4**. En modo individual con el
  tope por defecto son ~300 PDFs por carga, es decir del orden de **1 MB → 4 MB**
  en el bucket privado por lote. Es coste de almacenamiento, no de tiempo.
  **¿Se acepta?**

- **Q10 — La vista previa del modal no cambia.** `EtiquetaGuia.tsx` es DOM/HTML y
  pinta el `₡` con la fuente del sistema, así que no sufre el defecto y queda
  fuera. Consecuencia: el importe de la vista previa y el del PDF se verán con
  tipografías ligeramente distintas. **¿Se acepta, o se quiere paridad
  tipográfica?** (Paridad implicaría cargar la fuente también en la vista previa,
  es decir el coste de bundle que R13 evita.)
