import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";

import {
  buildManifiestoXlsx,
  COLUMNAS_MANIFIESTO,
  manifiestoFileName,
} from "@/lib/utils/manifiesto-xlsx";
import type { ManifiestoFilaDTO } from "@/lib/types/manifiesto";

// Feature 148 (T17) — generador del binario del manifiesto: las columnas y su orden, R13
// (XLSX válido y recargable, una sola hoja), R14 (nombre del archivo) y R17 (sin filas no se
// genera nada).
//
// Feature 160/R28b: el conjunto de columnas es ABIERTO. Los asertos de "exactamente 11
// columnas" que tenía esta suite se RETIRARON a propósito (design 160 §6.3): afirmaban una
// cardinalidad que ya no es la regla y hacían que agregar un dato de la orden rompiera la
// suite. Lo que se verifica ahora es que ciertas columnas ESTÁN, con su clave y su orden
// relativo — y que lo prohibido (ids internos, banderas de borrado) sigue fuera.

/** Índice 1-based de una columna del manifiesto por su `key` (sin fijar cardinalidad). */
function colDe(key: string): number {
  const i = COLUMNAS_MANIFIESTO.findIndex((c) => c.key === key);
  if (i < 0) throw new Error(`columna ${key} ausente de COLUMNAS_MANIFIESTO`);
  return i + 1;
}

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
    producto: "Camiseta talla M",
    monto: 15000,
    intentos: 0, // feature 160/R28a: numérico y NO nullable (sin intentos -> 0)
    origen: "Bodega central",
    destino: "Limón",
    responsable: "Beto Mensajero",
    fecha: "2026-07-28",
    ...over,
  };
}

describe("manifiesto-xlsx (feature 148)", () => {
  // Feature 160/R28b: presencia y ORDEN RELATIVO, nunca cardinalidad.
  it("R28b: la cabecera trae las columnas conocidas, en su orden relativo", async () => {
    const workbook = await loadWorkbook(await buildManifiestoXlsx([makeFila()]));
    const worksheet = workbook.worksheets[0];
    const cabecera = rowValues(worksheet, 1, COLUMNAS_MANIFIESTO.length);

    const esperadas = [
      "num_guia",
      "num_remision",
      "destinatario",
      "telefono",
      "direccion",
      "zona",
      "monto",
      "intentos", // feature 160/R28a
      "origen",
      "destino",
      "responsable",
      "fecha",
    ];
    for (const h of esperadas) expect(cabecera).toContain(h);
    // Orden relativo estable: la secuencia de las conocidas es EXACTAMENTE esta, aunque
    // mañana se sumen otras.
    expect(cabecera.filter((h) => esperadas.includes(h))).toEqual(esperadas);
    // La cabecera del archivo y la declaracion de columnas no pueden divergir.
    expect(cabecera).toEqual(COLUMNAS_MANIFIESTO.map((c) => c.header));
  });

  // Feature 160/R28a: en Excel una celda VACIA no es `0`. Este test es el que garantiza que la
  // tabla de la UI y el archivo digan lo MISMO del mismo hecho.
  it("R28a: la columna de intentos emite el numero, y `0` cuando no hay intentos", async () => {
    const workbook = await loadWorkbook(
      await buildManifiestoXlsx([makeFila({ intentos: 3 }), makeFila({ intentos: 0 })]),
    );
    const worksheet = workbook.worksheets[0];
    const col = colDe("intentos");

    expect(worksheet.getRow(2).getCell(col).value).toBe(3);
    // `0` viaja como NUMERO cero, no como celda vacia ni como texto.
    expect(worksheet.getRow(3).getCell(col).value).toBe(0);
    expect(worksheet.getRow(3).getCell(col).value).not.toBeNull();
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

    expect(rowValues(worksheet, 2, COLUMNAS_MANIFIESTO.length)).toEqual([
      "2002",
      "REM-001",
      "Ana Pérez",
      "88880000",
      "Calle 1, casa 2",
      "Guápiles",
      "Camiseta talla M",
      "12500.5",
      "0", // feature 160/R28a: intentos
      "Bodega central",
      "Guápiles",
      "Ana Mensajera",
      "2026-07-28",
    ]);
    // El monto viaja como NÚMERO, no como texto (sumable en la hoja).
    expect(worksheet.getRow(2).getCell(colDe("monto")).value).toBe(12500.5);
  });

  it("R5/R7: sin guía y sin monto las celdas quedan VACÍAS (sin texto inventado)", async () => {
    const workbook = await loadWorkbook(
      await buildManifiestoXlsx([
        makeFila({ numGuia: null, monto: null, direccion: null }),
      ]),
    );
    const worksheet = workbook.worksheets[0];

    expect(worksheet.getRow(2).getCell(colDe("numGuia")).value ?? "").toBe("");
    expect(worksheet.getRow(2).getCell(colDe("monto")).value ?? "").toBe("");
    expect(worksheet.getRow(2).getCell(colDe("direccion")).value ?? "").toBe("");
    // …y la fila sigue completa en el resto de columnas (no aborta por un hueco).
    expect(worksheet.getRow(2).getCell(colDe("numRemision")).value).toBe("REM-001");
    // Feature 160/R28a: el CONTRASTE — `intentos` NO se vacia, emite `0`.
    expect(worksheet.getRow(2).getCell(colDe("intentos")).value).toBe(0);
  });

  // Feature 160/R28: el conjunto de columnas es abierto, pero el lado PROHIBITIVO del R11 de
  // la 148 sigue vigente: un campo que no esta declarado en `COLUMNAS_MANIFIESTO` no se emite.
  it("R11 (vigente): un campo NO declarado en las columnas NO llega al archivo", async () => {
    const conExtra = {
      ...makeFila(),
      ordenId: "id-interno-uuid",
      deletedAt: null,
    } as ManifiestoFilaDTO;

    const workbook = await loadWorkbook(await buildManifiestoXlsx([conExtra]));
    const worksheet = workbook.worksheets[0];

    expect(rowValues(worksheet, 2, COLUMNAS_MANIFIESTO.length + 1).join("|")).not.toContain(
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
