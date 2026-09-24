import { describe, it, expect } from "vitest";
import {
  RESULTADO_FILA_LABEL,
  RESULTADO_LABEL,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";

// Feature 230 — Tanda 1 (T1.3, design §6.1, R45) — la etiqueta del resultado de una gestion en la
// celda de la hoja fundida.
//
// ⏳ REESCRITO EL 2026-09-24 (FICHA 455, T2.4; design §2.1; R4/R5). La 230 tenia DOS mapas: el
// plural de las secciones («Entregadas») y el singular de la celda («Entregada»), declarados por
// separado para no derivar uno del otro quitando la «s». La 455 fija UN nombre por estado, sin
// plural (R2), y el resultado se llama como su estado homonimo (R4): la pestaña, la seccion y la
// celda de la descarga dicen EXACTAMENTE lo mismo. Los dos mapas vuelven a ser uno
// (`RESULTADO_FILA_LABEL` es un alias de `RESULTADO_LABEL`). Se afirma:
//   - el contrato, literal y a mano (requirements 455 §0.2);
//   - que la celda y la seccion son el MISMO mapa (la mutacion que se caza ahora es la contraria:
//     que alguien vuelva a declarar un segundo mapa y los dos diverjan);
//   - que ninguna etiqueta es el value del enum (R45).

const ESPERADO = {
  entregado: "Entregado",
  reprogramado: "Reprogramado",
  novedad: "Novedad",
  devolucion_a_origen_por_rechazo: "Devolución a origen por rechazo",
  incidente: "Incidente",
} as const;

describe("RESULTADO_FILA_LABEL (feature 230, T1.3 → 455)", () => {
  it("fija los cinco nombres exactos, literalmente", () => {
    expect(RESULTADO_FILA_LABEL).toEqual(ESPERADO);
    expect(RESULTADO_LABEL).toEqual(ESPERADO);
  });

  it("la celda y la sección son el MISMO mapa: no pueden divergir", () => {
    expect(RESULTADO_FILA_LABEL).toBe(RESULTADO_LABEL);
  });

  it("ninguna etiqueta es el value del enum (R45)", () => {
    for (const [clave, etiqueta] of Object.entries(RESULTADO_FILA_LABEL)) {
      expect(etiqueta).not.toBe(clave);
    }
  });
});
