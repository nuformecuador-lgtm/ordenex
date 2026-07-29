import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";

import {
  buildManifiestoXlsx,
  COLUMNAS_MANIFIESTO,
  manifiestoFileName,
} from "@/lib/utils/manifiesto-xlsx";
import type { ManifiestoFilaDTO } from "@/lib/types/manifiesto";

// Feature 148 (T17) — generador del binario del manifiesto: R2 (las 11 columnas en
// orden), R13 (XLSX válido y recargable, una sola hoja), R14 (nombre del archivo) y
// R17 (sin filas no se genera nada).

/** Recarga el binario con la misma librería (round-trip real, sin dobles). */
async function loadWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  return workbook;
}

function rowValues(
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  count: number,
): string[] {
  const row = worksheet.getRow(rowNumber);
  const values: string[] = [];
  for (let col = 1; col <= count; col++) {
    const value = row.getCell(col).value;
    values.push(value === null || value === undefined ? "" : String(value));
  }
  return values;
}

function makeFila(over: Partial<ManifiestoFilaDTO> = {}): ManifiestoFilaDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Ana Pérez",
    telefono: "88880000",
    direccion: "Calle 1, casa 2",
    zona: "Limón",
    monto: 15000,
    origen: "Bodega central",
    destino: "Limón",
    responsable: "Beto Mensajero",
    fecha: "2026-07-28",
    ...over,
  };
}

describe("manifiesto-xlsx (feature 148)", () => {
  it("R2: la cabecera trae las 11 columnas pedidas, en el orden pedido", async () => {
    const workbook = await loadWorkbook(await buildManifiestoXlsx([makeFila()]));
    const worksheet = workbook.worksheets[0];

    expect(rowValues(worksheet, 1, 11)).toEqual([
      "num_guia",
      "num_remision",
      "destinatario",
      "telefono",
      "direccion",
      "zona",
      "monto",
      "origen",
      "destino",
      "responsable",
      "fecha",
    ]);
    // Ni una columna más: el manifiesto es exactamente esas 11 (R2/R11).
    expect(worksheet.columnCount).toBe(11);
    expect(COLUMNAS_MANIFIESTO).toHaveLength(11);
  });

  it("R13: produce un binario XLSX recargable con UNA sola hoja", async () => {
    const buffer = await buildManifiestoXlsx([makeFila()]);
    expect(buffer.byteLength).toBeGreaterThan(0);

    const workbook = await loadWorkbook(buffer);
    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.worksheets[0].name).toBe("Manifiesto");
  });

  it("R3/R13: emite una fila de datos por orden, en el orden recibido", async () => {
    const workbook = await loadWorkbook(
      await buildManifiestoXlsx([
        makeFila({ numRemision: "REM-A" }),
        makeFila({ numRemision: "REM-B" }),
        makeFila({ numRemision: "REM-C" }),
      ]),
    );
    const worksheet = workbook.worksheets[0];

    expect(worksheet.rowCount).toBe(4); // cabecera + 3
    expect([
      worksheet.getRow(2).getCell(2).value,
      worksheet.getRow(3).getCell(2).value,
      worksheet.getRow(4).getCell(2).value,
    ]).toEqual(["REM-A", "REM-B", "REM-C"]);
  });

  it("R4/R6/R7: vuelca los valores de la fila en su columna (guía, zona por nombre, monto numérico)", async () => {
    const workbook = await loadWorkbook(
      await buildManifiestoXlsx([
        makeFila({
          numGuia: 2002,
          zona: "Guápiles",
          monto: 12500.5,
          responsable: "Ana Mensajera",
          origen: "Bodega central",
          destino: "Guápiles",
        }),
      ]),
    );
    const worksheet = workbook.worksheets[0];

    expect(rowValues(worksheet, 2, 11)).toEqual([
      "2002",
      "REM-001",
      "Ana Pérez",
      "88880000",
      "Calle 1, casa 2",
      "Guápiles",
      "12500.5",
      "Bodega central",
      "Guápiles",
      "Ana Mensajera",
      "2026-07-28",
    ]);
    // El monto viaja como NÚMERO, no como texto (sumable en la hoja).
    expect(worksheet.getRow(2).getCell(7).value).toBe(12500.5);
  });

  it("R5/R7: sin guía y sin monto las celdas quedan VACÍAS (sin texto inventado)", async () => {
    const workbook = await loadWorkbook(
      await buildManifiestoXlsx([
        makeFila({ numGuia: null, monto: null, direccion: null }),
      ]),
    );
    const worksheet = workbook.worksheets[0];

    expect(worksheet.getRow(2).getCell(1).value ?? "").toBe("");
    expect(worksheet.getRow(2).getCell(7).value ?? "").toBe("");
    expect(worksheet.getRow(2).getCell(5).value ?? "").toBe("");
    // …y la fila sigue completa en el resto de columnas (no aborta por un hueco).
    expect(worksheet.getRow(2).getCell(2).value).toBe("REM-001");
  });

  it("R11: un campo ajeno a las 11 columnas NO llega al archivo", async () => {
    const conExtra = {
      ...makeFila(),
      ordenId: "id-interno-uuid",
      deletedAt: null,
    } as ManifiestoFilaDTO;

    const workbook = await loadWorkbook(await buildManifiestoXlsx([conExtra]));
    const worksheet = workbook.worksheets[0];

    expect(worksheet.columnCount).toBe(11);
    expect(rowValues(worksheet, 2, 12).join("|")).not.toContain(
      "id-interno-uuid",
    );
  });

  it("R14: nombra el archivo manifiesto-<flujo>-<YYYY-MM-DD>.xlsx", () => {
    expect(manifiestoFileName("carga_masiva", "2026-07-28")).toBe(
      "manifiesto-carga_masiva-2026-07-28.xlsx",
    );
    expect(manifiestoFileName("devolucion_central", "2026-01-05")).toBe(
      "manifiesto-devolucion_central-2026-01-05.xlsx",
    );
  });

  it("R17: lanza si no hay filas y no produce archivo alguno", async () => {
    await expect(buildManifiestoXlsx([])).rejects.toThrow();
  });
});
