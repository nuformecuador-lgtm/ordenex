# Feature 31 — Plantilla de carga en XLSX (corrección) · design.md

> Cubre R1–R13. Frontend puro: sin tocar backend, DB, RLS, actions ni el endpoint
> de subida. No hay modelo de datos, migraciones ni endpoints nuevos: es un cambio
> de presentación en cliente + una util pura. TypeScript strict, sin `any`.

## Contexto verificado (código actual)

- `exceljs: "^4.4.0"` ya está en `package.json`. Uso de referencia de su API:
  `lib/parsers/spreadsheet.ts` (`import ExcelJS from "exceljs"`, feature 15).
- `components/shared/BulkUpload.tsx` (`"use client"`): `handleDownloadTemplate()`
  hoy hace `buildCsvTemplate(fields)` → `new Blob([csv], {type:"text/csv…"})` →
  `URL.createObjectURL` + `<a download>` + `click()`. `DEFAULT_TEMPLATE_NAME =
  "plantilla.csv"`. Prop `templateFileName?`. `canDownloadTemplate = fields.length
  > 0 && !isUploading`.
- `lib/utils/csv-template.ts`: `buildCsvTemplate(fields)` (pura, sin DOM).
- `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx`: pasa
  `templateFileName="plantilla-ordenes-carga-masiva.csv"` y `fields=ORDENES_BULK_FIELDS`
  (11 columnas con `label` + `example`).
- Tests a no romper: `tests/components/BulkUpload.test.tsx`,
  `tests/unit/utils/csv-template.test.ts`.

## Decisión de alcance (FIRME — puerta F1.4 resuelta por el humano 2026-07-10)

`BulkUpload` genera **SIEMPRE XLSX** (opción a, firme). El botón "Descargar plantilla"
produce siempre un XLSX para todos los consumidores presentes y futuros. **NO** se
añade la prop `templateFormat`. Motivo: el único consumidor actual es órdenes, no
existe caso CSV, y es lo más simple sin ampliar el contrato genérico. `exceljs` se
carga de forma **dinámica** (firme; ver D3/R6b). `lib/utils/csv-template.ts` se
**conserva** intacto pero desconectado (firme; ver D5).

---

## D1 — Nuevo generador `lib/utils/xlsx-template.ts` (util, espejo de csv-template)

Archivo nuevo, función pura de presentación (sin DOM ni React), colocado junto a
`csv-template.ts`. Firma:

```ts
export interface XlsxTemplateField {
  key: string;
  label?: string;   // encabezado; fallback = key (R1)
  example?: string; // fila de ejemplo opcional (R4)
}

/** Genera el binario XLSX de la plantilla. Async por writeBuffer(). (R1–R7) */
export async function buildXlsxTemplate(
  fields: XlsxTemplateField[],
): Promise<ArrayBuffer>;
```

Implementación (alineada con la API usada en `lib/parsers/spreadsheet.ts`):

1. Si `fields.length === 0` → `throw new Error(...)` (R5), igual que `buildCsvTemplate`.
2. `const workbook = new ExcelJS.Workbook();`
   `const ws = workbook.addWorksheet("Plantilla");`
3. **Columnas + anchos (R3):** `ws.columns = fields.map(f => ({ header: f.label ?? f.key, key: f.key, width: computeWidth(f) }))`.
   - `header` establece la fila 1 (R1).
   - `width` = `Math.max(MIN_WIDTH, header.length + PAD, example.length + PAD)`
     acotado a `MAX_WIDTH` (p. ej. `MIN_WIDTH=12`, `PAD=2`, `MAX_WIDTH=40`). Sencillo
     y suficiente; sin autofit real (exceljs no lo trae). No sobre-ingenierizar.
4. **Encabezado en negrita (R2):** `ws.getRow(1).font = { bold: true };`
5. **Fila de ejemplo (R4):** `const hasAnyExample = fields.some(f => f.example != null);`
   si `hasAnyExample` → `ws.addRow(Object.fromEntries(fields.map(f => [f.key, f.example ?? ""])));`
   (usa la `key` de columna → celdas alineadas; campos sin ejemplo quedan vacíos).
   Si no hay ejemplos, no se añade fila (solo cabecera).
6. **Binario (R6/R7):** `return workbook.xlsx.writeBuffer();` (devuelve un buffer
   apto para envolver en Blob). El MIME es responsabilidad del componente al crear el
   Blob (D2). No se fija Content-Type aquí (es una util pura).

Notas:
- `writeBuffer()` es **async** → la función es `Promise<ArrayBuffer>`. De ahí que
  `handleDownloadTemplate` pase a `async` (D2).
- No se usa `any`. `exceljs` trae sus propios tipos. El único punto conocido de
  fricción de tipos es `workbook.xlsx.load(buffer)` en el LADO DE LECTURA (ver el
  cast documentado en `spreadsheet.ts`); en el lado de ESCRITURA (`writeBuffer`) no
  se requiere cast. Si un test necesita releer el buffer, reutiliza el mismo patrón
  de cast documentado que ya existe en `spreadsheet.ts` (no inventar API nueva).

**Formato "básico legible" (objetivo de la feature), explícito:** (1) encabezado
`label ?? key` por columna, (2) encabezado en **negrita**, (3) **anchos** de columna
calculados por contenido. Nada más (sin colores, bordes, validación de datos ni
congelar filas): se evita sobre-ingeniería.

---

## D2 — Cambios en `components/shared/BulkUpload.tsx`

