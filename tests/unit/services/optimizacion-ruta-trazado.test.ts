import { describe, it, expect, vi } from "vitest";
import { OptimizacionRutaService } from "@/lib/services/OptimizacionRutaService";
import type { RouteOptimizationConfig } from "@/lib/config/route-optimization";
import type { IRoutesClient } from "@/lib/interfaces/external/IRoutesClient";
import type { ParadaRutaRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import { decodificarPolilinea } from "@/lib/geo/polilinea";

// Feature 92 (seguimiento) — cableado del TRAZADO (Google Routes) dentro del service.
//
// LA REGLA QUE ESTOS TESTS PROTEGEN: el trazado es ACCESORIO. La optimizacion ya esta
// persistida cuando se pide el dibujo, asi que ningun desenlace del trazado —fallo, omision
// o excepcion— puede cambiar el resultado de la optimizacion. Si lo hiciera, el job
// reintentaria y volveria a PAGAR la optimizacion (la cara) para arreglar el dibujo (lo
// barato).

const T0 = new Date("2026-08-14T12:00:00.000Z");
const POLILINEA = "gfo}EtohhUxD@bAxJmGF";
/** Dos tramos: el doble de Routes se monta siempre sobre DOS paradas (o-1 y o-2). */
const TRAMOS = [
  { encodedPolyline: "gfo}EtohhUxD@", distanciaM: 2400, duracionS: 400 },
  { encodedPolyline: "bAxJmGF", distanciaM: 3000, duracionS: 530 },
];

const CONFIG: RouteOptimizationConfig = {
  GOOGLE_ROUTE_OPT_PROJECT_ID: "p",
  GOOGLE_ROUTE_OPT_SA_EMAIL: "sa@x",
  GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: "pem",
  GOOGLE_WIF_PROJECT_NUMBER: null,
  GOOGLE_WIF_POOL_ID: null,
  GOOGLE_WIF_PROVIDER_ID: null,
  GOOGLE_ROUTE_OPT_USE_ADC: false,
  ROUTE_OPT_TIMEOUT_MS: 20_000,
  RUTA_DEBOUNCE_S: 60,
  RUTA_ORIGEN_TTL_MIN: 120,
  RUTA_SYNC_MIN_INTERVALO_S: 10,
  RUTA_MAX_PARADAS: 100,
  // Feature 265: umbral de coherencia del origen. 200 km es el default del codigo; los tests
  // que ejercitan la guarda lo bajan por `config` para no depender de el.
  RUTA_ORIGEN_MAX_KM: 200,
  ROUTES_ROUTING_PREFERENCE: "TRAFFIC_UNAWARE",
};

function parada(id: string, lat: number, lng: number): ParadaRutaRow {
  return { ordenId: id, latitud: lat, longitud: lng, createdAt: T0 };
}

/** Monta el service con dobles minimos y devuelve tambien el espia de `reemplazarSecuencia`. */
function montar(routes: IRoutesClient | null, secuencia = ["o-2", "o-1"]) {
  const reemplazarSecuencia = vi.fn(async () => {});
  const guardarTrazado = vi.fn(async () => {});
  const rutas = {
    findByMensajero: async () => null,
    upsertOrigen: async () => {},
    reemplazarSecuencia,
    guardarTrazado,
    marcarTramoVivo: vi.fn(async () => {}),
    marcarDesactualizada: async () => {},
  };
  const paradasRepo = {
    findParadasEnReparto: async () => [parada("o-1", 9.94, -84.08), parada("o-2", 9.95, -84.07)],
  };
  // Feature 265: `fuente` es REQUERIDA en el desenlace `ok`. Aqui el doble hace de proveedor.
  const client = {
    optimizar: async () => ({ status: "ok" as const, secuencia, fuente: "proveedor" as const }),
  };
  const service = new OptimizacionRutaService(
    rutas,
    paradasRepo,
    client,
    CONFIG,
    () => T0,
    undefined,
    routes,
  );
  return { service, reemplazarSecuencia, guardarTrazado };
}

describe("trazado enchufado", () => {
  it("con trazado ok, el resultado lo incluye", async () => {
    const routes: IRoutesClient = {
      trazar: async () => ({
        status: "ok",
        encodedPolyline: POLILINEA,
        distanciaM: 5400,
        duracionS: 930,
        tramos: TRAMOS,
      }),
    };
    const { service } = montar(routes);
    const res = await service.ejecutar("m-1", { motivo: "manual" });

    expect(res).toEqual({
      status: "ok",
      paradas: 2,
      trazado: {
        encodedPolyline: POLILINEA,
        distanciaM: 5400,
        duracionS: 930,
        fuente: "routes",
        tramos: TRAMOS,
      },
    });
  });

  it("las paradas se mandan a Routes EN EL ORDEN que decidio la optimizacion", async () => {
    // El repo devuelve o-1 y luego o-2; la optimizacion decide o-2 primero. Si el trazado
    // usara el orden del repo, el mapa contradiria la lista de paradas.
    const trazar: IRoutesClient["trazar"] = vi.fn(async () => ({
      status: "ok" as const,
      encodedPolyline: POLILINEA,
      distanciaM: null,
      duracionS: null,
      tramos: TRAMOS,
    }));
    const { service } = montar({ trazar }, ["o-2", "o-1"]);
    await service.ejecutar("m-1", { motivo: "manual" });

    expect(trazar).toHaveBeenCalledTimes(1);
    const input = vi.mocked(trazar).mock.calls[0][0];
    expect(input.paradasEnOrden.map((p) => p.ordenId)).toEqual(["o-2", "o-1"]);
  });

  it("sin cliente de Routes se dibuja igual, con el trazado LOCAL", async () => {
    // El dibujo no depende de Google: una polilinea es una lista de lat/lng, y unir las
    // paradas en recto se hace aqui mismo, gratis. Aplica igual si la secuencia vino del
    // fallback Haversine.
    const { service, reemplazarSecuencia } = montar(null);
    const res = await service.ejecutar("m-1", { motivo: "manual" });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.trazado?.fuente).toBe("local");
    // Origen + 2 paradas: la polilinea decodificada debe traer 3 puntos.
    expect(decodificarPolilinea(res.trazado?.encodedPolyline ?? "")).toHaveLength(3);
    // Sin calles no hay tiempo que estimar: una cifra inventada acabaria mostrandose.
    expect(res.trazado?.duracionS).toBeNull();
    expect(res.trazado?.distanciaM).toBeGreaterThan(0);
    expect(reemplazarSecuencia).toHaveBeenCalledTimes(1);
  });

  it("el trazado local respeta el ORDEN de la secuencia optimizada", async () => {
    const { service } = montar(null, ["o-2", "o-1"]);
    const res = await service.ejecutar("m-1", { motivo: "manual" });
    if (res.status !== "ok") throw new Error("se esperaba ok");

    const puntos = decodificarPolilinea(res.trazado?.encodedPolyline ?? "");
    // [origen, o-2, o-1] — o-2 (9.95) antes que o-1 (9.94), como decidio la optimizacion.
    expect(puntos[1].lat).toBeCloseTo(9.95, 4);
    expect(puntos[2].lat).toBeCloseTo(9.94, 4);
  });
});

