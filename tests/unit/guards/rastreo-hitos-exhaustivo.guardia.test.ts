import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { NOMBRE_ESTADO, ORDER_STATUS_SEED, nombrePublicoDeEstado } from "@/lib/types/order-status";
import * as contratoRastreo from "@/lib/types/rastreo-publico";

// Feature 229 — GUARDIA de exhaustividad del vocabulario público del rastreo (T1.3, R16/R17).
//
// ⏳ REESCRITA EL 2026-09-24 (FICHA 455, T1.9; design DF/§4; R31/R34). Hasta la 455 esta guardia
// comparaba el mapa estado -> HITO (`HITO_POR_ESTATUS`, nueve hitos + el neutral «En proceso») con la
// tabla firmada de la 229, transcrita a mano. La 455 RETIRA los hitos: por transparencia total el
// destinatario ve el NOMBRE VISIBLE de cada estado, el mismo que la app interna (`nombrePublicoDeEstado`,
// la fuente única). Así que la guardia pasa a afirmar la AUSENCIA de hitos y la lectura pública de
// los 20 vigentes, de los 4 retirados y de un código desconocido — con las tablas escritas A MANO
// (si se derivaran de la función, la guardia diría que la función coincide consigo misma).

const RAIZ = path.resolve(__dirname, "../../..");

/** La lectura pública de los 20 vigentes: su nombre visible (requirements 455 §0.1), a mano. */
const NOMBRE_PUBLICO_ESPERADO: Record<string, string> = {
  entregado: "Entregado",
  novedad: "Novedad",
  devolviendo_a_tienda: "Devolviendo a tienda",
  reprogramado: "Reprogramado",
  en_ruta_bodega_central: "En ruta a bodega central",
  en_bodega_central: "En bodega central",
  en_preparacion: "En preparación",
  mensajero_recogiendo_en_bodega: "Mensajero recogiendo en la bodega",
  en_ruta_bodega_satelite: "En ruta a bodega satélite",
  en_reparto: "En reparto",
  devolucion_a_origen_por_rechazo: "Devolución a origen por rechazo",
  en_bodega_satelite: "En bodega satélite",
  devuelta_a_tienda: "Devuelta a tienda",
  novedad_interna: "Novedad interna",
  por_devolver_a_bodega_central: "Por devolver a bodega central",
  devolviendo_a_bodega_central: "Devolviendo a bodega central",
  por_devolver_a_tienda: "Por devolver a tienda",
  por_recolectar_en_tienda: "Por recolectar en tienda",
  incidente: "Incidente",
  recolectando: "Recolectando",
};

/** R34 — los retirados se pliegan al nombre de su vigente equivalente (design §1.1), a mano. */
const RETIRADO_PLEGADO_ESPERADO: Record<string, string> = {
  devolucion_por_confirmar: "Novedad",
  ayuda_tienda: "En reparto",
  en_fulfillment: "En preparación",
  pendiente: "En preparación",
};

describe("455/R31 — el rastreo ya no tiene vocabulario de hitos", () => {
  it("el contrato del rastreo no exporta ningún símbolo de hitos", () => {
    const exportados = Object.keys(contratoRastreo);
    for (const retirado of [
      "HITOS_PUBLICOS",
      "ETIQUETA_POR_HITO",
      "HITO_POR_ESTATUS",
      "HITO_POR_ESTATUS_RETIRADO",
      "HITO_POR_DEFECTO",
      "hitoDeEstatus",
      "NOMBRE_RESULTADO_PENDIENTE",
    ]) {
      expect(exportados, retirado).not.toContain(retirado);
    }
  });

  it("ni el servicio ni el modal nombran un hito", () => {
    for (const rel of ["lib/services/RastreoPublicoService.ts", "app/_landing/RastreoDialog.tsx"]) {
      const codigo = readFileSync(path.join(RAIZ, rel), "utf8");
      expect(codigo, rel).not.toMatch(/hitoDeEstatus|ETIQUETA_POR_HITO|hitoVigente|\.hito\b/);
    }
  });
});

describe("455/R31 · R34 · R10 — la lectura pública de cada estado", () => {
  it("los 20 vigentes se leen con su nombre visible exacto", () => {
    expect(Object.keys(NOMBRE_PUBLICO_ESPERADO).sort()).toEqual([...ORDER_STATUS_SEED].sort());
    for (const value of ORDER_STATUS_SEED) {
      expect(nombrePublicoDeEstado(value), value).toBe(NOMBRE_PUBLICO_ESPERADO[value]);
    }
  });

  it("los 4 retirados se pliegan al nombre de su equivalente, nunca a su nombre histórico", () => {
    for (const [value, esperado] of Object.entries(RETIRADO_PLEGADO_ESPERADO)) {
      expect(nombrePublicoDeEstado(value), value).toBe(esperado);
      expect(nombrePublicoDeEstado(value), value).not.toMatch(/estado retirado/);
    }
  });

  it("un código desconocido se lee «Estado no reconocido», nunca crudo", () => {
    expect(nombrePublicoDeEstado("estado_inventado_manana")).toBe("Estado no reconocido");
  });

  it("todo lo que el rastreo puede publicar está en el catálogo de nombres (o es el de R10)", () => {
    const publicables = new Set<string>([...Object.values(NOMBRE_ESTADO), "Estado no reconocido"]);
    for (const value of [...ORDER_STATUS_SEED, ...Object.keys(RETIRADO_PLEGADO_ESPERADO), "x_y"]) {
      expect(publicables.has(nombrePublicoDeEstado(value)), value).toBe(true);
    }
  });
});
