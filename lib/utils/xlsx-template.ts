/**
 * Utilidad de presentación (sin DOM ni React) para generar el binario XLSX de una
 * plantilla de carga masiva a partir de una definición de columnas.
 *
 * Feature 31 — corrección de la plantilla de `BulkUpload`: la descarga pasa de CSV
 * a un XLSX formateado y legible. Cubre R1 (cabecera en orden), R2 (negrita), R3
 * (anchos legibles), R4 (fila de ejemplo opcional), R5 (contrato con lista vacía),
 * R6/R7 (binario XLSX válido y recargable). La descarga en navegador vive en el
 * componente `BulkUpload`; aquí solo se construye el buffer.
 *
 * `exceljs` se importa de forma dinámica DENTRO de la función (R6b): así, sumado al
 * import dinámico de este módulo desde `BulkUpload`, exceljs queda fuera del bundle
 * inicial del componente.
 */

/** Definición de una columna de la plantilla. Espejo de `TemplateField`/`CsvTemplateField`. */
export interface XlsxTemplateField {
  /** Clave/encabezado de la columna. Fallback de la cabecera si no hay `label` (R1). */
  key: string;
  /** Etiqueta de cabecera mostrada en el archivo. Por defecto = `key` (R1). */
  label?: string;
  /** Valor de ejemplo opcional para la fila de muestra (R4). */
  example?: string;
  /**
   * Marca la columna como obligatoria: la cabecera se sufija con " *" para que
   * el usuario lo anticipe al abrir la plantilla (feature 51).
   */
  required?: boolean;
}

/** Sufijo visible que marca una columna obligatoria en la cabecera (feature 51). */
const REQUIRED_SUFFIX = " *";

/** Cabecera mostrada para una columna: `label ?? key`, con marca de obligatorio. */
function headerFor(field: XlsxTemplateField): string {
  const base = field.label ?? field.key;
  return field.required ? `${base}${REQUIRED_SUFFIX}` : base;
}

/** Ancho mínimo legible de columna, en caracteres (R3). */
const MIN_WIDTH = 12;
/** Ancho máximo para evitar columnas desmesuradas (R3). */
const MAX_WIDTH = 40;
/** Relleno añadido al contenido más largo para calcular el ancho (R3). */
const PAD = 2;

/** Calcula un ancho legible por columna a partir de cabecera y ejemplo (R3). */
function computeWidth(field: XlsxTemplateField): number {
  const header = headerFor(field);
  const example = field.example ?? "";
  const content = Math.max(header.length, example.length) + PAD;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, content));
}

/**
 * Construye el binario XLSX de la plantilla.
 *
 * - Única hoja "Plantilla".
 * - Primera fila (cabecera): `label ?? key` de cada campo, en el orden provisto (R1),
 *   en negrita (R2).
 * - Anchos de columna calculados por contenido (R3).
 * - Segunda fila (ejemplos): solo si al menos un campo aporta `example`; los campos
 *   sin ejemplo quedan como celda vacía alineada a su columna (R4).
 * - Devuelve un `ArrayBuffer` recargable con `ExcelJS.Workbook` (R6/R7). El MIME es
 *   responsabilidad del componente al envolverlo en un Blob.
 *
 * @throws si `fields` está vacío (el consumidor deshabilita el botón vía R11, pero
 * la utilidad protege su contrato de uso — R5).
 */
export async function buildXlsxTemplate(
  fields: XlsxTemplateField[],
): Promise<ArrayBuffer> {
  if (fields.length === 0) {
    throw new Error(
      "buildXlsxTemplate: se requiere al menos un campo para generar la plantilla",
    );
  }

  // Import dinámico (R6b): exceljs queda fuera del bundle inicial de BulkUpload.
  const ExcelJS = (await import("exceljs")).default;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Plantilla");

  // `header` fija la fila 1 (R1); `width` da un ancho legible por columna (R3).
  worksheet.columns = fields.map((field) => ({
    header: headerFor(field),
    key: field.key,
    width: computeWidth(field),
  }));

  // Encabezado en negrita (R2).
  worksheet.getRow(1).font = { bold: true };

  // Fila de ejemplo solo si algún campo la aporta (R4).
  const hasAnyExample = fields.some(
    (field) => field.example !== undefined && field.example !== null,
  );
  if (hasAnyExample) {
    const exampleRow: Record<string, string> = {};
    for (const field of fields) {
      exampleRow[field.key] = field.example ?? "";
    }
    worksheet.addRow(exampleRow);
  }

  // writeBuffer() es async y devuelve el binario XLSX (R6/R7). exceljs declara un
  // tipo `Buffer` propio; se normaliza a ArrayBuffer para el borde de presentación.
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
