import ExcelJS from "exceljs";
import { describe, it, expect } from "vitest";

import type { DescargaColumna, DescargaFila, DescargaHoja } from "@/lib/types/descarga";
import {
  construirDescarga,
  nombreHoja,
  nombresDeHojaUnicos,
} from "@/lib/utils/descarga-dataset";
import { buildXlsxLibro, buildXlsxRows } from "@/lib/utils/xlsx-template";

// Ficha 464 (T1, design §2.1) — el generador comun con VARIAS hojas: R10, R12, R41, R42.
// Los asertos de xlsx RELEEN el binario con exceljs (round-trip real, sin dobles).

const COLUMNAS: DescargaColumna[] = [
  { clave: "fecha", encabezado: "Fecha" },
  { clave: "movimiento", encabezado: "Movimiento" },
  { clave: "monto", encabezado: "Monto" },
];

const FILAS: DescargaFila[] = [
  { fecha: "2026-09-01", movimiento: "Flete", monto: "1500.00" },
  { fecha: "2026-09-02", movimiento: "Comisión COD", monto: null },
];

const DETALLE: DescargaHoja = {
  titulo: "Detalle por orden",
  columnas: [
    { clave: "n", encabezado: "N.º" },
    { clave: "guia", encabezado: "Guía" },
    { clave: "monto", encabezado: "Monto" },
  ],
  filas: [
    { n: 1, guia: "501", monto: "1000.00" },
    { n: 1, guia: "502", monto: "500.00" },
  ],
};

const FECHA = new Date(2026, 8, 30, 10, 0);

async function leer(contenido: ArrayBuffer | string): Promise<ExcelJS.Workbook> {
  expect(typeof contenido).not.toBe("string");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(contenido as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}

function celdas(ws: ExcelJS.Worksheet): string[][] {
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const fila: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = row.getCell(c).value;
      fila.push(v === null || v === undefined ? "" : String(v));
    }
    out.push(fila);
  });
  return out;
}

describe("ficha 464 — R41: sin hojas adicionales el archivo es el de siempre", () => {
  it("una sola hoja, con el mismo nombre, columnas y celdas que el camino anterior (buildXlsxRows)", async () => {
    for (const hojasAdicionales of [undefined, [] as DescargaHoja[]]) {
      const a = await construirDescarga(
        { titulo: "Libro de la caja", columnas: COLUMNAS, filas: FILAS, ...(hojasAdicionales ? { hojasAdicionales } : {}) },
        FECHA,
      );
      const libro = await leer(a.contenido);
      expect(libro.worksheets).toHaveLength(1);

      // La referencia es el generador de UNA hoja tal como se llamaba antes de la ficha.
      const ref = await leer(
        await buildXlsxRows(
          COLUMNAS.map((c) => ({ key: c.clave, header: c.encabezado })),
          FILAS,
          nombreHoja("Libro de la caja"),
        ),
      );
      expect(libro.worksheets[0].name).toBe(ref.worksheets[0].name);
      expect(libro.worksheets[0].name).toBe("Libro de la caja");
      expect(celdas(libro.worksheets[0])).toEqual(celdas(ref.worksheets[0]));
      expect(celdas(libro.worksheets[0])).toEqual([
        ["Fecha", "Movimiento", "Monto"],
        ["2026-09-01", "Flete", "1500.00"],
        ["2026-09-02", "Comisión COD", ""],
      ]);
      expect(a.nombreArchivo).toBe("libro-de-la-caja-2026-09-30.xlsx");
    }
  });

  it("csv sin hojas adicionales (o con la lista vacia) sigue produciendo el csv de siempre", async () => {
    const sin = await construirDescarga({ tipo: "csv", titulo: "T", columnas: COLUMNAS, filas: FILAS }, FECHA);
    const vacia = await construirDescarga(
      { tipo: "csv", titulo: "T", columnas: COLUMNAS, filas: FILAS, hojasAdicionales: [] },
      FECHA,
    );
    expect(vacia).toEqual(sin);
  });

  it("buildXlsxRows delega en buildXlsxLibro: las dos dan la misma hoja", async () => {
    const cols = COLUMNAS.map((c) => ({ key: c.clave, header: c.encabezado }));
    const a = await leer(await buildXlsxRows(cols, FILAS, "Hoja"));
    const b = await leer(await buildXlsxLibro([{ nombre: "Hoja", columns: cols, rows: FILAS }]));
    expect(a.worksheets.map((w) => w.name)).toEqual(b.worksheets.map((w) => w.name));
    expect(celdas(a.worksheets[0])).toEqual(celdas(b.worksheets[0]));
    expect(a.worksheets[0].getRow(1).font?.bold).toBe(true);
    expect(b.worksheets[0].getRow(1).font?.bold).toBe(true);
  });
});

