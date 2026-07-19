import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadGeocodeConfig } from "@/lib/config/geocode";

// Feature 91 (R33) — la credencial se resuelve por ENTORNO y su ausencia NO lanza. Es la
// propiedad que impide que un despliegue sin `GOOGLE_MAPS_API_KEY` tumbe el drenado de la
// cola, que comparte cron con `liberar_reprogramadas` (feature 46, ya en produccion).

const ENV_ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GEOCODE_TIMEOUT_MS;
});

afterEach(() => {
  process.env = { ...ENV_ORIGINAL };
});

describe("R33 — la credencial ausente o vacia se resuelve a null sin lanzar", () => {
  it("variable AUSENTE -> null, sin excepcion", () => {
    expect(() => loadGeocodeConfig()).not.toThrow();
    expect(loadGeocodeConfig().GOOGLE_MAPS_API_KEY).toBeNull();
  });

  it('variable VACIA ("") -> null, sin excepcion', () => {
    process.env.GOOGLE_MAPS_API_KEY = "";
    expect(() => loadGeocodeConfig()).not.toThrow();
    expect(loadGeocodeConfig().GOOGLE_MAPS_API_KEY).toBeNull();
  });

  it("variable presente -> se devuelve tal cual", () => {
    process.env.GOOGLE_MAPS_API_KEY = "clave-de-prueba";
    expect(loadGeocodeConfig().GOOGLE_MAPS_API_KEY).toBe("clave-de-prueba");
  });

  it("la credencial NO esta incrustada en el codigo: sin entorno no hay valor por defecto", () => {
    const config = loadGeocodeConfig();
    expect(config.GOOGLE_MAPS_API_KEY).toBeNull();
  });
});

describe("R33 — timeout con default sensato", () => {
  it("ausente -> 10_000 ms", () => {
    expect(loadGeocodeConfig().GEOCODE_TIMEOUT_MS).toBe(10_000);
  });

  it("valor invalido o no positivo -> cae al default sin lanzar", () => {
    process.env.GEOCODE_TIMEOUT_MS = "no-es-un-numero";
    expect(loadGeocodeConfig().GEOCODE_TIMEOUT_MS).toBe(10_000);
    process.env.GEOCODE_TIMEOUT_MS = "0";
    expect(loadGeocodeConfig().GEOCODE_TIMEOUT_MS).toBe(10_000);
  });

  it("valor valido -> se respeta", () => {
    process.env.GEOCODE_TIMEOUT_MS = "2500";
    expect(loadGeocodeConfig().GEOCODE_TIMEOUT_MS).toBe(2500);
  });
});
