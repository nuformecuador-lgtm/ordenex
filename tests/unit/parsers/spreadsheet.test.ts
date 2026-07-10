import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseSpreadsheet } from "@/lib/parsers/spreadsheet";
import { ValidationError } from "@/lib/errors";

describe("parseSpreadsheet — CSV (R14)", () => {
  it("respeta comillas, comas escapadas y saltos de linea dentro de una celda", async () => {
    const csv = [
      "num_remision,destinatario,telefono,provincia,canton",
      '"REM-001","Perez, Ana","0991234567",Pichincha,Quito',
      '"REM-002","Linea uno\nLinea dos","0987654321",Pichincha,Rumiñahui',
    ].join("\r\n");
    const buffer = Buffer.from(csv, "utf8");

    const { rows } = await parseSpreadsheet(buffer, "csv");

    expect(rows).toHaveLength(2);
    expect(rows[0].destinatario).toBe("Perez, Ana"); // coma escapada dentro de comillas
    expect(rows[1].destinatario).toBe("Linea uno\nLinea dos"); // salto interno
    expect(rows[1].canton).toBe("Rumiñahui");
  });

  it("normaliza cabeceras con mayusculas/espacios sobrantes (R16)", async () => {
    const csv = [
      " NUM_REMISION , Destinatario ,TELEFONO,Provincia,Canton",
      "REM-010,Juan,0999999999,Pichincha,Quito",
    ].join("\r\n");
    const buffer = Buffer.from(csv, "utf8");

    const { headers, rows } = await parseSpreadsheet(buffer, "csv");

    expect(headers).toEqual(["num_remision", "destinatario", "telefono", "provincia", "canton"]);
    expect(rows[0].num_remision).toBe("REM-010");
  });
});

describe("parseSpreadsheet — XLSX (R15)", () => {
  async function buildXlsxBuffer(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Hoja 1");
    sheet.addRow(["Num_Remision", " Destinatario ", "Telefono", "Provincia", "Canton"]);
    sheet.addRow(["REM-100", "Ana", "0991112222", "Pichincha", "Quito"]);
    sheet.addRow(["REM-101", "Beto", "0993334444", "Pichincha", "Rumiñahui"]);
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  it("lee la primera hoja, cabecera en la fila 1 y filas de datos siguientes", async () => {
    const buffer = await buildXlsxBuffer();

    const { headers, rows } = await parseSpreadsheet(buffer, "xlsx");

    expect(headers).toEqual(["num_remision", "destinatario", "telefono", "provincia", "canton"]);
    expect(rows).toHaveLength(2);
    expect(rows[0].num_remision).toBe("REM-100");
    expect(rows[1].destinatario).toBe("Beto");
  });

  it("descarta filas completamente vacias", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Hoja 1");
    sheet.addRow(["num_remision", "destinatario", "telefono", "provincia", "canton"]);
    sheet.addRow(["REM-200", "Cara", "0995556666", "Pichincha", "Quito"]);
    sheet.addRow(["", "", "", "", ""]);
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { rows } = await parseSpreadsheet(buffer, "xlsx");

    expect(rows).toHaveLength(1);
  });
});

describe("parseSpreadsheet — extension no soportada (R13)", () => {
  it("rechaza con ValidationError sin intentar parsear", async () => {
    const buffer = Buffer.from("cualquier contenido", "utf8");

    await expect(parseSpreadsheet(buffer, "txt")).rejects.toBeInstanceOf(ValidationError);
    try {
      await parseSpreadsheet(buffer, "txt");
      throw new Error("no deberia llegar aqui");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      if (error instanceof ValidationError) {
        expect(error.details?.fieldErrors).toHaveProperty("file");
      }
    }
  });

  it("es insensible a mayusculas y al punto inicial en la extension", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Hoja 1");
    sheet.addRow(["num_remision", "destinatario", "telefono", "provincia", "canton"]);
    sheet.addRow(["REM-300", "Dora", "0997778888", "Pichincha", "Quito"]);
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { rows } = await parseSpreadsheet(buffer, ".XLSX");
    expect(rows).toHaveLength(1);
  });
});