describe("ficha 464 — R10: con una hoja adicional el libro lleva dos hojas, en orden", () => {
  it("la principal primero y «Detalle por orden» despues, cada una con sus columnas y filas", async () => {
    const a = await construirDescarga(
      { titulo: "Libro de la caja", columnas: COLUMNAS, filas: FILAS, hojasAdicionales: [DETALLE] },
      FECHA,
    );
    const libro = await leer(a.contenido);
    expect(libro.worksheets.map((w) => w.name)).toEqual(["Libro de la caja", "Detalle por orden"]);
    expect(celdas(libro.worksheets[0])).toEqual([
      ["Fecha", "Movimiento", "Monto"],
      ["2026-09-01", "Flete", "1500.00"],
      ["2026-09-02", "Comisión COD", ""],
    ]);
    expect(celdas(libro.worksheets[1])).toEqual([
      ["N.º", "Guía", "Monto"],
      ["1", "501", "1000.00"],
      ["1", "502", "500.00"],
    ]);
    expect(libro.worksheets[1].getRow(1).font?.bold).toBe(true);
    // El nombre del ARCHIVO sigue saliendo del titulo de la principal.
    expect(a.nombreArchivo).toBe("libro-de-la-caja-2026-09-30.xlsx");
  });

  it("R24: una hoja adicional sin filas sale con su fila de encabezados y nada mas", async () => {
    const a = await construirDescarga(
      { titulo: "Libro", columnas: COLUMNAS, filas: FILAS, hojasAdicionales: [{ ...DETALLE, filas: [] }] },
      FECHA,
    );
    const libro = await leer(a.contenido);
    expect(celdas(libro.worksheets[1])).toEqual([["N.º", "Guía", "Monto"]]);
  });

  it("una hoja adicional sin columnas no produce archivo", async () => {
    await expect(
      construirDescarga(
        { titulo: "Libro", columnas: COLUMNAS, filas: FILAS, hojasAdicionales: [{ ...DETALLE, columnas: [] }] },
        FECHA,
      ),
    ).rejects.toThrow(/al menos una columna/);
  });
});

describe("ficha 464 — R12: csv con hojas adicionales no produce archivo", () => {
  it("lanza en vez de devolver un csv al que le falta la hoja de detalle", async () => {
    await expect(
      construirDescarga(
        { tipo: "csv", titulo: "Libro", columnas: COLUMNAS, filas: FILAS, hojasAdicionales: [DETALLE] },
        FECHA,
      ),
    ).rejects.toThrow(/solo existen en xlsx/);
  });
});

describe("ficha 464 — R42: nombres de hoja validos para Excel y distintos entre si", () => {
  it("dos titulos iguales (sin distinguir mayusculas) dan dos pestañas distintas", async () => {
    const a = await construirDescarga(
      {
        titulo: "Detalle",
        columnas: COLUMNAS,
        filas: FILAS,
        hojasAdicionales: [
          { ...DETALLE, titulo: "detalle" },
          { ...DETALLE, titulo: "Detalle" },
        ],
      },
      FECHA,
    );
    const libro = await leer(a.contenido);
    expect(libro.worksheets.map((w) => w.name)).toEqual(["Detalle", "detalle (2)", "Detalle (3)"]);
  });

  it("titulos que se pasan de 31 caracteres y chocan: el sufijo cabe y todos son validos", async () => {
    const largo = "Movimientos y detalle por orden de la tienda Ñandú / Sur";
    const a = await construirDescarga(
      {
        titulo: largo,
        columnas: COLUMNAS,
        filas: FILAS,
        hojasAdicionales: [{ ...DETALLE, titulo: largo }],
      },
      FECHA,
    );
    const libro = await leer(a.contenido);
    const nombres = libro.worksheets.map((w) => w.name);
    expect(nombres).toHaveLength(2);
    expect(new Set(nombres.map((n) => n.toLowerCase())).size).toBe(2);
    for (const n of nombres) {
      expect(n.length).toBeLessThanOrEqual(31);
      expect(n).not.toMatch(/[*?:/\\[\]]/);
    }
    expect(nombres[0]).toBe(nombreHoja(largo));
    expect(nombres[1].endsWith(" (2)")).toBe(true);
  });

  it("nombresDeHojaUnicos: identidad con nombres distintos; sufijos crecientes con repetidos", () => {
    expect(nombresDeHojaUnicos(["A", "B"])).toEqual(["A", "B"]);
    expect(nombresDeHojaUnicos(["Datos"])).toEqual(["Datos"]);
    expect(nombresDeHojaUnicos(["A", "a", "A", "A (2)"])).toEqual(["A", "a (2)", "A (3)", "A (2) (2)"]);
    const treintaYUno = "x".repeat(31);
    const [p, s] = nombresDeHojaUnicos([treintaYUno, treintaYUno]);
    expect(p).toBe(treintaYUno);
    expect(s).toBe(`${"x".repeat(26)}… (2)`);
    expect(s.length).toBe(31);
  });
});
