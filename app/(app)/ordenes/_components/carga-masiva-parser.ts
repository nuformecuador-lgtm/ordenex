// Parser de carga masiva en el NAVEGADOR. Convierte un archivo CSV/XLSX a filas
// normalizadas SIN enviarlo al servidor (evita el límite de body de Vercel). Las
// filas luego viajan como JSON en lotes. Mantiene paridad con el parser servidor
// (`lib/parsers/spreadsheet.ts`): cabecera lowercase+trim, descarta filas vacías,
// numera 1-based sobre las filas de datos no vacías.
import type { RawRow } from "@/lib/parsers/spreadsheet";

/** Una fila parseada con su línea original (1-based sobre datos no vacíos). */
export interface FilaParseada {
  row: RawRow;
  linea: number;
}

export interface ArchivoParseado {
  /** Cabeceras detectadas, normalizadas (lowercase+trim). */
  headers: string[];
  /** Filas de datos (sin cabecera); filas totalmente vacías descartadas. */
  filas: FilaParseada[];
}

/** Error de parseo legible para mostrar en una alerta. */
export class ParseArchivoError extends Error {}

/** Extensión en minúsculas sin punto (p. ej. "csv"), o "" si no hay. */
export function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf(".");
  return punto >= 0 ? nombre.slice(punto + 1).toLowerCase() : "";
}

/**
 * Parser CSV tolerante (estilo RFC 4180): respeta comillas dobles, comas y
 * saltos de línea dentro de campos entrecomillados, y `""` como comilla escapada.
 */
export function parseCsv(text: string): string[][] {
  // Descarta BOM inicial si viene.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const filas: string[][] = [];
  let campo = "";
  let fila: string[] = [];
  let enComillas = false;
  let algo = false; // hubo algún carácter/campo en la fila en curso

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (enComillas) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }
    if (c === '"') {
      enComillas = true;
      algo = true;
    } else if (c === ",") {
      fila.push(campo);
      campo = "";
      algo = true;
    } else if (c === "\r") {
      // se maneja con el \n siguiente
    } else if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
      algo = false;
    } else {
      campo += c;
      algo = true;
    }
  }
  // Último campo/fila (archivo sin salto final).
  if (algo || campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

/** Coacciona un valor de celda de exceljs a texto plano (rich text/fórmula/etc.). */
function celdaATexto(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join("");
    }
    if ("text" in v && "hyperlink" in v) return String(v.text ?? "");
    if ("formula" in v) {
      const result = v.result;
      if (result === undefined || result === null || typeof result === "object") return "";
      return celdaATexto(result);
    }
  }
  return "";
}

/** Convierte una matriz (fila 0 = cabecera) al modelo `ArchivoParseado`. */
export function matrizAArchivo(matriz: string[][]): ArchivoParseado {
  const [cabecera = [], ...datos] = matriz;
  const headerPorCol = new Map<number, string>();
  cabecera.forEach((h, idx) => {
    const norm = (h ?? "").trim().toLowerCase();
    if (norm !== "") headerPorCol.set(idx, norm);
  });

  const filas: FilaParseada[] = [];
  let linea = 0;
  for (const datoFila of datos) {
    const record: RawRow = {};
    let hasValue = false;
    for (const [col, header] of headerPorCol) {
      const raw = (datoFila[col] ?? "").trim();
      record[header] = raw;
      if (raw !== "") hasValue = true;
    }
    if (hasValue) {
      linea++;
      filas.push({ row: record, linea });
    }
  }
  return { headers: [...headerPorCol.values()], filas };
}

/** Lee un XLSX a matriz con exceljs (import dinámico: fuera del bundle inicial). */
async function xlsxAMatriz(file: File): Promise<string[][]> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new ParseArchivoError("el archivo no contiene hojas");

  const matriz: string[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const arr: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      arr[colNumber - 1] = celdaATexto(cell.value);
    });
    matriz.push(arr);
  });
  return matriz;
}

/**
 * Parsea un archivo CSV o XLSX (según su extensión) a filas normalizadas en el
 * navegador. Lanza `ParseArchivoError` con mensaje legible ante formatos no
 * soportados o archivos ilegibles.
 */
export async function parseArchivo(file: File): Promise<ArchivoParseado> {
  const ext = extensionDe(file.name);
  if (ext === "csv") {
    return matrizAArchivo(parseCsv(await file.text()));
  }
  if (ext === "xlsx") {
    return matrizAArchivo(await xlsxAMatriz(file));
  }
  throw new ParseArchivoError("tipo de archivo no soportado; use .csv o .xlsx");
}
