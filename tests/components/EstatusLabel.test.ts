import { describe, it, expect } from "vitest";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// OJO: estos literales son DELIBERADAMENTE hardcodeados. Este test blinda el mapa
// de presentación: si aserta contra `ORDER_STATUS_LABELS` se vuelve tautológico y
// deja de proteger nada. Al renombrar una etiqueta, se actualiza aquí a mano.
//
// ⏳ 2026-09-24 (FICHA 455, T2.1; R2/R10/R11): `estatusLabel` es `nombreDeEstado`, la fuente única.
// Siete nombres cambian (requirements 455 §0.1: «Entregado», «Novedad», «Reprogramado», «Mensajero
// recogiendo en la bodega», «Devolución a origen por rechazo», «Novedad interna», «Por devolver a
// bodega central»); un retirado se lee «<histórico> (estado retirado)» y un desconocido, «Estado no
// reconocido» (nunca el código crudo, R3).
const LABELS_ESPERADAS: Record<(typeof ORDER_STATUS_SEED)[number], string> = {
  entregado: "Entregado",
  novedad: "Novedad",
  devolviendo_a_tienda: "Devolviendo a tienda", // feature 135
  reprogramado: "Reprogramado",
  // Feature 155/R27/R28: el estado de fulfillment salio del catalogo, asi que sale de este
  // mapa. Su entrada en `ORDER_STATUS_LABELS` la retira la fase frontend (T6.1); mientras siga
  // ahi es una clave de mas que nadie consulta, porque este test recorre `ORDER_STATUS_SEED`.
  en_ruta_bodega_central: "En ruta a bodega central", // feature 135 (R8)
  en_bodega_central: "En bodega central", // feature 135 (R8)
  en_preparacion: "En preparación",
  mensajero_recogiendo_en_bodega: "Mensajero recogiendo en la bodega", // feature 17 (renombrado en la 135 y en la 455)
  en_ruta_bodega_satelite: "En ruta a bodega satélite", // feature 30 (R8)
  en_reparto: "En reparto", // feature 36 (renombrado en la 135 y de vuelta en la 153/R9)
  devolucion_a_origen_por_rechazo: "Devolución a origen por rechazo", // feature 36 (455)
  en_bodega_satelite: "En bodega satélite", // feature 33 (R8)
  devuelta_a_tienda: "Devuelta a tienda", // feature 135 (R8)
  novedad_interna: "Novedad interna", // feature 109/R25 (455)
  por_devolver_a_bodega_central: "Por devolver a bodega central", // feature 139/R4 (455)
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
  devolucion_por_confirmar: "Devolución por confirmar (estado retirado)", // 239/R26 → 455/R11
  ayuda_tienda: "Ayuda solicitada a la tienda (estado retirado)", // 235/R37 → 455/R11
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

  it("454/R40 · 455/R11: una fila histórica de un estado RETIRADO se lee con su nombre histórico, marcado", () => {
    for (const [value, label] of Object.entries(LABELS_RETIRADOS_ESPERADAS)) {
      expect(estatusLabel(value)).toBe(label);
      expect(ORDER_STATUS_SEED as readonly string[]).not.toContain(value);
    }
  });

  // Feature 154/R31: un value fuera del catálogo conocido por el build NO rompe la vista.
  // ⏳ 2026-09-24 (FICHA 455, R3/R10): ya no cae al value crudo.
  it("un estado desconocido se lee «Estado no reconocido», nunca crudo", () => {
    expect(estatusLabel("desconocido_x")).toBe("Estado no reconocido");
  });

  it("null/undefined/vacío → '—'", () => {
    expect(estatusLabel(null)).toBe("—");
    expect(estatusLabel(undefined)).toBe("—");
    expect(estatusLabel("")).toBe("—");
  });
});
