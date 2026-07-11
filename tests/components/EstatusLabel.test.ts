import { describe, it, expect } from "vitest";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

const LABELS_ESPERADAS: Record<(typeof ORDER_STATUS_SEED)[number], string> = {
  entregada: "Entregada",
  devuelta: "Devuelta",
  devuelta_origen: "Devuelta a origen",
  reprogramada: "Reprogramada",
  en_fulfillment: "En fulfillment",
  en_ruta_bodega_principal: "En ruta a bodega principal",
  en_bodega: "En bodega",
  en_preparacion: "En preparación",
  en_espera_aceptacion: "Por recoger", // feature 36: ajuste de semántica de recogida
  en_ruta_bodega_satelite: "En ruta a bodega satélite", // feature 30
  en_reparto: "En reparto", // feature 36
  rechazada: "Rechazada", // feature 36
};

describe("estatusLabel — mapa de presentación value → label (R17)", () => {
  it("traduce todos los estados del seed", () => {
    for (const value of ORDER_STATUS_SEED) {
      expect(estatusLabel(value)).toBe(LABELS_ESPERADAS[value]);
    }
  });

  it("cae al value crudo si el estado es desconocido", () => {
    expect(estatusLabel("desconocido_x")).toBe("desconocido_x");
  });

  it("null/undefined/vacío → '—'", () => {
    expect(estatusLabel(null)).toBe("—");
    expect(estatusLabel(undefined)).toBe("—");
    expect(estatusLabel("")).toBe("—");
  });
});
