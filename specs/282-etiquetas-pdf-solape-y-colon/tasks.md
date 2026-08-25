# Feature 282 — tasks

> `[P]` = paralelizable con las demás `[P]` del mismo bloque (no comparten
> archivo). El resto va en el orden que marque su dependencia.
> Sin tareas de base de datos: la feature no tiene migración, `down.sql` ni RLS
> (`design.md` §8).
> Gate: `./init.sh --rapido` (el diff no toca cimientos ni nombres de dinero).
>
> **AMPLIADO el 2026-08-25 (Q1-Q6).** La ficha es `fullstack` y se secuencia
> **backend → frontend**: el bloque **E** (maqueta compartida) y el **F**
> (servidor) van ANTES de los bloques B y C, que son de cliente. Las tareas
> nuevas y las correcciones de ruta están al final, en «Ampliación».

## Bloque A — La fuente: medirla antes de creérsela

### [ ] T1 — Elegir la fuente y MEDIR que sirve
- Descargar el TTF candidato (`design.md` §3.1: Liberation Sans Regular, OFL 1.1;
  alternativas DejaVu Sans / Noto Sans).
- Comprobar con el lector de T2 —no a ojo, no por reputación— que trae **U+20A1
  con contorno no vacío** y que cubre cp1252 imprimible.
- **Hecho cuando:** en `progress/impl_282.md` constan nombre, versión, origen
  (URL), licencia, SHA-256 y bytes del TTF original, y la salida del test de
  cobertura. Si la candidata falla, queda escrito **por qué** y cuál se eligió.
- Depende de: T2.

### [ ] T2 [P] — Lector mínimo de TTF para tests, con autocomprobación
- Archivo: `tests/unit/pdf/ttf-lector.ts` (NUEVO, helper, sin dependencias nuevas).
- API: `tablas(buf)`, `glifoDe(buf, codePoint)` (cmap 4 y 12), `contorno(buf, gid)`
  → longitud de `glyf` vía `loca` + `head.indexToLocFormat`.
- Archivo: `tests/unit/pdf/ttf-lector.test.ts` (NUEVO) con los **tres controles**
  de `design.md` §4: positivo (`'0'` → gid ≠ 0 y contorno > 0), negativo
  (U+4E2D → gid 0) y de vacío (`' '` → gid ≠ 0 y contorno = 0).
- **Hecho cuando:** los tres controles pasan sobre la fuente elegida. Un lector
  sin control negativo no se acepta: sería un verde que no mide nada.

### [ ] T3 — Subconjunto y artefacto que ships
- Generar el subconjunto (cp1252 imprimible ∪ `monedaConfig.simbolo`) con la
  herramienta que haya disponible; **anotar el comando exacto**.
- Commitear: `assets/fuentes/<fuente>-etiqueta-subset.ttf`,
  `licenses/<fuente>-OFL.txt`, `scripts/fuente-etiqueta-a-base64.ts` (sólo
  `node:fs`, tipado estricto: el build type-checkea `scripts/**`) y el módulo
  generado `app/(app)/ordenes/_components/etiquetas-fuente.ts` con la cabecera de
  procedencia de `design.md` §3.4.
- **Hecho cuando:** `pnpm run typecheck` pasa, `base64.length ≤ 81920`, y el
  base64 decodifica **byte a byte** al `.ttf` commiteado (SHA-256 afirmado en T4).
- Depende de: T1.

### [ ] T4 — Tests del artefacto de fuente
- Archivo: `tests/unit/components/etiquetas-fuente.test.ts` (NUEVO, Node).
- Cubre: cobertura de **todo** cp1252 imprimible con contorno no vacío
  **más** `monedaConfig.simbolo` leído de la configuración (no escrito a mano,
  patrón de `dinero-sin-centimos.guardia.test.ts`); SHA-256 del base64 = el del
  `.ttf` commiteado; la cabecera declara origen, versión, licencia y comando de
  regeneración; existe `licenses/<fuente>-OFL.txt`.
- **Hecho cuando:** pasa y cubre **R11** y **R17**.
- Depende de: T2, T3.

### [ ] T5 — Guardia de peso y de carga diferida
- Archivo: `tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` (NUEVO).
- Afirma: (a) `base64.length ≤ 81920`; (b) el módulo `etiquetas-fuente` **sólo**
  aparece dentro de un `import(` dinámico en `etiquetas-fuente-carga.ts`, y en
  ningún `import … from` estático de `etiquetas-pdf.ts`, del modal ni de nada
  bajo `app/`; (c) `lib/pdf/etiquetas-pdf-lote.ts` no lo nombra (blindaje de D3).
