import { describe, it, expect } from "vitest";

import { clasificarBulkSummary } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";

describe("clasificarBulkSummary — separa el resumen en tres grupos (R1, R2, R3)", () => {
  it("separa creada/duplicada/error en tres grupos disjuntos (R1)", () => {
    const data = {
      total: 3,
      creadas: 1,
      duplicadas: 1,
      conError: 1,
      filas: [
        { fila: 1, numRemision: "REM-0001", resultado: "creada" },
        {
          fila: 2,
          numRemision: "REM-0002",
          resultado: "duplicada",
          estatus: "en_preparacion",
        },
        {
          fila: 3,
          numRemision: "REM-0003",
          resultado: "error",
          errores: { num_remision: ["obligatorio"] },
        },
      ],
    };

    const clasif = clasificarBulkSummary(data);

    expect(clasif.numRemisionesNuevas).toEqual(["REM-0001"]);
    expect(clasif.existentes).toEqual([
      { numRemision: "REM-0002", estatus: "en_preparacion" },
    ]);
    expect(clasif.errores).toEqual([
      {
        fila: 3,
        numRemision: "REM-0003",
        errores: { num_remision: ["obligatorio"] },
      },
    ]);
  });

  it("separa el resumen incluso con data desconocida (R2)", () => {
    for (const data of [undefined, null, 42, "x", {}, { filas: "nope" }]) {
      const clasif = clasificarBulkSummary(data);
      expect(clasif.numRemisionesNuevas).toEqual([]);
      expect(clasif.existentes).toEqual([]);
      expect(clasif.errores).toEqual([]);
    }
  });

  it("duplicada sin estatus → estatus: null (R3)", () => {
    const clasif = clasificarBulkSummary({
      filas: [{ fila: 1, numRemision: "REM-0009", resultado: "duplicada" }],
    });

    expect(clasif.existentes).toEqual([
      { numRemision: "REM-0009", estatus: null },
    ]);
  });

  it("error sin errores → errores: {} conservando fila/numRemision (R3)", () => {
    const clasif = clasificarBulkSummary({
      filas: [{ fila: 7, numRemision: "REM-0007", resultado: "error" }],
    });

    expect(clasif.errores).toEqual([
      { fila: 7, numRemision: "REM-0007", errores: {} },
    ]);
  });

  it("ignora filas sin forma esperada sin lanzar (R2)", () => {
    const clasif = clasificarBulkSummary({
      filas: [null, 5, "x", { resultado: "creada" }],
    });

    // La fila creada sin numRemision string no aporta remisión.
    expect(clasif.numRemisionesNuevas).toEqual([]);
    expect(clasif.existentes).toEqual([]);
    expect(clasif.errores).toEqual([]);
  });
});
