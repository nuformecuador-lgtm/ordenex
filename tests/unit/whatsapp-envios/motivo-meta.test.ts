import { describe, it, expect } from "vitest";
import { acotarMotivo, motivoMeta } from "@/lib/whatsapp-envios/motivo-meta";

// Ficha 474 (T2.3, R45) — el motivo de un rechazo de Meta es un texto FIJO por codigo; nunca el
// detalle crudo (que puede ecoar el numero destino).

describe("474/R45 — motivoMeta", () => {
  it("codigo mapeado -> texto fijo", () => {
    expect(motivoMeta(131026)).toBe("El número no tiene WhatsApp o no puede recibir mensajes.");
    expect(motivoMeta(132012)).toBe("El formato de los datos no coincide con la plantilla.");
  });

  it("codigo no mapeado -> generico con el codigo", () => {
    expect(motivoMeta(999999)).toBe("Meta rechazó el envío (código 999999).");
  });

  it("sin codigo -> generico sin codigo", () => {
    expect(motivoMeta(null)).toBe("Meta rechazó el envío (sin código).");
  });

  it("la firma no admite el detalle crudo: solo un numero o null", () => {
    // @ts-expect-error — el detalle de Meta NO es una entrada valida (R45)
    motivoMeta("HTTP 400: (#131026) to 50688887777");
    expect(motivoMeta(131026)).not.toMatch(/\d{8}/);
  });

  it("acotarMotivo respeta el CHECK de 500", () => {
    expect(acotarMotivo("x".repeat(600))).toHaveLength(500);
    expect(acotarMotivo("corto")).toBe("corto");
  });
});
