import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";

import { buildXlsxRows, XLSX_MIME, type XlsxTemplateField } from "@/lib/utils/xlsx-template";
import {
  ERRORES_EXPORT_FIELDS,
  COLUMNA_MOTIVO_ERROR,
} from "@/app/(app)/ordenes/_components/carga-masiva-export-errores";

/** Recarga el binario con la misma librería y devuelve la primera hoja. */
async function loadFirstWorksheet(buffer: ArrayBuffer): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("el workbook no tiene hojas");
  return worksheet;
}

/** Lee los valores de una fila como texto plano, columna por columna. */
function rowValues(worksheet: ExcelJS.Worksheet, rowNumber: number, count: number): string[] {
  const row = worksheet.getRow(rowNumber);
  const values: string[] = [];
  for (let col = 1; col <= count; col++) {
    const value = row.getCell(col).value;
    values.push(value === null || value === undefined ? "" : String(value));
  }
  return values;
}

const CLAVES_PLANTILLA = [
  "destinatario",
  "telefono",
  "direccion_destinatario",
  "monto_cobrar",
  "producto",
  "num_remision",
  "peso",
  "notas",
];

describe("buildXlsxRows (feature 143)", () => {
  it("R1/R2: cabecera = claves máquina en orden, con motivo_error como ÚLTIMA columna", async () => {
    const worksheet = await loadFirstWorksheet(
      await buildXlsxRows(ERRORES_EXPORT_FIELDS, []),
    );
    expect(rowValues(worksheet, 1, ERRORES_EXPORT_FIELDS.length)).toEqual([
      ...CLAVES_PLANTILLA,
      COLUMNA_MOTIVO_ERROR,
    ]);
  });

  it("R2: ningún campo del export declara `label` (la cabecera NUNCA diverge de la clave)", () => {
    // Guard directo del bug de la feature 58: un label/sufijo en la cabecera
    // rompería el round-trip descargar → corregir → subir.
    for (const field of ERRORES_EXPORT_FIELDS) {
      expect(field.label ?? field.key).toBe(field.key);
    }
  });

  it("R3: emite una fila de datos por registro, en orden", async () => {
    const fields: XlsxTemplateField[] = [{ key: "a" }, { key: "b" }];
    const worksheet = await loadFirstWorksheet(
      await buildXlsxRows(fields, [
        { a: "1", b: "2" },
        { a: "3", b: "4" },
        { a: "5", b: "6" },
      ]),
    );
    expect(worksheet.rowCount).toBe(4); // cabecera + 3
    expect(rowValues(worksheet, 2, 2)).toEqual(["1", "2"]);
    expect(rowValues(worksheet, 3, 2)).toEqual(["3", "4"]);
    expect(rowValues(worksheet, 4, 2)).toEqual(["5", "6"]);
  });

  it("R4: celda vacía si la clave no está en el registro (sin desplazar columnas)", async () => {
    const fields: XlsxTemplateField[] = [{ key: "a" }, { key: "b" }, { key: "c" }];
    const worksheet = await loadFirstWorksheet(
      await buildXlsxRows(fields, [{ a: "1", c: "3" }]),
    );
    expect(rowValues(worksheet, 2, 3)).toEqual(["1", "", "3"]);
  });

  it("R1: la cabecera está en negrita y el binario es recargable por ExcelJS", async () => {
    const buffer = await buildXlsxRows([{ key: "a" }], [{ a: "x" }]);
    expect(buffer.byteLength).toBeGreaterThan(0);
    const worksheet = await loadFirstWorksheet(buffer);
    expect(worksheet.getRow(1).getCell(1).font?.bold).toBe(true);
  });

  it("R1: una sola hoja, aunque haya muchas filas", async () => {
    const workbook = new ExcelJS.Workbook();
    const buffer = await buildXlsxRows(ERRORES_EXPORT_FIELDS, [
      { num_remision: "A", motivo_error: "Fila 1 — x" },
      { num_remision: "B", motivo_error: "Fila 2 — y" },
    ]);
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.worksheets).toHaveLength(1);
  });

  it("contrato: rechaza si se invoca sin campos", async () => {
    await expect(buildXlsxRows([], [{ a: "1" }])).rejects.toThrow();
  });

  it("R21: expone el MIME de XLSX (única forma de descarga; no hay variante CSV)", () => {
    expect(XLSX_MIME).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("R19: el módulo de composición del export NO importa exceljs en top-level", () => {
    // exceljs solo puede entrar por import dinámico DENTRO de buildXlsxRows, o
    // acabaría en el bundle inicial del modal de carga masiva.
    const fuente = readFileSync(
      "app/(app)/ordenes/_components/carga-masiva-export-errores.ts",
      "utf-8",
    );
    expect(fuente).not.toMatch(/from\s+["']exceljs["']/);
    expect(fuente).not.toMatch(/require\(["']exceljs["']\)/);
  });

  it("R19: xlsx-template importa exceljs SOLO de forma dinámica", () => {
    const fuente = readFileSync("lib/utils/xlsx-template.ts", "utf-8");
    expect(fuente).not.toMatch(/^\s*import\s+.*from\s+["']exceljs["']/m);
    expect(fuente).toMatch(/await import\(["']exceljs["']\)/);
  });
});
