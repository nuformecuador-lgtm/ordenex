import ExcelJS from "exceljs";
import { describe, it, expect } from "vitest";

import type { DescargaColumna, DescargaFila, DescargaHoja } from "@/lib/types/descarga";
import { construirDescarga, nombreHoja } from "@/lib/utils/descarga-dataset";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import { celdaMonto, FORMATO_EXCEL_MONTO } from "@/lib/utils/xlsx-monto";

// Ficha 468 (T2, design §5) — montos como NUMERO de Excel (R22), filas en negrita (R23/R47), el csv
// intacto (R58) y el archivo de siempre cuando nadie pide nada nuevo (R59). Los asertos de xlsx RELEEN
// el binario con exceljs.

const FECHA = new Date(2026, 9, 2, 10, 0);

async function leer(contenido: ArrayBuffer | string): Promise<ExcelJS.Workbook> {
  expect(typeof contenido).not.toBe("string");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(contenido as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}

describe("468 — R22: celdaMonto convierte sin perder un centimo, o devuelve el texto", () => {
  it.each([
    ["9999999999.99", 9999999999.99],
    ["-1500.00", -1500],
    ["0.10", 0.1],
    ["0.00", 0],
    ["1234567.89", 1234567.89],
  ])("R22: «%s» sale como numero y su vuelta a dos decimales es el mismo texto", (texto, numero) => {
    const v = celdaMonto(texto);
    expect(typeof v).toBe("number");
    expect(v).toBe(numero);
    expect((v as number).toFixed(2)).toBe(texto);
  });

  it.each(["abc", "1.5", "1500", "1,500.00", "", " 1.00", "-0.00", "12345678901234.00"])(
    "R22: «%s» no es un importe escala 2 exacto: vuelve el TEXTO, nunca un numero inventado",
    (texto) => {
      expect(celdaMonto(texto)).toBe(texto);
    },
  );

  it("R22: una celda vacia sigue vacia", () => {
    expect(celdaMonto(null)).toBeNull();
  });
});

const COLUMNAS: DescargaColumna[] = [
  { clave: "concepto", encabezado: "Concepto" },
  { clave: "entra", encabezado: "Entra", formato: "monto" },
  { clave: "sale", encabezado: "Sale", formato: "monto" },
];
const FILAS: DescargaFila[] = [
  { concepto: "Saldo al inicio del periodo", entra: null, sale: null },
  { concepto: "Contra-entrega", entra: "39506131.00", sale: null },
  { concepto: "Pago al mensajero", entra: null, sale: "0.10" },
  { concepto: "Total del periodo", entra: "39506131.00", sale: "0.10" },
];

describe("468 — R22/R23/R47: el libro con columnas de monto y filas destacadas", () => {
  it("R22: la celda de monto es number, su toFixed(2) es el texto del servidor y lleva #,##0.00", async () => {
    const a = await construirDescarga({ titulo: "Movimientos", columnas: COLUMNAS, filas: FILAS }, FECHA);
    const ws = (await leer(a.contenido)).worksheets[0];
    let medidas = 0;
    for (const [i, fila] of FILAS.entries()) {
      const excel = ws.getRow(i + 2);
      for (const [c, clave] of [
        [2, "entra"],
        [3, "sale"],
      ] as const) {
        const texto = fila[clave];
        const celda = excel.getCell(c);
        expect(celda.numFmt).toBe(FORMATO_EXCEL_MONTO);
        if (texto === null) {
          expect(celda.value ?? null).toBeNull();
          continue;
        }
        expect(typeof celda.value).toBe("number");
        expect((celda.value as number).toFixed(2)).toBe(texto);
        medidas += 1;
      }
      // La columna sin formato sigue siendo texto.
      expect(typeof excel.getCell(1).value).toBe("string");
    }
    expect(medidas, "el libro no tenia montos que medir").toBe(4);
  });

  it("R23/R47: las filas destacadas van en negrita (principal y adicional); las demas no", async () => {
    const detalle: DescargaHoja = {
      titulo: "Detalle por guía",
      columnas: [
        { clave: "guia", encabezado: "Guía" },
        { clave: "entra", encabezado: "Entra", formato: "monto" },
      ],
      filas: [{ guia: "501", entra: null }, { guia: "501", entra: "1.00" }, { guia: null, entra: "1.00" }],
      filasDestacadas: [0, 2],
    };
    const a = await construirDescarga(
      { titulo: "Movimientos", columnas: COLUMNAS, filas: FILAS, filasDestacadas: [0, 3], hojasAdicionales: [detalle] },
      FECHA,
    );
    const libro = await leer(a.contenido);
    const negritas = (ws: ExcelJS.Worksheet, n: number) =>
      Array.from({ length: n }, (_, i) => ws.getRow(i + 2).font?.bold === true);
    expect(negritas(libro.worksheets[0], 4)).toEqual([true, false, false, true]);
    expect(negritas(libro.worksheets[1], 3)).toEqual([true, false, true]);
    expect(libro.worksheets[1].getRow(3).getCell(2).value).toBe(1);
    // La cabecera sigue en negrita como siempre.
    expect(libro.worksheets[0].getRow(1).font?.bold).toBe(true);
  });

  it("R59: sin `formato` ni `filasDestacadas` el archivo es el de antes (celdas, tipos y fuentes)", async () => {
    const sinNada: DescargaColumna[] = COLUMNAS.map(({ clave, encabezado }) => ({ clave, encabezado }));
    const nuevo = await leer((await construirDescarga({ titulo: "Libro", columnas: sinNada, filas: FILAS }, FECHA)).contenido);
    const ref = await leer(
      await buildXlsxRows(
        sinNada.map((c) => ({ key: c.clave, header: c.encabezado })),
        FILAS,
        nombreHoja("Libro"),
      ),
    );
    const volcado = (ws: ExcelJS.Worksheet) => {
      const out: unknown[] = [];
      ws.eachRow({ includeEmpty: true }, (row) => {
        out.push([row.font?.bold ?? null, ...[1, 2, 3].map((c) => [row.getCell(c).value ?? null, row.getCell(c).numFmt ?? null])]);
      });
      return out;
    };
    expect(volcado(nuevo.worksheets[0])).toEqual(volcado(ref.worksheets[0]));
    // Y el monto sigue siendo TEXTO cuando nadie pide el formato.
    expect(nuevo.worksheets[0].getRow(3).getCell(2).value).toBe("39506131.00");
  });

  it("R58: el csv con columnas de monto sigue sacando el texto del servidor, sin simbolo", async () => {
    const a = await construirDescarga({ tipo: "csv", titulo: "Movimientos", columnas: COLUMNAS, filas: FILAS, filasDestacadas: [0] }, FECHA);
    expect(typeof a.contenido).toBe("string");
    const lineas = (a.contenido as string).split(/\r?\n/);
    expect(lineas[2]).toBe("Contra-entrega,39506131.00,");
    expect(lineas[3]).toBe("Pago al mensajero,,0.10");
  });
});
