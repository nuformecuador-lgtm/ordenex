import { describe, it, expect } from "vitest";
import { periodoMensualCR } from "@/lib/utils/fecha-cr";

// Feature 45 (R30) — `periodoMensualCR` devuelve el periodo `YYYY-MM` de la fecha CALENDARIO de
// Costa Rica (UTC-6). Casos frontera: 00:00 CR del dia 1 (el instante que cruza al mes nuevo) y
// 23:59 CR del ultimo dia del mes anterior deben caer en meses DISTINTOS.

describe("periodoMensualCR (R30)", () => {
  it("00:00 CR del 1 de julio (06:00Z) -> '2026-07'", () => {
    expect(periodoMensualCR(new Date("2026-07-01T06:00:00.000Z"))).toBe("2026-07");
  });

  it("23:59 CR del 30 de junio (05:59Z del 1 jul) -> '2026-06' (mes anterior)", () => {
    expect(periodoMensualCR(new Date("2026-07-01T05:59:00.000Z"))).toBe("2026-06");
  });

  it("frontera exacta del cruce -6h: 05:59:59.999Z (jun) vs 06:00:00Z (jul)", () => {
    expect(periodoMensualCR(new Date("2026-07-01T05:59:59.999Z"))).toBe("2026-06");
    expect(periodoMensualCR(new Date("2026-07-01T06:00:00.000Z"))).toBe("2026-07");
  });

  it("mediodia CR resuelve al mes calendario de CR", () => {
    // 2026-07-15 12:00 CR == 2026-07-15T18:00:00Z
    expect(periodoMensualCR(new Date("2026-07-15T18:00:00.000Z"))).toBe("2026-07");
  });

  it("frontera de anio: 23:59 CR del 31 de diciembre -> '2026-12' (no 2027-01)", () => {
    // 2026-12-31 23:59 CR == 2027-01-01T05:59:00Z
    expect(periodoMensualCR(new Date("2027-01-01T05:59:00.000Z"))).toBe("2026-12");
    // 2027-01-01 00:00 CR == 2027-01-01T06:00:00Z
    expect(periodoMensualCR(new Date("2027-01-01T06:00:00.000Z"))).toBe("2027-01");
  });

  it("padea el mes a 2 digitos (enero -> '01')", () => {
    expect(periodoMensualCR(new Date("2026-01-15T18:00:00.000Z"))).toBe("2026-01");
  });
});