describe("persistencia del trazado (cache de la guarda R36)", () => {
  it("un trazado de ROUTES se persiste, atado a la huella con la que se calculo", async () => {
    const routes: IRoutesClient = {
      trazar: async () => ({
        status: "ok",
        encodedPolyline: POLILINEA,
        distanciaM: 5400,
        duracionS: 930,
        tramos: TRAMOS,
      }),
    };
    const { service, guardarTrazado, reemplazarSecuencia } = montar(routes);
    await service.ejecutar("m-1", { motivo: "manual" });

    expect(guardarTrazado).toHaveBeenCalledTimes(1);
    const [mensajeroId, huella, trazado] = vi.mocked(guardarTrazado).mock.calls[0] as unknown as [
      string,
      string,
      { fuente: string },
    ];
    expect(mensajeroId).toBe("m-1");
    expect(trazado.fuente).toBe("routes");
    // La huella con la que se guarda debe ser LA MISMA con la que se persistio la secuencia:
    // si divergieran, el trazado quedaria colgado de una ruta que no es la suya.
    const meta = (reemplazarSecuencia.mock.calls[0] as unknown as [string, string[], { huellaSet: string }])[2];
    expect(huella).toBe(meta.huellaSet);
  });

  it("un trazado LOCAL no se cachea: es la marca de que Google no contesto", async () => {
    // Si se cacheara, la guarda R36 cortaria en el proximo disparo y el mapa se quedaria con
    // lineas RECTAS hasta que cambiaran las paradas, incluso despues de que Routes vuelva.
    const { service, guardarTrazado } = montar(null);
    const res = await service.ejecutar("m-1", { motivo: "manual" });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.trazado?.fuente).toBe("local"); // si sube al cliente...
    expect(guardarTrazado).not.toHaveBeenCalled(); // ...pero NO a la DB
  });

  it("si persistir el trazado falla, la optimizacion sigue en ok", async () => {
    // Mismo criterio que el resto del dibujo: la secuencia YA esta guardada cuando se llega
    // aqui. Lanzar provocaria un reintento que vuelve a pagar la optimizacion.
    const routes: IRoutesClient = {
      trazar: async () => ({
        status: "ok",
        encodedPolyline: POLILINEA,
        distanciaM: 1,
        duracionS: 1,
        tramos: TRAMOS,
      }),
    };
    const { service, guardarTrazado } = montar(routes);
    guardarTrazado.mockRejectedValueOnce(new Error("la DB dijo que no"));

    const res = await service.ejecutar("m-1", { motivo: "manual" });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.trazado?.fuente).toBe("routes");
  });
});