- **Hecho cuando:** pasa y cubre **R13**, **R14** (tope) y parte de **R18**.
- Depende de: T3.

## Bloque B — El solape (independiente del bloque A)

### [ ] T6 [P] — Derivar la línea base de los campos
- Archivo: `app/(app)/ordenes/_components/etiquetas-layout.ts` (MODIFICADO):
  `PT_A_MM`, `MAQUETA_BASE.guiaY = margin + 10` y `camposYInicio()` =
  `guiaY + fontGuia * PT_A_MM` (`design.md` §2.1).
- Archivo: `app/(app)/ordenes/_components/etiquetas-pdf.ts` (MODIFICADO): usa
  `MAQUETA_BASE.guiaY` al dibujar la guía y `camposYInicio()` en lugar de la
  constante `18`, que **desaparece**.
- **Hecho cuando:** compila; no queda ningún `18` ni ningún `margin + 10` literal
  en el camino; con `100x100` el resto del dibujo es idéntico al actual.

### [ ] T7 — Tests del solape
- Archivo: `tests/unit/components/etiquetas-layout.test.ts` (EXTENDIDO):
  `camposYInicio()` = 23,7611 con el cuerpo actual; **si se dobla el cuerpo de la
  guía, la primera fila baja exactamente 7,76 mm más** (derivación, no número
  mágico); el cupo resultante es 10 y el umbral de 24 mm queda documentado en el
  test.
- Archivo: `tests/unit/components/etiquetas-pdf.test.ts` (EXTENDIDO), con jsPDF
  real y el helper `textosConY` que ya existe: en **las cuatro hojas**, la
  distancia entre la línea base del número de guía y la de la primera fila es
  ≥ `layout.fontGuia · 25.4/72`; ninguna línea invade la banda del QR; los siete
  rótulos siguen presentes y en orden.
- Caso de referencia (`requirements.md` § Caso de referencia): guía `19887906`,
  dirección de dos líneas, monto `18000`, ubicación `GAM / San José / Mora /
  Colón` → nueve datos completos, **sin** `...` en ningún valor; y el caso de
  dirección de tres líneas, también sin recorte.
- **Hecho cuando:** pasan y cubren **R1**, **R2**, **R3**, **R4**, **R5**, **R6**,
  **R7**.
- Depende de: T6.

## Bloque C — El colón en el PDF (depende de A y B)

### [ ] T8 — Cargador diferido e inyección
- Archivos NUEVOS: `app/(app)/ordenes/_components/etiquetas-fuente-carga.ts`
  (`cargarFuenteEtiqueta()` con el único `import()` dinámico y el error envuelto
  con contexto).
- Archivo `etiquetas-pdf.ts` (MODIFICADO): tipo `FuenteEmbebida`, cuarto
  parámetro **obligatorio** en `buildEtiquetasPdf`, registro con
  `addFileToVFS` + `addFont` (Identity-H, **sin** `WinAnsiEncoding`),
  `CampoEtiqueta.fuente` aplicada antes de medir y de dibujar, y
  `descargarEtiquetasPdf` pasa a `async`.
- **Hecho cuando:** compila en `strict`; el único campo con fuente propia es el
  valor de «Monto a cobrar»; `getTextWidth`/`splitTextToSize` de ese campo se
  ejecutan con esa fuente activa.
- Depende de: T3, T6.

### [ ] T9 — Borde de error en el modal (R16)
- Archivo: `app/(app)/ordenes/_components/EtiquetasGuiaModal.tsx` (MODIFICADO):
  `handleDescargar` async, `try/catch` (nada de `catch` vacío), mensaje
  «No se pudo preparar la tipografía de la etiqueta. Inténtalo de nuevo.» y
  **ninguna** descarga en ese camino.
- **Hecho cuando:** compila y el modal sigue respetando el caso «sin imprimibles».
- Depende de: T8.

