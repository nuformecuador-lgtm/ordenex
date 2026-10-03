import { describe, it, expect, afterEach } from "vitest";
import { EXCEL_FILAS_DATOS_POR_HOJA, loadDescargaConfig } from "@/lib/config/descarga";

// Feature 151/T2 (R19) — el tope de filas de la descarga vivia en config, no en literales.
// Ficha 470 (T1.1, R1/R3/R5/R10/R17/R9) — el tope pasa a ser el limite de Excel y deja de ser
// configurable; nacen el umbral de entrega por almacen, la caducidad de la URL firmada, la
// retencion de la purga y el bucket.

const VARS = [
  "DESCARGA_MAX_FILAS",
  "DESCARGA_UMBRAL_ALMACEN_BYTES",
  "DESCARGA_TTL_URL_SEGUNDOS",
  "DESCARGA_RETENCION_MINUTOS",
  "DESCARGAS_BUCKET",
] as const;

afterEach(() => {
  for (const v of VARS) delete process.env[v];
});

describe("loadDescargaConfig · tope = limite de Excel (470 R1/R3)", () => {
  it("el limite de Excel es 1.048.575 filas de datos (1.048.576 con la cabecera)", () => {
    // Literal a proposito: ES el contrato (el limite de la hoja de Excel), no un valor derivado.
    expect(EXCEL_FILAS_DATOS_POR_HOJA).toBe(1_048_575);
  });

  it("MAX_FILAS vale el limite de Excel sin variable de entorno", () => {
    expect(loadDescargaConfig().MAX_FILAS).toBe(1_048_575);
  });

  it("R3: DESCARGA_MAX_FILAS definida a cualquier valor NO cambia el maximo", () => {
    for (const valor of ["2000", "5000", "1", "99999999", "abc", "-10", "0"]) {
      process.env.DESCARGA_MAX_FILAS = valor;
      expect(loadDescargaConfig().MAX_FILAS).toBe(1_048_575);
    }
  });
});

describe("loadDescargaConfig · entrega por almacen (470 R5/R10/R17/R9)", () => {
  it("defaults: umbral 2.000.000 bytes, URL 300 s, retencion 60 min, bucket «descargas»", () => {
    const c = loadDescargaConfig();
    expect(c.UMBRAL_ALMACEN_BYTES).toBe(2_000_000);
    expect(c.TTL_URL_SEGUNDOS).toBe(300);
    expect(c.RETENCION_MINUTOS).toBe(60);
    expect(c.BUCKET).toBe("descargas");
  });

  it("toma los enteros positivos del entorno", () => {
    process.env.DESCARGA_UMBRAL_ALMACEN_BYTES = "1";
    process.env.DESCARGA_TTL_URL_SEGUNDOS = "120";
    process.env.DESCARGA_RETENCION_MINUTOS = "30";
    process.env.DESCARGAS_BUCKET = "  descargas-preview  ";
    const c = loadDescargaConfig();
    expect(c.UMBRAL_ALMACEN_BYTES).toBe(1);
    expect(c.TTL_URL_SEGUNDOS).toBe(120);
    expect(c.RETENCION_MINUTOS).toBe(30);
    expect(c.BUCKET).toBe("descargas-preview");
  });

  it("un valor no numerico, cero, negativo o vacio cae al default", () => {
    for (const malo of ["abc", "0", "-5", ""]) {
      process.env.DESCARGA_UMBRAL_ALMACEN_BYTES = malo;
      process.env.DESCARGA_TTL_URL_SEGUNDOS = malo;
      process.env.DESCARGA_RETENCION_MINUTOS = malo;
      process.env.DESCARGAS_BUCKET = malo === "" ? "   " : "descargas";
      const c = loadDescargaConfig();
      expect(c.UMBRAL_ALMACEN_BYTES).toBe(2_000_000);
      expect(c.TTL_URL_SEGUNDOS).toBe(300);
      expect(c.RETENCION_MINUTOS).toBe(60);
      expect(c.BUCKET).toBe("descargas");
    }
  });
});
