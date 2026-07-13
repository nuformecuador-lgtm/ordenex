import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { calcularSplitPago, derivarCuentaPorPagar } from "@/lib/utils/cuenta-por-pagar";

// Feature 44/T5 — tests puros de la regla money-safe del pago al mensajero. Cubre R4 (Decimal
// exacto, STRING 2 dec), R9 (pagado = min(P,E), pagado <= E y <= P), R14 (cuenta por pagar =
// devengado - pagado), R16 (nunca negativa en flujo normal; STRING). Bordes P=0/E=0/E>=P.

describe("calcularSplitPago — regla min(P,E) (R9/R10)", () => {
  it("E >= P: pagado = P, pendiente = 0 (pago cubierto integro por el efectivo)", () => {
    const s = calcularSplitPago("1000.00", "1500.00");
    expect(s).toEqual({ devengado: "1000.00", pagado: "1000.00", pendiente: "0.00" });
  });

  it("E = P (borde): pagado = P, pendiente = 0", () => {
    const s = calcularSplitPago("1000.00", "1000.00");
    expect(s).toEqual({ devengado: "1000.00", pagado: "1000.00", pendiente: "0.00" });
  });

  it("E < P: pagado = E, pendiente = P - E (cuenta por pagar)", () => {
    const s = calcularSplitPago("1000.00", "300.00");
    expect(s).toEqual({ devengado: "1000.00", pagado: "300.00", pendiente: "700.00" });
  });

  it("E = 0 (borde): pagado = 0, pendiente = P (todo queda como cuenta por pagar)", () => {
    const s = calcularSplitPago("1000.00", "0.00");
    expect(s).toEqual({ devengado: "1000.00", pagado: "0.00", pendiente: "1000.00" });
  });

  it("P = 0 (borde): todo 0 (cierre sin entregas que paguen)", () => {
    const s = calcularSplitPago("0.00", "5000.00");
    expect(s).toEqual({ devengado: "0.00", pagado: "0.00", pendiente: "0.00" });
  });

  it("R4: acepta Prisma.Decimal y devuelve STRING escala 2 exacta (sin perdida de precision)", () => {
    const s = calcularSplitPago(new Prisma.Decimal("1234.56"), new Prisma.Decimal("1000.01"));
    expect(s).toEqual({ devengado: "1234.56", pagado: "1000.01", pendiente: "234.55" });
    expect(typeof s.devengado).toBe("string");
    expect(typeof s.pagado).toBe("string");
    expect(typeof s.pendiente).toBe("string");
  });

  it("R9: el invariante devengado = pagado + pendiente se cumple exacto con Decimal", () => {
    const s = calcularSplitPago("999.99", "333.33");
    const suma = new Prisma.Decimal(s.pagado).add(new Prisma.Decimal(s.pendiente));
    expect(suma.toFixed(2)).toBe(s.devengado);
  });
});

describe("derivarCuentaPorPagar — saldo derivado (R14/R16)", () => {
  it("R14: cuenta por pagar = devengado - pagado (positivo -> Ordenex debe)", () => {
    const c = derivarCuentaPorPagar("1000.00", "300.00");
    expect(c).toEqual({
      devengado: "1000.00",
      pagado: "300.00",
      cuentaPorPagar: "700.00",
      signo: "positivo",
    });
  });

  it("R16: devengado = pagado -> cuenta por pagar 0.00, signo cero", () => {
    const c = derivarCuentaPorPagar("500.00", "500.00");
    expect(c.cuentaPorPagar).toBe("0.00");
    expect(c.signo).toBe("cero");
  });

  it("R16: sin movimientos (0/0) -> 0.00 cero", () => {
    const c = derivarCuentaPorPagar("0.00", "0.00");
    expect(c).toEqual({ devengado: "0.00", pagado: "0.00", cuentaPorPagar: "0.00", signo: "cero" });
  });

  it("R4/R27: acepta Decimal y expone STRING escala 2, sin perdida de precision", () => {
    const c = derivarCuentaPorPagar(new Prisma.Decimal("12345.67"), new Prisma.Decimal("2345.67"));
    expect(c.cuentaPorPagar).toBe("10000.00");
    expect(typeof c.devengado).toBe("string");
    expect(typeof c.pagado).toBe("string");
    expect(typeof c.cuentaPorPagar).toBe("string");
  });
});
