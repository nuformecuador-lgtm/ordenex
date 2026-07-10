import { describe, it, expect } from "vitest";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// R2/R5: exactamente 8 valores canonicos, incluido en_preparacion (feature 15,
// nuevo default GLOBAL de creacion; en_bodega se conserva como valor historico).
describe("ORDER_STATUS_SEED (R2/R5)", () => {
  it("contiene exactamente los 8 valores esperados", () => {
    expect([...ORDER_STATUS_SEED].sort()).toEqual(
      [
        "devuelta",
        "devuelta_origen",
        "embalaje",
        "en_bodega",
        "en_preparacion",
        "en_ruta_bodega_principal",
        "entregada",
        "reprogramada",
      ].sort(),
    );
  });

  it("incluye en_preparacion (default de creacion GLOBAL, feature 15/R7/R8)", () => {
    expect(ORDER_STATUS_SEED).toContain("en_preparacion");
  });

  it("no tiene valores duplicados", () => {
    expect(new Set(ORDER_STATUS_SEED).size).toBe(ORDER_STATUS_SEED.length);
    expect(ORDER_STATUS_SEED).toHaveLength(8);
  });
});
