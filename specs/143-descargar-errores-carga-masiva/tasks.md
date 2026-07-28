# Feature 143 — Tasks

> Rama: `feature/143-descargar-errores-carga-masiva` (worktree
> `ordenex-wt-143`, desde `origin/dev @ c3e6954`).
> `[P]` = paralelizable con las tareas de su mismo bloque.
> Un commit por task lógica (`docs/conventions.md`).

## Bloque 0 — Base

### T0. Baseline verde antes de tocar nada
- Depende de: —
- Correr `./init.sh`, `pnpm typecheck` y la suite de tests **en este worktree**.
- **Hecho cuando:** los tres terminan en verde y el resultado (nº de tests,
  duración) queda anotado en `progress/impl_143.md` como baseline. Si algo está
  en rojo de origen, se anota como hallazgo previo y NO se intenta arreglar aquí.

## Bloque 1 — Utilidades puras (sin UI)

### T1. `buildXlsxRows` en `lib/utils/xlsx-template.ts` [P]
- Depende de: T0
- Añadir la función hermana `buildXlsxRows(fields, rows, sheetName?)` que genera
  cabecera (clave máquina, negrita) + N filas de datos, con `exceljs` importado
  dinámicamente **dentro** de la función y anchos calculados con los helpers ya
  existentes. Exportar también `XLSX_MIME` y hacer que `BulkUpload.tsx` lo consuma
  desde aquí en vez de declararlo local.
- **No tocar** `buildXlsxTemplate`.
- **Hecho cuando:** `pnpm typecheck` verde y `buildXlsxRows` genera un ArrayBuffer
  recargable con `ExcelJS.Workbook`. Cubre R1 (parcial), R2, R19.

### T2. Extraer `formatErrores` a módulo puro [P]
- Depende de: T0
- Crear `app/(app)/ordenes/_components/carga-masiva-errores-formato.ts` con
  `formatErrores` y el motivo genérico; `OrdenesConErrorTabla.tsx` importa y
  **re-exporta** `formatErrores` (no cambia su firma ni su salida).
- **Hecho cuando:** `tests/components/OrdenesConErrorTabla.test.tsx` pasa sin
  modificarlo. Cubre R6/R7 (parcial).

### T3. Módulo de composición `carga-masiva-export-errores.ts`
- Depende de: T2
- Crear el módulo puro con `COLUMNA_MOTIVO_ERROR`, `ERRORES_EXPORT_FIELDS`
  (8 columnas de `ORDENES_BULK_FIELDS` + `motivo_error` al final),
  `motivoErrorDeFila(error)` (prefijo `Fila <N> — ` una sola vez, omitido si
  `fila` es `null` — decisión de gate G-2), `construirFilasErrorExport(errores,
  filas)` y `nombreArchivoErrores(fecha)`, según el algoritmo de `design.md §2.3`.
  Sin React, sin DOM, sin `any`, sin lanzar ante datos inesperados.
- **Hecho cuando:** `pnpm typecheck` verde y el módulo no importa `exceljs` ni
  ningún componente `"use client"`. Cubre R1, R3, R4, R5, R6, R7, R8, R10, R19,
  R22.

## Bloque 2 — Tests de las utilidades

### T4. Tests unitarios de `buildXlsxRows` [P]
- Depende de: T1
- `tests/unit/utils/xlsx-rows.test.ts`: cabecera exacta y en orden con
  `motivo_error` al final; una fila por registro; celda vacía si falta la clave;
  el binario se recarga con exceljs; el módulo de export no importa exceljs en
  top-level.
- **Hecho cuando:** los tests pasan y cada uno nombra el `R<n>` que cubre
  (R1, R2, R19).

### T5. Tests del compositor de filas [P]
- Depende de: T3
- `tests/components/CargaMasivaExportErrores.test.ts`: cruce por `linea` con
  valores CRUDOS; orden preservado; `fila: null`; línea sin correspondencia;
  `motivo_error` = `Fila 7 — telefono: …`; prefijo **una sola vez** con varios
  campos y varios mensajes (separadores `; ` y `, `); mapa vacío →
  `Fila 3 — Error de validación`; `fila: null` → celda **sin** prefijo `Fila`;
  dos invocaciones → resultado idéntico; nombre de archivo con fecha fija.
- **Hecho cuando:** los tests pasan y cubren R3, R4, R5, R6, R7, R8, R10, R22.

### T6. Test de regresión del cruce `fila` ↔ `linea` [P]
- Depende de: T3
- Escenario en el que la `fila` remapeada por `procesarEnChunks` **no** coincide
  con el índice dentro del lote (más de un chunk), para blindar el riesgo R-1 de
  `design.md §6`.
- **Hecho cuando:** el test falla si se elimina el remapeo de
  `carga-masiva-chunks.ts:98-100`. Refuerza R4.

## Bloque 3 — Round-trip (el riesgo central)

