import { describe, it, expect, afterEach } from "vitest";
import { loadDescargaConfig } from "@/lib/config/descarga";

// Feature 151/T2 (R19) — el tope de filas de la descarga es CONFIGURABLE por entorno,
// no un literal repartido por el codigo.

afterEach(() => {
  delete process.env.DESCARGA_MAX_FILAS;
});

describe("loadDescargaConfig (R19)", () => {
  it("usa 5000 cuando no hay variable de entorno", () => {
    expect(loadDescargaConfig().MAX_FILAS).toBe(5000);
  });

  it("toma el valor de DESCARGA_MAX_FILAS cuando es un entero positivo", () => {
    process.env.DESCARGA_MAX_FILAS = "2000";
    expect(loadDescargaConfig().MAX_FILAS).toBe(2000);
  });

  it("ignora un valor no numerico o no positivo y cae al default", () => {
    process.env.DESCARGA_MAX_FILAS = "abc";
    expect(loadDescargaConfig().MAX_FILAS).toBe(5000);
    process.env.DESCARGA_MAX_FILAS = "-10";
    expect(loadDescargaConfig().MAX_FILAS).toBe(5000);
    process.env.DESCARGA_MAX_FILAS = "0";
    expect(loadDescargaConfig().MAX_FILAS).toBe(5000);
  });
});
