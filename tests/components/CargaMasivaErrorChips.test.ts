import { describe, it, expect } from "vitest";

import type { OrdenConError } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
import {
  construirChips,
  ordenarPorChip,
  clavesDeFila,
} from "@/app/(app)/ordenes/_components/carga-masiva-error-chips";

function err(
  numRemision: string,
  errores: Record<string, string[]>,
  fila: number | null = 1,
): OrdenConError {
  return { fila, numRemision, errores };
}

describe("carga-masiva-error-chips — construirChips", () => {
  it("agrupa por tipo de error y cuenta las filas afectadas", () => {
    const errores = [
      err("A", { provincia: ["provincia no encontrada"] }),
      err("B", { provincia: ["provincia no encontrada"] }),
      err("C", { canton: ["canton no encontrado en la provincia"] }),
    ];

    const chips = construirChips(errores);

    expect(chips).toHaveLength(2);
    // Mayor conteo primero.
    expect(chips[0]).toMatchObject({
      label: "Provincia no encontrada",
      count: 2,
    });
    expect(chips[1]).toMatchObject({
      label: "Canton no encontrado en la provincia",
      count: 1,
    });
  });

  it("canoniza mensajes con valores variables (comillas) al mismo chip", () => {
    const errores = [
      err("A", {
        distrito: ["sin cobertura: el distrito 'Carmen' no pertenece a ninguna zona"],
      }),
      err("B", {
        distrito: ["sin cobertura: el distrito 'Mata Redonda' no pertenece a ninguna zona"],
      }),
    ];

    const chips = construirChips(errores);

    // Ambas filas caen en un ÚNICO chip pese al nombre distinto del distrito.
    expect(chips).toHaveLength(1);
    expect(chips[0].count).toBe(2);
    expect(chips[0].label).toContain("'…'");
  });

  it("una fila con dos errores aporta a dos chips distintos", () => {
    const errores = [
      err("A", {
        provincia: ["provincia no encontrada"],
        monto_cobrar: ["monto inválido"],
      }),
    ];

    const chips = construirChips(errores);
    expect(chips).toHaveLength(2);
    expect(chips.every((c) => c.count === 1)).toBe(true);
  });

  it("sin errores → sin chips", () => {
    expect(construirChips([])).toEqual([]);
  });
});

describe("carga-masiva-error-chips — ordenarPorChip", () => {
  const errores = [
    err("A", { provincia: ["provincia no encontrada"] }),
    err("B", { canton: ["canton no encontrado en la provincia"] }),
    err("C", { provincia: ["provincia no encontrada"] }),
  ];

  it("chipKey=null → conserva el orden original (misma referencia lógica)", () => {
    expect(ordenarPorChip(errores, null)).toEqual(errores);
  });

  it("lleva al inicio (estable) las filas con el chip activo", () => {
    const [key] = [...clavesDeFila(errores[0])];
    const ordenado = ordenarPorChip(errores, key);

    expect(ordenado.map((e) => e.numRemision)).toEqual(["A", "C", "B"]);
    // No muta el arreglo de entrada.
    expect(errores.map((e) => e.numRemision)).toEqual(["A", "B", "C"]);
  });

  it("chip inexistente → todas quedan al final, orden preservado", () => {
    const ordenado = ordenarPorChip(errores, "campo::inexistente");
    expect(ordenado.map((e) => e.numRemision)).toEqual(["A", "B", "C"]);
  });
});
