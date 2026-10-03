// Ficha 470 (T4.3, design §4.4) — R2: la guardia de Excel en el ARMADO del archivo. Cada hoja
// (principal y adicionales) se cuenta ANTES de llamar a exceljs; la que pasa de 1.048.575 filas de
// datos no produce archivo y lanza `LimiteExcelExcedidoError` con la hoja y sus filas.
//
// Los generadores de xlsx son espías: el contrato es que NO se invocan cuando la guardia salta. Las
// hojas grandes son arrays dispersos (`new Array(n)`): la guardia solo cuenta, no recorre.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return {
    ...real,
    buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)),
    buildXlsxLibro: vi.fn(async () => new ArrayBuffer(8)),
  };
});

import { EXCEL_FILAS_DATOS_POR_HOJA } from "@/lib/config/descarga";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import { construirDescarga, LimiteExcelExcedidoError } from "@/lib/utils/descarga-dataset";
import { comprobarLimiteExcel } from "@/lib/utils/limite-excel";
import { buildXlsxLibro, buildXlsxRows } from "@/lib/utils/xlsx-template";
import { mensajeLimiteExcel } from "@/components/shared/descarga-resultado";

const COLUMNAS: DescargaColumna[] = [{ clave: "guia", encabezado: "Guía" }];
const POCAS: DescargaFila[] = [{ guia: "A-1" }, { guia: "B-2" }];

function filas(n: number): DescargaFila[] {
  return new Array<DescargaFila>(n);
}

beforeEach(() => {
  vi.mocked(buildXlsxRows).mockClear();
  vi.mocked(buildXlsxLibro).mockClear();
});

describe("R2 · el límite de Excel es el de la hoja", () => {
  it("el límite vale 1.048.575 filas de datos (1.048.576 con la cabecera)", () => {
    expect(EXCEL_FILAS_DATOS_POR_HOJA).toBe(1_048_575);
  });

  it("hoja PRINCIPAL con 1.048.576 filas ⇒ LimiteExcelExcedidoError con hoja y filas, y exceljs no se invoca", async () => {
    const p = construirDescarga({ tipo: "xlsx", titulo: "Órdenes", columnas: COLUMNAS, filas: filas(1_048_576) });
    await expect(p).rejects.toBeInstanceOf(LimiteExcelExcedidoError);
    await expect(p).rejects.toMatchObject({ hoja: "Órdenes", filas: 1_048_576, limite: 1_048_575 });
    expect(buildXlsxRows).not.toHaveBeenCalled();
    expect(buildXlsxLibro).not.toHaveBeenCalled();
  });

  it("tipo ausente (xlsx por defecto) también pasa por la guardia", async () => {
    await expect(
      construirDescarga({ titulo: "Órdenes", columnas: COLUMNAS, filas: filas(1_048_576) }),
    ).rejects.toBeInstanceOf(LimiteExcelExcedidoError);
    expect(buildXlsxRows).not.toHaveBeenCalled();
  });

  it("hoja ADICIONAL con 1.048.576 filas ⇒ lanza nombrando ESA hoja, sin armar el libro", async () => {
    const p = construirDescarga({
      tipo: "xlsx",
      titulo: "Libro de la caja",
      columnas: COLUMNAS,
      filas: POCAS,
      hojasAdicionales: [{ titulo: "Detalle por guía", columnas: COLUMNAS, filas: filas(1_048_576) }],
    });
    await expect(p).rejects.toMatchObject({ name: "LimiteExcelExcedidoError", hoja: "Detalle por guía", filas: 1_048_576 });
    expect(buildXlsxLibro).not.toHaveBeenCalled();
  });

  it("1.048.575 filas NO lanza por la guardia (contador de la guardia, sin armar el libro)", () => {
    expect(() =>
      comprobarLimiteExcel([
        { titulo: "Libro de la caja", filas: { length: 1_048_575 } },
        { titulo: "Detalle por guía", filas: { length: 1_048_575 } },
      ]),
    ).not.toThrow();
    expect(() => comprobarLimiteExcel([{ titulo: "X", filas: { length: 1_048_576 } }])).toThrow(LimiteExcelExcedidoError);
  });

  it("por debajo del límite el archivo se arma como siempre", async () => {
    const archivo = await construirDescarga({ tipo: "xlsx", titulo: "Órdenes", columnas: COLUMNAS, filas: POCAS });
    expect(buildXlsxRows).toHaveBeenCalledTimes(1);
    expect(archivo.nombreArchivo).toMatch(/^ordenes-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("el aviso dice la hoja, las filas que tendría, el máximo de Excel y qué hacer", () => {
    expect(mensajeLimiteExcel("Detalle por guía", 2_000_000, 1_048_575)).toBe(
      "La hoja «Detalle por guía» tendría 2.000.000 filas y Excel admite hasta 1.048.575 por hoja. Acota el periodo o los filtros y vuelve a intentarlo.",
    );
  });
});
