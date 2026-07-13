import { describe, it, expect, afterEach } from "vitest";
import { loadCargaMasivaConfig } from "@/lib/config/carga-masiva";

// R28: limites configurables por entorno, patron ordenesConfig.
const ENV_KEYS = [
  "CARGA_MASIVA_MAX_FILE_BYTES",
  "CARGA_MASIVA_MAX_ROWS",
  "CARGA_MASIVA_BATCH_SIZE",
] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("loadCargaMasivaConfig valores por defecto (R28)", () => {
  it("usa defaults razonables cuando no hay env", () => {
    const cfg = loadCargaMasivaConfig();
    expect(cfg.MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
    expect(cfg.MAX_ROWS).toBe(5000);
    expect(cfg.BATCH_SIZE).toBe(500);
  });
});

describe("loadCargaMasivaConfig overrides por entorno (R28)", () => {
  it("respeta valores validos de env", () => {
    process.env.CARGA_MASIVA_MAX_FILE_BYTES = "1024";
    process.env.CARGA_MASIVA_MAX_ROWS = "10";
    process.env.CARGA_MASIVA_BATCH_SIZE = "5";
    const cfg = loadCargaMasivaConfig();
    expect(cfg.MAX_FILE_BYTES).toBe(1024);
    expect(cfg.MAX_ROWS).toBe(10);
    expect(cfg.BATCH_SIZE).toBe(5);
  });

  it("ignora env no positivo o no numerico y cae al default", () => {
    process.env.CARGA_MASIVA_MAX_ROWS = "-5";
    process.env.CARGA_MASIVA_BATCH_SIZE = "abc";
    const cfg = loadCargaMasivaConfig();
    expect(cfg.MAX_ROWS).toBe(5000);
    expect(cfg.BATCH_SIZE).toBe(500);
  });
});
