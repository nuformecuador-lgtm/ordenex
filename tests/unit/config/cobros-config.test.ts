import { describe, it, expect, afterEach } from "vitest";
import { loadCobrosConfig } from "@/lib/config/cobros";

// R18 (soporte): config sobreescribible por entorno con readPositiveInt
// (patron lib/config/ordenes.ts).
const ENV_KEYS = ["COBROS_DEFAULT_PAGE_SIZE", "COBROS_MAX_PAGE_SIZE"] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("loadCobrosConfig valores por defecto", () => {
  it("usa defaults cuando no hay env", () => {
    const cfg = loadCobrosConfig();
    expect(cfg.DEFAULT_PAGE_SIZE).toBe(25);
    expect(cfg.MAX_PAGE_SIZE).toBe(100);
  });
});

describe("loadCobrosConfig overrides por entorno", () => {
  it("respeta valores validos de env", () => {
    process.env.COBROS_DEFAULT_PAGE_SIZE = "10";
    process.env.COBROS_MAX_PAGE_SIZE = "50";
    const cfg = loadCobrosConfig();
    expect(cfg.DEFAULT_PAGE_SIZE).toBe(10);
    expect(cfg.MAX_PAGE_SIZE).toBe(50);
  });

  it("ignora env no positivo o no numerico y cae al default (R18)", () => {
    process.env.COBROS_MAX_PAGE_SIZE = "-5";
    process.env.COBROS_DEFAULT_PAGE_SIZE = "abc";
    const cfg = loadCobrosConfig();
    expect(cfg.MAX_PAGE_SIZE).toBe(100);
    expect(cfg.DEFAULT_PAGE_SIZE).toBe(25);
  });
});