### [ ] T10 — Tests del glifo EN el PDF (el requisito caro)
- Archivo: `tests/unit/components/etiquetas-pdf.test.ts` (EXTENDIDO), jsPDF real:
  1. el recurso de fuente activo en la fila del monto es `/Subtype /Type0` con
     `/Encoding /Identity-H` y tiene `/FontFile2` (**R8**);
  2. el `<hex> Tj` de esa fila, decodificado con el `/ToUnicode` **del propio
     documento**, es exactamente `formatMonto(18000)` = `₡18.000`, y contiene
     `20a1` (**R9**);
  3. el CID del símbolo tiene contorno **no vacío** dentro del `/FontFile2`
     extraído del PDF, leído con `ttf-lector` (**R10**);
  4. la longitud del stream `/FontFile2` ≤ 12 KB, y es la misma con 1 página que
     con 20 (**R15**);
  5. el reparto de líneas de una dirección larga es idéntico al de antes del
     cambio de fuente y sigue siendo el mismo en las cuatro hojas (**R12**).
- **Hecho cuando:** pasan, y el caso 2 sustituye (endureciéndola, no borrándola)
  la aserción ASCII del monto de `etiquetas-pdf.test.ts:301-326`.
- Depende de: T2, T8.

### [ ] T11 — Tests del borde de error y de la descarga
- Archivos: `tests/components/EtiquetasGuiaModal.test.tsx` (EXTENDIDO): con la
  carga de fuente fallando, aparece el mensaje y **no** se llama a la descarga
  (**R16**); `tests/unit/components/etiquetas-pdf-descarga.test.ts` (EXTENDIDO):
  el doble de jsPDF gana `addFileToVFS`/`addFont` y las llamadas se `await`ean,
  conservando sus aserciones de nombre de archivo y de páginas.
- **Hecho cuando:** pasan sin relajar ninguna aserción previa.
- Depende de: T9.

### [ ] T12 [P] — No-regresión del generador del lote (D3 / R18)
- Archivo: `tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts` (EXTENDIDO): sigue
  en 100 × 100, conserva su firma de un solo parámetro y su fuente **no** nombra
  el artefacto de la 282.
- **Hecho cuando:** pasa **sin** haber modificado `lib/pdf/etiquetas-pdf-lote.ts`
  ni `lib/pdf/etiquetas-ajuste.ts` (**R18**).

## Bloque D — Demostrar que no miente

### [ ] T13 — Mutaciones obligatorias (matar los tests)
Aplicar una a una, correr los tests indicados, **revertir**, y pegar la salida
real en `progress/impl_282.md`:

| # | Mutación | Debe ponerse ROJO |
|---|---|---|
| M1 | el valor del monto vuelve a `helvetica` | T10 (1, 2, 3) |
| M2 | base64 sustituido por una fuente sin `₡` | T4 y T10 (2, 3) |
| M3 | glifo del símbolo vaciado (contorno 0) en el subconjunto | T10 (3) — el eslabón que distingue declarado de impreso |
| M4 | `camposYInicio()` fijado a `18` | T7 (las cuatro hojas) |
| M5 | `camposYInicio()` fijado a `23.7611` a mano (sin derivar) | T7 (caso de derivación) |
| M6 | `addFont` con `"WinAnsiEncoding"` | T10 (4): el `/FontFile2` se dispara |

- **Hecho cuando:** las seis salen rojas **y está pegada la salida que lo
  demuestra**. Un informe de mutaciones sin salida de tests no cuenta.
- Depende de: T4, T7, T10.

### [ ] T14 — Medir el coste de verdad
- `pnpm exec prisma generate` → `pnpm exec next build` (no `pnpm run build`).
- Anotar: «Size» y «First Load JS» de `/ordenes` **antes y después**, tamaño en
  disco y gzip del chunk que contiene el base64, `base64.length`, bytes del
  `/FontFile2` y peso del PDF de una etiqueta antes/después.
- Los comandos auxiliares van **en un archivo de script**, no inline (el escapado
  inline se come una capa en este repo).
- **Hecho cuando:** las cifras están en `progress/impl_282.md` y **cumplen** los
  topes de `design.md` §5.1 (**R14**). Si alguna se pasa, se para y se pregunta
  (Q6): no se baja el tope por decreto.
- Depende de: T3, T8.

### [ ] T15 — Verlo con los ojos, una vez
- Generar el PDF del caso de referencia en las cuatro hojas, abrirlo y confirmar:
  el número de guía no toca «DESTINATARIO» y el importe se lee `₡18.000`.
- **Hecho cuando:** hay captura o confirmación en `progress/impl_282.md`. Es la
  única comprobación de **tinta** (ver Q4); no sustituye a T10, lo acompaña.
