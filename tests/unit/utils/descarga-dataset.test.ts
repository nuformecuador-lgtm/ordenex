import { readFileSync } from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";
import { describe, it, expect } from "vitest";

import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import { construirDescarga, CSV_MIME } from "@/lib/utils/descarga-dataset";
import { XLSX_MIME } from "@/lib/utils/xlsx-template";

// Feature 151 (T4) — despachador comun de la descarga: R1, R2, R3, R5, R6, R7, R8, R9, R10.
// Los asertos de xlsx RELEEN el libro con la misma libreria (round-trip real, sin dobles).

const COLUMNAS: DescargaColumna[] = [
  { clave: "numGuia", encabezado: "Nº Guía" },
  { clave: "destinatario", encabezado: "Destinatario" },
  { clave: "monto", encabezado: "Monto a cobrar" },
];

const FILAS: DescargaFila[] = [
  { numGuia: 1001, destinatario: "Ana Pérez", monto: 15000 },
  { numGuia: 1002, destinatario: "Beto Mora", monto: null },
  { numGuia: 1003, destinatario: "Cira Solís", monto: 7500 },
];

const FECHA = new Date(2026, 6, 29, 10, 30); // 2026-07-29, hora local

/** Recarga el binario con la misma libreria y devuelve la unica hoja. */
async function leerLibro(contenido: ArrayBuffer | string) {
  expect(typeof contenido).not.toBe("string");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    contenido as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  return workbook;
}

/** Valores de una fila del libro, como texto, para las `count` primeras columnas. */
function valoresFila(
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  count: number,
): string[] {
  const row = worksheet.getRow(rowNumber);
  const valores: string[] = [];
  for (let col = 1; col <= count; col++) {
    const value = row.getCell(col).value;
    valores.push(value === null || value === undefined ? "" : String(value));
  }
  return valores;
}

