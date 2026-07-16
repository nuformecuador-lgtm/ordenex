import { describe, it, expect, afterEach } from "vitest";
import { loadRankingConfig } from "@/lib/config/ranking";

// Feature 76 (R7/R22): umbral minimo de muestra para el podio, configurable por entorno con
// readPositiveInt (espejo de lib/config/reintentos.ts). Se invoca loadRankingConfig() tras
// setear/limpiar el env, NO se depende del `rankingConfig` congelado en import.
const ENV_KEY = "RANKING_MIN_ASIGNADAS";

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("loadRankingConfig (R7/R22)", () => {
  it("ausente -> default 1", () => {
    delete process.env[ENV_KEY];
    expect(loadRankingConfig().MIN_ASIGNADAS_PODIO).toBe(1);
  });

  it('"3" -> 3 (override valido)', () => {
    process.env[ENV_KEY] = "3";
    expect(loadRankingConfig().MIN_ASIGNADAS_PODIO).toBe(3);
  });

  it('"0" -> 1 (no positivo cae al default)', () => {
    process.env[ENV_KEY] = "0";
    expect(loadRankingConfig().MIN_ASIGNADAS_PODIO).toBe(1);
  });

  it('"x" -> 1 (no numerico cae al default)', () => {
    process.env[ENV_KEY] = "x";
    expect(loadRankingConfig().MIN_ASIGNADAS_PODIO).toBe(1);
  });

  it('"" -> 1 (vacio cae al default)', () => {
    process.env[ENV_KEY] = "";
    expect(loadRankingConfig().MIN_ASIGNADAS_PODIO).toBe(1);
  });
});
