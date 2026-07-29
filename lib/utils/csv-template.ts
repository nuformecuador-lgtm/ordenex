/**
 * Utilidad pura (sin DOM ni React) para generar el texto CSV de una plantilla
 * de carga masiva a partir de una definición de columnas.
 *
 * Feature 9 — componente carga masiva. Cubre R5 (cabecera en orden), R6 (fila
 * de ejemplo opcional) y R7 (escapado CSV válido). La descarga en navegador vive
 * en el componente `BulkUpload`; aquí solo se construye el string.
 */

/** Definición de una columna de la plantilla. Espejo de `TemplateField`. */
export interface CsvTemplateField {
  /** Clave/encabezado de la columna. Fallback de la cabecera si no hay `label`. */
  key: string;
  /** Etiqueta de cabecera mostrada en el archivo. Por defecto = `key` (R5). */
  label?: string;
  /** Valor de ejemplo opcional para la fila de muestra (R6). */
  example?: string;
}

const SEPARATOR = ",";
const ROW_DELIMITER = "\r\n";

/**
 * Escapa un valor para un campo CSV (R7): si contiene el separador, comillas
 * dobles o saltos de línea, se envuelve en comillas dobles y las comillas
 * internas se duplican. En caso contrario se devuelve tal cual.
 */
function escapeCsvValue(value: string): string {
  const needsQuoting =
    value.includes(SEPARATOR) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** Une un arreglo de celdas ya en texto en una fila CSV escapada. */
function toCsvRow(cells: string[]): string {
  return cells.map(escapeCsvValue).join(SEPARATOR);
}

/**
 * Construye el texto CSV de la plantilla.
 *
 * - Primera fila (cabecera): `label ?? key` de cada campo, en el orden provisto (R5).
 * - Segunda fila (ejemplos): solo si al menos un campo aporta `example`; los
 *   campos sin ejemplo quedan como celda vacía alineada a su columna (R6).
 * - Todos los valores se escapan como CSV válido (R7).
 *
 * @throws si `fields` está vacío (el consumidor deshabilita el botón vía R20,
 * pero la utilidad protege su contrato de uso).
 */
export function buildCsvTemplate(fields: CsvTemplateField[]): string {
  if (fields.length === 0) {
    throw new Error(
      "buildCsvTemplate: se requiere al menos un campo para generar la plantilla",
    );
  }

  const header = toCsvRow(fields.map((field) => field.label ?? field.key));

  const hasAnyExample = fields.some(
    (field) => field.example !== undefined && field.example !== null,
  );
  if (!hasAnyExample) {
    return header;
  }

  const exampleRow = toCsvRow(fields.map((field) => field.example ?? ""));
  return `${header}${ROW_DELIMITER}${exampleRow}`;
}

// ---------------------------------------------------------------------------
// Generador de HOJA DE DATOS (N filas), hermano del de plantilla.
// Feature 151 (design.md §3.1): la descarga de un dataset necesita el equivalente
// CSV de `buildXlsxRows`, que hasta hoy solo existia para xlsx. Nace AL LADO de
// `buildCsvTemplate` y reutiliza su escapado (`escapeCsvValue`/`toCsvRow`) y su
// `ROW_DELIMITER`, exactamente el movimiento que ya hizo `xlsx-template.ts`.
// ---------------------------------------------------------------------------

/** Definicion de una columna de datos: clave del dato + cabecera visible. Espejo de `XlsxColumn`. */
export interface CsvColumn {
  /** Clave con la que se busca el valor en cada fila. */
  key: string;
  /** Texto de la celda de cabecera (primera linea). */
  header: string;
}

/**
 * Valor admitido en una celda de datos. `null` -> celda VACIA (no la cadena
 * "null", no 0). Espejo deliberado de `XlsxCellValue`.
 */
export type CsvCellValue = string | number | null;

/** Texto de una celda: `null`/ausente -> vacio (R6); `number` -> su representacion decimal. */
function cellToText(value: CsvCellValue | undefined): string {
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? String(value) : value;
}

/**
 * Construye el texto CSV de una hoja de DATOS: una linea de cabecera mas una
 * linea por elemento de `rows`, en el orden recibido (R4).
 *
 * - Solo se emiten las columnas declaradas y en su orden: cualquier otra clave
 *   presente en una fila se IGNORA (R5), igual que en `buildXlsxRows`.
 * - Un valor `null`/ausente deja la celda vacia, sin texto de relleno (R6).
 * - Todos los valores se escapan como CSV valido: separador, comillas y saltos
 *   de linea incluidos (R4).
 *
 * @throws si `columns` esta vacio (mismo contrato defensivo que
 * `buildCsvTemplate` y `buildXlsxRows` — R9).
 */
export function buildCsvRows(
  columns: CsvColumn[],
  rows: Array<Record<string, CsvCellValue>>,
): string {
  if (columns.length === 0) {
    throw new Error(
      "buildCsvRows: se requiere al menos una columna para generar la hoja",
    );
  }

  const lines = [toCsvRow(columns.map((column) => column.header))];
  for (const row of rows) {
    lines.push(toCsvRow(columns.map((column) => cellToText(row[column.key]))));
  }
  return lines.join(ROW_DELIMITER);
}
