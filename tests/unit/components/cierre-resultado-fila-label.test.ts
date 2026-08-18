import { describe, it, expect } from "vitest";
import {
  RESULTADO_FILA_LABEL,
  RESULTADO_LABEL,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";

// Feature 230 — Tanda 1 (T1.3, design §6.1, R45) — la etiqueta SINGULAR del resultado de una
// gestion.
//
// Por que hace falta un segundo mapa, y por que este archivo mide algo: `RESULTADO_LABEL` esta
// en PLURAL porque nombra la SECCION de la pantalla («Entregadas»). La hoja fundida emite una
// celda por FILA, y una fila es una gestion: «Entregada».
//
// La mutacion que estos casos matan es la tentadora: derivar el singular del plural quitandole
// la «s». Funciona con los cinco valores de HOY, y por eso un caso que solo comparase textos
// pasaria igual. Aqui se afirma ademas que los dos mapas son declaraciones INDEPENDIENTES y que
// ninguno de los cinco valores del enum se queda sin etiqueta.

const ESPERADO = {
  entregada: "Entregada",
  reprogramada: "Reprogramada",
  devuelta: "Devuelta",
  rechazada: "Rechazada",
  incidente: "Incidente",
} as const;

describe("RESULTADO_FILA_LABEL (feature 230, T1.3)", () => {
  it("fija los cinco textos en singular, literalmente", () => {
    expect(RESULTADO_FILA_LABEL).toEqual(ESPERADO);
  });

  it("cubre EXACTAMENTE los mismos resultados que el mapa de secciones (ni uno menos)", () => {
    // Si el enum gana un resultado, `RESULTADO_LABEL` lo obliga por tipo y este caso obliga a
    // que la hoja fundida tambien lo tenga: una celda vacia en la columna «Resultado» seria un
    // dato perdido, no una celda que «no aplica» (R10).
    expect(Object.keys(RESULTADO_FILA_LABEL).sort()).toEqual(Object.keys(RESULTADO_LABEL).sort());
  });

  it("NO se deriva del plural quitando la «s»: son dos declaraciones distintas", () => {
    for (const [clave, plural] of Object.entries(RESULTADO_LABEL)) {
      const singular = RESULTADO_FILA_LABEL[clave as keyof typeof RESULTADO_FILA_LABEL];
      expect(singular).not.toBe(plural);
    }
    // Y el plural NO se toca (R3 del espiritu de la feature: lo que ya existe sigue igual).
    expect(RESULTADO_LABEL.entregada).toBe("Entregadas");
  });

  it("ninguna etiqueta es el value del enum (R45)", () => {
    for (const [clave, etiqueta] of Object.entries(RESULTADO_FILA_LABEL)) {
      expect(etiqueta).not.toBe(clave);
    }
  });
});
