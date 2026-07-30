import { describe, it, expect } from "vitest";

import { etiquetaRango, rangoVisible } from "@/components/shared/carrusel-rango";

// Etiqueta de posición del carrusel. Es la única regla con aritmética del compuesto, así que
// se ejercita aquí sin montar embla (que en jsdom no mide anchos y no reporta visibilidad).

describe("rangoVisible", () => {
  it("convierte índices 0-based en un rango 1-based inclusivo", () => {
    expect(rangoVisible([0, 1, 2], 5)).toEqual({ desde: 1, hasta: 3 });
    expect(rangoVisible([3, 4], 5)).toEqual({ desde: 4, hasta: 5 });
  });

  it("toma el mínimo y el máximo, sin asumir que los índices vengan ordenados", () => {
    expect(rangoVisible([2, 0, 1], 5)).toEqual({ desde: 1, hasta: 3 });
  });

  it("sin elementos no hay rango", () => {
    expect(rangoVisible([0, 1], 0)).toBeNull();
  });

  it("sin información de visibilidad cae a la primera posición, no inventa un rango", () => {
    expect(rangoVisible([], 5)).toEqual({ desde: 1, hasta: 1 });
  });

  it("descarta índices fuera de rango en lugar de propagarlos", () => {
    expect(rangoVisible([-1, 0, 1, 99], 3)).toEqual({ desde: 1, hasta: 2 });
    // Todos inválidos equivale a no tener información.
    expect(rangoVisible([7, 8], 3)).toEqual({ desde: 1, hasta: 1 });
  });
});

describe("etiquetaRango", () => {
  it("una sola visible se lee en singular: 'Orden 5 de 5'", () => {
    expect(etiquetaRango([4], 5)).toBe("Orden 5 de 5");
  });

  it("varias visibles se leen como rango en plural: 'Órdenes 1-3 de 5'", () => {
    expect(etiquetaRango([0, 1, 2], 5)).toBe("Órdenes 1-3 de 5");
  });

  it("la última página parcial muestra el rango real, no tres fijas", () => {
    expect(etiquetaRango([3, 4], 5)).toBe("Órdenes 4-5 de 5");
  });

  it("un único elemento en total no se anuncia como rango", () => {
    expect(etiquetaRango([0], 1)).toBe("Orden 1 de 1");
  });

  it("sin elementos no hay etiqueta", () => {
    expect(etiquetaRango([], 0)).toBe("");
  });

  it("acepta otros nombres, para no quedar atado a 'Orden'", () => {
    expect(
      etiquetaRango([0, 1], 4, { singular: "Guía", plural: "Guías" }),
    ).toBe("Guías 1-2 de 4");
    expect(etiquetaRango([3], 4, { singular: "Guía", plural: "Guías" })).toBe(
      "Guía 4 de 4",
    );
  });
});