- Depende de: T8, T6.

### [ ] T16 — Gate y bitácora
- `./init.sh --rapido` en verde (con `INIT_EXIT=$?` escrito **dentro** del log:
  aquí un `echo` ya ha tapado un rojo).
- `progress/impl_282.md` con el mapa R → test completo y las cifras de T14.
- **Hecho cuando:** gate verde, los **34** requisitos mapeados a un test que
  existe y pasa, y ningún test previo relajado.
- Depende de: T4, T5, T7, T10, T11, T12, T13, T15 **y todo lo posterior
  (T17-T29)**. La medición válida del navegador es la de **T29**, no la de T14. Correr además los tests de integración de la carga por
  API (`tests/integration/carga-api-etiquetas.test.ts`), que el grafo de imports
  sí selecciona ahora que el generador del servidor cambia.

---

## Trazabilidad R → tarea / test

| R | Qué fija | Tarea | Test |
|---|---|---|---|
| R1 | 1 em de separación entre líneas base | T6 | `tests/unit/components/etiquetas-pdf.test.ts` (separación medida en el PDF) |
| R2 | la separación se **deriva** del cuerpo | T6 | `tests/unit/components/etiquetas-layout.test.ts` (cuerpo doblado → baja lo mismo) |
| R3 | se cumple en las cuatro hojas | T7 | `tests/unit/components/etiquetas-pdf.test.ts` (bucle sobre `HOJAS_ETIQUETA`) |
| R4 | los siete campos, mismo orden | T7 | `tests/unit/components/etiquetas-pdf.test.ts` (rótulos presentes y en orden) |
| R5 | nada invade la banda del QR | T7 | `tests/unit/components/etiquetas-pdf.test.ts` (`max(ys) ≤ layout.y(qrTop)`) |
| R6 | dirección de 3 líneas sin recorte | T7 | `tests/unit/components/etiquetas-pdf.test.ts` (sin `...`) |
| R7 | caso de referencia completo | T7 | `tests/unit/components/etiquetas-pdf.test.ts` (fixture guía `19887906`) |
| R8 | el monto usa fuente embebida (Type0/Identity-H) | T8 | `tests/unit/components/etiquetas-pdf.test.ts` (T10 caso 1) |
| R9 | el texto del monto, decodificado por el `/ToUnicode` del PDF | T8 | `tests/unit/components/etiquetas-pdf.test.ts` (T10 caso 2) |
| R10 | el glifo del símbolo tiene contorno no vacío | T8 | `tests/unit/components/etiquetas-pdf.test.ts` (T10 caso 3) + `tests/unit/pdf/ttf-lector.test.ts` |
| R11 | cobertura cp1252 + símbolo configurado | T3 | `tests/unit/components/etiquetas-fuente.test.ts` |
| R12 | el resto del texto no cambia | T8 | `tests/unit/components/etiquetas-pdf.test.ts` (T10 caso 5) |
| R13 | la fuente no va en la carga inicial | T8 | `tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` |
| R14 | tope de 80 KB del artefacto + cifra medida | T3, T14 | `tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` + `progress/impl_282.md` |
| R15 | `/FontFile2` ≤ 12 KB por documento | T8 | `tests/unit/components/etiquetas-pdf.test.ts` (T10 caso 4) |
| R16 | fallo de carga → mensaje y sin PDF | T9 | `tests/components/EtiquetasGuiaModal.test.tsx` |
| R17 | licencia y procedencia | T3 | `tests/unit/components/etiquetas-fuente.test.ts` |
| R18 | el generador del lote intacto | T12 | `tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts` + guardia de T5 |

Los 18 requisitos están mapeados; ninguno queda sin test.

> **Aviso al implementador:** R14 lleva una cifra que **hay que medir**, no
> estimar (T14), y R10 es el requisito que da sentido a la ficha: si el test
> pasara con una fuente sin el glifo, el test está mal, no la fuente. La tabla de
> mutaciones de T13 existe precisamente para demostrar lo contrario.

---

# Ampliación del 2026-08-25 — los dos generadores, cupo y cobertura

## Correcciones a las tareas ya escritas

