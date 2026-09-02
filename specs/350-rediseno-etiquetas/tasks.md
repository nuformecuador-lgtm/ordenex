# Feature 350 — tasks

> `[P]` = paralelizable con las demás `[P]` del mismo bloque (no comparten
> archivo). El resto va en el orden que marque su dependencia.
> **Sin tareas de base de datos**: la feature no tiene migración, `down.sql` ni
> RLS (`design.md` §10).
> Zona: **fullstack** (la geometría es compartida por los dos generadores), y se
> secuencia **compartido → cliente**.
> Gate: `./init.sh --rapido` (el diff no toca migraciones, `lib/types/`,
> configuración de build ni archivos con nombre de dinero).
>
> ⚠️ **Los bloques A y B son puertas.** T2 puede terminar diciendo «no cabe», y
> en ese caso **se para y se pregunta (Q2/Q3)**; no se sigue a T6 eligiendo una
> mitigación en silencio.

---

## Bloque A — Medir antes de decidir

### [ ] T1 [P] — ¿Deja `splitTextToSize` desbordar una palabra larga?
- Test temporal o script de un solo uso (que **se borra**, no se commitea) con
  jsPDF real: envolver `"A".repeat(60)` en un ancho de 88 mm a 9 pt y mirar qué
  devuelve.
- **Hecho cuando:** en `progress/impl_350.md` consta la salida real y el
  veredicto. Si desborda (lo esperado), `partirEnLineas` de T8 lleva lógica de
  partido por carácter; si no desborda, T8 se reduce a una aserción de seguridad.
- **Por qué es una tarea y no una suposición:** `design.md` §5.3 declara este
  comportamiento como **no verificado en esta sesión**. R3 depende de él.

### [ ] T2 — Presupuesto MEDIDO del peor caso, en las cuatro hojas
- Con jsPDF real y `doc.getTextWidth` (no con la estimación de 0,5 em de
  `design.md` §5.5): calcular, para el peor caso medido (dirección **286** car.,
  producto **138**), el alto que necesita cada banda con los cuerpos propuestos
  de §4.3 y con el suelo de 6,0 pt, en `100x100`, `4x6in`, `a4` y `carta`.
- **Hecho cuando:** la tabla de alturas reales está en `progress/impl_350.md` y
  responde a **una** pregunta: ¿entra el peor caso en `100x100`?
  - **Sí** → se fijan las constantes de T6 con la holgura medida escrita.
  - **No** → se aplican las palancas de §5.5 **en su orden**, anotando cuánto da
    cada una; si se agotan, **se para y se pregunta**.
- Depende de: T1.

---

## Bloque B — Cimientos compartidos

### [ ] T3 [P] — `pdf-inspector` lee rectángulos
- `tests/unit/pdf/pdf-inspector.ts` (MODIFICADO): `rectangulosDePagina(bytes, i)`
  → `{ x, y, w, h, operador }[]`, leyendo `x y w h re` seguido de `S` / `f` / `B`.
- **Con autocomprobación**, o no se acepta: un caso positivo (un `doc.rect`
  conocido se encuentra con sus cuatro números) y uno **negativo** (un documento
  sin rectángulos devuelve lista vacía). Un lector sin control negativo es un
  verde que no mide nada.
- **Hecho cuando:** los dos controles pasan.

### [ ] T4 [P] — El corpus crece con el peor caso real
- `tests/fixtures/etiquetas-282.ts` (MODIFICADO): `CASO_PEOR_MEDIDO`
  (dirección 286 car., producto 138), `CASO_PALABRA_SIN_ESPACIOS` (una palabra de
  60 car. sin un espacio) y `CASO_MINIMOS` (todos los campos en su forma corta).
- Cada caso declara **qué es real**: en el peor caso lo real es **la longitud**,
  no el texto (las cadenas de producción son PII). Mismo criterio de honestidad
  que ya usa el archivo con las «formas».
- Cada caso trae su **valor esperado por dato, escrito como literal** —incluida
  la ubicación como `"GAM / San José / Mora / Colón"`—, **nunca** llamando a
  `geografiaLegible`: comparar un texto contra la función que lo genera está
  siempre verde.
