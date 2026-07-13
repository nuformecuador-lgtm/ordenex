import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { derivarBalance } from "@/lib/utils/wallet-balance";

// Feature 42 — tests del util PURO de balance (R4/R16/R17). Money-safe: salida STRING
// escala 2, signo explicito; Decimal exacto sin drift de float.

describe("derivarBalance (R16/R17)", () => {
  it("positivo: ingresos > egresos", () => {
    const b = derivarBalance("1000.00", "300.00");
    expect(b).toEqual({ ingresos: "1000.00", egresos: "300.00", balance: "700.00", signo: "positivo" });
  });

  it("negativo: egresos > ingresos -> balance con signo", () => {
    const b = derivarBalance("100.00", "250.50");
    expect(b.balance).toBe("-150.50");
    expect(b.signo).toBe("negativo");
  });

  it("cero: ingresos == egresos", () => {
    const b = derivarBalance("500.00", "500.00");
    expect(b.balance).toBe("0.00");
    expect(b.signo).toBe("cero");
  });

  it("acepta Prisma.Decimal ademas de STRING", () => {
    const b = derivarBalance(new Prisma.Decimal("10.10"), new Prisma.Decimal("0.05"));
    expect(b.balance).toBe("10.05");
    expect(b.signo).toBe("positivo");
  });

  it("Decimal exacto (sin drift): 0.10 + 0.20 - 0.30 = 0.00", () => {
    const ingresos = new Prisma.Decimal("0.10").add("0.20"); // 0.30 exacto
    const b = derivarBalance(ingresos, "0.30");
    expect(b.balance).toBe("0.00");
    expect(b.signo).toBe("cero");
  });

  it("salida SIEMPRE STRING escala 2", () => {
    const b = derivarBalance("1", "0");
    expect(typeof b.balance).toBe("string");
    expect(b.ingresos).toBe("1.00");
    expect(b.egresos).toBe("0.00");
    expect(b.balance).toBe("1.00");
  });
});
