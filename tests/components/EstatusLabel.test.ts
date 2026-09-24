import { describe, it, expect } from "vitest";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// OJO: estos literales son DELIBERADAMENTE hardcodeados. Este test blinda el mapa
// de presentación: si aserta contra `ORDER_STATUS_LABELS` se vuelve tautológico y
// deja de proteger nada. Al renombrar una etiqueta, se actualiza aquí a mano.
const LABELS_ESPERADAS: Record<(typeof ORDER_STATUS_SEED)[number], string> = {
  entregado: "Entregada",
  novedad: "Devuelta",
  devolviendo_a_tienda: "Devolviendo a tienda", // feature 135
  reprogramado: "Reprogramada",
  // Feature 155/R27/R28: el estado de fulfillment salio del catalogo, asi que sale de este
  // mapa. Su entrada en `ORDER_STATUS_LABELS` la retira la fase frontend (T6.1); mientras siga
  // ahi es una clave de mas que nadie consulta, porque este test recorre `ORDER_STATUS_SEED`.
  en_ruta_bodega_central: "En ruta a bodega central", // feature 135 (R8)
  en_bodega_central: "En bodega central", // feature 135 (R8)
  en_preparacion: "En preparación",
  mensajero_recogiendo_en_bodega: "Por recoger", // feature 17 (renombrado en feature 135)
  en_ruta_bodega_satelite: "En ruta a bodega satélite", // feature 30 (R8)
  en_reparto: "En reparto", // feature 36 (renombrado en la 135 y de vuelta en la 153/R9)
  devolucion_a_origen_por_rechazo: "Rechazada", // feature 36
  en_bodega_satelite: "En bodega satélite", // feature 33 (R8)
  devuelta_a_tienda: "Devuelta a tienda", // feature 135 (R8)
  novedad_interna: "Sin gestionar", // feature 109/R25
  por_devolver_a_bodega_central: "Por devolver", // feature 139/R4
  devolviendo_a_bodega_central: "Devolviendo a bodega central", // feature 139/R4
  por_devolver_a_tienda: "Por devolver a tienda", // feature 139/R4
  por_recolectar_en_tienda: "Por recolectar en tienda", // feature 154/R29 (Q5 confirmada)
  recolectando: "Recolectando", // feature 157 (ampliacion): ya tiene mensajero y va en camino
  incidente: "Incidente", // feature 154/R30 (Q5 confirmada)
  // ⏳ 2026-09-23 (FICHA 454, R37): aqui estaban `devolucion_por_confirmar` (239/R26) y
  // `ayuda_tienda` (235/R37). Salen del catalogo; su lectura HISTORICA se afirma abajo (R40), con
  // los mismos literales escritos a mano.
};

/** 454/R40 — la lectura de siempre de los dos estados retirados, escrita a mano. */
const LABELS_RETIRADOS_ESPERADAS: Record<string, string> = {
  devolucion_por_confirmar: "Devolución por confirmar", // 239/R26
  ayuda_tienda: "Ayuda solicitada a la tienda", // 235/R37
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

  it("454/R40: una fila histórica de un estado RETIRADO se lee con su etiqueta de siempre, no cruda", () => {
    for (const [value, label] of Object.entries(LABELS_RETIRADOS_ESPERADAS)) {
      expect(estatusLabel(value)).toBe(label);
      expect(ORDER_STATUS_SEED as readonly string[]).not.toContain(value);
    }
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
