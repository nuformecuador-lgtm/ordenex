import { describe, it, expect } from "vitest";
import { tiempoRelativo } from "@/lib/utils/tiempo-relativo";

// FICHA 409 (T1.1, R33) — el instante relativo en palabras, con RELOJ FIJO.
//
// Los literales estan ESCRITOS A MANO, nunca comparados contra la funcion que los compone: un
// aserto contra su propia fuente esta siempre verde y ya dejo pasar un tope que la app rechazaba.
//
// ⚠️ LOS DOS CASOS QUE JUSTIFICAN EL DISEÑO son los bordes de «ayer» en hora de COSTA RICA, y por
// eso van con su instante UTC escrito al lado: CR es UTC−6 fijo, asi que las 23:59 CR del dia D
// son las 05:59Z del dia D+1, y las 00:01 CR del dia D+1 son las 06:01Z del dia D+1. Un corte por
// «han pasado 24 h» se equivoca en los dos.

/** 2026-07-27 a las 12:00 CR = 18:00Z. El «ahora» de casi todos los casos. */
const AHORA = new Date("2026-07-27T18:00:00.000Z");
const MIN = 60 * 1000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

describe("R33 — la granularidad del contrato visual", () => {
  it("menos de un minuto no dice «hace 0 min»", () => {
    expect(tiempoRelativo(new Date(AHORA.getTime() - 30 * 1000), AHORA)).toBe("hace un momento");
  });

  it("minutos", () => {
    expect(tiempoRelativo(new Date(AHORA.getTime() - 40 * MIN), AHORA)).toBe("hace 40 min");
    expect(tiempoRelativo(new Date(AHORA.getTime() - 15 * MIN), AHORA)).toBe("hace 15 min");
    expect(tiempoRelativo(new Date(AHORA.getTime() - 1 * MIN), AHORA)).toBe("hace 1 min");
  });

  it("horas", () => {
    expect(tiempoRelativo(new Date(AHORA.getTime() - 1 * HORA), AHORA)).toBe("hace 1 h");
    expect(tiempoRelativo(new Date(AHORA.getTime() - 2 * HORA), AHORA)).toBe("hace 2 h");
    expect(tiempoRelativo(new Date(AHORA.getTime() - 9 * HORA), AHORA)).toBe("hace 9 h");
  });

  it("dias", () => {
    expect(tiempoRelativo(new Date(AHORA.getTime() - 2 * DIA), AHORA)).toBe("hace 2 d");
    expect(tiempoRelativo(new Date(AHORA.getTime() - 3 * DIA), AHORA)).toBe("hace 3 d");
    expect(tiempoRelativo(new Date(AHORA.getTime() - 30 * DIA), AHORA)).toBe("hace 30 d");
  });
});

describe("R33 — «ayer» es el dia CALENDARIO de Costa Rica anterior, no «hace mas de 24 h»", () => {
  it("un aviso de las 23:59 CR leido a las 00:01 CR es de AYER, aunque lleve 2 minutos", () => {
    const emitido = new Date("2026-07-27T05:59:00.000Z"); // 23:59 CR del 26 de julio
    const leidoAlMinutoSiguiente = new Date("2026-07-27T06:01:00.000Z"); // 00:01 CR del 27

    expect(tiempoRelativo(emitido, leidoAlMinutoSiguiente)).toBe("ayer");
  });

  it("un aviso de hace 20 horas del MISMO dia CR sigue diciendo las horas", () => {
    // 2026-07-27 a las 22:00 CR = 04:00Z del 28. El aviso es de las 02:00 CR del MISMO 27.
    const ahora = new Date("2026-07-28T04:00:00.000Z");
    const emitido = new Date("2026-07-27T08:00:00.000Z"); // 02:00 CR del 27

    expect(tiempoRelativo(emitido, ahora)).toBe("hace 20 h");
  });

  it("las 00:01 CR de hoy, leidas a las 00:02 CR de hoy, NO son ayer", () => {
    const emitido = new Date("2026-07-27T06:01:00.000Z"); // 00:01 CR del 27
    const ahora = new Date("2026-07-27T06:02:00.000Z"); // 00:02 CR del 27

    expect(tiempoRelativo(emitido, ahora)).toBe("hace 1 min");
  });

  it("dos dias CR atras deja de ser «ayer»", () => {
    const emitido = new Date("2026-07-25T20:00:00.000Z"); // 14:00 CR del 25
    const ahora = new Date("2026-07-27T18:00:00.000Z"); // 12:00 CR del 27

    expect(tiempoRelativo(emitido, ahora)).toBe("hace 2 d");
  });
});

describe("R33 — una fecha futura no produce negativos", () => {
  it("un aviso con fecha por delante del reloj cae en «hace un momento»", () => {
    expect(tiempoRelativo(new Date(AHORA.getTime() + 5 * HORA), AHORA)).toBe("hace un momento");
    expect(tiempoRelativo(new Date(AHORA.getTime() + 3 * DIA), AHORA)).toBe("hace un momento");
  });
});

describe("R32 — la funcion es PURA: no lee el reloj", () => {
  it("el mismo par de fechas da siempre el mismo texto", () => {
    const desde = new Date("2026-07-27T16:00:00.000Z");
    const primera = tiempoRelativo(desde, AHORA);
    const segunda = tiempoRelativo(desde, AHORA);

    expect(primera).toBe("hace 2 h");
    expect(segunda).toBe(primera);
  });
});
