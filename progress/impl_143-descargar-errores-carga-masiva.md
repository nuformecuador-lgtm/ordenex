# Feature 143 — Descargar en Excel las filas con error de la carga masiva

> Rama `feature/143-descargar-errores-carga-masiva`, worktree `ordenex-wt-143`
> (desde `origin/dev @ c3e6954`). Spec cerrado y aprobado: `specs/143-descargar-errores-carga-masiva/`.

## T0 — Baseline (medido por el leader en este worktree, ANTES de tocar nada)

- `pnpm typecheck`: **2 errores preexistentes**, ambos
  `Property 'count' is missing in type ... GestionarOrdenPanelProps`
  (`tests/components/GestionarOrdenPanelEvidencias.test.tsx`,
  `tests/components/NotaPrivadaMensajero.test.tsx`). Ajenos a esta feature.
- `pnpm test`: **14 tests fallando / 5294 pasando (518 archivos)** en
  `DataTable`, `LoginForm`, `MarcarLuegoToggle`, `MisAsignacionesModule`,
  `NotaPrivadaMensajero`. Ninguno toca carga masiva. Hallazgo previo, NO se
  arregla aquí.

## Resultado tras la implementación

- `pnpm typecheck`: **los mismos 2 errores preexistentes**, ninguno nuevo →
  **delta 0**.
- `pnpm test`: **14 tests fallando / 5341 pasando (521 archivos)** → mismo número
  de fallos que el baseline, en los mismos archivos ajenos; **+47 tests nuevos**
  y +3 archivos, todos en verde → **delta 0**.
  - Nota de flakiness: una segunda pasada de la suite completa dio 18 fallos
    (se sumaron `recuperar-contrasena-form` y más casos de
    `MisAsignacionesModule`, todos por timing bajo carga). Son suites ya
    inestables en `dev`; ninguno pertenece al alcance de esta feature. Los
    archivos tocados por 143 se ejecutaron aparte y pasan al 100%.
- `pnpm lint`: **0 errores** (145 warnings preexistentes del repo); ningún
  warning en los archivos de esta feature.

## Archivos creados

- `app/(app)/ordenes/_components/carga-masiva-errores-formato.ts` — `formatErrores`
  + `MOTIVO_GENERICO` extraídos a módulo puro (T2).
- `app/(app)/ordenes/_components/carga-masiva-export-errores.ts` —
  `COLUMNA_MOTIVO_ERROR`, `ERRORES_EXPORT_FIELDS`, `motivoErrorDeFila`,
  `construirFilasErrorExport`, `nombreArchivoErrores` (T3).
- `tests/unit/utils/xlsx-rows.test.ts` (T4).
- `tests/components/CargaMasivaExportErrores.test.ts` (T5 + T6).
- `tests/integration/carga-masiva-errores-roundtrip.test.ts` (T7).

## Archivos modificados

- `lib/utils/xlsx-template.ts` — nueva función hermana `buildXlsxRows(fields,
  rows, sheetName?)` (cabecera = clave máquina, negrita, N filas, anchos por
  contenido, `exceljs` por import dinámico DENTRO de la función) y `XLSX_MIME`
  promovido a constante exportada. `buildXlsxTemplate` **no se tocó** (T1, R18).
- `components/shared/BulkUpload.tsx` — consume `XLSX_MIME` del módulo en vez de
  declararlo local (cambio mecánico, sin efecto observable).
- `app/(app)/ordenes/_components/OrdenesConErrorTabla.tsx` — importa y
  **re-exporta** `formatErrores` (firma y salida intactas).
- `app/(app)/ordenes/_components/OrdenesCargaPreview.tsx` — prop opcional
  `filas?: FilaParseada[]`, estado `generandoErrores`, botón "Descargar filas con
  error (.xlsx)" (visible solo si hay errores) con Blob + anchor +
  `revokeObjectURL`, import dinámico de `buildXlsxRows` y `toast.error` en el
  `catch` (T9).
- `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx` — pasa
  `filas={filasUnicas}` al preview (T10).
