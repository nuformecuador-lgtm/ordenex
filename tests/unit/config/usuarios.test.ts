import { describe, it, expect, afterEach } from "vitest";
import { loadUsuariosConfig } from "@/lib/config/usuarios";

// R13: config sobreescribible por entorno (patron lib/config/cobros.ts).
const ENV_KEYS = ["USUARIOS_DEFAULT_PAGE_SIZE", "USUARIOS_MAX_PAGE_SIZE"] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("loadUsuariosConfig (R13)", () => {
  it("expone limites de paginacion positivos y MAX>=DEFAULT", () => {
    const cfg = loadUsuariosConfig();
    expect(cfg.DEFAULT_PAGE_SIZE).toBeGreaterThan(0);
    expect(cfg.MAX_PAGE_SIZE).toBeGreaterThan(0);
    expect(cfg.MAX_PAGE_SIZE).toBeGreaterThanOrEqual(cfg.DEFAULT_PAGE_SIZE);
  });

  it("respeta overrides validos de entorno", () => {
    process.env.USUARIOS_DEFAULT_PAGE_SIZE = "10";
    process.env.USUARIOS_MAX_PAGE_SIZE = "50";
    const cfg = loadUsuariosConfig();
    expect(cfg.DEFAULT_PAGE_SIZE).toBe(10);
    expect(cfg.MAX_PAGE_SIZE).toBe(50);
  });

  it("ignora env no positivo o no numerico y cae al default", () => {
    process.env.USUARIOS_DEFAULT_PAGE_SIZE = "abc";
    process.env.USUARIOS_MAX_PAGE_SIZE = "-5";
    const cfg = loadUsuariosConfig();
    expect(cfg.DEFAULT_PAGE_SIZE).toBe(25);
    expect(cfg.MAX_PAGE_SIZE).toBe(100);
  });
});
