import { describe, it, expect } from "vitest";
import { diaIsoDe, proximaOcurrencia } from "@/lib/whatsapp-envios/proxima-ocurrencia";

// Ficha 474 (T2.1, R20/R22) — la proxima ocurrencia de un envio a hora fija. CR = UTC-6 fijo:
// las 05:00 CR son las 11:00 UTC. Los instantes esperados estan escritos A MANO.

describe("474/R22 — proximaOcurrencia", () => {
  it("2026-10-05 es lunes (ISO 1) y 2026-10-11 domingo (ISO 7)", () => {
    expect(diaIsoDe("2026-10-05")).toBe(1);
    expect(diaIsoDe("2026-10-11")).toBe(7);
  });

  it("hoy, si la hora aun no paso", () => {
    // lunes 2026-10-05 04:00 CR = 10:00 UTC; envio lunes a las 05:00 CR
    const r = proximaOcurrencia([1], "05:00", new Date("2026-10-05T10:00:00.000Z"));
    expect(r).toEqual({ fechaCr: "2026-10-05", instante: new Date("2026-10-05T11:00:00.000Z") });
  });

  it("R20: una hora ya pasada hoy cae en la proxima ocurrencia, sin recuperar lo pasado", () => {
    // lunes 06:00 CR; envio lunes a las 05:00 -> el lunes siguiente
    const r = proximaOcurrencia([1], "05:00", new Date("2026-10-05T12:00:00.000Z"));
    expect(r).toEqual({ fechaCr: "2026-10-12", instante: new Date("2026-10-12T11:00:00.000Z") });
  });

  it("desde EXACTAMENTE en el instante no lo repite (estrictamente posterior)", () => {
    const r = proximaOcurrencia([1, 2], "05:00", new Date("2026-10-05T11:00:00.000Z"));
    expect(r?.fechaCr).toBe("2026-10-06");
  });

  it("cruce domingo -> lunes", () => {
    // domingo 2026-10-11 23:00 CR = lunes 05:00 UTC; envio lunes 05:00
    const r = proximaOcurrencia([1], "05:00", new Date("2026-10-12T05:00:00.000Z"));
    expect(r).toEqual({ fechaCr: "2026-10-12", instante: new Date("2026-10-12T11:00:00.000Z") });
  });

  it("el dia CR manda, no el UTC: a las 19:00 CR del lunes ya es martes en UTC", () => {
    // lunes 19:00 CR = martes 01:00 UTC; envio martes 05:00 -> martes 6
    const r = proximaOcurrencia([2], "05:00", new Date("2026-10-06T01:00:00.000Z"));
    expect(r?.fechaCr).toBe("2026-10-06");
  });

  it("23:59 CR es 05:59 UTC del dia siguiente", () => {
    const r = proximaOcurrencia([3], "23:59", new Date("2026-10-05T10:00:00.000Z"));
    expect(r).toEqual({ fechaCr: "2026-10-07", instante: new Date("2026-10-08T05:59:00.000Z") });
  });

  it("sin dias validos -> null", () => {
    expect(proximaOcurrencia([], "05:00", new Date())).toBeNull();
    expect(proximaOcurrencia([0, 8], "05:00", new Date())).toBeNull();
  });
});