1. `DEFAULT_TEMPLATE_NAME = "plantilla.xlsx"` (antes `"plantilla.csv"`). Actualizar el
   JSDoc de la prop `templateFileName` (default `"plantilla.xlsx"`).
2. `handleDownloadTemplate` pasa a **async** y genera XLSX:

```ts
const [isGeneratingTemplate, setIsGeneratingTemplate] = useState(false);

async function handleDownloadTemplate() {
  if (fields.length === 0 || isGeneratingTemplate) return; // R10
  setIsGeneratingTemplate(true);
  try {
    const { buildXlsxTemplate } = await import("@/lib/utils/xlsx-template"); // D3
    const buffer = await buildXlsxTemplate(fields);
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = templateFileName ?? DEFAULT_TEMPLATE_NAME;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  } finally {
    setIsGeneratingTemplate(false); // se restablece pase lo que pase (sin catch vacío)
  }
}
```

3. `canDownloadTemplate = fields.length > 0 && !isUploading && !isGeneratingTemplate;`
   (R10 + conserva R11). El `onClick={handleDownloadTemplate}` acepta el handler async
   (React ignora la promesa devuelta; no se propaga error porque el `finally` limpia y
   el `import`/`writeBuffer` solo fallarían por un bug de build — se deja burbujear a
   la consola, no hay `catch` vacío que oculte el fallo, según convenciones).
4. `import { buildCsvTemplate } from "@/lib/utils/csv-template";` se **elimina** de
   `BulkUpload` (queda sin uso con la opción (a)). Ver D5 sobre el archivo util.

El mecanismo de descarga (Blob → `createObjectURL` → `<a download>` → `click`) se
conserva: los tests existentes stubbean `URL.createObjectURL`/`revokeObjectURL` y
`HTMLAnchorElement.prototype.click`, por lo que siguen sirviendo; solo cambian las
aserciones de MIME/extensión y se vuelven `async` (usar `waitFor`).

---

## D3 — Import dinámico de exceljs en el cliente (FIRME, R6b)

`exceljs` es una dependencia **pesada**. `BulkUpload` es un client component que se
monta en la vista de órdenes; cargar exceljs en su bundle inicial penaliza a todos los
que abren la página aunque nunca descarguen la plantilla.

**Decisión firme:** cargar el generador (y con él exceljs) con **import dinámico**
`await import("@/lib/utils/xlsx-template")` dentro de `handleDownloadTemplate`, es
decir, solo al primer clic. Ventaja: exceljs queda en un chunk aparte, fuera del
bundle inicial. Coste: el primer clic hace una micro-espera de carga del chunk; se
cubre con el estado `isGeneratingTemplate` (R10), que además da feedback y evita
doble disparo. Este import dinámico es también lo que permite que el test unitario del
generador y el test del componente se aíslen limpiamente.

---

## D4 — Consumidor `OrdenesCargaMasivaButton.tsx`

Único cambio: `templateFileName="plantilla-ordenes-carga-masiva.csv"` →
`"plantilla-ordenes-carga-masiva.xlsx"` (R12). `accept={["csv","xlsx"]}` y
`ORDENES_BULK_FIELDS` **no cambian** (la subida sigue aceptando ambos; R13). El
comentario que dice "descargar una plantilla CSV" en el JSDoc de `BulkUpload` se
actualiza a XLSX.

---

## D5 — Destino de `csv-template.ts` (FIRME: conservar)

Decisión firme (F1.4-2): **conservar** `lib/utils/csv-template.ts` y su test
`tests/unit/utils/csv-template.test.ts` **intactos** (función pura ya cubierta, no
estorba), pero **desconectarla** de `BulkUpload` (se elimina su import en D2). NO se
borra ninguno de los dos archivos. No hay otras referencias a `buildCsvTemplate` fuera
de `BulkUpload`.

---

## Alternativas descartadas

### ALT-1 — Generar el XLSX en el servidor (route handler o Server Action)
Exponer `GET /api/plantilla` (o una Server Action) que arme el XLSX con exceljs en el
servidor y lo devuelva como descarga.
**Descartada** porque: (1) viola el alcance de la feature (zone=frontend; no tocar
backend/endpoints); (2) añade una ruta/superficie de red y su autorización para algo
puramente estático derivado de props que el cliente ya tiene; (3) exceljs ya corre en
cliente sin problema para este tamaño (≤ 12 filas). El único beneficio (no cargar
exceljs en el bundle del cliente) se logra igual con el import dinámico de D3, sin
crear backend.

### ALT-2 — Nueva dependencia cliente ligera (p. ej. `xlsx`/SheetJS o `write-excel-file`)
Usar una librería más liviana que exceljs solo para escribir la plantilla en cliente.
**Descartada** porque: (1) el brief y CLAUDE.md ("No inventes"/reutilizar) piden
**reutilizar exceljs**, que ya está en el repo y en uso (feature 15); (2) añadir otra
dependencia duplica capacidades y aumenta superficie de mantenimiento/seguridad; (3)
el peso de exceljs se mitiga con import dinámico (D3). Reutilizar exceljs mantiene una
sola fuente de verdad de la API de spreadsheets en el proyecto.

### ALT-3 — Mantener CSV y solo "mejorar" abriéndolo en Excel
No cambiar nada y confiar en que Excel abre el CSV.
**Descartada:** no cumple el objetivo (encabezados formateados/legibles, negrita,
anchos), y un CSV abierto por doble clic sufre problemas de separador/locale y
codificación para usuarios no técnicos — justo el problema que la feature resuelve.
