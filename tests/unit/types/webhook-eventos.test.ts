import { describe, expect, it } from "vitest";

import { EVENTOS_PUBLICOS, esEventoPublico } from "@/lib/types/webhook-eventos";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 239 (T1.7, R26/R27, P2 FIRMADA el 2026-08-19) — la politica de eventos publicos es un
// `Set` PARCIAL: no rompe el build, asi que un value nuevo se queda fuera EN SILENCIO. La unica
// forma de que la decision sea auditable es afirmarla, incluido el caso NEGATIVO.
//
// La decision: el pre-estado NO es evento publico. El vocabulario que ve el integrador no gana
// un valor nuevo — anadirlo le obligaria a manejar un estado que no sabe interpretar—. Lo que
// cambia es CUANDO llega `devuelta`: antes al gestionar el mensajero, ahora al aprobar el cierre.

const PRE_ESTADO = "devolucion_por_confirmar";

describe("EVENTOS_PUBLICOS — el pre-estado NO entra en el contrato publico (239/P2/R27)", () => {
  it("R27/P2: `devolucion_por_confirmar` NO es evento publico", () => {
    expect(EVENTOS_PUBLICOS.has(PRE_ESTADO)).toBe(false);
    expect(esEventoPublico(PRE_ESTADO)).toBe(false);
  });

  it("R27: `devuelta` SIGUE siendo evento publico — lo que cambia es CUANDO se emite", () => {
    // El integrador sigue recibiendo el mismo evento con el mismo nombre. La 239 lo retrasa
    // hasta la aprobacion del cierre, que es cuando la orden entra de verdad en `devuelta`
    // (R27). Es un cambio de contrato OBSERVABLE y hay que avisar antes de desplegar (T0.3).
    expect(EVENTOS_PUBLICOS.has("devuelta")).toBe(true);
    expect(esEventoPublico("devuelta")).toBe(true);
  });

  it("la lista NO cambio de tamano con la 239: sigue teniendo los 10 values de la 155", () => {
    // Si esto sube a 11, alguien anadio el pre-estado (o algun otro) al contrato publico sin
    // pasar por la puerta humana. La lista se congela por CONTENIDO, no solo por conteo.
    expect([...EVENTOS_PUBLICOS].sort()).toEqual(
      [
        "por_recolectar_en_tienda",
        "en_ruta_bodega_central",
        "en_bodega_central",
        "en_reparto",
        "entregada",
        "reprogramada",
        "devuelta",
        "rechazada",
        "devolviendo_a_tienda",
        "devuelta_a_tienda",
      ].sort(),
    );
  });

  it("todos los values emitidos existen en el catalogo vigente (sin fantasmas)", () => {
    for (const value of EVENTOS_PUBLICOS) {
      expect(ORDER_STATUS_SEED as readonly string[]).toContain(value);
    }
  });
});
