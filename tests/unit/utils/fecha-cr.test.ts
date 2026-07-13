import { describe, it, expect } from "vitest";
import { startOfDayCR } from "@/lib/utils/fecha-cr";

// Feature 46 (R9) — `startOfDayCR` devuelve la medianoche UTC de la fecha calendario de
// Costa Rica (UTC-6) para "hoy". Casos frontera: 23:59 CR sigue siendo el mismo dia;
// 00:01 CR ya es el dia siguiente; el instante UTC que cruza el offset -6h (06:00Z)
// marca el cambio de dia.

describe("startOfDayCR (R9)", () => {
  it("23:59 CR = mismo dia (medianoche UTC de ESA fecha CR)", () => {
    // 2026-07-14 23:59 CR == 2026-07-15T05:59:00Z
    const now = new Date("2026-07-15T05:59:00.000Z");
    expect(startOfDayCR(now).toISOString()).toBe("2026-07-14T00:00:00.000Z");
  });

  it("00:01 CR = dia siguiente respecto a las 23:59 anteriores", () => {
    // 2026-07-15 00:01 CR == 2026-07-15T06:01:00Z
    const now = new Date("2026-07-15T06:01:00.000Z");
    expect(startOfDayCR(now).toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  it("instante UTC que cruza el offset -6h: 05:59Z (dia previo) vs 06:00Z (dia nuevo)", () => {
    const antes = new Date("2026-07-15T05:59:59.999Z"); // 23:59:59.999 CR del 14
    const justo = new Date("2026-07-15T06:00:00.000Z"); // 00:00:00 CR del 15
    expect(startOfDayCR(antes).toISOString()).toBe("2026-07-14T00:00:00.000Z");
    expect(startOfDayCR(justo).toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  it("mediodia CR resuelve al mismo dia calendario", () => {
    // 2026-07-15 12:00 CR == 2026-07-15T18:00:00Z
    const now = new Date("2026-07-15T18:00:00.000Z");
    expect(startOfDayCR(now).toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  it("normaliza siempre a medianoche UTC (hora/min/seg/ms en cero)", () => {
    const d = startOfDayCR(new Date("2026-03-02T19:23:45.678Z"));
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });
});
