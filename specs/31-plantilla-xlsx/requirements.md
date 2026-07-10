# Feature 31 — Plantilla de carga en XLSX (corrección) · requirements.md

> Zona: frontend · Complejidad: medium · Depende de: null
> Corrección de la feature 9 (`BulkUpload`): el botón "Descargar plantilla" hoy
> descarga un **CSV**; debe descargar un **XLSX** formateado y legible para que
> una persona con poco conocimiento técnico llene la orden columna por columna.
> Alcance: SOLO el formato de la plantilla que se **descarga**. El endpoint de
> subida (feature 15) ya acepta CSV y XLSX y **no se toca**.

## Notación
Requisitos en EARS. Cada `R<n>` es testeable. La trazabilidad a tests concretos
está en `tasks.md`. Convención de tipos de test:
- **UNIT-GEN** = test unitario del generador `buildXlsxTemplate` (lee el buffer de
  vuelta con `ExcelJS.Workbook` y verifica su contenido/formato).
- **COMP-BTN** = test de componente (`BulkUpload`) sobre el botón de descarga.

---

## Generación de la plantilla XLSX (util pura)

**R1** — El sistema DEBE exponer un generador de plantilla XLSX que, dada una lista
ordenada de campos `{ key, label?, example? }`, produzca un libro (`workbook`) con
una sola hoja cuya **primera fila** contenga, en el mismo orden de los campos, el
encabezado `label ?? key` de cada campo.
_(UNIT-GEN: leer fila 1 del workbook y comparar orden + valores)._

**R2** — El sistema DEBE marcar la fila de encabezado en **negrita** (`bold`).
_(UNIT-GEN: la celda de encabezado tiene `font.bold === true`)._

**R3** — El sistema DEBE asignar a cada columna un **ancho legible** (no dejar el
ancho por defecto de 8 caracteres), de modo que el encabezado y su ejemplo sean
visibles sin ajuste manual.
_(UNIT-GEN: cada `worksheet.columns[i].width` está definido y es ≥ un mínimo fijo)._

**R4** — SI al menos un campo aporta `example`, ENTONCES el sistema DEBE generar una
**segunda fila** con los ejemplos alineados a su columna; los campos sin `example`
DEBEN quedar como celda vacía en su columna. SI ningún campo aporta `example`,
ENTONCES el sistema DEBE generar únicamente la fila de encabezado.
_(UNIT-GEN: dos escenarios — con y sin ejemplos)._

**R5** — SI el generador se invoca con una lista de campos vacía, ENTONCES el
sistema DEBE lanzar un error (protección de contrato; el botón ya se deshabilita en
R11 de la feature 9).
_(UNIT-GEN: `expect(...).rejects/toThrow`)._

**R6** — El sistema DEBE devolver el contenido del libro como binario apto para
descarga en el navegador (Blob o `ArrayBuffer`) con el MIME
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
_(UNIT-GEN: el binario devuelto se puede volver a cargar con `ExcelJS.Workbook`;
COMP-BTN: el Blob descargado usa ese MIME)._

**R6b** — El sistema DEBE cargar `exceljs` de forma **dinámica** (`await import(...)`)
dentro del manejador de descarga, y NO como import estático en el tope del módulo del
componente, para no incluir `exceljs` en el bundle inicial de `BulkUpload`. (Decisión
firme F1.4-3.)
_(COMP-BTN: no hay import estático de exceljs en `BulkUpload`; la generación ocurre
tras el clic — verificable como no-regresión del bundle y por el flujo async)._

**R7** — El workbook generado DEBE ser un XLSX válido: al releerlo con la misma
librería (`ExcelJS`) DEBE recuperarse la cabecera esperada en orden y, cuando
aplique, la fila de ejemplo (garantiza compatibilidad con el parser de subida de la
feature 15, que lee la primera hoja).
_(UNIT-GEN: round-trip write → load → assert headers/ejemplo)._

---

## Comportamiento del botón "Descargar plantilla" (`BulkUpload`)

**R8** — CUANDO el usuario pulsa "Descargar plantilla", el sistema DEBE generar el
XLSX en el navegador y disparar la descarga de un archivo con extensión `.xlsx` y el
MIME de R6, **sin** llamar al endpoint de subida.
_(COMP-BTN: se crea un Blob y se dispara la descarga; `fetch` no se invoca)._

**R9** — El sistema DEBE usar `plantilla.xlsx` como **nombre por defecto** del
archivo descargado, y DEBE usar `templateFileName` cuando el consumidor lo provee.
_(COMP-BTN: dos casos — default y provisto)._

**R10** — MIENTRAS la generación del XLSX está en curso (operación asíncrona), el
sistema DEBE evitar que la misma acción se dispare en paralelo (p. ej. deshabilitando
el botón o ignorando clics repetidos hasta que termine).
_(COMP-BTN: durante la promesa pendiente el botón queda deshabilitado / no re-dispara)._

**R11** — MIENTRAS `fields` esté vacío o haya una subida en curso, el sistema DEBE
mantener deshabilitado el botón "Descargar plantilla" (comportamiento existente de la
feature 9 que NO debe regresar).
_(COMP-BTN: `fields=[]` → botón deshabilitado)._

---

## Consumidor de órdenes y no-regresión

**R12** — El consumidor real de la carga masiva de órdenes
(`OrdenesCargaMasivaButton`) DEBE solicitar la plantilla con nombre
`plantilla-ordenes-carga-masiva.xlsx` (antes `.csv`), conservando las 11 columnas y
sus ejemplos actuales, en el mismo orden.
_(COMP-BTN o test de integración ligero del consumidor: el nombre termina en `.xlsx`
y las columnas coinciden con `ORDENES_BULK_FIELDS`)._

**R13** — El cambio NO DEBE alterar el flujo de **subida** (validación de archivo,
POST multipart, callbacks `onSuccess`/`onError`) ni los tipos aceptados para subir.
_(COMP-BTN: la suite de subida existente de la feature 9 sigue en verde)._

---

## Decisiones firmes (puerta F1.4 — resueltas por el humano 2026-07-10)

Las tres preguntas quedaron resueltas en la recomendación del spec_author y fijadas
como firmes:

1. **Contrato de `BulkUpload` → SIEMPRE XLSX (opción a).** El botón "Descargar
   plantilla" genera siempre un XLSX para todos los consumidores. NO se añade la prop
   `templateFormat`. `DEFAULT_TEMPLATE_NAME` pasa a `plantilla.xlsx`. (Ver R8/R9.)
2. **`lib/utils/csv-template.ts` y su test → CONSERVAR intactos.** Quedan
   desconectados del flujo de descarga (ya no los importa `BulkUpload`), pero NO se
   borran. (Ver D5/T6.)
3. **Import de `exceljs` en cliente → DINÁMICO** (`await import(...)` dentro de
   `handleDownloadTemplate`), nunca estático al tope del módulo. Fijado como **R6b** y
   D3.

## Preguntas abiertas

Ninguna pendiente.