- `lib/types/carga-masiva.ts` — comentarios-ancla en `findMissingHeaders` (R14) y
  en `filaCargaSchema` (R16: NO convertirlo en `.strict()`), apuntando al test de
  round-trip (T8).
- `tests/components/OrdenesCargaPreview.test.tsx` — bloque nuevo de la descarga
  (T11).
- `tests/components/OrdenesCargaUpload.test.tsx` — caso R17 (T12).
- `tests/components/OrdenesCargaMasivaButton.test.tsx` — caso R20 y aserción de
  que el preview recibe `filas` (T12b, T10).
- `tests/components/OrdenesCargaResumen.test.tsx` — caso R20 sobre el componente
  REAL del paso posterior a la carga (refuerzo de T12b).
- `tests/components/BulkUpload.test.tsx` — el mock de `@/lib/utils/xlsx-template`
  pasa a ser PARCIAL (`importOriginal`) porque `XLSX_MIME` ahora viene de ahí.

## Decisiones respetadas (cerradas por el humano, no re-negociadas)

- Una sola columna extra `motivo_error`, al final tras `notas`, una sola hoja (D-A).
- Celdas con los valores **crudos** de `FilaParseada.row` (D-B).
- Prefijo de línea `Fila 7 — …` dentro de `motivo_error`, una sola vez; sin
  número conocido, sin prefijo y sin inventarlo (G-2, R22).
- Solo vista previa (G-1, R20) y solo `.xlsx` (G-3, R21).
- Sin backend, sin endpoint, sin migración: descarga cliente puro.

## T13 — Verificación del flujo (extremo a extremo)

El recorrido de navegador con `pnpm dev` **no** se ejecutó desde el agente (sin
sesión de navegador ni datos de una carga real). En su lugar se verificó el mismo
recorrido de forma ejecutable y reproducible:

1. Se compusieron filas de error de tres tipos (campo inválido, monto inválido y
   una fila sin número de fila) y se generó el binario real con `buildXlsxRows`.
2. El archivo resultante se re-parseó con el parser del **servidor**
   (`parseSpreadsheet`) y con el parser del **navegador** (`matrizAArchivo`):
   - Cabeceras: `destinatario | telefono | direccion_destinatario | monto_cobrar |
     producto | num_remision | peso | notas | motivo_error` (columna extra al
     final).
   - `findMissingHeaders(headers)` → `[]`.
   - Celdas `motivo_error`: `Fila 3 — telefono: debe tener 8 dígitos`,
     `Fila 9 — monto_cobrar: debe ser numérico y no negativo`, y
     `Error de validación` (sin prefijo) para la fila sin número.
   - Valores crudos intactos (`"abc"` en `monto_cobrar`, `"  ojo  "` en `notas`).
3. Corregidas las celdas inválidas, `filaCargaSchema.parse(fila)` acepta cada
   fila y su salida **no** contiene `motivo_error` (round-trip completo).

Lo mismo queda automatizado en `tests/integration/carga-masiva-errores-roundtrip.test.ts`,
que corre en cada suite. Queda pendiente el paseo visual del humano (abrir el
`.xlsx` en Excel) si lo quiere para la puerta de aceptación.

## Trazabilidad R1–R22 → test

