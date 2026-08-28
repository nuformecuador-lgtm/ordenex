import { describe, expect, it } from "vitest";

import { claveDiaCR, separadorDia } from "@/lib/utils/separador-dia-cr";

// Feature 318 / T2.3 — el separador de dia del hilo (R23, decision humana P6).
//
// Dos cosas se miden aqui, y la segunda es la que de verdad se rompe sola:
//   1. la FORMA: «hoy», «ayer», «jueves 28 de agosto», sin coma y SIN AÑO nunca;
//   2. la FRONTERA de Costa Rica: entre las 18:00 y las 24:00 CR, el dia UTC ya es el
//      siguiente. Un calculo que reste 24 h a un instante —o que use `toISOString()`— acierta
//      todo el dia y falla justo esas seis horas.

/** 12:00 CR del VIERNES 28 de agosto de 2026. */
const AHORA = new Date("2026-08-28T18:00:00Z");

describe("separadorDia — hoy / ayer (R23)", () => {
  it("devuelve «hoy» para un mensaje de la fecha calendario CR en curso", () => {
    expect(separadorDia("2026-08-28T20:00:00Z", AHORA)).toBe("hoy");
  });

  it("devuelve «ayer» para un mensaje del dia calendario CR anterior", () => {
    expect(separadorDia("2026-08-27T20:00:00Z", AHORA)).toBe("ayer");
  });

  it("devuelve el dia largo para cualquier otro dia", () => {
    expect(separadorDia("2026-08-26T20:00:00Z", AHORA)).toBe("miércoles 26 de agosto");
  });
});

describe("separadorDia — NUNCA lleva año (P6)", () => {
  it("un dia de OTRO año se rotula igual, sin año", () => {
    expect(separadorDia("2025-08-28T18:00:00Z", AHORA)).toBe("jueves 28 de agosto");
  });

  it("ninguna etiqueta contiene cuatro digitos seguidos", () => {
    for (const iso of [
      "2025-08-28T18:00:00Z",
      "2024-01-01T18:00:00Z",
      "2026-08-26T20:00:00Z",
      "2026-12-31T18:00:00Z",
    ]) {
      expect(separadorDia(iso, AHORA)).not.toMatch(/\d{4}/);
    }
  });

  // La forma pedida por el humano es «jueves x de X»: sin coma. `es-CR` emite
  // «jueves, 28 de agosto» con `format()`; el helper arma la cadena por partes para no
  // depender de los literales del locale.
  it("no lleva coma entre el dia de la semana y el numero", () => {
    expect(separadorDia("2025-08-28T18:00:00Z", AHORA)).not.toContain(",");
  });

  it("empieza en minuscula aunque el ICU de la plataforma capitalizara", () => {
    const etiqueta = separadorDia("2026-08-26T20:00:00Z", AHORA);
    expect(etiqueta[0]).toBe(etiqueta[0]?.toLowerCase());
  });
});

describe("separadorDia — la frontera de Costa Rica (el off-by-one)", () => {
  // 22:00 CR del 28 de agosto. En UTC ya es el 29: quien calcule «hoy» en UTC dira «ayer»
  // para un mensaje de las 21:00 CR del MISMO dia.
  const AHORA_NOCHE_CR = new Date("2026-08-29T04:00:00Z");

  it("a las 22:00 CR, un mensaje de las 21:00 CR del mismo dia es «hoy»", () => {
    expect(separadorDia("2026-08-29T03:00:00Z", AHORA_NOCHE_CR)).toBe("hoy");
  });

  it("a las 22:00 CR, un mensaje del dia anterior sigue siendo «ayer»", () => {
    expect(separadorDia("2026-08-28T03:00:00Z", AHORA_NOCHE_CR)).toBe("ayer");
  });

  // 23:00 CR del 28 de agosto (= 2026-08-29T05:00:00Z). Leido desde otro dia, se agrupa como
  // 28 de agosto, no como 29: el formateador va en `America/Costa_Rica`, no en UTC.
  it("un mensaje de las 23:00 CR se rotula con el dia CR, no con el dia UTC", () => {
    const AHORA_OTRO_DIA = new Date("2026-09-05T18:00:00Z");
    expect(separadorDia("2026-08-29T05:00:00Z", AHORA_OTRO_DIA)).toBe("viernes 28 de agosto");
  });

  it("la medianoche CR exacta ya pertenece al dia siguiente", () => {
    const AHORA_OTRO_DIA = new Date("2026-09-05T18:00:00Z");
    expect(separadorDia("2026-08-29T06:00:00Z", AHORA_OTRO_DIA)).toBe("sábado 29 de agosto");
  });
});

describe("claveDiaCR — agrupacion del separador (un separador por dia)", () => {
  it("dos mensajes del mismo dia CR comparten clave aunque cambien de dia en UTC", () => {
    expect(claveDiaCR("2026-08-28T13:00:00Z")).toBe("2026-08-28");
    expect(claveDiaCR("2026-08-29T05:59:00Z")).toBe("2026-08-28");
  });

  it("la medianoche CR abre clave nueva", () => {
    expect(claveDiaCR("2026-08-29T06:00:00Z")).toBe("2026-08-29");
  });
});
