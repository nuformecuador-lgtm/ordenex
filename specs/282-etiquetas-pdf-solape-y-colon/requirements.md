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
- **D3** — **Alcance: sólo el generador de cliente.** El generador server-side
  del lote (feature 136, `lib/pdf/etiquetas-pdf-lote.ts`) queda **fuera**.
  Comprobado en esta sesión: es un módulo distinto, no importa el de cliente y
  no comparte con él más que `lib/pdf/etiquetas-ajuste.ts` (aritmética pura) y
  `formatMonto`. Ver la pregunta abierta **Q1**: ese módulo tiene hoy los dos
  mismos defectos.
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

- **R14** — El artefacto de fuente que viaja al navegador NO DEBE superar
  **80 KB** (81 920 caracteres del texto que se sirve). El objetivo es ≤ 45 KB.
  La cifra realmente medida DEBE quedar registrada en `progress/impl_282.md`
  junto con el peso del chunk diferido y el «First Load JS» de la ruta antes y
  después del cambio.

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

- **R18** — El generador server-side del lote (feature 136) DEBE seguir
  produciendo exactamente lo que produce hoy: NO DEBE importar la fuente
  embebida, NO DEBE cambiar su maqueta y NO DEBE cambiar su firma pública.

---

## Preguntas abiertas

- **Q1 — El generador del lote tiene los DOS mismos defectos, y queda fuera por
  encargo.** Medido en esta sesión sobre `lib/pdf/etiquetas-pdf-lote.ts`: el
  número de guía se dibuja en `MARGIN + 10 = 16` con cuerpo 22 y
  `CAMPOS_Y_INICIO = 18` (líneas 53 y 128-131), y el monto pasa por el mismo
  `formatMonto` sobre Helvetica (línea 152). Es decir: el PDF que sale por la
  API de carga masiva seguirá con el número de guía encima de «DESTINATARIO» y
  con `¡` en lugar de `₡` después de esta feature. **¿Se abre ficha hermana o se
  acepta conscientemente?** No lo doy por decidido.

- **Q2 — Fuente concreta y licencia.** Propongo **Liberation Sans Regular**
  (SIL OFL 1.1, TrueType, métricas compatibles con Arial/Helvetica, que es la
  familia con la que está maquetada la etiqueta). **No he verificado que
  contenga U+20A1**: eso lo decide la medición de la tarea T1, no mi palabra. Si
  no lo trae, la alternativa es DejaVu Sans (Bitstream Vera / Public Domain,
  cobertura de moneda notoriamente amplia) o Noto Sans (OFL). ¿Hay alguna
  familia o licencia vetada por el negocio, o alguna preferencia de marca?

- **Q3 — Qué cede el cupo vertical.** Bajar la primera fila a 23,76 mm reduce el
  cupo de **11 a 10 líneas** para siete campos (aritmética en `design.md` §2.3).
  El caso de la evidencia necesita 8 y una dirección de tres líneas necesita 9:
  las dos siguen entrando. La alternativa para no ceder nada sería subir también
  la línea base del número de guía ~1,5 mm, lo que toca la cabecera (más cambio
  del que la evidencia pide). **¿Se acepta ceder esa línea?**

- **Q4 — Cota de tinta.** Adopto **1 em** como separación mínima (R1) porque es
  derivable del cuerpo y no depende de métricas internas de la fuente. Las
  métricas reales de Helvetica (ascendente/descendente) **no están en el repo**:
  jsPDF sólo expone el bbox de fuentes embebidas, no de las 14 estándar, así que
  no las afirmo. La verificación automática afirma la separación de líneas base;
  la ausencia de tinta solapada se comprueba **a ojo** una vez (T15). ¿Se acepta,
  o se exige medir la tinta rasterizando el PDF (implica dependencia de
  desarrollo nueva: `pdfjs-dist` + un canvas en Node)?

- **Q5 — Símbolo configurable.** `MONEDA_SIMBOLO` es una variable de entorno:
  si alguien la cambia a un carácter fuera de la cobertura del subconjunto, el
  símbolo volvería a perderse. La guardia de R11 lee el símbolo **de la
  configuración** (no lo escribe a mano), así que un cambio del default pone la
  guardia en rojo; pero un cambio sólo en el entorno de producción **no lo ve
  nadie**. ¿Se acepta esa limitación documentada, o se quiere una comprobación en
  tiempo de ejecución?

- **Q6 — Los topes de peso.** 80 KB de artefacto (R14) y 12 KB de subconjunto
  embebido por PDF (R15) son topes que propongo yo a partir del tamaño esperado
  de un subconjunto cp1252 (~230 glifos). Si la fuente elegida no cabe, la salida
  es estrechar la cobertura a ASCII + acentos del español + `₡` (~120 glifos), lo
  que **debilita R11**. ¿Prefieres el tope o la cobertura, si hubiera que elegir?