- **Hecho cuando:** los cuatro casos del corpus actual siguen ahí sin cambios y
  las suites que hoy lo importan siguen verdes.

### [ ] T5 [P] — La hoja se parte en celdas
- `lib/config/etiquetas-hoja.ts` (MODIFICADO): `columnas` y `filas` en
  `HojaEtiqueta`, **todas a 1 × 1**; `celdaDeHoja(hoja, indice)` →
  `{ x0, y0, ancho, alto }`.
- El módulo sigue siendo **puro** (sin imports, sin `process.env`, sin I/O): esa
  pureza es la razón por la que existe separado de `lib/config/etiquetas.ts`.
- **Hecho cuando:** con 1 × 1 la celda es la hoja entera (`x0 = y0 = 0`); con un
  2 × 2 hipotético las cuatro celdas cubren la hoja **sin solaparse y sin hueco**
  (test parametrizado, aunque el catálogo no lo use todavía: es lo que hace que
  firmar Q1 sea cambiar dos filas).
- Cubre: la mitad de **Q1** que puede adelantarse sin firma.

### [ ] T6 — La maqueta nueva
- `lib/pdf/etiquetas-maqueta.ts` (MODIFICADO): `CELDA_BASE_MM`, `MARGEN_MM`,
  **`CUERPO_MINIMO_PT`**, `INTERLINEADO` (= 1,26, derivado de los 4 mm a 9 pt de
  hoy), los cuerpos de §4.3 y la declaración de las cinco bandas con su regla de
  alto y su orden de sacrificio.
- Se **conserva** la separación derivada de la 282 entre la línea base de la guía
  y lo que venga debajo (≥ 1 em del cuerpo de la guía), con su justificación
  intacta.
- **Hecho cuando:** `pnpm run typecheck` pasa; las constantes salen de la tabla
  **medida** en T2, no de la estimada; y un test afirma `CUERPO_MINIMO_PT = 6.0`
  y que **no** se multiplica por ninguna escala.
- Depende de: T2.
- Cubre: **R6**, **R13** (declaración), **R24** (parte de guía).

### [ ] T7 — El layout: celda + escala tipográfica
- `lib/pdf/etiquetas-layout.ts` (MODIFICADO): el contrato de `design.md` §3.1.
  Desaparecen `s`, `lado`, `offX`, `offY` y el lienzo 0-100. `x/y` pasan a mapear
  **mm relativos al área útil**.
- `k = anchoUtil / anchoUtilBase`; `qrMm = 26 · max(1, k)`,
  `barcodeMm = 16 · max(1, k)`; `barcodeRaster` conserva su redondeo hacia arriba
  con `k` en lugar de `s`.
- `crearLayoutBase()` sigue existiendo y sigue dando `k = 1` y celda = hoja: el
  generador del servidor **no se toca** (R20).
- **Hecho cuando:** compila; `crearLayoutBase()` da márgenes y ancho útil
  idénticos a los de hoy; y los tests nuevos de `k` afirman 1 / 1,018 / 2,25 /
  2,32 para las cuatro hojas.
- Depende de: T5, T6.
- Cubre: **R9**, **R10**, **R12** (dimensiones), **R11** (parte aritmética).

---

## Bloque C — El ajuste que no recorta

### [ ] T8 — `partirEnLineas` + `ajustarBloque` + el error de «no cabe»
- `lib/pdf/etiquetas-ajuste.ts` (MODIFICADO):
  - `partirEnLineas(texto, anchoMm, pt, medir)`: envuelve `splitTextToSize` y
    parte por carácter toda línea que aún exceda el ancho (según T1).
  - `ajustarBloque(...)`: búsqueda **descendente** de 0,25 pt desde
    `cuerpoMaxPt` hasta `cuerpoMinPt`; devuelve `{ cuerpoPt, lineas, altoMm, cabe }`.
  - `ErrorEtiquetaNoCabe`, con el dato que desbordó y la hoja en el mensaje
    (nada de `catch` vacíos ni de errores sin contexto).
