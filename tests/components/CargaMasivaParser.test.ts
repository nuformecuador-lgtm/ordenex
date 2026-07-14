import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";

import {
  parseCsv,
  matrizAArchivo,
  extensionDe,
  parseArchivo,
  ParseArchivoError,
} from "@/app/(app)/ordenes/_components/carga-masiva-parser";

describe("carga-masiva-parser — extensionDe", () => {
  it("devuelve la extensión en minúsculas sin punto", () => {
    expect(extensionDe("carga.CSV")).toBe("csv");
    expect(extensionDe("archivo.xlsx")).toBe("xlsx");
    expect(extensionDe("sin_extension")).toBe("");
  });
});

describe("carga-masiva-parser — parseCsv", () => {
  it("parsea filas y columnas simples", () => {
    const m = parseCsv("a,b,c\n1,2,3\n4,5,6");
    expect(m).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("respeta comillas: comas y saltos de línea internos, y comilla escapada", () => {
    const m = parseCsv('num,nota\n"A,1","dice ""hola""\ncon salto"\n');
    expect(m).toEqual([
      ["num", "nota"],
      ["A,1", 'dice "hola"\ncon salto'],
    ]);
  });

  it("descarta el BOM inicial", () => {
    const m = parseCsv("﻿a,b\n1,2");
    expect(m[0]).toEqual(["a", "b"]);
  });
});

describe("carga-masiva-parser — matrizAArchivo", () => {
  it("normaliza cabecera, descarta filas vacías y numera 1-based sobre datos", () => {
    const { headers, filas } = matrizAArchivo([
      [" Num_Remision ", "Destinatario", ""],
      ["REM-1", "Ana", "ignorado"],
      ["", "", ""], // fila vacía -> descartada
      ["REM-2", "Beto", ""],
    ]);

    expect(headers).toEqual(["num_remision", "destinatario"]);
    expect(filas).toEqual([
      { row: { num_remision: "REM-1", destinatario: "Ana" }, linea: 1 },
      { row: { num_remision: "REM-2", destinatario: "Beto" }, linea: 2 },
    ]);
  });

  it("ignora columnas sin cabecera", () => {
    const { headers, filas } = matrizAArchivo([
      ["num_remision", ""],
      ["REM-1", "valor-sin-header"],
    ]);
    expect(headers).toEqual(["num_remision"]);
    expect(filas[0].row).toEqual({ num_remision: "REM-1" });
  });
});

describe("carga-masiva-parser — parseArchivo", () => {
  it("parsea un CSV real (File)", async () => {
    const file = new File(["num_remision,destinatario\nREM-1,Ana\n"], "carga.csv", {
      type: "text/csv",
    });
    const { headers, filas } = await parseArchivo(file);
    expect(headers).toEqual(["num_remision", "destinatario"]);
    expect(filas).toEqual([
      { row: { num_remision: "REM-1", destinatario: "Ana" }, linea: 1 },
    ]);
  });

  it("parsea un XLSX real (File)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Hoja 1");
    ws.addRow(["num_remision", "destinatario"]);
    ws.addRow(["REM-9", "Zoe"]);
    const buffer = await wb.xlsx.writeBuffer();
    const file = new File([buffer], "carga.xlsx", { type: "application/xlsx" });

    const { headers, filas } = await parseArchivo(file);
    expect(headers).toEqual(["num_remision", "destinatario"]);
    expect(filas[0].row).toEqual({ num_remision: "REM-9", destinatario: "Zoe" });
  });

  it("rechaza extensiones no soportadas", async () => {
    const file = new File(["x"], "carga.txt", { type: "text/plain" });
    await expect(parseArchivo(file)).rejects.toBeInstanceOf(ParseArchivoError);
  });
});
