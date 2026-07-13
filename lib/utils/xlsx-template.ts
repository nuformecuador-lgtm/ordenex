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
   * Marca SEMÁNTICA de columna obligatoria. YA NO altera el texto de la cabecera:
   * el header SIEMPRE es la clave máquina (`label ?? key`). Sufijarlo con " *"
   * (como hacía la feature 51) rompía el round-trip descargar→subir, porque el
   * parser identifica cada columna por su clave exacta y "distrito *" ya no casa
   * con "distrito" (feature 58). La obligatoriedad se comunica en la UI (el
   * `Alert` del botón de carga), no en el archivo.
   */
  required?: boolean;
}

/**
 * Cabecera de una columna: SIEMPRE la clave máquina (`label ?? key`), sin marca
 * de obligatorio. El texto de la celda de cabecera NUNCA puede diferir de la
 * clave que el parser usa como identificador, o el archivo descargado deja de
 * poder re-subirse (feature 58).
 */
function headerFor(field: XlsxTemplateField): string {
  return field.label ?? field.key;
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