- `MARCA_CORTE` y `recortarConElipsis` **se conservan en el archivo** y **dejan de
  usarse**: borrarlos arrastraría sus tests, y en este repo eso ya costó una
  regresión.
- **Hecho cuando:** compila y **ninguna** rama de `ajustarBloque` puede devolver
  un `cuerpoPt < cuerpoMinPt` (afirmado en T9, no razonado).
- Depende de: T6.
- Cubre: **R3**, **R6**, **R7** (mecanismo).

### [ ] T9 — Tests del ajuste, con medidor lineal
- `tests/unit/pdf/etiquetas-ajuste.test.ts` (EXTENDIDO), con
  `medir = (t, pt) => t.length * pt * 0.1` — un medidor propio del test, como ya
  hace el archivo hoy: basta para fijar el contrato y no ata la aritmética a jsPDF.
- Afirma: el cuerpo devuelto es **el mayor que cabe** (uno más grande no cabría);
  nunca baja del suelo; con alto imposible devuelve `cabe: false` y **no** recorta
  ninguna línea; una palabra más ancha que el cupo se parte y **ninguna** línea
  resultante excede el ancho; ninguna línea se pierde (la concatenación de las
  líneas es el texto de entrada, salvo espacios).
- **Hecho cuando:** pasan, y la mutación M3 los pone en rojo.
- Depende de: T8.
- Cubre: **R2** (nivel unitario), **R3**, **R6**.

---

## Bloque D — El dibujo

### [ ] T10 — Las cinco bandas y el recuadro
- `lib/pdf/etiquetas-dibujo.ts` (MODIFICADO): `drawEtiqueta` conserva su firma;
  por dentro dibuja cabecera (guía + fecha + remisión + **QR arriba a la
  derecha**), destino **sin columna de rótulos**, recuadro del importe, detalle
  con rótulo en línea, y código de barras **a todo el ancho útil**.
- `drawCampos` **desaparece**, y con él el uso de `recortarConElipsis`.
- El importe: **una sola línea**, dentro del recuadro; `exigirCobertura` sobre su
  texto completo, antes de escribir un byte.
- Disciplina de fuentes de la 282 intacta: la tipografía se activa **antes** de
  medir y de dibujar, nunca después.
- **Hecho cuando:** compila; los dos generadores siguen sin modificar (diff cero
  en ambos); y el PDF del corpus se genera sin lanzar.
- Depende de: T7, T8.
- Cubre: **R13**, **R14**, **R15**, **R16**, **R17**, **R21**, **R22**.

### [ ] T11 — Fallo visible cuando no cabe (R7)
- El error de T8 sube por los **dos canales que ya existen**, sin inventar
  ninguno: en el navegador, el `catch` de `handleDescargar` en
  `EtiquetasGuiaModal.tsx` (mensaje, **ninguna** descarga); en la API, el camino
  best-effort (`etiquetasPdf: { error }`, HTTP 200, carga **no** revertida).
- El mensaje del modal distingue este caso del de la fuente: al operador hay que
  decirle **qué orden** no cupo, o no puede hacer nada al respecto.
- **Hecho cuando:** con el suelo forzado a un valor imposible, ni el navegador ni
  la API entregan una etiqueta, y las dos lo dicen.
- Depende de: T10.
- Cubre: **R7**.

---

## Bloque E — La verificación que muerde

### [ ] T12 — V1-V6 sobre el PDF, en las cuatro hojas
- `tests/unit/components/etiquetas-pdf.test.ts` (EXTENDIDO) y
  `tests/unit/pdf/etiquetas-pdf-lote.test.ts` (EXTENDIDO), con las seis
  aserciones de `design.md` §6, recorriendo **todo el corpus × las cuatro hojas**:
  - **V1** reconstrucción exacta contra el literal del fixture;
  - **V2** contención horizontal con `getTextWidth` bajo la fuente y el cuerpo
    del propio `Tf`;
  - **V3** contención vertical + bandas disjuntas + nada dentro de la banda de
    códigos ni fuera de la celda;
  - **V4** todo `Tf` con `tamano ≥ CUERPO_MINIMO_PT`;
  - **V5** `tamano(destinatario) > tamano(producto)` y el importe **contenido en
    el rectángulo** que devuelve `rectangulosDePagina`;
  - **V6** ningún texto con `...` ni `…`.
