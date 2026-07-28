import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";

import {
  buildXlsxRows,
  buildXlsxTemplate,
  XLSX_MIME,
  type XlsxColumn,
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

// ---------------------------------------------------------------------------
// Feature 148 (T7/T21) — hoja de DATOS y MIME compartido
// ---------------------------------------------------------------------------

describe("XLSX_MIME (feature 148/T7, T21 no regresión)", () => {
  it("R13: es exactamente el MIME OpenXML que usaba la constante local de BulkUpload", () => {
    // Blindaje del cambio mecánico: si este literal cambia, la descarga de plantilla
    // (y la del manifiesto) dejaría de abrirse como XLSX en el sistema operativo.
    expect(XLSX_MIME).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });
});

describe("buildXlsxRows (feature 148/T7)", () => {
  const columns: XlsxColumn[] = [
    { key: "a", header: "col_a" },
    { key: "b", header: "col_b" },
  ];

  it("R13: emite la cabecera en el orden dado y una fila por elemento, recargable", async () => {
    const buffer = await buildXlsxRows(
      columns,
      [
        { a: "x1", b: 1 },
        { a: "x2", b: 2 },
      ],
      "Datos",
    );
    const worksheet = await loadFirstWorksheet(buffer);

    expect(worksheet.name).toBe("Datos");
    expect(worksheet.rowCount).toBe(3);
    expect(rowValues(worksheet, 1, 2)).toEqual(["col_a", "col_b"]);
    expect(rowValues(worksheet, 2, 2)).toEqual(["x1", "1"]);
    expect(rowValues(worksheet, 3, 2)).toEqual(["x2", "2"]);
  });

  it("R13: la cabecera va en negrita y cada columna tiene ancho legible", async () => {
    const worksheet = await loadFirstWorksheet(
      await buildXlsxRows(columns, [{ a: "x", b: null }], "Datos"),
    );

    expect(worksheet.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(worksheet.getColumn(1).width as number).toBeGreaterThanOrEqual(12);
  });

  it("R5/R7: un valor null (o ausente) deja la celda VACÍA, sin texto de relleno", async () => {
    const worksheet = await loadFirstWorksheet(
      await buildXlsxRows(columns, [{ a: null }], "Datos"),
    );

    expect(rowValues(worksheet, 2, 2)).toEqual(["", ""]);
  });

  it("R11: solo se emiten las columnas declaradas; una clave extra de la fila se ignora", async () => {
    const worksheet = await loadFirstWorksheet(
      await buildXlsxRows(columns, [{ a: "x", b: 1, secreto: "id-interno" }], "Datos"),
    );

    expect(worksheet.columnCount).toBe(2);
    expect(rowValues(worksheet, 2, 3)).toEqual(["x", "1", ""]);
  });

  it("preserva un número como número (no lo convierte a texto)", async () => {
    const worksheet = await loadFirstWorksheet(
      await buildXlsxRows(columns, [{ a: "x", b: 1500.5 }], "Datos"),
    );

    expect(worksheet.getRow(2).getCell(2).value).toBe(1500.5);
  });

  it("rechaza si se invoca sin columnas (contrato de uso)", async () => {
    await expect(buildXlsxRows([], [{ a: "x" }], "Datos")).rejects.toThrow();
  });
});