| Tarea | Corrección |
|---|---|
| **T1** | Gana la **puerta de R30**: si el archivo candidato no contiene U+20A1 con contorno no vacío, **no se sigue con él**; se busca otro y queda escrito por qué. Y la licencia se cita **por su nombre** en `progress/impl_282.md` y en la cabecera del módulo. |
| **T3** | El artefacto **no** vive bajo `app/`: es `lib/pdf/etiquetas-fuente.ts` (el servidor no puede importar de `app/`). Añade `COBERTURA` (generada, T24) y `PESO_DECLARADO_BYTES` (T26). |
| **T4** | El test pasa a `tests/unit/pdf/etiquetas-fuente.test.ts` (sigue al módulo). |
| **T5** | La guardia amplía su alcance: además de lo escrito, comprueba que el **servidor** sí lo importa de forma estática y que **ningún módulo de cliente** lo hace. Deja de afirmar que el lote «no lo nombra» (ahora debe nombrarlo). |
| **T6** | Las constantes derivadas nacen ya en `lib/pdf/etiquetas-maqueta.ts` (T17), no en `app/…/etiquetas-layout.ts`. |
| **T8** | El registro de la fuente y `cubreTexto` viven en `lib/pdf/etiquetas-fuente-registro.ts`, compartidos con el servidor. |
| **T12** | Deja de ser «no-regresión por no tocarlo». Ahora afirma lo que R18 revisado conserva: firma pública, 100 × 100, tope de etiquetas y política best-effort — **con** el archivo modificado. |
| **T13** | La tabla de mutaciones crece con M7-M9 (abajo). |

## Bloque E — Maqueta compartida (va PRIMERO: es dependencia de todo)

### [ ] T17 — Una sola fuente de verdad para la geometría
- NUEVO `lib/pdf/etiquetas-maqueta.ts`: `LIENZO_BASE_MM`, `MAQUETA_BASE` (con
  `guiaY`), `PT_A_MM`, `camposYInicio()`, `GAP_TEXTO_CODIGOS`,
  `GAP_ROTULO_VALOR`, `qrTopBase()`.
- MUDAR `app/(app)/ordenes/_components/etiquetas-layout.ts` →
  `lib/pdf/etiquetas-layout.ts` (mismo contenido, `crearLayout` intacto).
  Actualizar los imports de `etiquetas-pdf.ts` y de los dos tests que lo usan.
  **Sin archivo-puente**: un puente es otro sitio donde divergir.
- `lib/pdf/etiquetas-pdf-lote.ts` deja de declarar `SIZE_MM`, `MARGIN`,
  `CONTENT_WIDTH`, `FONT_*`, `LINE_HEIGHT`, `FIELD_GAP`, `CAMPOS_Y_INICIO`,
  `GAP_*` y pasa a usar `crearLayout` con la hoja `100x100` (`s = 1`,
  offsets 0).
- **Hecho cuando:** `pnpm run typecheck` pasa; no queda
  `app/(app)/ordenes/_components/etiquetas-layout.ts`; los tests de la 150
  siguen verdes **sin relajar una sola aserción**; y el PDF del servidor para un
  fixture da **exactamente los mismos `Td`** que antes de esta tarea (aún sin el
  cambio de R19: aquí sólo se muda, no se arregla).

### [ ] T18 — El dibujo del texto, una sola vez
- NUEVO `lib/pdf/etiquetas-dibujo.ts`: cabecera (GUÍA / REMISIÓN),
  `drawCampos` (con `CampoEtiqueta.fuente`, §3.2) y `geografiaLegible`; recibe
  el `doc`, el `layout`, el DTO, la fuente embebida y **los data URL ya
  rasterizados** del QR y del código de barras.
- Los dos generadores quedan reducidos a: rasterizar lo suyo + llamar a este
  módulo.
- **Hecho cuando:** los dos compilan, ninguno conserva su propio `drawCampos`, y
  las suites de cliente y de lote siguen verdes.
- Depende de: T17.

### [ ] T19 — Anti-divergencia, asertada
- NUEVO `tests/unit/pdf/etiquetas-dos-generadores.test.ts`: para el mismo DTO y
  la hoja `100x100`, extrae `x y Td` + texto de los **dos** PDF y exige que
  coincidan (**R22**).
- NUEVA guardia `tests/unit/guards/etiquetas-maqueta-unica.guardia.test.ts`:
  ninguno de los dos generadores declara por su cuenta `CAMPOS_Y_INICIO`,
  `FONT_ROTULO`, `FONT_VALOR`, `LINE_HEIGHT`, `FIELD_GAP`, `MARGIN` ni
  `SIZE_MM` (**R21**).
- **Hecho cuando:** pasan, y la mutación M7 los pone en rojo.
- Depende de: T18.

