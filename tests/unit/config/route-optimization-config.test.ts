import { describe, it, expect, afterEach } from "vitest";
import { loadRouteOptimizationConfig } from "@/lib/config/route-optimization";

// Feature 92 (R10) — la carga de configuracion del proveedor de optimizacion NUNCA lanza.
// No es un detalle estetico: el drenador de la cola comparte proceso con
// `liberar_reprogramadas` (feature 46, en produccion) y `geocodificacion` (91). Si esta
// funcion lanzara al faltar una variable, un despliegue sin el SKU de Route Optimization
// tumbaria TODO el drenado, no solo esta feature.

const VARS = [
  "GOOGLE_ROUTE_OPT_PROJECT_ID",
  "GOOGLE_ROUTE_OPT_SA_EMAIL",
  "GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY",
  "ROUTE_OPT_TIMEOUT_MS",
  "RUTA_DEBOUNCE_S",
  "RUTA_ORIGEN_TTL_MIN",
  "RUTA_SYNC_MIN_INTERVALO_S",
  "RUTA_MAX_PARADAS",
] as const;

const original = new Map(VARS.map((v) => [v, process.env[v]]));

afterEach(() => {
  for (const [k, v] of original) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function limpiar() {
  for (const v of VARS) delete process.env[v];
}

describe("R10 — secretos ausentes o vacios se resuelven a null", () => {
  it("sin ninguna variable, las tres piezas de la credencial son null y no lanza", () => {
    limpiar();
    const config = loadRouteOptimizationConfig();
    expect(config.GOOGLE_ROUTE_OPT_PROJECT_ID).toBeNull();
    expect(config.GOOGLE_ROUTE_OPT_SA_EMAIL).toBeNull();
    expect(config.GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY).toBeNull();
  });

  it("cadena VACIA cuenta como ausente (no como credencial valida de longitud 0)", () => {
    limpiar();
    process.env.GOOGLE_ROUTE_OPT_PROJECT_ID = "";
    process.env.GOOGLE_ROUTE_OPT_SA_EMAIL = "";
    process.env.GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY = "";
    const config = loadRouteOptimizationConfig();
    expect(config.GOOGLE_ROUTE_OPT_PROJECT_ID).toBeNull();
    expect(config.GOOGLE_ROUTE_OPT_SA_EMAIL).toBeNull();
    expect(config.GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY).toBeNull();
  });

  it("los `\\n` escapados de la PEM se desescapan a saltos de linea reales", () => {
    // En Vercel un secreto multilinea viaja con `\n` LITERALES. Sin este desescapado,
    // `createSign` recibiria una sola linea y la firma fallaria en produccion aunque la
    // credencial fuera correcta.
    limpiar();
    process.env.GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY =
      "-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----\\n";
    const pem = loadRouteOptimizationConfig().GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY;
    expect(pem).toBe("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n");
    expect(pem).not.toContain("\\n");
  });
});

describe("R10 — enteros: default ante ausente, vacio o invalido", () => {
  it("sin variables, cada entero toma su default documentado", () => {
    limpiar();
    const config = loadRouteOptimizationConfig();
    expect(config.ROUTE_OPT_TIMEOUT_MS).toBe(20_000);
    expect(config.RUTA_DEBOUNCE_S).toBe(60);
    expect(config.RUTA_ORIGEN_TTL_MIN).toBe(120);
    expect(config.RUTA_SYNC_MIN_INTERVALO_S).toBe(10);
    expect(config.RUTA_MAX_PARADAS).toBe(100);
  });

  it("valores no numericos, cero y negativos caen al default (no a NaN ni a 0)", () => {
    // Un `RUTA_MAX_PARADAS = 0` mal tipeado dejaria la feature optimizando cero paradas
    // para siempre, en silencio. Un NaN haria lo mismo de forma aun mas opaca.
    limpiar();
    process.env.ROUTE_OPT_TIMEOUT_MS = "abc";
    process.env.RUTA_DEBOUNCE_S = "0";
    process.env.RUTA_ORIGEN_TTL_MIN = "-5";
    process.env.RUTA_SYNC_MIN_INTERVALO_S = "";
    process.env.RUTA_MAX_PARADAS = "1.9";
    const config = loadRouteOptimizationConfig();
    expect(config.ROUTE_OPT_TIMEOUT_MS).toBe(20_000);
    expect(config.RUTA_DEBOUNCE_S).toBe(60);
    expect(config.RUTA_ORIGEN_TTL_MIN).toBe(120);
    expect(config.RUTA_SYNC_MIN_INTERVALO_S).toBe(10);
    expect(config.RUTA_MAX_PARADAS).toBe(1); // parseInt trunca; 1 es positivo, se acepta
  });

  it("valores validos se respetan", () => {
    limpiar();
    process.env.RUTA_MAX_PARADAS = "40";
    process.env.RUTA_DEBOUNCE_S = "30";
    const config = loadRouteOptimizationConfig();
    expect(config.RUTA_MAX_PARADAS).toBe(40);
    expect(config.RUTA_DEBOUNCE_S).toBe(30);
  });

  it("NINGUNA combinacion de entorno hace lanzar a loadRouteOptimizationConfig", () => {
    const combinaciones: Record<string, string>[] = [
      {},
      { GOOGLE_ROUTE_OPT_PROJECT_ID: "p" },
      { GOOGLE_ROUTE_OPT_SA_EMAIL: "sa@x.iam.gserviceaccount.com" },
      { GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: "no-es-una-pem" },
      { ROUTE_OPT_TIMEOUT_MS: "NaN", RUTA_MAX_PARADAS: "-1", RUTA_DEBOUNCE_S: "x" },
    ];
    for (const combo of combinaciones) {
      limpiar();
      Object.assign(process.env, combo);
      expect(() => loadRouteOptimizationConfig()).not.toThrow();
    }
  });
});
