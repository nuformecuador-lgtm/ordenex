import { describe, it, expect, afterEach } from "vitest";
import { loadTarifasConfig } from "@/lib/config/tarifas";

// R18 (soporte): config sobreescribible por entorno con readPositiveInt
// (patron lib/config/ordenes.ts).
const ENV_KEYS = ["TARIFAS_DEFAULT_PAGE_SIZE", "TARIFAS_MAX_PAGE_SIZE"] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("loadTarifasConfig valores por defecto", () => {
  it("usa defaults cuando no hay env", () => {
    const cfg = loadTarifasConfig();
    expect(cfg.DEFAULT_PAGE_SIZE).toBe(25);
    expect(cfg.MAX_PAGE_SIZE).toBe(100);
  });
});

describe("loadTarifasConfig overrides por entorno", () => {
  it("respeta valores validos de env", () => {
    process.env.TARIFAS_DEFAULT_PAGE_SIZE = "10";
    process.env.TARIFAS_MAX_PAGE_SIZE = "50";
    const cfg = loadTarifasConfig();
    expect(cfg.DEFAULT_PAGE_SIZE).toBe(10);
    expect(cfg.MAX_PAGE_SIZE).toBe(50);
  });

  it("ignora env no positivo o no numerico y cae al default (R18)", () => {
    process.env.TARIFAS_MAX_PAGE_SIZE = "-5";
    process.env.TARIFAS_DEFAULT_PAGE_SIZE = "abc";
    const cfg = loadTarifasConfig();
    expect(cfg.MAX_PAGE_SIZE).toBe(100);
    expect(cfg.DEFAULT_PAGE_SIZE).toBe(25);
  });
});
