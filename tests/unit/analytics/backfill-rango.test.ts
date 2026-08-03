import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  HORIZONTE_HISTORIAL_CR,
  esNoComparable,
  planificarBackfill,
} from "@/lib/analytics/backfill-rango";

/**
 * Feature 125 / T1.2 — el PLANIFICADOR PURO del rango. Cubre R6-R10 y la mitad de R20 que se
 * puede medir sin base (la clasificacion; la consecuencia real del horizonte la mide
 * `tests/integration/db/analytics-daily-backfill.test.ts`).
 *
 * El reloj se INYECTA en todos los casos: un test que dependiera de `new Date()` real se
 * pondria rojo solo por pasar la medianoche de Costa Rica.
 */

/** Instante UTC de una hora de PARED de Costa Rica (UTC-6 fijo, sin horario de verano). */
function instanteCR(fecha: string, horaCR: string): Date {
  const [y, m, d] = fecha.split("-").map((n) => Number.parseInt(n, 10));
  const [hh, mm] = horaCR.split(":").map((n) => Number.parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d, hh + 6, mm, 0));
}

/** Atajo: plan aceptado o explota con el motivo, para que las aserciones no anden con `if`. */
function planDe(desde: string, hasta: string, ahora: Date) {
  const r = planificarBackfill({ desde, hasta, ahora });
  if (!r.ok) throw new Error(`se esperaba un plan aceptado y se rechazo: ${r.motivo}`);
  return r.plan;
}

const AHORA = instanteCR("2026-08-02", "09:00");

describe("R9 · el plan sale de fecha-cr y recorre el calendario CR", () => {
  it("el plan sale de fecha-cr: el borde del dia CR decide la fecha de hoy, no el reloj UTC (R8)", () => {
    // 23:59 CR del 1 de agosto son las 05:59 UTC del 2: para UTC ya es dia 2, para CR no.
    // Si el planificador usara `toISOString().slice(0,10)` en vez de `fecha-cr`, rechazaria
    // el 2026-08-01 por «dia en curso» y admitiria el 2026-08-02, exactamente al reves.
    const casiMedianocheCR = instanteCR("2026-08-01", "23:59");
    expect(planificarBackfill({ desde: "2026-08-01", hasta: "2026-08-01", ahora: casiMedianocheCR }).ok).toBe(
      false,
    );
    const plan = planDe("2026-07-31", "2026-07-31", casiMedianocheCR);
    expect(plan.fechas).toEqual(["2026-07-31"]);
  });

  it("produce N fechas ascendentes y sin repetidos para un rango de N dias, inclusivo en ambos extremos", () => {
    const plan = planDe("2026-07-20", "2026-07-22", AHORA);
    expect(plan.fechas).toEqual(["2026-07-20", "2026-07-21", "2026-07-22"]);

    const largo = planDe("2026-06-01", "2026-06-30", AHORA);
    expect(largo.fechas).toHaveLength(30);
    expect(new Set(largo.fechas).size).toBe(30);
    expect([...largo.fechas].sort()).toEqual([...largo.fechas]);
    expect(largo.fechas[0]).toBe("2026-06-01");
    expect(largo.fechas[29]).toBe("2026-06-30");
  });

  it("cruza fin de mes, fin de ano y bisiesto; N fechas ascendentes y sin repetidos para N dias", () => {
    expect(planDe("2026-01-30", "2026-02-02", AHORA).fechas).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
    // Fin de ano.
    expect(planDe("2025-12-30", "2026-01-02", AHORA).fechas).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
    // Bisiesto: 2024 SI tiene 29 de febrero.
    expect(planDe("2024-02-27", "2024-03-01", AHORA).fechas).toEqual([
      "2024-02-27",
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
    // No bisiesto: 2026 NO lo tiene, y el recorrido no lo inventa.
    expect(planDe("2026-02-27", "2026-03-01", AHORA).fechas).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
    ]);
    // Febrero de un ano divisible por 100 y no por 400: 2100 NO es bisiesto.
    expect(planDe("2100-02-27", "2100-03-01", instanteCR("2100-06-01", "09:00")).fechas).toEqual([
      "2100-02-27",
      "2100-02-28",
      "2100-03-01",
    ]);
  });

  it("un rango de un solo dia produce exactamente esa fecha", () => {
    expect(planDe("2026-07-15", "2026-07-15", AHORA).fechas).toEqual(["2026-07-15"]);
  });
});

