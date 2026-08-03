import { describe, it, expect } from "vitest";
import {
  ANALITICA_CACHE_DISABLED_ENV,
  ANALITICA_CACHE_TTL_SEGUNDOS,
  analiticaCacheHabilitada,
} from "@/lib/config/analitica-cache";
import { decorarRollupConCache } from "@/lib/repositories/CachedAnaliticaOperativaRollupRepository";
import type { DimensionAnalitica } from "@/lib/analytics/types";
import { cacheFalsa } from "./_cache-falsa";
import { consultaDe, cubo, MAESTRO, rollupFalso } from "./_fake-operativa";

// Feature 128 / T4.1 — R16 (D5). El kill-switch.
//
// «Si la cache sirve algo raro en produccion, apagarla no debe requerir un PR» — y encenderla
// tampoco: por eso el default es ENCENDIDA. Invertirlo dejaria la feature inservible hasta que
// alguien hiciera un deploy.

const SIN_GRANO: readonly DimensionAnalitica[] = [];

describe("R16 · con la cache deshabilitada, toda consulta va a la base", () => {
  it("dos consultas identicas llaman DOS veces al repositorio", async () => {
    const interno = rollupFalso([cubo({ fecha: "2026-08-01" })]);
    const repo = decorarRollupConCache(interno, cacheFalsa(), {
      [ANALITICA_CACHE_DISABLED_ENV]: "1",
    });
    const consulta = consultaDe("entregas", MAESTRO, { rango: "dia" });

    await repo.agregarCubos(consulta, SIN_GRANO);
    await repo.agregarCubos(consulta, SIN_GRANO);

    expect(interno.llamadasAgregar).toHaveLength(2);
  });

  it("y NO se lee ni se escribe una sola entrada: es un kill-switch, no un placebo", async () => {
    const cache = cacheFalsa();
    const repo = decorarRollupConCache(rollupFalso([cubo({ fecha: "2026-08-01" })]), cache, {
      [ANALITICA_CACHE_DISABLED_ENV]: "true",
    });

    await repo.agregarCubos(consultaDe("entregas", MAESTRO, { rango: "dia" }), SIN_GRANO);

    expect(cache.tamano()).toBe(0);
    expect(cache.claves).toEqual([]);
  });
});

describe("R16 · sin la variable definida, la cache esta habilitada", () => {
  it("un entorno vacio cachea: dos consultas identicas llaman UNA vez", async () => {
    const interno = rollupFalso([cubo({ fecha: "2026-08-01" })]);
    const repo = decorarRollupConCache(interno, cacheFalsa(), {});
    const consulta = consultaDe("entregas", MAESTRO, { rango: "dia" });

    await repo.agregarCubos(consulta, SIN_GRANO);
    await repo.agregarCubos(consulta, SIN_GRANO);

    expect(interno.llamadasAgregar).toHaveLength(1);
  });

  it("`analiticaCacheHabilitada` dice que si ante la ausencia y ante un valor cualquiera", () => {
    expect(analiticaCacheHabilitada({})).toBe(true);
    expect(analiticaCacheHabilitada({ [ANALITICA_CACHE_DISABLED_ENV]: "" })).toBe(true);
    expect(analiticaCacheHabilitada({ [ANALITICA_CACHE_DISABLED_ENV]: "0" })).toBe(true);
    expect(analiticaCacheHabilitada({ [ANALITICA_CACHE_DISABLED_ENV]: "false" })).toBe(true);
  });

  it("y que no ante los valores de apagado", () => {
    for (const valor of ["1", "true", "TRUE", "yes", "on", " 1 "]) {
      expect(analiticaCacheHabilitada({ [ANALITICA_CACHE_DISABLED_ENV]: valor })).toBe(false);
    }
  });
});

describe("R17 · el TTL es 3600 s y es una constante", () => {
  it("vale 3600 segundos", () => {
    expect(ANALITICA_CACHE_TTL_SEGUNDOS).toBe(3600);
  });
});
