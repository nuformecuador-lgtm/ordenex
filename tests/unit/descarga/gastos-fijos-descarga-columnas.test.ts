import { describe, it, expect } from "vitest";

import { COLUMNAS_DESCARGA_GASTOS_FIJOS } from "@/app/(app)/wallet/_components/gastos-fijos-descarga-columnas";

// Feature 189 — ORDEN y CENSO de las columnas del archivo descargable de las PLANTILLAS DE
// GASTO FIJO del wallet (feature 170, T D.3 / R5).
//
// OJO al homónimo: `tests/unit/descarga/plantillas-descarga-columnas.test.ts` NO cubre esto.
// Aquélla es `COLUMNAS_DESCARGA_PLANTILLAS`, las plantillas de MENSAJE de
// `configuracion/plantillas`. Son otra pantalla y otro archivo.
//
// Tres columnas: la tentación es decir que un listado tan corto no necesita test de orden, y
// es al revés — con tres columnas una permuta cabe entera en una revisión distraída, y
// «Monto mensual» y «Estado» son dos celdas que un `toContain` de encabezados no distingue.

describe("orden de las columnas de descarga de las plantillas de gasto fijo", () => {
  it("declara sus columnas en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_GASTOS_FIJOS.map((c) => c.clave)).toEqual([
      "concepto",
      "monto",
      "estado",
    ]);
    expect(COLUMNAS_DESCARGA_GASTOS_FIJOS.map((c) => c.encabezado)).toEqual([
      "Concepto",
      "Monto mensual",
      "Estado",
    ]);
  });
});