describe("R6/R7 · el rango se rechaza entero antes de tocar nada", () => {
  it("rechaza el formato invalido nombrando cual de las dos puntas esta mal", () => {
    for (const mala of ["2026-13-01", "2026-02-30", "20260715", "2026-7-15", "ayer", ""]) {
      const r = planificarBackfill({ desde: mala, hasta: "2026-07-20", ahora: AHORA });
      expect(r.ok, `deberia rechazar --desde "${mala}"`).toBe(false);
      if (!r.ok) expect(r.motivo).toContain("--desde");
    }
    const r = planificarBackfill({ desde: "2026-07-20", hasta: "2026-02-31", ahora: AHORA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("--hasta");
  });

  it("rechaza desde > hasta y lo dice con las dos fechas", () => {
    const r = planificarBackfill({ desde: "2026-07-22", hasta: "2026-07-20", ahora: AHORA });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain("2026-07-22");
      expect(r.motivo).toContain("2026-07-20");
    }
  });
});

describe("R10 · con el reloj inyectado rechaza el rango que incluye hoy CR o manana CR, nombrando la fecha ofensora", () => {
  it("rechaza el rango que TERMINA hoy CR y nombra hoy como ofensora", () => {
    const r = planificarBackfill({ desde: "2026-07-30", hasta: "2026-08-02", ahora: AHORA });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain("2026-08-02");
      expect(r.motivo).toContain("dia CR en curso");
    }
  });

  it("rechaza el rango que EMPIEZA manana CR y nombra manana como ofensora", () => {
    const r = planificarBackfill({ desde: "2026-08-03", hasta: "2026-08-05", ahora: AHORA });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain("2026-08-03");
      expect(r.motivo).toContain("futura");
    }
  });

  it("rechaza el rango ENTERO, no solo la cola: no devuelve las fechas buenas", () => {
    const r = planificarBackfill({ desde: "2026-07-01", hasta: "2026-08-10", ahora: AHORA });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("2026-07-01");
  });

  it("admite ayer CR como ultimo dia recomputable y lo nombra en el motivo del rechazo", () => {
    expect(planDe("2026-08-01", "2026-08-01", AHORA).fechas).toEqual(["2026-08-01"]);
    const r = planificarBackfill({ desde: "2026-08-01", hasta: "2026-08-02", ahora: AHORA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("2026-08-01");
  });
});

describe("R20 · toda fecha anterior a la constante de horizonte se clasifica no comparable", () => {
  it("el horizonte es el dia de la migracion del historial y la comparacion es estricta", () => {
    expect(HORIZONTE_HISTORIAL_CR).toBe("2026-07-13");
    expect(esNoComparable("2026-07-12")).toBe(true);
    // El propio dia del horizonte NO es no comparable: la migracion corrio ese dia.
    expect(esNoComparable("2026-07-13")).toBe(false);
    expect(esNoComparable("2026-07-14")).toBe(false);
  });

  it("el plan separa las fechas bajo horizonte sin sacarlas del recorrido (R21)", () => {
    const plan = planDe("2026-07-11", "2026-07-15", AHORA);
    expect(plan.fechas).toEqual([
      "2026-07-11",
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
    ]);
    // Las no comparables son un SUBCONJUNTO: se etiquetan, no se saltan.
    expect(plan.noComparables).toEqual(["2026-07-11", "2026-07-12"]);
    for (const f of plan.noComparables) expect(plan.fechas).toContain(f);
  });

  it("un rango entero bajo el horizonte sale entero como no comparable", () => {
    const plan = planDe("2026-06-01", "2026-06-03", AHORA);
    expect(plan.noComparables).toEqual(plan.fechas);
  });

  it("un rango entero sobre el horizonte no tiene ninguna no comparable", () => {
    expect(planDe("2026-07-13", "2026-07-20", AHORA).noComparables).toEqual([]);
  });

  it("la constante se declara UNA sola vez y su comentario cita la migracion aditiva sin backfill", () => {
    // La constante sin su procedencia es un numero magico: manana nadie sabe por que 07-13.
    const raiz = path.join(__dirname, "..", "..", "..");
    const fuente = fs.readFileSync(path.join(raiz, "lib", "analytics", "backfill-rango.ts"), "utf8");
    expect(fuente).toMatch(/20260713120000_orden_historial_estado/);
    expect(fuente).toMatch(/aditiva|ADITIVA/i);
    expect(fuente).toMatch(/sin backfill|SIN BACKFILL/i);
    const declaraciones = fuente.match(/HORIZONTE_HISTORIAL_CR\s*=/g) ?? [];
    expect(declaraciones).toHaveLength(1);
    // Y la migracion citada existe de verdad: una procedencia inventada no es procedencia.
    expect(
      fs.existsSync(path.join(raiz, "db", "migrations", "20260713120000_orden_historial_estado")),
    ).toBe(true);
  });
});