- **Hecho cuando:** pasan y las mutaciones M1, M3, M6, M7 y **M8** las ponen
  rojas. M8 es la que decide si V1 sirve: quitar **un** carácter del final de la
  dirección tiene que salir rojo.
- Depende de: T3, T4, T10.
- Cubre: **R1**, **R2**, **R3**, **R4**, **R5**, **R6**, **R14**, **R15**.

### [ ] T13 — Capacidad declarada y monotonía (R8, R11)
- Test nuevo: para cada hoja, direcciones de longitud creciente; se anota el
  último largo que entra **sin bajar del cuerpo base** y el último que entra
  **antes de disparar R7**. Los dos quedan como constante esperada en el test, con
  el mensaje de fallo diciendo el número viejo y el nuevo.
- Monotonía (R11): esas capacidades **no decrecen** al pasar a una hoja de área
  mayor. Es el test que mata el defecto de fondo: hoy sería verde por empate
  (10 líneas en las cuatro) y con el rediseño tiene que ser estrictamente
  creciente en alto.
- **Hecho cuando:** pasa, los números están en `progress/impl_350.md`, y la
  mutación M4 (volver `k` al lado menor) lo pone rojo.
- Depende de: T12.
- Cubre: **R8**, **R11**.

### [ ] T14 — Paridad ampliada + guardia ampliada
- `tests/unit/pdf/etiquetas-dos-generadores.test.ts` (EXTENDIDO): además de
  `Td` + cuerpo + texto, compara **los rectángulos** de las dos páginas. Sin esto,
  el recuadro podría existir en un generador y no en el otro con el test verde —
  el agujero exacto que `design.md` §7.1 señala.
- `tests/unit/guards/etiquetas-maqueta-unica.guardia.test.ts` (EXTENDIDO): la
  lista de constantes prohibidas gana `CUERPO_MINIMO_PT`, `MARGEN_MM`,
  `INTERLINEADO`, `BANDAS` y los `CUERPO_*`; el control positivo (la maqueta
  compartida **sí** las declara) se amplía en paralelo, o la prohibición sería
  vacía.
- **Hecho cuando:** pasan y la mutación M5 los pone rojos.
- Depende de: T3, T10.
- Cubre: **R18**, **R19**.

### [ ] T15 — Sustituir, no borrar, las aserciones de la 150
- `tests/unit/components/etiquetas-layout.test.ts` y
  `tests/unit/pdf/etiquetas-maqueta.test.ts` (MODIFICADOS) siguiendo **fila a
  fila** la tabla de `design.md` §11.
- Cada aserción que se retira deja en su sitio un comentario con: qué afirmaba,
  qué decisión la sustituye, y **qué test nuevo cubre lo mismo o más**.
- Se **conserva** intacto: la densidad del raster del barcode, que el QR sea
  cuadrado, y la no-regresión de la 282/295 (guía sin pisar, símbolo impreso,
  fecha en cabecera).
- **Hecho cuando:** ninguna de las ocho filas de §11 queda sin sustituto, y
  `etiquetas-pdf-lote.smoke.test.ts` sigue verde **sin tocarlo** (R20).
- Depende de: T12, T13.
- Cubre: **R12**, **R20**, **R24**.

### [ ] T16 — El coste del ajuste iterativo (presupuesto de la 282/R24)
- Medir el tiempo por etiqueta **con** el ajuste, en los dos modos del generador
  del lote: consolidado (1 documento) e **individual** (N documentos, el peor
  caso). Comprobar `(t_render + f) × N ≤ 36 000 ms` para el tope por defecto
  (300) y para el techo duro (1000).
- Los comandos auxiliares van **en un archivo de script**, no inline: el escapado
  inline se come una capa en este repo.