| R | Test |
| --- | --- |
| R1 | `tests/unit/utils/xlsx-rows.test.ts::R1/R2: cabecera = claves máquina en orden, con motivo_error como ÚLTIMA columna` · `tests/components/CargaMasivaExportErrores.test.ts::R1: las 8 columnas de la plantilla en su orden + motivo_error al final` · `…::R1: hay UNA sola columna extra (nada de 'fila_original' ni segunda columna)` |
| R2 | `tests/unit/utils/xlsx-rows.test.ts::R1/R2: cabecera = claves máquina…` · `…::R2: ningún campo del export declara 'label' (la cabecera NUNCA diverge de la clave)` · `tests/integration/carga-masiva-errores-roundtrip.test.ts::R14: cada clave de columna aparece VERBATIM en la cabecera (sin label ni sufijo)` |
| R3 | `tests/unit/utils/xlsx-rows.test.ts::R3: emite una fila de datos por registro, en orden` · `tests/components/CargaMasivaExportErrores.test.ts::R3/R4: una fila por error, en el orden de la clasificación, con valores CRUDOS` |
| R4 | `tests/components/CargaMasivaExportErrores.test.ts::R3/R4: …valores CRUDOS` · `…::R1/R4: cada fila trae las 8 claves de la plantilla + motivo_error` · `…::R4: con varios lotes, cada fila con error exporta SUS propios valores crudos` (blinda el remapeo de `procesarEnChunks`) · `tests/unit/utils/xlsx-rows.test.ts::R4: celda vacía si la clave no está en el registro (sin desplazar columnas)` |
| R5 | `tests/components/CargaMasivaExportErrores.test.ts::R5: 'fila: null' → se emite igual, vacía salvo num_remision, sin lanzar` · `…::R5: línea sin correspondencia → fila degradada y el resto se sigue generando` · `…::R5: sin filas parseadas no lanza; degrada todas las filas` |
| R6 | `tests/components/CargaMasivaExportErrores.test.ts::R6: 'Fila N — campo: mensaje' con el mismo detalle que la columna Motivo` · `…::R6/R8: varios campos se separan con '; ' y el prefijo aparece UNA sola vez` · `…::R6: el motivo_error de cada fila lleva su prefijo de línea` |
| R7 | `tests/components/CargaMasivaExportErrores.test.ts::R7: sin detalle (mapa vacío) → 'Fila N — Error de validación'` · `…::R7: campos sin mensajes también degradan al motivo genérico` |
| R8 | `tests/components/CargaMasivaExportErrores.test.ts::R6/R8: varios mensajes de un campo se separan con ', '` · `…::R6/R8: varios campos se separan con '; '…` · `…::R8: dos generaciones sobre la misma clasificación dan un resultado idéntico` |
| R9 | `tests/components/OrdenesCargaPreview.test.tsx::R9/R10: al pulsar genera el Blob xlsx en el navegador y dispara la descarga` (fetch espiado sin llamadas) · `…::R9: las filas exportadas se componen con los valores CRUDOS y el motivo` |
| R10 | `tests/components/CargaMasivaExportErrores.test.ts::R10: 'ordenes-con-error-AAAAMMDD-HHmm.xlsx' con hora local, cero-rellenado` · `tests/components/OrdenesCargaPreview.test.tsx::R9/R10: …` (nombre del anchor) |
| R11 | `tests/components/OrdenesCargaPreview.test.tsx::R11: sin filas con error, el botón de descarga NO está en el DOM` · `…::R11: con filas con error, el botón de descarga está disponible` |
| R12 | `tests/components/OrdenesCargaPreview.test.tsx::R12: doble click con una generación en curso → una sola generación` |
| R13 | `tests/components/OrdenesCargaPreview.test.tsx::R13: si la generación falla → toast de error, botón re-habilitado y paso operativo` |
| R14 | `tests/integration/carga-masiva-errores-roundtrip.test.ts::R14: parser SERVIDOR — el archivo exportado no reporta cabeceras obligatorias ausentes` · `…::R14: parser NAVEGADOR — …` · `…::R14: cada clave de columna aparece VERBATIM…` |
| R15 | `tests/integration/carga-masiva-errores-roundtrip.test.ts::R15: parser SERVIDOR — la columna extra no altera el valor de ninguna otra` · `…::R15: parser NAVEGADOR — …` |
| R16 | `tests/integration/carga-masiva-errores-roundtrip.test.ts::R16: 'filaCargaSchema' valida la fila re-subida y DESCARTA motivo_error` · `…::R16: el schema NO es '.strict()' (endurecerlo rompería la re-subida)` |
| R17 | `tests/components/OrdenesCargaUpload.test.tsx::R17 (feature 143): cabecera incompleta → sin clasificación, luego no hay descarga de errores` |
| R18 | `tests/integration/carga-masiva-plantilla-roundtrip.test.ts` (suite existente, sin cambios: la plantilla sigue con sus 8 columnas) · `tests/integration/carga-masiva-errores-roundtrip.test.ts::R18: la plantilla vacía sigue teniendo 8 columnas y NINGUNA motivo_error` |
| R19 | `tests/unit/utils/xlsx-rows.test.ts::R19: el módulo de composición del export NO importa exceljs en top-level` · `…::R19: xlsx-template importa exceljs SOLO de forma dinámica` · `…::R19: el componente que descarga NO importa exceljs (lo carga buildXlsxRows)` |
| R20 | `tests/components/OrdenesCargaMasivaButton.test.tsx::R20 (feature 143): en el paso 'asignacion' no existe ningún botón de descarga de errores` · `tests/components/OrdenesCargaResumen.test.tsx::R20 (feature 143): el paso posterior a la carga real NO ofrece descargar filas con error` |
| R21 | `tests/components/OrdenesCargaPreview.test.tsx::R21: hay UNA sola acción de descarga y es .xlsx (sin variante CSV)` · `tests/unit/utils/xlsx-rows.test.ts::R21: expone el MIME de XLSX (única forma de descarga; no hay variante CSV)` · `tests/components/CargaMasivaExportErrores.test.ts::R10/R21: la extensión ofrecida es siempre .xlsx` |
| R22 | `tests/components/CargaMasivaExportErrores.test.ts::R22: 'fila: null' → SIN prefijo; no se inventa número de fila` · `…::R22: 'fila: null' y sin detalle → solo el motivo genérico, sin prefijo` |

