import { afterEach, describe, expect, it, vi } from "vitest";

import { ventanaDelDiaEnCursoCR } from "@/lib/utils/ventana-dia-cr";

// Feature 192 (B1.2) — R12-R16. La ventana del dia CR con el reloj CONGELADO en los
// instantes frontera. Costa Rica es UTC-6 fijo (sin horario de verano), asi que el dia
// `YYYY-MM-DD` va de `T06:00:00.000Z` a `T06:00:00.000Z` del dia siguiente, semiabierto.
//
// Todos los instantes de este archivo se escriben en UTC y se anota al lado su hora de
// pared en CR, para que el lector no tenga que hacer la resta mentalmente.

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/** `true` si `instante` cae dentro del intervalo SEMIABIERTO `[desde, hasta)`. */
function dentro(ventana: { desde: Date; hasta: Date }, instante: Date): boolean {
  return instante >= ventana.desde && instante < ventana.hasta;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("R12 — la ventana es [fecha T06:00Z, fecha+1 T06:00Z), semiabierta", () => {
  it("05:59:59.999Z pertenece al dia CR ANTERIOR (en CR son las 23:59:59.999 de ayer)", () => {
    const ventana = ventanaDelDiaEnCursoCR(new Date("2026-08-08T05:59:59.999Z"));

    expect(ventana.fecha).toBe("2026-08-07");
    expect(ventana.desde.toISOString()).toBe("2026-08-07T06:00:00.000Z");
    expect(ventana.hasta.toISOString()).toBe("2026-08-08T06:00:00.000Z");
  });

  it("06:00:00.000Z es el PRIMER instante del dia CR (00:00 de pared en CR)", () => {
    const ventana = ventanaDelDiaEnCursoCR(new Date("2026-08-08T06:00:00.000Z"));

    expect(ventana.fecha).toBe("2026-08-08");
    expect(ventana.desde.toISOString()).toBe("2026-08-08T06:00:00.000Z");
    expect(ventana.hasta.toISOString()).toBe("2026-08-09T06:00:00.000Z");
  });

  it("`desde` es siempre T06:00:00.000Z de su fecha y `hasta` es exactamente 24 h despues", () => {
    for (const instante of [
      "2026-08-08T05:59:59.999Z",
      "2026-08-08T06:00:00.000Z",
      "2026-08-08T13:00:00.000Z",
      "2026-08-09T01:00:00.000Z",
      "2026-12-31T23:00:00.000Z", // cruce de anio: 17:00 CR del 31 de diciembre
    ]) {
      const ventana = ventanaDelDiaEnCursoCR(new Date(instante));

      expect(ventana.desde.toISOString()).toBe(`${ventana.fecha}T06:00:00.000Z`);
      expect(ventana.hasta.getTime() - ventana.desde.getTime()).toBe(UN_DIA_MS);
    }
  });

  it("la cota superior es EXCLUSIVA: su propio instante ya es del dia siguiente", () => {
    const ventana = ventanaDelDiaEnCursoCR(new Date("2026-08-08T13:00:00.000Z"));

    expect(dentro(ventana, ventana.desde)).toBe(true);
    expect(dentro(ventana, new Date(ventana.hasta.getTime() - 1))).toBe(true);
    expect(dentro(ventana, ventana.hasta)).toBe(false);
  });
});

describe("R13 — consultando a las 19:00 CR, la ventana NO se desplaza a 18:00-18:00", () => {
  // 19:00 CR del 8 de agosto == 01:00Z del 9 de agosto (ya es "manana" en UTC).
  const ventana = ventanaDelDiaEnCursoCR(new Date("2026-08-09T01:00:00.000Z"));

  it("el dia representado sigue siendo el 8 de agosto en Costa Rica", () => {
    expect(ventana.fecha).toBe("2026-08-08");
  });

  it("incluye una orden asignada a las 07:00 CR de ESE mismo dia", () => {
    // 07:00 CR del 8 == 13:00Z del 8. Con la ventana rota (18:00-18:00 UTC) se perderia.
    expect(dentro(ventana, new Date("2026-08-08T13:00:00.000Z"))).toBe(true);
  });

  it("no adelanta la ventana a las 18:00Z del dia anterior", () => {
    expect(ventana.desde.toISOString()).toBe("2026-08-08T06:00:00.000Z");
    expect(dentro(ventana, new Date("2026-08-07T18:30:00.000Z"))).toBe(false);
  });
});

describe("R14 — una orden asignada a las 23:00 CR de AYER no cuenta hoy", () => {
  it("23:00 CR del 7 de agosto queda fuera de la ventana del 8", () => {
    const ventana = ventanaDelDiaEnCursoCR(new Date("2026-08-09T01:00:00.000Z")); // 19:00 CR del 8
    // 23:00 CR del 7 == 05:00Z del 8: el mismo dia en UTC, el dia ANTERIOR en CR.
    const asignadaAyer = new Date("2026-08-08T05:00:00.000Z");

    expect(ventana.fecha).toBe("2026-08-08");
    expect(dentro(ventana, asignadaAyer)).toBe(false);
    expect(asignadaAyer < ventana.desde).toBe(true);
  });
});

describe("R15 — una orden asignada a las 00:30 CR de hoy SI cuenta hoy", () => {
  it("00:30 CR del 8 de agosto cae dentro de la ventana del 8", () => {
    const ventana = ventanaDelDiaEnCursoCR(new Date("2026-08-09T01:00:00.000Z")); // 19:00 CR del 8
    // 00:30 CR del 8 == 06:30Z del 8.
    expect(dentro(ventana, new Date("2026-08-08T06:30:00.000Z"))).toBe(true);
  });

  it("consultada a las 00:30 CR, la ventana ya es la del dia nuevo", () => {
    const ventana = ventanaDelDiaEnCursoCR(new Date("2026-08-08T06:30:00.000Z"));

    expect(ventana.fecha).toBe("2026-08-08");
    expect(ventana.desde.toISOString()).toBe("2026-08-08T06:00:00.000Z");
  });
});

describe("R16 — el instante de referencia ENTRA como parametro", () => {
  it("`now` es obligatorio: la funcion declara exactamente un parametro, sin default", () => {
    expect(ventanaDelDiaEnCursoCR).toHaveLength(1);
  });

  it("el resultado no depende del reloj del proceso", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-03-01T12:00:00.000Z"));

    const ventana = ventanaDelDiaEnCursoCR(new Date("2026-08-08T13:00:00.000Z"));

    expect(ventana.fecha).toBe("2026-08-08");
    expect(ventana.desde.toISOString()).toBe("2026-08-08T06:00:00.000Z");
  });

  it("dos instantes distintos del mismo dia CR producen la MISMA ventana", () => {
    const temprano = ventanaDelDiaEnCursoCR(new Date("2026-08-08T06:00:00.000Z"));
    const tardio = ventanaDelDiaEnCursoCR(new Date("2026-08-09T05:59:59.999Z"));

    expect(tardio.fecha).toBe(temprano.fecha);
    expect(tardio.desde.getTime()).toBe(temprano.desde.getTime());
    expect(tardio.hasta.getTime()).toBe(temprano.hasta.getTime());
  });
});
