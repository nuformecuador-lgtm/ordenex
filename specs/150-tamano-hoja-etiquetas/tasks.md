# Feature 150 — Tamaño de hoja seleccionable en las etiquetas · tasks

> `[P]` = paralelizable con las demás `[P]` del mismo bloque (no comparten
> archivo). El resto va en orden por la dependencia indicada.
> Sin tareas de DB: la feature no tiene migración, `down.sql` ni RLS
> (`design.md` §0 y §6).

## Bloque A — Catálogo (sin dependencias)

### [x] T1 [P] — Crear el catálogo de tamaños
- Archivo: `lib/config/etiquetas-hoja.ts` (NUEVO).
- Contenido: `HojaEtiquetaId`, `HojaEtiqueta`, `HOJAS_ETIQUETA` (orden de R1),
  `HOJA_ETIQUETA_DEFAULT_ID = "100x100"`, `getHojaEtiqueta`, `formatMm`.
  Valores exactos de `design.md` §2.
- **Hecho cuando:** el módulo compila con `strict`, no contiene `process.env` ni
  import alguno, y `pnpm typecheck` pasa.

### [x] T2 [P] — Tests del catálogo
- Archivo: `tests/unit/config/etiquetas-hoja.test.ts` (NUEVO, entorno Node).
- Cubre: los cuatro tamaños y su orden, dimensiones exactas, default,
  `getHojaEtiqueta` con id desconocido, y que el módulo no toca el entorno
  (aserción sobre el texto fuente: no aparece `process.env`).
- **Hecho cuando:** los tests pasan y cubren R1, R2, R3, R4, R5.
- Depende de: T1.

### [x] T3 [P] — Test de no-regresión del generador server-side (blindaje de D3)
- Archivo: `tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts` (extender) o test
  nuevo junto a él.
- Afirma: el `/MediaBox` sigue siendo `283.xx × 283.xx` pt y
  `buildEtiquetasLotePdf` sigue aceptando un solo parámetro.
- **Hecho cuando:** el test pasa **sin** haber modificado
  `lib/pdf/etiquetas-pdf-lote.ts` (R21).

## Bloque B — Escalado (depende de T1)

### [x] T4 — Módulo de layout escalado
- Archivo: `app/(app)/ordenes/_components/etiquetas-layout.ts` (NUEVO).
- `crearLayout(hoja)` → `s`, `offX`, `offY`, constantes de `design.md` §3.3 y los
  mapeadores `x()`/`y()`. Puro: sin DOM, sin jspdf.
- **Hecho cuando:** para las cuatro hojas devuelve exactamente los números de la
  tabla §3.2/§3.3 y `pnpm typecheck` pasa.
- Depende de: T1.

### [x] T5 — Tests del layout
- Archivo: `tests/unit/components/etiquetas-layout.test.ts` (NUEVO, Node).
- Cubre: factor único por lado menor (mismo `s` en X y en Y), centrado en ambos
  ejes para las tres hojas no cuadradas, `s = 1` y offsets 0 en `100x100`, y la
  aserción de encaje (`offX, offY ≥ 0` y el bloque cabe en la página).
- **Hecho cuando:** los tests pasan y cubren R14, R15, R16, R17.
- Depende de: T4.

## Bloque C — Generador de cliente (depende de T4)

### [x] T6 — Parametrizar el generador por tamaño
- Archivo: `app/(app)/ordenes/_components/etiquetas-pdf.ts` (MODIFICADO).
- Cambios de `design.md` §4.3: tercer parámetro `hoja` obligatorio en
  `buildEtiquetasPdf` y `descargarEtiquetasPdf`, `format: [anchoMm, altoMm]` en
  `new jsPDF` y en cada `addPage`, dibujo vía `crearLayout`, `splitTextToSize`
  con `layout.contentWidth`, ráster del barcode escalado (§3.4), y
  `etiquetasPdfFilename(hoja)` en lugar de `ETIQUETAS_PDF_FILENAME`.
- **Hecho cuando:** compila, no queda ninguna referencia a `SIZE_MM` fija ni a
  `ETIQUETAS_PDF_FILENAME`, y con `100x100` el dibujo es idéntico al actual
  (s = 1, offsets 0).
- Depende de: T4.

### [x] T7 — Tests del PDF generado
- Archivo: `tests/unit/components/etiquetas-pdf.test.ts` (NUEVO, `@vitest-environment jsdom`).
- jspdf REAL; `jsbarcode` mockeado (captura de opciones) y
  `HTMLCanvasElement.prototype.toDataURL` estubado con el PNG 1×1 del precedente
  `tests/unit/pdf/etiquetas-pdf-lote.test.ts`.
- Cubre: `/MediaBox` por tamaño (§3.2), una página por etiqueta en los cuatro
  tamaños, opciones del barcode escaladas, nombre de archivo por tamaño y
  presencia de los nueve datos de la etiqueta.
- **Hecho cuando:** los tests pasan y cubren R12, R13, R18, R19, R20.
- Depende de: T6.

## Bloque D — UI (depende de T1 y T6)

### [x] T8 — Selector en el modal
- Archivo: `app/(app)/ordenes/_components/EtiquetasGuiaModal.tsx` (MODIFICADO).
- Estado local `hojaId` con reset al default en la transición de `open`, `Select`
  de `components/ui/select.tsx` con `aria-label="Tamaño de hoja"`, render solo si
  `hayImprimibles`, `description` compuesta con `formatMm`, y
  `descargarEtiquetasPdf(..., getHojaEtiqueta(hojaId))`.