**Los 22 requisitos tienen al menos un test nombrado.**

## Cierre de menores del review (post-aprobación)

Del review `progress/review_143-descargar-errores-carga-masiva.md` (APROBADO, 0
bloqueantes, 8 menores) se cerraron tres; los otros cinco quedan fuera de alcance
(deuda preexistente de dev, verificación humana o bookkeeping del leader).

- **Menor 1** — `specs/143-…/tasks.md` pasa a casillas `[x]` por task
  (`CHECKPOINTS.md`). **T13 queda SIN marcar**, con una nota que explica la
  sustitución por verificación ejecutable y que el paseo visual en Excel/Sheets
  es de aceptación humana.
- **Menor 5** — el test del parser NAVEGADOR ya no reimplementa la lectura de
  celdas: construye un `File` real con el binario exportado e invoca
  `parseArchivo`, es decir el camino de producción completo
  (`xlsxAMatriz` → `celdaATexto` → `matrizAArchivo`). Si la coacción de celdas se
  rompe (rich text, fórmula, fecha), el test cae con ella. Esto cierra además la
  mitad (b) del menor 4: el camino `File` → `parseArchivo` sobre un archivo
  exportado de verdad queda cubierto.
- **Menor 6** — se elimina el `await import("@/lib/utils/xlsx-template")` del
  handler: el módulo ya se resolvía estáticamente por `XLSX_MIME`, así que el
  dinámico no aplazaba nada. `buildXlsxRows` pasa a import estático y **el
  invariante de R19 sigue intacto**: la librería XLSX solo entra por el import
  dinámico interno de `buildXlsxRows`. Añadido un test que lo blinda desde el
  componente.

Verificación tras estos arreglos: `pnpm typecheck` con los mismos 2 errores
preexistentes (delta 0), `pnpm lint` 0 errores y sin warnings propios, y los 11
archivos de test de la feature y colindantes en verde: **137/137**.

## Riesgos vigentes

- **R-1** (remapeo `fila` ↔ `linea` en `carga-masiva-chunks.ts`): blindado por el
  test de dos lotes; si alguien quita el remapeo, ese test falla con valores de
  otras filas.
- **R-2** (`.strict()` futuro en `filaCargaSchema` o lista blanca en
  `findMissingHeaders`): blindado por los tests de R14/R16 y por los comentarios-ancla.
- **R-3** (archivos muy grandes: generación síncrona en el hilo principal):
  mitigado solo con el estado ocupado (R12). Worker fuera de alcance.