describe("tramos por parada", () => {
  it("los tramos suben en el resultado y se persisten con el trazado", async () => {
    const routes: IRoutesClient = {
      trazar: async () => ({
        status: "ok",
        encodedPolyline: POLILINEA,
        distanciaM: 5400,
        duracionS: 930,
        tramos: TRAMOS,
      }),
    };
    const { service, guardarTrazado } = montar(routes);
    const res = await service.ejecutar("m-1", { motivo: "manual" });

    if (res.status !== "ok") throw new Error("se esperaba ok");
    expect(res.trazado?.tramos).toEqual(TRAMOS);
    // Van EN ORDEN DE VISITA: el repositorio los reparte por secuencia (i -> secuencia i+1),
    // asi que un orden distinto aqui pegaria cada tramo en la parada equivocada.
    const [, , , tramos] = vi.mocked(guardarTrazado).mock.calls[0] as unknown as [
      string,
      string,
      unknown,
      typeof TRAMOS,
    ];
    expect(tramos).toEqual(TRAMOS);
  });

  it("el trazado LOCAL no produce tramos: una recta no describe ningun recorrido", async () => {
    const { service } = montar(null);
    const res = await service.ejecutar("m-1", { motivo: "manual" });

    if (res.status !== "ok") throw new Error("se esperaba ok");
    expect(res.trazado?.fuente).toBe("local");
    expect(res.trazado?.tramos).toEqual([]);
  });
});

describe("el trazado NUNCA rompe la optimizacion", () => {
  it.each([
    ["omitida", { status: "omitida" as const, razon: "sin_polilinea" }],
    ["transitorio", { status: "transitorio" as const, detalle: "x" }],
    ["config_invalida", { status: "config_invalida" as const, detalle: "x" }],
  ])("un trazado %s cae al local, y la optimizacion sigue en ok", async (_n, outcome) => {
    const { service, reemplazarSecuencia } = montar({ trazar: async () => outcome });
    const res = await service.ejecutar("m-1", { motivo: "manual" });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.trazado?.fuente).toBe("local");
    expect(reemplazarSecuencia).toHaveBeenCalledTimes(1);
  });

  it("si el cliente de Routes LANZA, se cae al local y la optimizacion sigue en ok", async () => {
    // Este es el caso peligroso: una excepcion aqui, propagada, haria fallar el job y
    // provocaria un reintento que vuelve a pagar la optimizacion entera.
    const { service, reemplazarSecuencia } = montar({
      trazar: async () => {
        throw new Error("boom en Routes");
      },
    });
    const res = await service.ejecutar("m-1", { motivo: "manual" });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.trazado?.fuente).toBe("local");
    expect(reemplazarSecuencia).toHaveBeenCalledTimes(1);
  });
});