## Bloque F — El servidor (backend, antes que el cliente)

### [ ] T20 — Fuente embebida en el generador del lote
- `lib/pdf/etiquetas-pdf-lote.ts`: **import estático** de
  `lib/pdf/etiquetas-fuente.ts` (nada de `fs`: `next.config.ts` no declara
  `outputFileTracingIncludes` y el fallo sólo se vería en producción),
  `registrarFuente(doc, fuente)` una vez por documento y el valor del monto con
  la fuente embebida.
- **Hecho cuando:** compila, la firma pública de `buildEtiquetasLotePdf` no
  cambia (**R18**) y no aparece ningún `readFileSync` (**R23**).
- Depende de: T3, T17, T18.

### [ ] T21 — Tests del PDF del servidor
- `tests/unit/pdf/etiquetas-pdf-lote.test.ts` (EXTENDIDO), inflando los streams
  (ese builder usa `compress: true`): separación de líneas base ≥ 1 em del
  cuerpo de la guía (**R19**); y los tres eslabones del §4 sobre **su** PDF —
  recurso `Type0`/`Identity-H`, decodificación por el `/ToUnicode` propio hasta
  `₡18.000`, y contorno no vacío del CID en su `/FontFile2` (**R20**); tamaño del
  `/FontFile2` ≤ 12 KB por documento y constante al crecer las páginas (**R15**
  en esta salida).
- **Hecho cuando:** pasan y las mutaciones M1-M4 también los ponen rojos a ellos.
- Depende de: T2, T20.

### [ ] T22 — Medir el coste por documento en la ruta del servidor
- Medir `f` = coste de `addFont` (descodificar + parsear el TTF) **por
  documento**, y comprobar la desigualdad de `design.md` §11.3 en los dos modos:
  consolidado (1 documento) e **individual** (N documentos, el peor caso).
- Medir también el tamaño del PDF de **una** etiqueta antes/después (Q9).
- **Hecho cuando:** las cifras están en `progress/impl_282.md` y cumplen
  `(18 ms + f) × N ≤ 36 000 ms` para el tope por defecto (300) y para el techo
  duro (1000). **Si no cabe, se PARA y se pregunta (Q8)**: no se elige mitigación
  en silencio. (**R24**)
- Depende de: T20.

## Bloque G — Cupo y cobertura

### [ ] T23 [P] — Corpus de casos y cupo que no se recorta en silencio
- NUEVO `tests/fixtures/etiquetas-282.ts` con el corpus de `design.md` §13,
  marcando cuál es **real** (la evidencia) y cuáles son **formas**.
- Test en los **dos** generadores: ningún caso del corpus sale con marca de
  recorte (**R26**); el cupo para siete campos es ≥ 9 en las cuatro hojas y en el
  servidor (**R25**); `qrSize`, `barcodeHeight` y `gapQrBarcode` conservan sus
  valores actuales y el cuerpo de la guía sigue siendo 22 (**R27**).
- **Hecho cuando:** pasan, y añadir a mano un caso que no quepa los pone rojos.
- Depende de: T17.

### [ ] T24 — Cobertura declarada y fallo visible
- `scripts/fuente-etiqueta-a-base64.ts` emite también `COBERTURA`, **derivada
  del archivo** (nunca a mano).
- `lib/pdf/etiquetas-fuente-registro.ts`: `cubreTexto(fuente, texto)`; los dos
  generadores lo llaman **con el texto completo del campo** (no sólo con el
  símbolo: `formatMontoString` tiene una rama verbatim) y lanzan error con
  contexto si algo no está cubierto.
- Cliente: el modal muestra el mensaje de R16 y **no** descarga. Servidor: el
  error sube por el camino best-effort que ya existe →
  `etiquetasPdf: { error }`, HTTP 200, carga no revertida.
- Tests: `tests/unit/pdf/etiquetas-fuente.test.ts` (la cobertura declarada
  coincide con la del archivo, **R29**), `tests/components/EtiquetasGuiaModal.test.tsx`
  y `tests/integration/carga-api-etiquetas.test.ts` (los dos canales de fallo,
  **R28**).
- **Hecho cuando:** con `MONEDA_SIMBOLO` forzado a un carácter fuera del
  subconjunto, ni el navegador ni la API entregan una etiqueta: los dos fallan de
  forma visible.
- Depende de: T3, T20.

