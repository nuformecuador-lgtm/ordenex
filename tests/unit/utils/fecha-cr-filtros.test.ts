import { describe, it, expect } from "vitest";
import {
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
  inicioDeUltimosNDiasCREnUtc,
  startOfDayCR,
} from "@/lib/utils/fecha-cr";

// Feature 144/B1 (R41/R42) — bordes temporales del filtro de creacion.
//
// `orden.created_at` es un `timestamp` en UTC y la operacion es de Costa Rica (UTC-6
// fijo, sin horario de verano). El off-by-one clasico son las 6 horas de desfase: la
// medianoche de CR NO es la medianoche UTC del mismo dia, sino las 06:00 UTC.

describe("inicioDelDiaCREnUtc (R41/R42)", () => {
  it("00:00 de Costa Rica de una fecha es las 06:00 UTC de ESA fecha", () => {
    expect(inicioDelDiaCREnUtc("2026-07-15").toISOString()).toBe("2026-07-15T06:00:00.000Z");
  });

  it("NO es lo mismo que startOfDayCR: hay exactamente 6 horas de diferencia", () => {
    // `startOfDayCR` devuelve la MEDIANOCHE UTC de la fecha calendario CR (convencion
    // `@db.Date` de la feature 46). Usarla para comparar contra un timestamp UTC
    // metería en el rango las 6 primeras horas UTC, que en CR son el dia anterior.
    const medianocheUtc = startOfDayCR(new Date("2026-07-15T12:00:00.000Z"));
    expect(medianocheUtc.toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(inicioDelDiaCREnUtc("2026-07-15").getTime() - medianocheUtc.getTime()).toBe(
      6 * 60 * 60 * 1000,
    );
  });

  it("R42: `2026-07-15T05:59:59Z` (23:59:59 CR del 14) queda FUERA de desde=2026-07-15", () => {
    const gte = inicioDelDiaCREnUtc("2026-07-15");
    expect(new Date("2026-07-15T05:59:59.000Z") >= gte).toBe(false);
  });

  it("R42: `2026-07-15T06:00:00Z` (00:00 CR del 15) queda DENTRO de desde=2026-07-15", () => {
    const gte = inicioDelDiaCREnUtc("2026-07-15");
    expect(new Date("2026-07-15T06:00:00.000Z") >= gte).toBe(true);
  });
});

describe("inicioDelDiaSiguienteCREnUtc — `hasta` INCLUSIVE (R42)", () => {
  it("es la cota superior EXCLUSIVA: 06:00 UTC del dia siguiente", () => {
    expect(inicioDelDiaSiguienteCREnUtc("2026-07-15").toISOString()).toBe(
      "2026-07-16T06:00:00.000Z",
    );
  });

  it("hasta=2026-07-15 INCLUYE `2026-07-16T05:59:59Z` (23:59:59 CR del 15)", () => {
    const lt = inicioDelDiaSiguienteCREnUtc("2026-07-15");
    expect(new Date("2026-07-16T05:59:59.000Z") < lt).toBe(true);
  });

  it("hasta=2026-07-15 EXCLUYE `2026-07-16T06:00:00Z` (00:00 CR del 16)", () => {
    const lt = inicioDelDiaSiguienteCREnUtc("2026-07-15");
    expect(new Date("2026-07-16T06:00:00.000Z") < lt).toBe(false);
  });

  it("el error clasico (`<= inicio del MISMO dia`) perderia el dia entero", () => {
    // Documenta por que la cota es el dia SIGUIENTE: con el inicio del mismo dia,
    // una orden de media tarde CR del 15 quedaria fuera de `hasta = 2026-07-15`.
    const mediaTardeCR = new Date("2026-07-15T20:00:00.000Z"); // 14:00 CR del 15
    expect(mediaTardeCR < inicioDelDiaCREnUtc("2026-07-15")).toBe(false);
    expect(mediaTardeCR < inicioDelDiaSiguienteCREnUtc("2026-07-15")).toBe(true);
  });

  it("cruza el fin de mes sin aritmetica de calendario propia", () => {
    expect(inicioDelDiaSiguienteCREnUtc("2026-07-31").toISOString()).toBe(
      "2026-08-01T06:00:00.000Z",
    );
    expect(inicioDelDiaSiguienteCREnUtc("2026-02-28").toISOString()).toBe(
      "2026-03-01T06:00:00.000Z",
    );
  });
});

describe("inicioDeUltimosNDiasCREnUtc — atajo de antiguedad (R41)", () => {
  // 2026-07-15T20:00:00Z = 14:00 CR del 15 de julio.
  const AHORA = new Date("2026-07-15T20:00:00.000Z");

  it("R41: 'ultimos 7 dias' arranca el 00:00 CR de hace 6 dias (7 dias CALENDARIO incl. hoy)", () => {
    expect(inicioDeUltimosNDiasCREnUtc(7, AHORA).toISOString()).toBe("2026-07-09T06:00:00.000Z");
  });

  it("R41: 15/30/90 dias usan la misma regla N-1", () => {
    expect(inicioDeUltimosNDiasCREnUtc(15, AHORA).toISOString()).toBe("2026-07-01T06:00:00.000Z");
    expect(inicioDeUltimosNDiasCREnUtc(30, AHORA).toISOString()).toBe("2026-06-16T06:00:00.000Z");
    expect(inicioDeUltimosNDiasCREnUtc(90, AHORA).toISOString()).toBe("2026-04-17T06:00:00.000Z");
  });

  it("R41: el dia CR se resuelve sobre la hora de pared de CR, no sobre la fecha UTC", () => {
    // 2026-07-16T02:00:00Z son las 20:00 CR del 15: el dia CR sigue siendo el 15,
    // asi que "ultimos 7 dias" arranca igual que a las 14:00 CR del 15.
    const nocheCR = new Date("2026-07-16T02:00:00.000Z");
    expect(inicioDeUltimosNDiasCREnUtc(7, nocheCR).toISOString()).toBe(
      inicioDeUltimosNDiasCREnUtc(7, AHORA).toISOString(),
    );
  });
});
