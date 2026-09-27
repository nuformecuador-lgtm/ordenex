import { describe, expect, it } from "vitest";

import {
  notaRetieneReprogramadas,
  retieneReprogramadas,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";
import { NOMBRE_ESTADO } from "@/lib/types/order-status";

// FICHA 462 (T3.1, R27) — los textos de la marca «Retiene N paquetes reprogramados para hoy».
//
// ⚠️ LITERALES ESCRITOS A MANO, nunca contra la funcion que los genera (memoria «asercion contra su
// propia fuente»: siempre verde). Es el CONTRATO visible aprobado por el leader el 2026-09-25:
// del PAQUETE en masculino, con el nombre vigente del estado de la 455 como adjetivo, singular y
// plural explicitos. Cambiar una palabra es legitimo, pero cuesta un cambio visible aqui.

describe("462/R27 — `retieneReprogramadas(n)`, singular y plural a mano", () => {
  it("1 → «Retiene 1 paquete reprogramado para hoy»", () => {
    expect(retieneReprogramadas(1)).toBe("Retiene 1 paquete reprogramado para hoy");
  });

  it("3 → «Retiene 3 paquetes reprogramados para hoy»; 12 → con su cifra", () => {
    expect(retieneReprogramadas(3)).toBe("Retiene 3 paquetes reprogramados para hoy");
    expect(retieneReprogramadas(12)).toBe("Retiene 12 paquetes reprogramados para hoy");
  });

  it("la nota (title / nombre accesible) dice que NO se pueden asignar hasta aprobar este cierre", () => {
    expect(notaRetieneReprogramadas(1)).toBe(
      "1 paquete reprogramado para hoy no se puede asignar hasta que se apruebe este cierre.",
    );
    expect(notaRetieneReprogramadas(4)).toBe(
      "4 paquetes reprogramados para hoy no se pueden asignar hasta que se apruebe este cierre.",
    );
  });

  it("455 §0.3: ningun texto usa el plural femenino RETIRADO «reprogramadas»; el adjetivo es el nombre vigente en minuscula", () => {
    for (const n of [1, 2, 7]) {
      for (const texto of [retieneReprogramadas(n), notaRetieneReprogramadas(n)]) {
        expect(texto).not.toMatch(/reprogramadas/i);
        expect(texto.toLowerCase()).toContain(NOMBRE_ESTADO.reprogramado.toLowerCase());
      }
    }
  });

  it("ningun identificador interno ni PII: solo la cifra y palabras (R52)", () => {
    for (const texto of [retieneReprogramadas(5), notaRetieneReprogramadas(5)]) {
      expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
      expect(texto).not.toMatch(/gu[ií]a|remisi[oó]n|tel[eé]fono|direcci[oó]n|₡/i);
    }
  });
});