/** Parsea un CSV simple respetando el envoltorio de comillas dobles. */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (inQuotes) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char === "\r") {
      // ignorar; el par \r\n cierra fila en el \n
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

describe("construirDescarga", () => {
  it("genera xlsx cuando no se declara tipo de archivo", async () => {
    const archivo = await construirDescarga(
      { titulo: "Órdenes", columnas: COLUMNAS, filas: FILAS },
      FECHA,
    );

    expect(archivo.mime).toBe(XLSX_MIME);
    expect(archivo.nombreArchivo.endsWith(".xlsx")).toBe(true);
    // No es texto: es el binario del libro, y se relee como tal.
    const workbook = await leerLibro(archivo.contenido);
    expect(workbook.worksheets).toHaveLength(1);
  });

  it("produce un libro de una hoja con cabecera y una fila por elemento, en orden", async () => {
    const archivo = await construirDescarga(
      { tipo: "xlsx", titulo: "Órdenes", columnas: COLUMNAS, filas: FILAS },
      FECHA,
    );

    const workbook = await leerLibro(archivo.contenido);
    expect(workbook.worksheets).toHaveLength(1);

    const worksheet = workbook.worksheets[0];
    expect(valoresFila(worksheet, 1, 3)).toEqual([
      "Nº Guía",
      "Destinatario",
      "Monto a cobrar",
    ]);
    // Una fila por elemento, en el MISMO orden recibido (+1 por la cabecera).
    expect(worksheet.rowCount).toBe(FILAS.length + 1);
    expect(valoresFila(worksheet, 2, 3)).toEqual(["1001", "Ana Pérez", "15000"]);
    expect(valoresFila(worksheet, 3, 3)).toEqual(["1002", "Beto Mora", ""]);
    expect(valoresFila(worksheet, 4, 3)).toEqual(["1003", "Cira Solís", "7500"]);
  });

  it("produce texto csv con cabecera y una línea por elemento cuando el tipo es csv", async () => {
    const archivo = await construirDescarga(
      { tipo: "csv", titulo: "Órdenes", columnas: COLUMNAS, filas: FILAS },
      FECHA,
    );

    expect(typeof archivo.contenido).toBe("string");
    const filas = parseCsv(archivo.contenido as string);

    expect(filas).toHaveLength(FILAS.length + 1);
    expect(filas[0]).toEqual(["Nº Guía", "Destinatario", "Monto a cobrar"]);
    expect(filas[1]).toEqual(["1001", "Ana Pérez", "15000"]);
    expect(filas[3]).toEqual(["1003", "Cira Solís", "7500"]);
  });

  it("emite solo las columnas declaradas y en su orden, ignorando claves extra", async () => {
    const filas: DescargaFila[] = [
      {
        monto: 500,
        destinatario: "Ana Pérez",
        numGuia: 1001,
        id: "uuid-interno",
        deletedAt: "2026-01-01",
      },
    ];

    const csv = await construirDescarga(
      { tipo: "csv", titulo: "Órdenes", columnas: COLUMNAS, filas },
      FECHA,
    );
    const parseado = parseCsv(csv.contenido as string);

    // El orden es el de COLUMNAS, no el de las claves del objeto fila.
    expect(parseado[0]).toEqual(["Nº Guía", "Destinatario", "Monto a cobrar"]);
    expect(parseado[1]).toEqual(["1001", "Ana Pérez", "500"]);
    expect(csv.contenido as string).not.toContain("uuid-interno");
    expect(csv.contenido as string).not.toContain("deletedAt");

    const xlsx = await construirDescarga(
      { tipo: "xlsx", titulo: "Órdenes", columnas: COLUMNAS, filas },
      FECHA,
    );
    const worksheet = (await leerLibro(xlsx.contenido)).worksheets[0];
    expect(worksheet.columnCount).toBe(COLUMNAS.length);
    expect(valoresFila(worksheet, 2, 4)).toEqual([
      "1001",
      "Ana Pérez",
      "500",
      "",
    ]);
  });

  it("deja vacía la celda de una columna que la fila no aporta", async () => {
    const filas: DescargaFila[] = [{ numGuia: 1001 }, { destinatario: null }];

    const csv = await construirDescarga(
      { tipo: "csv", titulo: "Órdenes", columnas: COLUMNAS, filas },
      FECHA,
    );
    const parseado = parseCsv(csv.contenido as string);

    expect(parseado[1]).toEqual(["1001", "", ""]);
    expect(parseado[2]).toEqual(["", "", ""]);
    expect(csv.contenido as string).not.toContain("null");
    expect(csv.contenido as string).not.toContain("undefined");

    const xlsx = await construirDescarga(
      { tipo: "xlsx", titulo: "Órdenes", columnas: COLUMNAS, filas },
      FECHA,
    );
    const worksheet = (await leerLibro(xlsx.contenido)).worksheets[0];
    expect(valoresFila(worksheet, 2, 3)).toEqual(["1001", "", ""]);
    expect(valoresFila(worksheet, 3, 3)).toEqual(["", "", ""]);
  });

  it("devuelve el MIME y la extensión correspondientes al tipo", async () => {
    const xlsx = await construirDescarga(
      { tipo: "xlsx", titulo: "Órdenes", columnas: COLUMNAS, filas: FILAS },
      FECHA,
    );
    const csv = await construirDescarga(
      { tipo: "csv", titulo: "Órdenes", columnas: COLUMNAS, filas: FILAS },
      FECHA,
    );

    expect(xlsx.mime).toBe(XLSX_MIME);
    expect(xlsx.nombreArchivo).toBe("ordenes-2026-07-29.xlsx");
    expect(csv.mime).toBe(CSV_MIME);
    expect(csv.mime).toContain("charset=utf-8");
    expect(csv.nombreArchivo).toBe("ordenes-2026-07-29.csv");
  });

  it("usa el título como nombre de hoja y como base del nombre de archivo", async () => {
    const archivo = await construirDescarga(
      {
        titulo: "Órdenes en bodega",
        columnas: COLUMNAS,
        filas: FILAS,
      },
      FECHA,
    );

    const workbook = await leerLibro(archivo.contenido);
    expect(workbook.worksheets[0].name).toBe("Órdenes en bodega");
    expect(archivo.nombreArchivo).toBe("ordenes-en-bodega-2026-07-29.xlsx");
  });

  it("lanza si no hay columnas declaradas", async () => {
    await expect(
      construirDescarga(
        { titulo: "Órdenes", columnas: [], filas: FILAS },
        FECHA,
      ),
    ).rejects.toThrow();

    await expect(
      construirDescarga(
        { tipo: "csv", titulo: "Órdenes", columnas: [], filas: FILAS },
        FECHA,
      ),
    ).rejects.toThrow();
  });

  it("se ejecuta sin DOM: el módulo no referencia document ni window", () => {
    const fuente = readFileSync(
      path.join(process.cwd(), "lib/utils/descarga-dataset.ts"),
      "utf8",
    );

    expect(fuente).not.toMatch(/\bdocument\b/);
    expect(fuente).not.toMatch(/\bwindow\b/);
    expect(fuente).not.toMatch(/from ["']react["']/);
    // `exceljs` solo entra por el import dinamico que vive dentro de buildXlsxRows:
    // aqui no hay import suyo de ninguna clase (ni estatico ni dinamico).
    expect(fuente).not.toMatch(/from ["']exceljs["']/);
    expect(fuente).not.toMatch(/import\(["']exceljs["']\)/);
    expect(fuente).not.toMatch(/require\(["']exceljs["']\)/);
  });
});
