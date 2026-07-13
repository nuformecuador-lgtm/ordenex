import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";

import {
  buildXlsxTemplate,
  type XlsxTemplateField,
} from "@/lib/utils/xlsx-template";

/**
 * Recarga el binario generado con la misma librería (round-trip, R6/R7) y
 * devuelve la primera hoja. Reutiliza el patrón de cast documentado de
 * `lib/parsers/spreadsheet.ts` para el borde de tipos de exceljs.
 */
async function loadFirstWorksheet(
  buffer: ArrayBuffer,
): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
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

describe("buildXlsxTemplate", () => {
  it("R1/R7: la cabecera respeta el orden de los campos y usa label cuando existe (round-trip)", async () => {
    const fields: XlsxTemplateField[] = [
      { key: "num_remision", label: "Nº Remisión" },
      { key: "telefono" },
      { key: "provincia", label: "Provincia" },
    ];

    const worksheet = await loadFirstWorksheet(await buildXlsxTemplate(fields));

    expect(rowValues(worksheet, 1, 3)).toEqual([
      "Nº Remisión",
      "telefono",
      "Provincia",
    ]);
  });

  it("R2: la fila de cabecera está en negrita", async () => {
    const fields: XlsxTemplateField[] = [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ];

    const worksheet = await loadFirstWorksheet(await buildXlsxTemplate(fields));

    expect(worksheet.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(worksheet.getRow(1).getCell(2).font?.bold).toBe(true);
  });

  it("R3: cada columna tiene un ancho definido y ≥ mínimo legible", async () => {
    const fields: XlsxTemplateField[] = [
      { key: "a", label: "A", example: "x" },
      { key: "descripcion_larga", label: "Descripción muy larga de columna" },
    ];

    const worksheet = await loadFirstWorksheet(await buildXlsxTemplate(fields));

    for (let col = 1; col <= fields.length; col++) {
      const width = worksheet.getColumn(col).width;
      expect(width).toBeDefined();
      expect(width as number).toBeGreaterThanOrEqual(12);
    }
  });

  it("R4: con al menos un ejemplo genera una segunda fila alineada; sin ejemplo queda vacía", async () => {
    const fields: XlsxTemplateField[] = [
      { key: "a", example: "1" },
      { key: "b" },
      { key: "c", example: "3" },
    ];

    const worksheet = await loadFirstWorksheet(await buildXlsxTemplate(fields));

    expect(worksheet.rowCount).toBe(2);
    expect(rowValues(worksheet, 1, 3)).toEqual(["a", "b", "c"]);
    expect(rowValues(worksheet, 2, 3)).toEqual(["1", "", "3"]);
  });

  it("R4: sin ningún ejemplo genera solo la fila de cabecera", async () => {
    const fields: XlsxTemplateField[] = [{ key: "a" }, { key: "b" }];

    const worksheet = await loadFirstWorksheet(await buildXlsxTemplate(fields));

    expect(worksheet.rowCount).toBe(1);
    expect(rowValues(worksheet, 1, 2)).toEqual(["a", "b"]);
  });

  it("feature 58: `required` NO altera la cabecera (sigue siendo la clave/label, sin sufijo)", async () => {
    // Regresión del bug 58: la feature 51 sufijaba la cabecera de un campo
    // `required` con ' *', lo que rompía el round-trip descargar→subir (el parser
    // identifica cada columna por su clave exacta y "distrito *" no casa con
    // "distrito"). El header debe ser SIEMPRE `label ?? key`, sin marca alguna.
    const fields: XlsxTemplateField[] = [
      { key: "distrito", label: "Distrito", required: true },
      { key: "notas", label: "Notas" },
      { key: "provincia", required: true },
    ];

    const worksheet = await loadFirstWorksheet(await buildXlsxTemplate(fields));

    expect(rowValues(worksheet, 1, 3)).toEqual(["Distrito", "Notas", "provincia"]);
  });

  it("R5: rechaza si se invoca sin campos (contrato de uso)", async () => {
    await expect(buildXlsxTemplate([])).rejects.toThrow();
  });

  it("R6/R7: devuelve un binario recargable por ExcelJS", async () => {
    const buffer = await buildXlsxTemplate([{ key: "a", label: "A" }]);
    expect(buffer.byteLength).toBeGreaterThan(0);
    // Si no fuera un XLSX válido, loadFirstWorksheet lanzaría al recargarlo.
    const worksheet = await loadFirstWorksheet(buffer);
    expect(worksheet.getRow(1).getCell(1).value).toBe("A");
  });
});
