import { describe, it, expect, afterEach } from "vitest";
import { loadReintentosConfig } from "@/lib/config/reintentos";

// Feature 47 (R3): umbral configurable por entorno con readPositiveInt (patron
// lib/config/ordenes.ts). Se invoca loadReintentosConfig() tras setear/limpiar el env,
// NO se depende del `reintentosConfig` congelado en import. El env se restaura en afterEach.
const ENV_KEY = "REINTENTOS_MIN_INTENTOS";

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("loadReintentosConfig (R3)", () => {
  it("ausente -> default 3 (minimo por ley)", () => {
    delete process.env[ENV_KEY];
    expect(loadReintentosConfig().MIN_INTENTOS_ENTREGA).toBe(3);
  });

  it('"5" -> 5 (override valido)', () => {
    process.env[ENV_KEY] = "5";
    expect(loadReintentosConfig().MIN_INTENTOS_ENTREGA).toBe(5);
  });

  it('"0" -> 3 (no positivo cae al default)', () => {
    process.env[ENV_KEY] = "0";
    expect(loadReintentosConfig().MIN_INTENTOS_ENTREGA).toBe(3);
  });

  it('"x" -> 3 (no numerico cae al default)', () => {
    process.env[ENV_KEY] = "x";
    expect(loadReintentosConfig().MIN_INTENTOS_ENTREGA).toBe(3);
  });

  it('"" -> 3 (vacio cae al default)', () => {
    process.env[ENV_KEY] = "";
    expect(loadReintentosConfig().MIN_INTENTOS_ENTREGA).toBe(3);
  });

  it('"-2" -> 3 (negativo cae al default)', () => {
    process.env[ENV_KEY] = "-2";
    expect(loadReintentosConfig().MIN_INTENTOS_ENTREGA).toBe(3);
  });
});
