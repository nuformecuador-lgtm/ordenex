import { describe, it, expect } from "vitest";

import { esFechaFutura } from "@/lib/types/gestion-orden";

// R25 — el mínimo de `fechaReprogramacion` es MAÑANA en el calendario de Costa Rica.
// Regresión (off-by-one por zona horaria): la versión anterior comparaba contra los
// campos UTC de `new Date()`, así que entre las 18:00 y la medianoche de CR el día UTC
// ya era el siguiente y rechazaba mañana como si fuera hoy.

/** 20:00 CR del 15 jul = 02:00 UTC del 16: la ventana donde UTC y CR discrepan. */
const NOCHE_CR_15 = new Date("2026-07-16T02:00:00.000Z");
/** 08:00 CR del 15 jul = 14:00 UTC del 15: UTC y CR coinciden en el día. */
const MANANA_CR_15 = new Date("2026-07-15T14:00:00.000Z");

describe("esFechaFutura — mínimo mañana en CR", () => {
  it("de noche en CR acepta mañana (el bug la rechazaba)", () => {
    expect(esFechaFutura("2026-07-16", NOCHE_CR_15)).toBe(true);
  });

  it("de noche en CR rechaza hoy, aunque en UTC ya sea 'ayer'", () => {
    expect(esFechaFutura("2026-07-15", NOCHE_CR_15)).toBe(false);
  });

  it("de día en CR acepta mañana y rechaza hoy", () => {
    expect(esFechaFutura("2026-07-16", MANANA_CR_15)).toBe(true);
    expect(esFechaFutura("2026-07-15", MANANA_CR_15)).toBe(false);
  });

  it("rechaza el pasado", () => {
    expect(esFechaFutura("2026-07-14", MANANA_CR_15)).toBe(false);
    expect(esFechaFutura("2025-01-01", MANANA_CR_15)).toBe(false);
  });

  it("acepta fechas más allá de mañana", () => {
    expect(esFechaFutura("2026-07-17", MANANA_CR_15)).toBe(true);
    expect(esFechaFutura("2026-12-31", MANANA_CR_15)).toBe(true);
  });

  it("rechaza un día que no existe", () => {
    // OJO: este caso pasaba también ANTES del arreglo, pero por el motivo equivocado —
    // "2026-02-31" rueda al 3 de marzo, que es ANTERIOR al 16 de julio, así que lo rechazaba
    // la comparación lexicográfica y no la validación de calendario. El `describe` de abajo
    // usa un reloj que deja la fecha rodada en el FUTURO y sí distingue las dos cosas.
    expect(esFechaFutura("2026-02-31", MANANA_CR_15)).toBe(false);
  });
});

// Regresión — día de calendario INEXISTENTE (features 36/73/100). La versión anterior confiaba
// en que `new Date("2026-02-31T00:00:00.000Z")` daba `Invalid Date`; su comentario lo afirmaba y
// era FALSO en V8: solo el MES fuera de rango invalida, el DÍA desbordado RUEDA al mes
// siguiente. Consecuencia real: una reprogramación al "31 de febrero" se aceptaba y se guardaba
// como 3 de marzo — el sistema elegía la fecha por el usuario, sin avisar.
//
// El reloj es de ENERO a propósito: así toda fecha rodada cae en el FUTURO y pasa la comparación
// lexicográfica. Con un reloj de julio estos casos salen verdes aunque la validación no exista.

/** 08:00 CR del 15 ene 2026 = 14:00 UTC. Mañana en CR = "2026-01-16". */
const ENERO_CR_15 = new Date("2026-01-15T14:00:00.000Z");

describe("esFechaFutura — el día inexistente NO rueda: se rechaza", () => {
  it("deja constancia de lo que V8 hace de verdad (el comentario decía lo contrario)", () => {
    // Si algún día V8 empezara a devolver Invalid Date con el día desbordado, este test lo dirá.
    expect(new Date("2026-02-31T00:00:00.000Z").toISOString().slice(0, 10)).toBe("2026-03-03");
    expect(Number.isNaN(new Date("2026-13-01T00:00:00.000Z").getTime())).toBe(true);
  });

  it.each([
    ["31 de febrero (rodaba a 2026-03-03)", "2026-02-31"],
    ["31 de abril (rodaba a 2026-05-01)", "2026-04-31"],
    ["30 de febrero (rodaba a 2026-03-02)", "2026-02-30"],
    ["29 de febrero de año NO bisiesto (rodaba a 2027-03-01)", "2027-02-29"],
  ])("rechaza el %s", (_caso, fecha) => {
    expect(esFechaFutura(fecha, ENERO_CR_15)).toBe(false);
  });

  it("el mes fuera de rango se sigue rechazando (era el único caso que ya funcionaba)", () => {
    expect(esFechaFutura("2026-13-01", ENERO_CR_15)).toBe(false);
  });

  it("NO se pasa de duro: el 29 de febrero de un año BISIESTO se acepta", () => {
    expect(esFechaFutura("2028-02-29", ENERO_CR_15)).toBe(true);
  });

  it("el último día real de cada mes se sigue aceptando", () => {
    expect(esFechaFutura("2026-02-28", ENERO_CR_15)).toBe(true);
    expect(esFechaFutura("2026-04-30", ENERO_CR_15)).toBe(true);
    expect(esFechaFutura("2026-12-31", ENERO_CR_15)).toBe(true);
  });
});
