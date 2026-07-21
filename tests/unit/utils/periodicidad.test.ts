import { describe, it, expect } from "vitest";
import { aplicaHoy, periodoDe, type PlantillaPeriodica } from "@/lib/utils/periodicidad";

// Feature 84 — logica PURA de la periodicidad. Todo con reloj inyectado (`now`). Las fechas de
// prueba se dan a mediodia CR para no rozar el borde del dia: 12:00 CR = 18:00 UTC (UTC-6). Asi
// `startOfDayCR(now)` cae en el dia calendario CR esperado sin ambiguedad.

/** 12:00 CR del dia calendario `YYYY-MM-DD` (== 18:00 UTC), lejos del borde del dia. */
function mediodiaCR(fecha: string): Date {
  return new Date(`${fecha}T18:00:00.000Z`);
}

function plantilla(over: Partial<PlantillaPeriodica>): PlantillaPeriodica {
  return { periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-01-01", ...over };
}

describe("aplicaHoy — antes del ancla (fecha_cobro)", () => {
  it("NO cobra ningun dia anterior a fecha_cobro, sea cual sea la unidad", () => {
    const p = plantilla({ periodicidadUnidad: "dias", periodicidadCantidad: 1, fechaCobro: "2026-07-10" });
    expect(aplicaHoy(p, mediodiaCR("2026-07-09"))).toBe(false);
    expect(aplicaHoy(p, mediodiaCR("2026-07-01"))).toBe(false);
  });

  it("el DIA EXACTO del ancla dispara (diff 0)", () => {
    expect(aplicaHoy(plantilla({ periodicidadUnidad: "dias", fechaCobro: "2026-07-10" }), mediodiaCR("2026-07-10"))).toBe(true);
    expect(aplicaHoy(plantilla({ periodicidadUnidad: "semanas", fechaCobro: "2026-07-10" }), mediodiaCR("2026-07-10"))).toBe(true);
    expect(aplicaHoy(plantilla({ periodicidadUnidad: "meses", fechaCobro: "2026-07-10" }), mediodiaCR("2026-07-10"))).toBe(true);
  });
});

describe("aplicaHoy — diaria (1 dias)", () => {
  const p = plantilla({ periodicidadUnidad: "dias", periodicidadCantidad: 1, fechaCobro: "2026-07-10" });
  it("dispara todos los dias desde el ancla", () => {
    for (const f of ["2026-07-10", "2026-07-11", "2026-07-12", "2026-08-01"]) {
      expect(aplicaHoy(p, mediodiaCR(f))).toBe(true);
    }
  });
});

describe("aplicaHoy — cada 3 dias", () => {
  const p = plantilla({ periodicidadUnidad: "dias", periodicidadCantidad: 3, fechaCobro: "2026-07-10" });
  it("dispara el 10, 13, 16, 19; NO el 11/12/14/15", () => {
    for (const f of ["2026-07-10", "2026-07-13", "2026-07-16", "2026-07-19"]) {
      expect(aplicaHoy(p, mediodiaCR(f))).toBe(true);
    }
    for (const f of ["2026-07-11", "2026-07-12", "2026-07-14", "2026-07-15"]) {
      expect(aplicaHoy(p, mediodiaCR(f))).toBe(false);
    }
  });
});

describe("aplicaHoy — semanal (1 semanas)", () => {
  const p = plantilla({ periodicidadUnidad: "semanas", periodicidadCantidad: 1, fechaCobro: "2026-07-10" });
  it("dispara cada 7 dias (10, 17, 24, 31); NO en el medio", () => {
    for (const f of ["2026-07-10", "2026-07-17", "2026-07-24", "2026-07-31"]) {
      expect(aplicaHoy(p, mediodiaCR(f))).toBe(true);
    }
    for (const f of ["2026-07-11", "2026-07-16", "2026-07-18", "2026-07-23"]) {
      expect(aplicaHoy(p, mediodiaCR(f))).toBe(false);
    }
  });
});

describe("aplicaHoy — quincenal (2 semanas)", () => {
  const p = plantilla({ periodicidadUnidad: "semanas", periodicidadCantidad: 2, fechaCobro: "2026-07-10" });
  it("dispara cada 14 dias (10, 24, ago-07); NO a los 7 dias (17)", () => {
    expect(aplicaHoy(p, mediodiaCR("2026-07-10"))).toBe(true);
    expect(aplicaHoy(p, mediodiaCR("2026-07-24"))).toBe(true);
    expect(aplicaHoy(p, mediodiaCR("2026-08-07"))).toBe(true);
    expect(aplicaHoy(p, mediodiaCR("2026-07-17"))).toBe(false); // media quincena
  });
});

describe("aplicaHoy — mensual (1 meses)", () => {
  const p = plantilla({ periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-07-15" });
  it("dispara el mismo dia cada mes (15 jul, 15 ago, 15 sep); NO otros dias", () => {
    for (const f of ["2026-07-15", "2026-08-15", "2026-09-15"]) {
      expect(aplicaHoy(p, mediodiaCR(f))).toBe(true);
    }
    for (const f of ["2026-07-14", "2026-07-16", "2026-08-14"]) {
      expect(aplicaHoy(p, mediodiaCR(f))).toBe(false);
    }
  });

  it("mensual dia 1 (comportamiento legacy): dispara el 1 de cada mes", () => {
    const legacy = plantilla({ periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-01-01" });
    expect(aplicaHoy(legacy, mediodiaCR("2026-07-01"))).toBe(true);
    expect(aplicaHoy(legacy, mediodiaCR("2026-07-02"))).toBe(false);
  });
});

describe("aplicaHoy — cada 6 meses", () => {
  const p = plantilla({ periodicidadUnidad: "meses", periodicidadCantidad: 6, fechaCobro: "2026-01-20" });
  it("dispara ene-20 y jul-20; NO en abr-20 (mes intermedio)", () => {
    expect(aplicaHoy(p, mediodiaCR("2026-01-20"))).toBe(true);
    expect(aplicaHoy(p, mediodiaCR("2026-07-20"))).toBe(true);
    expect(aplicaHoy(p, mediodiaCR("2026-04-20"))).toBe(false);
  });
});

describe("aplicaHoy — CLAMPING de fin de mes (ancla 31)", () => {
  const p = plantilla({ periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-01-31" });
  it("ancla 31 cobra el 28 en febrero (2026 no bisiesto), NO se saltea el mes", () => {
    expect(aplicaHoy(p, mediodiaCR("2026-02-28"))).toBe(true);
    expect(aplicaHoy(p, mediodiaCR("2026-02-27"))).toBe(false);
  });
  it("ancla 31 cobra el 30 en abril (mes de 30 dias)", () => {
    expect(aplicaHoy(p, mediodiaCR("2026-04-30"))).toBe(true);
    expect(aplicaHoy(p, mediodiaCR("2026-04-29"))).toBe(false);
  });
  it("ancla 31 cobra el 31 en meses de 31 dias (mar, may)", () => {
    expect(aplicaHoy(p, mediodiaCR("2026-03-31"))).toBe(true);
    expect(aplicaHoy(p, mediodiaCR("2026-05-31"))).toBe(true);
  });
  it("año BISIESTO: ancla 31 cobra el 29 en febrero 2028", () => {
    const b = plantilla({ periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2028-01-31" });
    expect(aplicaHoy(b, mediodiaCR("2028-02-29"))).toBe(true);
    expect(aplicaHoy(b, mediodiaCR("2028-02-28"))).toBe(false);
  });
});

describe("aplicaHoy — CLAMPING de fin de mes (ancla 30)", () => {
  const p = plantilla({ periodicidadUnidad: "meses", periodicidadCantidad: 1, fechaCobro: "2026-01-30" });
  it("ancla 30 cobra el 28 en febrero (no bisiesto) y el 30 en abril", () => {
    expect(aplicaHoy(p, mediodiaCR("2026-02-28"))).toBe(true);
    expect(aplicaHoy(p, mediodiaCR("2026-04-30"))).toBe(true);
  });
});

describe("periodoDe — clave de idempotencia por unidad", () => {
  it("meses -> `YYYY-MM` (formato legacy, NO cambia en el deploy: evita doble cobro)", () => {
    const p = plantilla({ periodicidadUnidad: "meses", fechaCobro: "2026-07-01" });
    expect(periodoDe(p, mediodiaCR("2026-07-01"))).toBe("2026-07");
    expect(periodoDe(p, mediodiaCR("2026-08-01"))).toBe("2026-08");
  });
  it("dias -> `YYYY-MM-DD` (fecha CR del disparo)", () => {
    const p = plantilla({ periodicidadUnidad: "dias", fechaCobro: "2026-07-10" });
    expect(periodoDe(p, mediodiaCR("2026-07-13"))).toBe("2026-07-13");
  });
  it("semanas -> `YYYY-MM-DD`", () => {
    const p = plantilla({ periodicidadUnidad: "semanas", fechaCobro: "2026-07-10" });
    expect(periodoDe(p, mediodiaCR("2026-07-24"))).toBe("2026-07-24");
  });
});