### [ ] T25 — El peso, declarado y reportado (R14 revisado)
- `lib/pdf/etiquetas-fuente.ts` exporta `PESO_DECLARADO_BYTES`; la guardia de T5
  compara el peso **real** con el declarado y falla si difieren, con un mensaje
  que diga los dos números.
- **Hecho cuando:** cambiar un byte del artefacto sin actualizar el número pone
  la guardia en rojo, y el número queda también en `progress/impl_282.md`. El
  tope de 80 KB es **objetivo**, no puerta: si la cobertura de R11 obliga a
  pasarlo, se pasa y **se reporta**.
- Depende de: T3.

## Mutaciones añadidas a T13

| # | Mutación | Debe ponerse ROJO |
|---|---|---|
| M7 | mover la línea base de los campos **en un solo** generador | T19 (R22) y la guardia de R21 |
| M8 | `MONEDA_SIMBOLO` a un carácter fuera del subconjunto | T24: el modal no descarga y la API responde `etiquetasPdf: { error }` |
| M9 | `COBERTURA` declarando un carácter que el archivo no tiene | T24 (R29) |

## Trazabilidad — filas nuevas y revisadas

| R | Qué fija | Tarea | Test |
|---|---|---|---|
| R14 *(rev.)* | peso declarado = peso real, y se reporta | T25 | `tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` |
| R18 *(rev.)* | del lote se conserva todo lo que no se arregla | T20 | `tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts` |
| R19 | el servidor también separa 1 em | T20 | `tests/unit/pdf/etiquetas-pdf-lote.test.ts` |
| R20 | el símbolo, impreso también en el PDF del servidor | T20 | `tests/unit/pdf/etiquetas-pdf-lote.test.ts` (tres eslabones) |
| R21 | una sola fuente de verdad de la geometría | T17 | `tests/unit/guards/etiquetas-maqueta-unica.guardia.test.ts` |
| R22 | los dos generadores coinciden en 100 × 100 | T18 | `tests/unit/pdf/etiquetas-dos-generadores.test.ts` |
| R23 | la fuente no se lee del sistema de archivos | T20 | `tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` |
| R24 | el coste por documento cabe en el presupuesto | T22 | medición registrada + test de tiempo por documento |
| R25 | cupo ≥ 9 en los dos generadores y las cuatro hojas | T23 | `tests/unit/pdf/etiquetas-ajuste.test.ts` + tests de PDF |
| R26 | ningún caso del corpus se recorta | T23 | `tests/unit/components/etiquetas-pdf.test.ts` + `tests/unit/pdf/etiquetas-pdf-lote.test.ts` |
| R27 | ni guía encogida ni banda de códigos comprimida | T23 | `tests/unit/pdf/etiquetas-maqueta.test.ts` |
| R28 | carácter no cubierto → fallo visible en los dos canales | T24 | `tests/components/EtiquetasGuiaModal.test.tsx` + `tests/integration/carga-api-etiquetas.test.ts` |
| R29 | la cobertura declarada no miente | T24 | `tests/unit/pdf/etiquetas-fuente.test.ts` |
| R30 | la fuente elegida contiene U+20A1, verificado antes | T1 | `tests/unit/pdf/etiquetas-fuente.test.ts` (puerta) |

Con estas filas, los **30** requisitos quedan mapeados a un test concreto.

---

# Cierre del 2026-08-25 — Q7 a Q10

## Correcciones a las tareas ya escritas

| Tarea | Corrección |
|---|---|
| **T15** | Se amplía: además del PDF, abrir **la vista previa del modal** y comparar el importe a ojo. Es la única comprobación de que los píxeles coinciden (Q4 cerró que no se añade rasterizador). |
| **T23** | El corpus ya no es «una etiqueta real + formas»: incorpora el **alfabeto medido en producción** el 2026-08-25 (T26). |
| **T5** | La guardia sigue vigilando que el artefacto sólo se referencie por `import()` dinámico — con la paridad eso **no cambia**, lo que cambia es *cuándo* se dispara ese `import()` (al abrir el modal, no al descargar). |
| **T14** | Su medición queda **superada** por T29: hay que volver a medir después de la paridad, no antes. La cifra válida es la de T29. |

## Bloque H — Corpus real y paridad

### [ ] T26 [P] — El alfabeto real, dentro del corpus
- `tests/fixtures/etiquetas-282.ts`: añadir un caso que contenga los **seis**
  caracteres no ASCII medidos en producción (`á é í ñ ó ú`) repartidos por
  destinatario, dirección y producto, con la fecha de la medida en el comentario.
