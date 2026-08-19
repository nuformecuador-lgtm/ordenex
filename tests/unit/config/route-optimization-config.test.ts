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
  "GOOGLE_WIF_PROJECT_NUMBER",
  "GOOGLE_WIF_POOL_ID",
  "GOOGLE_WIF_PROVIDER_ID",
  "GOOGLE_CLOUD_PROJECT_NUMBER",
  "GOOGLE_CLOUD_WORKLOAD_IDENTITY_POOL_ID",
  "GOOGLE_CLOUD_WORKLOAD_IDENTITY_POOL_PROVIDER_ID",
  "GOOGLE_ROUTE_OPT_USE_ADC",
  "ROUTE_OPT_TIMEOUT_MS",
  "RUTA_DEBOUNCE_S",
  "RUTA_ORIGEN_TTL_MIN",
  "RUTA_SYNC_MIN_INTERVALO_S",
  "RUTA_MAX_PARADAS",
  "ROUTES_ROUTING_PREFERENCE",
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

describe("R10 — piezas de WIF: nombre canonico y alias del entorno ya desplegado", () => {
  it("sin variables, las tres piezas WIF son null y ADC queda desactivado", () => {
    limpiar();
    const config = loadRouteOptimizationConfig();
    expect(config.GOOGLE_WIF_PROJECT_NUMBER).toBeNull();
    expect(config.GOOGLE_WIF_POOL_ID).toBeNull();
    expect(config.GOOGLE_WIF_PROVIDER_ID).toBeNull();
    expect(config.GOOGLE_ROUTE_OPT_USE_ADC).toBe(false);
  });

  it("los nombres GOOGLE_CLOUD_* del entorno ya desplegado valen como alias", () => {
    // El `.env` de produccion nombra estas piezas asi desde antes de la feature 92. Aceptar
    // el alias evita un renombrado coordinado en Vercel para encender WIF.
    limpiar();
    process.env.GOOGLE_CLOUD_PROJECT_NUMBER = "123456789012";
    process.env.GOOGLE_CLOUD_WORKLOAD_IDENTITY_POOL_ID = "vercel";
    process.env.GOOGLE_CLOUD_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "vercel";
    const config = loadRouteOptimizationConfig();
    expect(config.GOOGLE_WIF_PROJECT_NUMBER).toBe("123456789012");
    expect(config.GOOGLE_WIF_POOL_ID).toBe("vercel");
    expect(config.GOOGLE_WIF_PROVIDER_ID).toBe("vercel");
  });

  it("el nombre canonico GANA cuando estan los dos", () => {
    limpiar();
    process.env.GOOGLE_WIF_POOL_ID = "canonico";
    process.env.GOOGLE_CLOUD_WORKLOAD_IDENTITY_POOL_ID = "alias";
    expect(loadRouteOptimizationConfig().GOOGLE_WIF_POOL_ID).toBe("canonico");
  });

  it("un canonico VACIO cede al alias (vacio == ausente, R10)", () => {
    limpiar();
    process.env.GOOGLE_WIF_POOL_ID = "";
    process.env.GOOGLE_CLOUD_WORKLOAD_IDENTITY_POOL_ID = "alias";
    expect(loadRouteOptimizationConfig().GOOGLE_WIF_POOL_ID).toBe("alias");
  });

  it.each([
    ["true", true],
    ["TRUE", true],
    ["1", false],
    ["yes", false],
    ["false", false],
    ["", false],
  ])("GOOGLE_ROUTE_OPT_USE_ADC=%j -> %s", (valor, esperado) => {
    // Solo "true" activa: el flag conmuta a ADC, que en Vercel NO funciona. Un valor
    // ambiguo debe caer del lado seguro (produccion sigue en WIF).
    limpiar();
    process.env.GOOGLE_ROUTE_OPT_USE_ADC = valor;
    expect(loadRouteOptimizationConfig().GOOGLE_ROUTE_OPT_USE_ADC).toBe(esperado);
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

  describe("ROUTES_ROUTING_PREFERENCE — enum con lista blanca", () => {
    it("ausente -> TRAFFIC_UNAWARE (el SKU barato es el default)", () => {
      limpiar();
      expect(loadRouteOptimizationConfig().ROUTES_ROUTING_PREFERENCE).toBe("TRAFFIC_UNAWARE");
    });

    it("acepta los tres valores validos, sin distinguir mayusculas", () => {
      for (const [entrada, esperado] of [
        ["TRAFFIC_AWARE", "TRAFFIC_AWARE"],
        ["traffic_aware_optimal", "TRAFFIC_AWARE_OPTIMAL"],
        ["TRAFFIC_UNAWARE", "TRAFFIC_UNAWARE"],
      ] as const) {
        limpiar();
        process.env.ROUTES_ROUTING_PREFERENCE = entrada;
        expect(loadRouteOptimizationConfig().ROUTES_ROUTING_PREFERENCE).toBe(esperado);
      }
    });

    it("un valor invalido cae al lado BARATO, no al caro", () => {
      // Lo que importa aqui no es que se sanee, sino HACIA DONDE: un typo jamas debe subir
      // de SKU y ponerse a facturar tarifa Advanced sin que nadie lo haya pedido.
      for (const basura of ["TRAFFIC_AWERE", "si", "1", "TRAFFIC"]) {
        limpiar();
        process.env.ROUTES_ROUTING_PREFERENCE = basura;
        expect(loadRouteOptimizationConfig().ROUTES_ROUTING_PREFERENCE).toBe("TRAFFIC_UNAWARE");
      }
    });
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
