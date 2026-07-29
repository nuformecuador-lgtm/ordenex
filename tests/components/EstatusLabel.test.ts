import { describe, it, expect } from "vitest";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// OJO: estos literales son DELIBERADAMENTE hardcodeados. Este test blinda el mapa
// de presentación: si aserta contra `ORDER_STATUS_LABELS` se vuelve tautológico y
// deja de proteger nada. Al renombrar una etiqueta, se actualiza aquí a mano.
const LABELS_ESPERADAS: Record<(typeof ORDER_STATUS_SEED)[number], string> = {
  entregada: "Entregada",
  devuelta: "Devuelta",
  devolviendo_a_tienda: "Devolviendo a tienda", // feature 135
  reprogramada: "Reprogramada",
  en_fulfillment: "En fulfillment",
  en_ruta_bodega_central: "En ruta a bodega central", // feature 135 (R8)
  en_bodega_central: "En bodega central", // feature 135 (R8)
  en_preparacion: "En preparación",
  por_recoger: "Por recoger", // feature 17 (renombrado en feature 135)
  en_ruta_bodega_satelite: "En ruta a bodega satélite", // feature 30 (R8)
  en_reparto: "En reparto", // feature 36 (renombrado en la 135 y de vuelta en la 153/R9)
  rechazada: "Rechazada", // feature 36
  en_bodega_satelite: "En bodega satélite", // feature 33 (R8)
  devuelta_a_tienda: "Devuelta a tienda", // feature 135 (R8)
  sin_gestionar: "Sin gestionar", // feature 109/R25
  por_devolver: "Por devolver", // feature 139/R4
  devolviendo_a_bodega_central: "Devolviendo a bodega central", // feature 139/R4
  por_devolver_a_tienda: "Por devolver a tienda", // feature 139/R4
  por_recolectar_en_tienda: "Por recolectar en tienda", // feature 154/R29 (Q5 confirmada)
  incidente: "Incidente", // feature 154/R30 (Q5 confirmada)
};

describe("estatusLabel — mapa de presentación value → label (R17)", () => {
  it("traduce todos los estados del seed", () => {
    for (const value of ORDER_STATUS_SEED) {
      expect(estatusLabel(value)).toBe(LABELS_ESPERADAS[value]);
    }
  });

  // Feature 154/R29: el estado de espera en tienda se muestra con etiqueta legible en español.
  it("154/R29: por_recolectar_en_tienda se muestra como “Por recolectar en tienda”", () => {
    expect(estatusLabel("por_recolectar_en_tienda")).toBe("Por recolectar en tienda");
  });

  // Feature 154/R30: el cierre en error se muestra con etiqueta legible en español.
  it("154/R30: incidente se muestra como “Incidente”", () => {
    expect(estatusLabel("incidente")).toBe("Incidente");
  });

  // Feature 154/R31: un value fuera del catálogo conocido por el build NO rompe la vista.
  it("cae al value crudo si el estado es desconocido", () => {
    expect(estatusLabel("desconocido_x")).toBe("desconocido_x");
  });

  it("null/undefined/vacío → '—'", () => {
    expect(estatusLabel(null)).toBe("—");
    expect(estatusLabel(undefined)).toBe("—");
    expect(estatusLabel("")).toBe("—");
  });
});
