import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fechaComoDate, fechaObjetivo, ventanaDelDia } from "@/lib/ranking/snapshot-dia";

// Feature 196 (T0.3) — la fecha que congela el cron y su ventana. Cubre R2: la corrida en
// el instante T congela D−1 en calendario de Costa Rica (UTC-6 fijo) y ninguna otra fecha.

describe("fechaObjetivo — D−1 en calendario CR (R2)", () => {
  it("con la corrida de las 02:00 CR congela el dia que acaba de cerrar", () => {
    // 2026-08-11T08:00:00Z == 02:00 CR del 11 -> el dia cerrado es el 10.
    expect(fechaObjetivo(new Date("2026-08-11T08:00:00.000Z"))).toBe("2026-08-10");
  });

  it("no usa UTC para decidir el dia: 19:00 CR sigue siendo el mismo dia CR", () => {
    // 2026-08-11T01:00:00Z == 19:00 CR del 10; en UTC ya es el 11. D−1 es el 9.
    expect(fechaObjetivo(new Date("2026-08-11T01:00:00.000Z"))).toBe("2026-08-09");
  });

  it("cruza el cambio de fecha CR (06:00Z) sin off-by-one", () => {
    // 23:59:59.999 CR del 10 -> dia CR = 10 -> objetivo 9.
    expect(fechaObjetivo(new Date("2026-08-11T05:59:59.999Z"))).toBe("2026-08-09");
    // 00:00:00.000 CR del 11 -> dia CR = 11 -> objetivo 10.
    expect(fechaObjetivo(new Date("2026-08-11T06:00:00.000Z"))).toBe("2026-08-10");
  });

  it("retrocede correctamente sobre cambio de mes y de anio", () => {
    expect(fechaObjetivo(new Date("2026-09-01T08:00:00.000Z"))).toBe("2026-08-31");
    expect(fechaObjetivo(new Date("2027-01-01T08:00:00.000Z"))).toBe("2026-12-31");
    expect(fechaObjetivo(new Date("2028-03-01T08:00:00.000Z"))).toBe("2028-02-29"); // bisiesto
  });

  it("`now` es obligatorio: la funcion no tiene reloj propio", () => {
    expect(fechaObjetivo.length).toBe(1);
    const modulo = leerModulo("lib/ranking/snapshot-dia.ts");
    expect(modulo).not.toContain("new Date()");
    expect(modulo).not.toContain("Date.now()");
  });

  it("dos llamadas con el mismo instante dan la misma fecha", () => {
    const now = new Date("2026-08-11T08:00:00.000Z");
    expect(fechaObjetivo(now)).toBe(fechaObjetivo(now));
  });
});

describe("ventanaDelDia — [fecha+06:00Z, +24h) (R2)", () => {
  it("ambos bordes caen en `T06:00:00.000Z` (00:00 de pared en CR)", () => {
    const { desde, hasta } = ventanaDelDia("2026-08-10");
    expect(desde.toISOString()).toBe("2026-08-10T06:00:00.000Z");
    expect(hasta.toISOString()).toBe("2026-08-11T06:00:00.000Z");
    expect(hasta.getTime() - desde.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("la entrega de las 19:00 CR cae DENTRO del dia congelado", () => {
    const { desde, hasta } = ventanaDelDia("2026-08-10");
    const entrega = new Date("2026-08-11T01:00:00.000Z"); // 19:00 CR del 10
    expect(entrega.getTime()).toBeGreaterThanOrEqual(desde.getTime());
    expect(entrega.getTime()).toBeLessThan(hasta.getTime());
  });

  it("la cota superior es EXCLUSIVA: 00:00:00 CR del dia siguiente queda fuera", () => {
    const { desde, hasta } = ventanaDelDia("2026-08-10");
    const ultimo = new Date("2026-08-11T05:59:59.999Z"); // 23:59:59.999 CR del 10
    const primeroDelSiguiente = new Date("2026-08-11T06:00:00.000Z");
    expect(ultimo.getTime()).toBeGreaterThanOrEqual(desde.getTime());
    expect(ultimo.getTime()).toBeLessThan(hasta.getTime());
    expect(primeroDelSiguiente.getTime()).toBe(hasta.getTime());
  });

  it("la ventana de la fecha objetivo se encadena con el dia siguiente sin solape ni hueco", () => {
    expect(ventanaDelDia("2026-08-10").hasta.getTime()).toBe(
      ventanaDelDia("2026-08-11").desde.getTime(),
    );
  });
});

describe("fechaComoDate — convencion `@db.Date` de la cabecera", () => {
  it("es la MEDIANOCHE UTC de la fecha calendario, no el inicio de la ventana", () => {
    expect(fechaComoDate("2026-08-10").toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(fechaComoDate("2026-08-10").getTime()).not.toBe(
      ventanaDelDia("2026-08-10").desde.getTime(),
    );
  });

  it("la cabecera del dia congelado guarda D−1, coherente con `fechaObjetivo`", () => {
    const fecha = fechaObjetivo(new Date("2026-08-11T08:00:00.000Z"));
    expect(fechaComoDate(fecha).toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });
});

describe("modulo puro — sin acoplamientos prohibidos", () => {
  it("no importa `startOfDayCR`, ni `lib/analytics/`, ni Prisma, ni `next/*`", () => {
    const modulo = leerModulo("lib/ranking/snapshot-dia.ts");
    const imports = modulo
      .split("\n")
      .filter((linea) => /^\s*import\s/.test(linea) || /from\s+"/.test(linea));
    const texto = imports.join("\n");
    expect(texto).not.toContain("startOfDayCR");
    expect(texto).not.toContain("lib/analytics");
    expect(texto).not.toContain("@prisma");
    expect(texto).not.toContain("next/");
    expect(texto).toContain("@/lib/utils/fecha-cr");
  });

  it("no calcula el dia con `toISOString`", () => {
    expect(leerModulo("lib/ranking/snapshot-dia.ts")).not.toContain("toISOString");
  });
});

function leerModulo(relativo: string): string {
  return readFileSync(path.join(path.resolve(__dirname, "../../.."), relativo), "utf8");
}