- Test en los **dos** generadores: esos seis caracteres aparecen impresos en la
  etiqueta (decodificados desde el PDF, no desde el DTO) (**R34**).
- **Hecho cuando:** pasa, y quitar un carácter del subconjunto lo pone rojo.
- Depende de: T23.

### [ ] T27 — Paridad: la misma fuente en la vista previa
- `app/(app)/ordenes/_components/etiquetas-fuente-carga.ts`:
  `asegurarFuenteEnPantalla(fuente)` idempotente — base64 → `ArrayBuffer` →
  `new FontFace(nombre, buffer)` → `document.fonts.add`.
- `EtiquetasGuiaModal.tsx`: dispara la carga **al abrir el modal** (una vez, sin
  bloquear el render).
- `EtiquetaGuia.tsx`: el **valor del monto** usa esa familia con la del sistema
  como respaldo. Nada más de la vista previa cambia.
- **Hecho cuando:** compila; si la fuente no llega, la vista previa se pinta
  igual con la tipografía del sistema y la descarga sigue fallando visible
  (**R33**); no existe ningún `.woff2` ni segunda copia del archivo (**R31**).
- Depende de: T3, T8.

### [ ] T28 — La paridad, comprobada (no afirmada)
- `tests/components/EtiquetaGuiaPreview.test.tsx` (NUEVO o extendido): el importe
  tiene como **primera** familia la del artefacto, y `document.fonts.add` recibió
  una `FontFace` con ese nombre creada desde **esos** bytes (espía: jsdom no
  rasteriza).
- Test de origen único: vista previa y generador de PDF leen el **mismo** módulo
  (mismo `nombre`, mismo `base64`).
- Test cruzado: el nombre de familia registrado en pantalla es **idéntico** al
  `/BaseFont` con el que el PDF dibuja el monto (se reutiliza la extracción de
  R8) (**R32**).
- **Hecho cuando:** pasan y la mutación M10 los pone en rojo.
- Depende de: T27.

### [ ] T29 — Volver a presupuestar el navegador **después** de la paridad
- Repetir la medición de T14 con la paridad ya puesta:
  `pnpm exec prisma generate` → `pnpm exec next build`; anotar «Size» y «First
  Load JS» de `/ordenes` antes/después, y el peso del chunk.
- Verificar **la condición** del `+0 KB` (`design.md` §19.2): el artefacto no
  entra en el bundle inicial y la vista previa no se renderiza en la carga de la
  pantalla; el chunk se pide **al abrir el modal**.
- **Hecho cuando:** las cifras están en `progress/impl_282.md` marcadas como
  «post-paridad» y el First Load JS de `/ordenes` **no ha crecido** (**R13**
  revisado, **R14**). Si creciera, se para: significa que el artefacto entró al
  bundle inicial.
- Depende de: T27.

## Mutaciones añadidas

| # | Mutación | Debe ponerse ROJO |
|---|---|---|
| M10 | quitar la familia del artefacto del importe en la vista previa | T28 (R32) |
| M11 | registrar en pantalla una familia con **otro** nombre que el del PDF | T28 (test cruzado) |

## Trazabilidad — filas del cierre

| R | Qué fija | Tarea | Test |
|---|---|---|---|
| R13 *(rev.)* | nada de fuente en la carga inicial; se carga al abrir el modal, una sola vez | T27, T29 | `tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` + medición de T29 |
| R31 | misma fuente y mismo artefacto en pantalla y PDF | T27 | `tests/components/EtiquetaGuiaPreview.test.tsx` |
| R32 | la paridad se comprueba, no se afirma | T28 | `tests/components/EtiquetaGuiaPreview.test.tsx` (test cruzado con el `/BaseFont`) |
| R33 | sin fuente: vista previa sí, descarga falla visible | T27 | `tests/components/EtiquetasGuiaModal.test.tsx` |
| R34 | los seis caracteres reales se imprimen | T26 | `tests/unit/components/etiquetas-pdf.test.ts` + `tests/unit/pdf/etiquetas-pdf-lote.test.ts` |

**Total: 34 requisitos, todos mapeados a un test concreto. Sin preguntas
abiertas.** T16 (gate y bitácora) pasa a depender también de T26-T29, y su
criterio de «hecho» cuenta **34**, no 30.
