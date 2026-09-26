// Ficha 458-A (TA.3, R13–R15) — las opciones del filtro de concepto: las del servidor, con su
// número, en su orden; el elegido se CONSERVA con 0 (R15); nada sin rótulo.
import { describe, it, expect } from "vitest";

import { opcionesDeConceptos, rotuloConCuenta } from "@/components/shared/wallet/conceptos-filtro";
import { CATEGORIA_LABEL, CATEGORIA_TODAS_OPTION } from "@/app/(app)/wallet/_components/wallet-labels";

describe("opcionesDeConceptos", () => {
  it("R13: «todas» y luego los conceptos con movimientos, en el orden del servidor y con su número", () => {
    const opciones = opcionesDeConceptos(
      [
        { categoria: "ingreso_flete", movimientos: 12 },
        { categoria: "egreso_sueldo", movimientos: 1 },
      ],
      CATEGORIA_LABEL,
      "",
      CATEGORIA_TODAS_OPTION,
    );
    expect(opciones).toEqual([
      { value: "", label: "Todas las categorías" },
      { value: "ingreso_flete", label: "Flete cobrado a la tienda (12)" },
      { value: "egreso_sueldo", label: "Sueldo (1)" },
    ]);
  });

  it("R14: lo que el servidor no trae no se ofrece (egreso_gasto sin productor)", () => {
    const opciones = opcionesDeConceptos([{ categoria: "egreso_sueldo", movimientos: 1 }], CATEGORIA_LABEL, "", CATEGORIA_TODAS_OPTION);
    expect(opciones.map((o) => o.value)).not.toContain("egreso_gasto");
  });

  it("R15: el elegido que se queda sin movimientos se conserva, con 0, al final", () => {
    const opciones = opcionesDeConceptos(
      [{ categoria: "ingreso_flete", movimientos: 3 }],
      CATEGORIA_LABEL,
      "egreso_sueldo",
      CATEGORIA_TODAS_OPTION,
    );
    expect(opciones.at(-1)).toEqual({ value: "egreso_sueldo", label: "Sueldo (0)" });
    // Y si SÍ tiene movimientos, no se duplica.
    const conEl = opcionesDeConceptos(
      [{ categoria: "egreso_sueldo", movimientos: 2 }],
      CATEGORIA_LABEL,
      "egreso_sueldo",
      CATEGORIA_TODAS_OPTION,
    );
    expect(conEl.filter((o) => o.value === "egreso_sueldo")).toEqual([{ value: "egreso_sueldo", label: "Sueldo (2)" }]);
  });

  it("mientras no hay respuesta (o falló), queda «todas» y el elegido con 0", () => {
    expect(opcionesDeConceptos(undefined, CATEGORIA_LABEL, "egreso_sueldo", CATEGORIA_TODAS_OPTION)).toEqual([
      { value: "", label: "Todas las categorías" },
      { value: "egreso_sueldo", label: "Sueldo (0)" },
    ]);
  });

  it("un concepto sin rótulo en el diccionario de la superficie no se pinta con su valor técnico", () => {
    const opciones = opcionesDeConceptos([{ categoria: "no_existe", movimientos: 1 }], CATEGORIA_LABEL, "no_existe", CATEGORIA_TODAS_OPTION);
    expect(opciones).toEqual([{ value: "", label: "Todas las categorías" }]);
  });

  it("rotuloConCuenta", () => {
    expect(rotuloConCuenta("Sueldo", 0)).toBe("Sueldo (0)");
  });
});
