import { describe, it, expect } from "vitest";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// R2: exactamente 7 valores canonicos, incluido en_bodega (estatus por defecto).
describe("ORDER_STATUS_SEED (R2)", () => {
  it("contiene exactamente los 7 valores esperados", () => {
    expect([...ORDER_STATUS_SEED].sort()).toEqual(
      [
        "devuelta",
        "devuelta_origen",
        "embalaje",
        "en_bodega",
        "en_ruta_bodega_principal",
        "entregada",
        "reprogramada",
      ].sort(),
    );
  });

  it("incluye en_bodega (default de creacion, N1/R10)", () => {
    expect(ORDER_STATUS_SEED).toContain("en_bodega");
  });

  it("no tiene valores duplicados", () => {
    expect(new Set(ORDER_STATUS_SEED).size).toBe(ORDER_STATUS_SEED.length);
    expect(ORDER_STATUS_SEED).toHaveLength(7);
  });
});
