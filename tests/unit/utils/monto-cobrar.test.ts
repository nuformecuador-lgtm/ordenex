import { describe, it, expect } from "vitest";

import {
  normalizarMontoCobrar,
  redondearMontoCobrar,
  redondearMontoCobrarTexto,
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

// FICHA 305 — la MISMA regla para el monto que viaja como TEXTO (la cotizacion por API key).
describe("redondearMontoCobrarTexto (ficha 305)", () => {
  it.each([
    ["11898.81", "11899"], // el monto de la captura del 2026-08-27
    ["11898.5", "11899"], // el medio SUBE, igual que en la version numerica
    ["11898.49", "11898"],
    ["0.5", "1"],
    ["0.49", "0"],
    ["0", "0"],
    ["11899", "11899"], // un entero no se toca, ni gana un `.0`
    ["9999999999.99", "10000000000"], // el tope de `DECIMAL(12,2)`: el acarreo añade un digito
  ])("%s -> %s", (entrada, esperado) => {
    expect(redondearMontoCobrarTexto(entrada)).toBe(esperado);
  });

  it("sale SIN separador decimal: lo que devuelve es un entero listo para `Prisma.Decimal`", () => {
    for (const monto of ["11898.81", "0.5", "9999999999.99", "7"]) {
      expect(redondearMontoCobrarTexto(monto)).toMatch(/^\d+$/);
    }
  });

  it("NO ES UNA SEGUNDA REGLA: da exactamente lo mismo que la version numerica", () => {
    // El corazon de la ficha 305. Si alguien reimplementara el redondeo aqui —con
    // `Prisma.Decimal`, con `toFixed(0)`, con lo que sea— este barrido es lo que lo delata en
    // cuanto las dos versiones difieran en un solo valor del corpus.
    const discrepan: string[] = [];
    for (let entero = 0; entero < 60; entero++) {
      for (let centimos = 0; centimos < 100; centimos++) {
        const texto = `${entero}.${String(centimos).padStart(2, "0")}`;
        const porTexto = redondearMontoCobrarTexto(texto);
        const porNumero = String(redondearMontoCobrar(Number(texto)));
        if (porTexto !== porNumero) discrepan.push(`${texto}: ${porTexto} != ${porNumero}`);
      }
    }
    expect(discrepan).toEqual([]);
  });

  it("es IDEMPOTENTE: redondear lo ya redondeado no lo mueve", () => {
    for (const monto of ["11898.81", "0.5", "25900.49"]) {
      const una = redondearMontoCobrarTexto(monto);
      expect(redondearMontoCobrarTexto(una)).toBe(una);
    }
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
