import { describe, it, expect, afterEach } from "vitest";
import { loadOrdenesConfig } from "@/lib/config/ordenes";

// R33/N1: config sobreescribible por entorno con readPositiveInt (patron auth).
const ENV_KEYS = [
  "ORDENES_DEFAULT_PAGE_SIZE",
  "ORDENES_MAX_PAGE_SIZE",
  "ORDENES_DEFAULT_ESTATUS_VALUE",
] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("loadOrdenesConfig valores por defecto (N1/R33)", () => {
  it("usa defaults cuando no hay env", () => {
    const cfg = loadOrdenesConfig();
    expect(cfg.DEFAULT_PAGE_SIZE).toBe(25);
    expect(cfg.MAX_PAGE_SIZE).toBe(100);
    expect(cfg.DEFAULT_ESTATUS_VALUE).toBe("en_preparacion"); // feature 15/R7/R8: default GLOBAL
  });
});

describe("loadOrdenesConfig overrides por entorno", () => {
  it("respeta valores validos de env", () => {
    process.env.ORDENES_DEFAULT_PAGE_SIZE = "10";
    process.env.ORDENES_MAX_PAGE_SIZE = "50";
    process.env.ORDENES_DEFAULT_ESTATUS_VALUE = "embalaje";
    const cfg = loadOrdenesConfig();
    expect(cfg.DEFAULT_PAGE_SIZE).toBe(10);
    expect(cfg.MAX_PAGE_SIZE).toBe(50);
    expect(cfg.DEFAULT_ESTATUS_VALUE).toBe("embalaje");
  });

  it("ignora env no positivo o no numerico y cae al default (R33)", () => {
    process.env.ORDENES_MAX_PAGE_SIZE = "-5";
    process.env.ORDENES_DEFAULT_PAGE_SIZE = "abc";
    const cfg = loadOrdenesConfig();
    expect(cfg.MAX_PAGE_SIZE).toBe(100);
    expect(cfg.DEFAULT_PAGE_SIZE).toBe(25);
  });
});
