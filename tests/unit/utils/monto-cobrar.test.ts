import { describe, it, expect } from "vitest";

import {
  normalizarMontoCobrar,
  redondearMontoCobrar,
} from "@/lib/utils/monto-cobrar";

// FEATURE 299 — el modulo puro que redondea el monto a cobrar al colon mas cercano.
// Los casos del schema y de las dos vias viven en sus propios archivos; aqui se fija la
// FUNCION, incluida la unica decision que no es obvia: hacia donde va el medio.

describe("redondearMontoCobrar (feature 299)", () => {
  it.each([
    [11898.81, 11899], // el monto de la captura del 2026-08-27
    [11898.5, 11899], // el medio SUBE (half away from zero, igual que `money()`)
    [11898.4999, 11898],
    [0.5, 1],
    [0.49, 0],
    [11899, 11899], // un entero no se toca
    [0, 0],
  ])("%s -> %s", (entrada, esperado) => {
    expect(redondearMontoCobrar(entrada)).toBe(esperado);
  });
});

describe("normalizarMontoCobrar (feature 299)", () => {
  it("un decimal devuelve el entero Y el aviso con los dos numeros", () => {
    expect(normalizarMontoCobrar(11898.81)).toEqual({
      valor: 11899,
      ajuste: { original: 11898.81, aplicado: 11899 },
    });
  });

  it("un entero NO genera aviso: una carga normal no gana ni un mensaje", () => {
    expect(normalizarMontoCobrar(11899)).toEqual({ valor: 11899, ajuste: null });
  });

  it("sin monto (null) no hay ni valor ni aviso: 'sin COD' no es un cero ni un ajuste", () => {
    expect(normalizarMontoCobrar(null)).toEqual({ valor: null, ajuste: null });
  });

  it("el cero es un monto como otro cualquiera y tampoco avisa", () => {
    expect(normalizarMontoCobrar(0)).toEqual({ valor: 0, ajuste: null });
  });

  it("es IDEMPOTENTE: normalizar lo ya normalizado no vuelve a avisar", () => {
    // Importa para la guarda: el valor que sale de aqui puede volver a pasar por aqui (por
    // ejemplo si otra puerta de alta reusa el normalizador) sin inventarse un segundo aviso.
    const primera = normalizarMontoCobrar(11898.81);
    expect(normalizarMontoCobrar(primera.valor)).toEqual({ valor: 11899, ajuste: null });
  });
});
