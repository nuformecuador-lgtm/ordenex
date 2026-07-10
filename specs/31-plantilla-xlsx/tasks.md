# Feature 31 — Plantilla de carga en XLSX (corrección) · tasks.md

> Checklist verificable. `[P]` = paralelizable. Cada task indica el/los `R<n>` que
> cubre y su test (UNIT-GEN = unit del generador; COMP-BTN = component del botón).
> Puerta F1.4 RESUELTA (firme): (a) `BulkUpload` SIEMPRE XLSX, sin prop `templateFormat`;
> (2) `exceljs` con import dinámico dentro de `handleDownloadTemplate`; (3)
> `csv-template.ts` y su test se conservan intactos, solo desconectados.
> Verificación global final: `./init.sh` en verde y suite de tests sin rojos.

---

## Bloque A — Generador XLSX (util pura)

- [ ] **T1 — Crear `lib/utils/xlsx-template.ts`** con `buildXlsxTemplate(fields)` y
  la interfaz `XlsxTemplateField` (D1).
  - Cubre: R1, R2, R3, R4, R5, R6, R7.
  - Hecho cuando: existe la función `Promise<ArrayBuffer>`, sin `any`, `tsc`
    (strict) pasa, y `npx eslint` limpio en el archivo.
  - Depende de: nada.

- [ ] **T2 [P] — Test unitario `tests/unit/utils/xlsx-template.test.ts`** (UNIT-GEN).
  Escenarios que releen el buffer con `ExcelJS.Workbook` (round-trip):
  - Cabecera en orden con `label ?? key` → **R1**.
  - Celdas de fila 1 con `font.bold === true` → **R2**.
  - `worksheet.columns[i].width` definido y ≥ mínimo para cada columna → **R3**.
  - Con ≥1 `example`: segunda fila alineada, campos sin ejemplo vacíos; sin ningún
    `example`: solo fila de cabecera → **R4**.
  - Invocar con `[]` rechaza/lanza → **R5**.
  - `writeBuffer()` devuelve binario recargable por ExcelJS → **R6/R7**.
  - Hecho cuando: todos los casos verdes; reutiliza (si hace falta releer) el patrón
    de cast documentado de `lib/parsers/spreadsheet.ts`, sin inventar API.
  - Depende de: T1.

---

## Bloque B — Componente `BulkUpload`

- [ ] **T3 — Migrar `handleDownloadTemplate` a XLSX async** en
  `components/shared/BulkUpload.tsx` (D2/D3):
  - `DEFAULT_TEMPLATE_NAME = "plantilla.xlsx"`; **import dinámico** de
    `xlsx-template` (que a su vez importa exceljs — R6b, sin import estático al tope);
    Blob con MIME de R6; estado `isGeneratingTemplate`; `canDownloadTemplate`
    incorpora `!isGeneratingTemplate`; eliminar el import de `buildCsvTemplate`;
    actualizar JSDoc (CSV→XLSX). NO se añade prop `templateFormat` (siempre XLSX).
  - Cubre: R6b, R8, R9, R10, R11 (mantener), R13 (no tocar flujo de subida).
  - Hecho cuando: `tsc` strict pasa, sin `catch` vacío, no hay import estático de
    exceljs en `BulkUpload`, el bloque de subida queda intacto.
  - Depende de: T1.

- [ ] **T4 — Actualizar/añadir tests de descarga en `tests/components/BulkUpload.test.tsx`**
  (COMP-BTN):
  - Descarga crea Blob con MIME XLSX y dispara `<a>.click()` sin llamar a `fetch`
    (adaptar el test existente R4/R8 a async con `waitFor`) → **R8**.
  - Nombre por defecto `plantilla.xlsx` y `templateFileName` provisto respetado →
    **R9**.
  - Durante la generación pendiente el botón no re-dispara / queda deshabilitado →
    **R10**.
  - `fields=[]` mantiene el botón deshabilitado (test existente) → **R11**.
  - La suite de subida (R2/R12.../ selección/validación de la feature 9) sigue verde →
    **R13**.
  - Hecho cuando: toda la suite de `BulkUpload.test.tsx` pasa (incluidos los tests
    heredados no relacionados con la descarga).
  - Depende de: T3.

---

## Bloque C — Consumidor de órdenes

- [ ] **T5 [P] — Cambiar nombre de plantilla en
  `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx`**:
  `templateFileName` → `"plantilla-ordenes-carga-masiva.xlsx"` (D4). No tocar
  `ORDENES_BULK_FIELDS` ni `accept`.
  - Cubre: R12 (y R13 por no alterar subida).
  - Hecho cuando: el nombre termina en `.xlsx`; columnas/ejemplos intactos; `tsc`
    pasa. Verificar con test (COMP-BTN sobre el consumidor, o assert de que el prop
    llega a `BulkUpload`).
  - Depende de: nada (independiente de T3; pero la descarga real end-to-end depende
    de T3).

---

## Bloque D — Limpieza de csv-template (según P2)

- [ ] **T6 — Conservar `lib/utils/csv-template.ts` intacto** (decisión firme F1.4-2):
  - NO borrar `lib/utils/csv-template.ts` ni `tests/unit/utils/csv-template.test.ts`;
    quedan intactos.
  - Confirmar que `BulkUpload` ya no lo importa (hecho en T3) y que su único
    consumidor previo era `BulkUpload` (`Grep buildCsvTemplate`).
  - Cubre: higiene; no añade R.
  - Hecho cuando: `csv-template.ts` y su test siguen presentes y verdes, sin imports
    rotos.
  - Depende de: T3.

---

## Bloque E — Verificación final

- [ ] **T7 — Verificación ejecutable de la feature**:
  - `./init.sh` en verde.
  - Suite completa de tests sin rojos (unit + component).
  - Mapa de trazabilidad R1–R13 → test, documentado en
    `progress/impl_31-plantilla-xlsx.md` por el implementer.
  - Comprobación manual opcional: descargar la plantilla desde el modal de carga
    masiva de órdenes y abrir el `.xlsx` (encabezados en negrita, anchos legibles,
    fila de ejemplo).
  - Depende de: T1–T6.

---

## Mapa R → task/test (resumen de trazabilidad)

| R   | Task(s) | Test |
| --- | ------- | ---- |
| R1  | T1      | UNIT-GEN cabecera/orden |
| R2  | T1      | UNIT-GEN bold |
| R3  | T1      | UNIT-GEN width |
| R4  | T1      | UNIT-GEN con/sin ejemplo |
| R5  | T1      | UNIT-GEN throw en vacío |
| R6  | T1      | UNIT-GEN round-trip / COMP-BTN MIME |
| R6b | T3      | COMP-BTN sin import estático de exceljs / generación tras clic |
| R7  | T1      | UNIT-GEN write→load |
| R8  | T3      | COMP-BTN descarga sin fetch |
| R9  | T3      | COMP-BTN nombre default/provisto |
| R10 | T3      | COMP-BTN botón deshabilitado durante generación |
| R11 | T3      | COMP-BTN fields vacío deshabilita |
| R12 | T5      | COMP-BTN consumidor `.xlsx` + columnas |
| R13 | T3/T5   | COMP-BTN suite de subida verde |