- **Hecho cuando:** la cifra está en `progress/impl_350.md` y cumple. **Si no
  cabe, se para y se pregunta**: la mitigación (arrancar la búsqueda por
  estimación de área) está descrita en `design.md` §13 pero **no se aplica de
  antemano**.
- Depende de: T10.
- Cubre: presupuesto heredado (282/R24).

---

## Bloque F — Frontend (sólo si se firma Q5)

### [ ] T17 [P] — La vista previa deja de mentir sobre el papel
- `app/(app)/ordenes/_components/EtiquetaGuia.tsx` (MODIFICADO): mismo orden y
  misma jerarquía de tamaños que el PDF; sin la rejilla `grid-cols-[auto_1fr]` en
  el bloque de destino; el importe destacado.
- **No cambia**: la familia del importe (paridad de la 282/R31), la fecha en
  cabecera (295), ni los valores que los tests actuales afirman.
- **Hecho cuando:** los tests existentes de `EtiquetaGuia`, `EtiquetaGuiaPreview`
  y `EtiquetaFechaEnPantalla` pasan **sin relajar ninguna aserción** (hoy afirman
  valores, no la estructura `dt`/`dd`), y un test nuevo compara la **secuencia de
  datos** de la pantalla con la del PDF.
- Depende de: T10, y de la firma de **Q5**.
- Cubre: **R23**.

---

## Bloque G — Demostrar que no miente

### [ ] T18 — Mutaciones obligatorias
Aplicar una a una, correr los tests indicados, **revertir**, y pegar la salida
real en `progress/impl_350.md`. Un informe de mutaciones sin salida de tests no
cuenta: en este repo un arnés de mutaciones ya reportó 9/9 supervivientes **dos
veces sin haber ejecutado un solo test**.

| # | Mutación | Debe ponerse ROJO |
|---|---|---|
| M1 | volver a `recortarConElipsis` en el bloque de destino | T12 (V1, V6) |
| M2 | subir el suelo a 12 pt (el peor caso deja de caber) | T11: los dos canales fallan **visiblemente**; y **NO** T12 con recorte |
| M3 | quitar el partido de palabras largas | T9 y T12 (V2) con `palabra-sin-espacios` |
| M4 | `k` vuelve a salir del lado menor (el `s` de hoy) | T13 (monotonía de capacidad) |
| M5 | dibujar el recuadro sólo en el generador de cliente | T14 (paridad de rectángulos) |
| M6 | destinatario y producto al mismo cuerpo | T12 (V5) |
| M7 | permitir que el importe se envuelva en dos líneas | T12 (V5) y la aserción de una sola línea |
| **M8** | **quitar UN carácter del final de la dirección al dibujar** | **T12 (V1)** — si esta sobrevive, V1 no sirve y el resto del bloque E es decorado |

- **Hecho cuando:** las ocho salen rojas y está pegada la salida que lo demuestra.
- Depende de: T9, T11, T12, T13, T14.

### [ ] T19 — Verlo con los ojos, una vez
- Generar el PDF del **peor caso medido** en las cuatro hojas, abrirlo y
  confirmar: nada cortado, nada fuera de la celda, el importe legible en su
  recuadro, y el QR y el código de barras escaneables (con el móvil vale).
- **Hecho cuando:** hay captura o confirmación en `progress/impl_350.md`, y queda
  escrito **qué no cubre** (en los PDF de test el QR y el barcode son PNG de
  relleno).
- Depende de: T10.

### [ ] T20 — Gate y bitácora
- `./init.sh --rapido` en verde, con `INIT_EXIT=$?` escrito **dentro** del log:
  aquí un `echo` ya ha tapado un rojo.
- `progress/impl_350.md` con: el mapa R → test completo, la tabla medida de T2,
  las capacidades de T13, el coste de T16 y las mutaciones de T18.
- **Hecho cuando:** gate verde, los **24** requisitos mapeados a un test que
  existe y pasa, y ninguna aserción previa relajada sin su fila en §11 del design.
- Depende de: todo lo anterior.

---

## Trazabilidad R → tarea / test

