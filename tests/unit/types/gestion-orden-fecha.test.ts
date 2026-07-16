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
    expect(esFechaFutura("2026-02-31", MANANA_CR_15)).toBe(false);
  });
});
