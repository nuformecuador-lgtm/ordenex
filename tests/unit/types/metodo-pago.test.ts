import { describe, it, expect } from "vitest";
import { MetodoPagoValue } from "@prisma/client";
import { METODO_PAGO_SEED } from "@/lib/types/metodo-pago";

// Feature 36/R5 (decision F1.4-c): tipo cerrado de metodo de pago, fuente unica de
// verdad, respaldado por el enum Postgres nativo `metodo_pago_value`. La
// exhaustividad frente al enum Prisma es de compile-time (satisfies + chequeo de
// tipo en lib/types/metodo-pago.ts); aqui se verifica el contenido en runtime.
describe("METODO_PAGO_SEED (R5)", () => {
  it("contiene exactamente efectivo, SIMPE y transferencia (F1.4-c, SIMPE en mayusculas)", () => {
    expect([...METODO_PAGO_SEED].sort()).toEqual(["SIMPE", "efectivo", "transferencia"].sort());
  });

  it("coincide 1:1 con los valores del enum Prisma metodo_pago_value", () => {
    expect([...METODO_PAGO_SEED].sort()).toEqual(Object.values(MetodoPagoValue).sort());
  });

  it("no tiene valores duplicados", () => {
    expect(new Set(METODO_PAGO_SEED).size).toBe(METODO_PAGO_SEED.length);
  });
});