| R | Qué fija | Tarea | Test |
|---|---|---|---|
| R1 | ninguna marca de recorte | T10 | `etiquetas-pdf.test.ts` + `etiquetas-pdf-lote.test.ts` (V6) |
| R2 | reconstrucción exacta de cada dato | T10 | idem (V1) — el literal sale del fixture, no de la función |
| R3 | ninguna línea excede el ancho; palabras largas partidas | T8 | `etiquetas-ajuste.test.ts` + V2 |
| R4 | nada fuera de la celda ni en la banda de códigos | T10 | V3 |
| R5 | el peor caso medido, en las cuatro hojas | T4, T12 | V1-V4 sobre `CASO_PEOR_MEDIDO` × 4 hojas |
| R6 | suelo de legibilidad, absoluto | T6, T8 | `etiquetas-maqueta.test.ts` (valor y no-escalado) + V4 |
| R7 | no cabe ⇒ fallo visible en los dos canales | T11 | `EtiquetasGuiaModal.test.tsx` + `carga-api-etiquetas.test.ts` |
| R8 | capacidad declarada por hoja | T13 | test de capacidad + `progress/impl_350.md` |
| R9 | la celda se usa entera | T7 | `etiquetas-layout.test.ts` (franja sin usar ≤ margen) |
| R10 | el alto extra se vuelve líneas | T7 | test de capacidad (líneas por hoja) |
| R11 | más papel nunca da menos capacidad | T13 | test de monotonía |
| R12 | QR y barcode no encogen ni se deforman | T7, T15 | `etiquetas-layout.test.ts` + V3 |
| R13 | las cinco bandas y su orden | T6, T10 | V3 (intervalos disjuntos y ordenados) |
| R14 | destinatario/teléfono > producto/tienda | T10 | V5 |
| R15 | importe en recuadro y en una línea | T10 | V5 (con `rectangulosDePagina`) |
| R16 | sin columna de rótulos en el destino | T10 | V2 (el valor dispone del ancho completo) |
| R17 | los nueve datos siguen impresos | T10 | V1 recorre los nueve |
| R18 | una sola fuente de verdad de la geometría | T6, T7 | `etiquetas-maqueta-unica.guardia.test.ts` |
| R19 | los dos generadores dibujan lo mismo, rectángulos incluidos | T14 | `etiquetas-dos-generadores.test.ts` |
| R20 | el generador del lote conserva firma y página | T15 | `etiquetas-pdf-lote.smoke.test.ts` (sin tocarlo) |
| R21 | cobertura exigida a todo texto con fuente embebida | T10 | test de conjunto: textos `Type0` ⊆ textos con `exigirCobertura` |
| R22 | el importe no se convierte ni se reconstruye | T10 | guardias de dinero vivas + V5 |
| R23 | la vista previa refleja orden y jerarquía | T17 | `EtiquetaGuia.test.tsx` + test cruzado pantalla/PDF |
| R24 | no se pierde lo vigente de la 282 y la 295 | T15 | tests de la 282/295 sin relajar |

Los **24** requisitos están mapeados; ninguno queda sin test.

---

## Aviso al implementador

1. **T2 es una puerta, no un trámite.** La aritmética de `design.md` §5.5 dice
   que el peor caso entra en 100 × 100 por **0,9 mm**, y esa aritmética es una
   **estimación** (ancho medio 0,5 em). Mídelo antes de escribir una constante.
2. **M8 es la mutación que decide si el bloque E vale algo.** Si quitar un
   carácter de la dirección no pone rojo a V1, todo lo demás es decorado.
3. **Q1, Q2, Q3, Q4 y Q5 están abiertas.** Q1 (cuatro por hoja) no bloquea:
   T5 la deja lista como cambio de datos. Q2 (el suelo de 6,0 pt) **sí** bloquea
   a T6, porque es el número del que cuelga todo el resto.
4. **El diff de los dos generadores debe ser cero** en todo el bloque D. Si te
   ves editando `etiquetas-pdf.ts` o `etiquetas-pdf-lote.ts` para que algo
   funcione, algo se te quedó fuera del módulo compartido — que es exactamente la
   forma en que este repo divergió una vez.