### T7. Test de integración `carga-masiva-errores-roundtrip.test.ts`
- Depende de: T1, T3
- Generar un XLSX de export con filas reales y comprobar, para **ambos** parsers
  (`lib/parsers/spreadsheet.ts` y `matrizAArchivo`/`parseCsv` del parser del
  navegador):
  1. `findMissingHeaders(headers)` → `[]` (R14).
  2. Para cada una de las 8 claves, el valor re-parseado es idéntico al del mismo
     archivo generado SIN la columna `motivo_error` (R15).
  3. `filaCargaSchema.parse(row)` no falla y su salida **no** contiene
     `motivo_error` (R16).
- **Hecho cuando:** los tests pasan y cada `it` nombra su `R<n>`.

### T8. Comentario-ancla en `filaCargaSchema` [P]
- Depende de: T7
- Añadir en `lib/types/carga-masiva.ts` un comentario que documente que el schema
  NO debe volverse `.strict()` sin romper la re-subida del export de errores
  (feature 143, R16), apuntando al test de T7.
- **Hecho cuando:** el comentario existe y `pnpm typecheck` sigue verde.
  Mitiga el riesgo R-2.

## Bloque 4 — UI

### T9. Botón de descarga en `OrdenesCargaPreview.tsx`
- Depende de: T1, T3
- Añadir prop opcional `filas?: FilaParseada[]`, estado `generando`, y el botón
  (visible solo si `errores.length > 0`) con el patrón Blob + anchor +
  `revokeObjectURL`, import dinámico de `buildXlsxRows`, toast de error en el
  `catch` y reset en el `finally`. **Una sola acción de descarga, solo `.xlsx`**
  (decisión de gate G-3): nada de menú de formatos ni variante CSV. **No** se
  toca `OrdenesCargaResumen` ni el paso `asignacion` (decisión de gate G-1).
- **Hecho cuando:** `pnpm typecheck` verde y `tests/components/OrdenesCargaResumen.test.tsx`
  y `OrdenesConErrorTabla.test.tsx` siguen pasando sin cambios. Cubre R9, R11,
  R12, R13, R21.

### T10. Enhebrar `filasUnicas` desde `OrdenesCargaMasivaButton.tsx`
- Depende de: T9
- Pasar `filas={filasUnicas}` a `OrdenesCargaPreview`. Sin más cambios de estado
  ni de flujo.
- **Hecho cuando:** la descarga funciona en el flujo real (verificación manual
  descrita en T13) y `pnpm typecheck` sigue verde.

### T11. Tests de la UI
- Depende de: T9, T10
- `tests/components/OrdenesCargaPreview.test.tsx`: sin filas con error el botón
  no está en el DOM (R11); con filas con error, click → `URL.createObjectURL`
  llamado con un Blob de MIME xlsx y `anchor.download` con el nombre esperado
  (R9, R10); `fetch` espiado sin llamadas (R9); doble click → una sola generación
  (R12); `buildXlsxRows` que rechaza → toast de error y botón re-habilitado (R13);
  no hay ninguna opción de descarga en CSV (R21).
- **Hecho cuando:** todos pasan y cada `it` nombra su `R<n>`.

### T12. Test de alcance: cabecera incompleta [P]
- Depende de: T10
- Verificar en `tests/components/OrdenesCargaUpload.test.tsx` (o test nuevo) que
  un archivo con cabecera incompleta no produce clasificación ni paso de
  hallazgos, por tanto no hay descarga de errores.
- **Hecho cuando:** el test pasa y cubre R17.

### T12b. Test de alcance: paso posterior a la carga real [P]
- Depende de: T10
- En `tests/components/OrdenesCargaMasivaButton.test.tsx` (o test nuevo):
  llevado el modal al paso `asignacion`, no existe en el DOM ningún botón de
  descarga de filas con error (decisión de gate G-1).
- **Hecho cuando:** el test pasa y cubre R20.

## Bloque 5 — Cierre

### T13. Verificación manual del flujo
- Depende de: T10
- Con `pnpm dev`: subir un archivo con filas con error de varios tipos, descargar
  el xlsx, abrirlo (columna `motivo_error` al final con el prefijo `Fila N — `,
  valores crudos), corregir una fila y **volver a subir el mismo archivo
  descargado**: debe validarse sin errores de cabecera.
- **Hecho cuando:** el recorrido queda registrado en `progress/impl_143.md`
  según `docs/verification.md` (pasos, resultado, capturas si aplica).

### T14. Mapa de trazabilidad y cierre
- Depende de: T4, T5, T6, T7, T11, T12, T12b, T13
- Escribir en `progress/impl_143.md` la tabla `R1..R22 → archivo::nombre del test`
  y el delta de la suite respecto al baseline de T0.
- **Hecho cuando:** los 22 requisitos tienen al menos un test nombrado, `./init.sh`
  y la suite completa terminan en verde, y el delta de tests fallidos respecto al
  baseline es 0.
