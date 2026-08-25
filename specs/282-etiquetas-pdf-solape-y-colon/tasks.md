# Feature 282 — tasks

> `[P]` = paralelizable con las demás `[P]` del mismo bloque (no comparten
> archivo). El resto va en el orden que marque su dependencia.
> Sin tareas de base de datos: la feature no tiene migración, `down.sql` ni RLS
> (`design.md` §8).
> Gate: `./init.sh --rapido` (el diff no toca cimientos ni nombres de dinero).

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
- **Hecho cuando:** gate verde, los 18 requisitos mapeados a un test que existe y
  pasa, y ningún test previo relajado.
- Depende de: T4, T5, T7, T10, T11, T12, T13, T14, T15.

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