- **Hecho cuando:** compila, no se introduce `localStorage` ni llamada al
  servidor, y el modal sigue respetando el caso "sin imprimibles".
- Depende de: T1, T6.

### [x] T9 — Tests del modal
- Archivo: `tests/components/EtiquetasGuiaModal.test.tsx` (EXTENDIDO).
- Cubre: presencia y orden de las cuatro opciones, valor inicial = default,
  descripción dinámica al cambiar de tamaño, tercer argumento correcto al
  descargar, reapertura vuelve al default, ausencia de selector sin imprimibles,
  y ausencia de escritura en `localStorage` (espía sobre `Storage.prototype.setItem`).
- **Hecho cuando:** los tests pasan y cubren R6, R7, R8, R9, R10, R11.
- Depende de: T8.

### [x] T10 — Actualizar los tests existentes que rompe el cambio
- Archivos: `tests/components/EtiquetasGuiaModal.test.tsx` (aserción de
  argumentos, línea 135), `tests/components/OrdenesListadoEtiquetasChain.test.tsx`,
  `tests/components/OrdenesRevisionMaestro.test.tsx` (mocks del módulo de PDF).
- **Hecho cuando:** los tres archivos pasan en verde sin relajar sus aserciones
  originales (siguen afirmando que se descarga con las etiquetas imprimibles).
- Depende de: T8.

## Bloque E — Cierre

### [x] T11 — Verificación y bitácora
- Correr `./init.sh` y la suite completa; registrar el mapa R → test en
  `progress/impl_150.md`.
- **Hecho cuando:** `./init.sh` en verde, suite sin fallos nuevos respecto del
  baseline medido en el momento (no citado de memoria), y los 21 requisitos
  aparecen mapeados a un test existente.
- Depende de: T2, T3, T5, T7, T9, T10.

---

## Trazabilidad R → tarea / test

| R | Qué fija | Tarea | Test |
|---|---|---|---|
| R1 | catálogo de 4 tamaños en orden | T1 | `tests/unit/config/etiquetas-hoja.test.ts` |
| R2 | dimensiones exactas en mm | T1 | `tests/unit/config/etiquetas-hoja.test.ts` |
| R3 | módulo sin efectos secundarios | T1 | `tests/unit/config/etiquetas-hoja.test.ts` |
| R4 | default `100x100` | T1 | `tests/unit/config/etiquetas-hoja.test.ts` |
| R5 | id desconocido → default | T1 | `tests/unit/config/etiquetas-hoja.test.ts` |
| R6 | selector con las 4 opciones, en orden | T8 | `tests/components/EtiquetasGuiaModal.test.tsx` |
| R7 | al abrir, default | T8 | `tests/components/EtiquetasGuiaModal.test.tsx` |
| R8 | descripción con label y mm | T8 | `tests/components/EtiquetasGuiaModal.test.tsx` |
| R9 | descarga usa el tamaño seleccionado | T8 | `tests/components/EtiquetasGuiaModal.test.tsx` |
| R10 | sin persistencia | T8 | `tests/components/EtiquetasGuiaModal.test.tsx` |
| R11 | sin imprimibles no hay selector ni descarga | T8 | `tests/components/EtiquetasGuiaModal.test.tsx` |
| R12 | una etiqueta por página, sin mosaico | T6 | `tests/unit/components/etiquetas-pdf.test.ts` + `etiquetas-pdf-descarga.test.ts` |
| R13 | tamaño de página declarado | T6 | `tests/unit/components/etiquetas-pdf.test.ts` |
| R14 | escalado uniforme, un solo factor | T4 | `tests/unit/components/etiquetas-layout.test.ts` |
| R15 | hoja no cuadrada: cuadrado centrado | T4 | `tests/unit/components/etiquetas-layout.test.ts` |
| R16 | todos los elementos escalan | T4 | `tests/unit/components/etiquetas-layout.test.ts` |
| R17 | nada se sale de la página | T4 | `tests/unit/components/etiquetas-layout.test.ts` |
| R18 | densidad del ráster del barcode | T6 | `tests/unit/components/etiquetas-pdf.test.ts` |
| R19 | nombre de archivo con el tamaño | T6 | `tests/unit/components/etiquetas-pdf.test.ts` (`etiquetasPdfFilename`) + `tests/unit/components/etiquetas-pdf-descarga.test.ts` (`doc.save`) |
| R20 | los 9 datos en cualquier tamaño | T6 | `tests/unit/components/etiquetas-pdf.test.ts` |
| R21 | server-side sigue en 100 × 100 | T3 | `tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts` |

Los 21 requisitos están mapeados; ninguno queda sin test.

> Desvío de T7 durante la implementación: el paso final de la descarga
> (`doc.save(nombre)`) NO se puede afirmar en `etiquetas-pdf.test.ts`, porque
> `save` es una propiedad de **instancia** de jsPDF (no del prototipo: no hay
> dónde espiarla) y el build de Node de jspdf la implementa con
> `fs.writeFileSync`, es decir escribiría archivos reales durante la suite. Por
> eso ese único caso vive en `tests/unit/components/etiquetas-pdf-descarga.test.ts`,
> donde jspdf se sustituye por un doble mínimo. El resto de T7 (MediaBox, páginas
> y contenido) sigue con jspdf REAL en el archivo previsto.
