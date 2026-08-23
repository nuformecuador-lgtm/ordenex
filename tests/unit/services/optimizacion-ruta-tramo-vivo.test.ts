import { describe, it, expect, vi } from "vitest";
import { OptimizacionRutaService } from "@/lib/services/OptimizacionRutaService";
import type { RouteOptimizationConfig } from "@/lib/config/route-optimization";
import type { IRoutesClient } from "@/lib/interfaces/external/IRoutesClient";
import type { ParadaRutaRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { RutaOptimizadaDTO } from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";

// Feature 92 (seguimiento) — TRAYECTO EN VIVO: de donde esta el mensajero a UNA parada.
//
// LAS DOS COSAS QUE ESTE ARCHIVO PROTEGE:
//
//  1. COSTE. Es la unica llamada de la feature que no se puede cachear, asi que cada camino
//     que NO debe llamar al proveedor tiene su `expect(trazar).not.toHaveBeenCalled()`.
//  2. AUTORIZACION. Pedir el trayecto a una guia ajena devolveria sus coordenadas de entrega
//     (R14). La pertenencia se comprueba contra las paradas EN REPARTO del propio mensajero.

const MENSAJERO = "m-1";
const T0 = new Date("2026-08-14T12:00:00.000Z");
const POLILINEA = "gfo}EtohhUxD@";

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

const UBICACION = { lat: 9.93, lng: -84.09 };

function parada(id: string, over: Partial<ParadaRutaRow> = {}): ParadaRutaRow {
  return { ordenId: id, latitud: 9.94, longitud: -84.08, createdAt: T0, ...over };
}

function ruta(over: Partial<RutaOptimizadaDTO> = {}): RutaOptimizadaDTO {
  return {
    id: "r1",
    mensajeroId: MENSAJERO,
    estado: "vigente",
    calculadaAt: null,
    origenLat: null,
    origenLng: null,
    origenAt: null,
    origenFuente: null,
    huellaSet: null,
    ultimoError: null,
    // Feature 265 (R35): sin marca de procedencia por defecto; los tests que la necesitan la
    // pasan por `over`. `null` = no consta, que es el estado de toda ruta anterior a la 265.
    secuenciaFuente: null,
    trazado: null,
    tramoVivoAt: null,
    tramoPorOrden: new Map(),
    secuenciaPorOrden: new Map(),
    ...over,
  };
}

/** Doble de Routes que siempre responde bien, con espia sobre `trazar`. */
function routesOk() {
  const trazar = vi.fn(async () => ({
    status: "ok" as const,
    encodedPolyline: POLILINEA,
    distanciaM: 1200,
    duracionS: 240,
    tramos: [],
  }));
  return { trazar };
}

function montar(opts: {
  ruta?: RutaOptimizadaDTO | null;
  paradas?: ParadaRutaRow[];
  routes: IRoutesClient | null;
  now?: Date;
}) {
  const marcarTramoVivo = vi.fn(async () => {});
  const rutas = {
    findByMensajero: async () => opts.ruta ?? null,
    upsertOrigen: async () => {},
    reemplazarSecuencia: async () => {},
    guardarTrazado: async () => {},
    marcarTramoVivo,
    marcarDesactualizada: async () => {},
  };
  const paradasRepo = { findParadasEnReparto: async () => opts.paradas ?? [] };
  // Feature 265: `fuente` es REQUERIDA en el desenlace `ok`. Este doble no se ejercita aqui.
  const client = {
    optimizar: async () => ({ status: "ok" as const, secuencia: [], fuente: "proveedor" as const }),
  };
  const service = new OptimizacionRutaService(
    rutas,
    paradasRepo,
    client,
    CONFIG,
    () => opts.now ?? T0,
    undefined,
    opts.routes,
  );
  return { service, marcarTramoVivo };
}

describe("guarda de coste — intervalo minimo persistido", () => {
  it("dentro del intervalo -> CERO llamadas", async () => {
    const routes = routesOk();
    const { service, marcarTramoVivo } = montar({
      routes,
      paradas: [parada("o1")],
      ruta: ruta({ tramoVivoAt: new Date(T0.getTime() - 3_000) }), // hace 3 s (< 10)
    });

    const r = await service.trazarTramoVivo(MENSAJERO, {
      ubicacion: UBICACION,
      ordenId: "o1",
    });

    expect(r).toEqual({ status: "intervalo_minimo" });
    expect(routes.trazar).not.toHaveBeenCalled();
    expect(marcarTramoVivo).not.toHaveBeenCalled();
  });

  it("pasado el intervalo SI se llama", async () => {
    const routes = routesOk();
    const { service } = montar({
      routes,
      paradas: [parada("o1")],
      ruta: ruta({ tramoVivoAt: new Date(T0.getTime() - 11_000) }),
    });

    const r = await service.trazarTramoVivo(MENSAJERO, {
      ubicacion: UBICACION,
      ordenId: "o1",
    });

    expect(r.status).toBe("ok");
    expect(routes.trazar).toHaveBeenCalledTimes(1);
  });

  it("sin marca previa (nunca se pidio) la guarda no aplica", async () => {
    const routes = routesOk();
    const { service } = montar({ routes, paradas: [parada("o1")], ruta: ruta() });

    const r = await service.trazarTramoVivo(MENSAJERO, {
      ubicacion: UBICACION,
      ordenId: "o1",
    });

    expect(r.status).toBe("ok");
  });

  it("el sello se pone DESPUES del exito, nunca antes", async () => {
    // Sellar antes cobraria el intervalo por un intento que no devolvio nada, y dejaria al
    // mensajero esperando sin su trayecto.
    const routes = {
      trazar: vi.fn(async () => ({ status: "transitorio" as const, detalle: "x" })),
    };
    const { service, marcarTramoVivo } = montar({
      routes,
      paradas: [parada("o1")],
      ruta: ruta(),
    });

    const r = await service.trazarTramoVivo(MENSAJERO, {
      ubicacion: UBICACION,
      ordenId: "o1",
    });

    expect(r).toEqual({ status: "no_disponible" });
    expect(marcarTramoVivo).not.toHaveBeenCalled();
  });
});

describe("autorizacion — la parada tiene que ser SUYA", () => {
  it("una orden que no esta en sus paradas -> no_autorizada y CERO llamadas", async () => {
    const routes = routesOk();
    const { service } = montar({ routes, paradas: [parada("o1")], ruta: ruta() });

    const r = await service.trazarTramoVivo(MENSAJERO, {
      ubicacion: UBICACION,
      ordenId: "AJENA",
    });

    expect(r).toEqual({ status: "no_autorizada" });
    // Lo que se protege no es solo el dinero: esa llamada habria devuelto la geometria hasta
    // el domicilio de entrega de otra persona (R14).
    expect(routes.trazar).not.toHaveBeenCalled();
  });

  it("una parada SUYA pero sin coordenadas -> el mismo desenlace, sin llamar", async () => {
    const routes = routesOk();
    const { service } = montar({
      routes,
      paradas: [parada("o1", { latitud: null, longitud: null })],
      ruta: ruta(),
    });

    const r = await service.trazarTramoVivo(MENSAJERO, {
      ubicacion: UBICACION,
      ordenId: "o1",
    });

    expect(r).toEqual({ status: "no_autorizada" });
    expect(routes.trazar).not.toHaveBeenCalled();
  });
});

describe("llamada al proveedor", () => {
  it("manda la ubicacion como ORIGEN y la parada como unico destino", async () => {
    const routes = routesOk();
    const { service, marcarTramoVivo } = montar({
      routes,
      paradas: [parada("o1", { latitud: 9.95, longitud: -84.07 }), parada("o2")],
      ruta: ruta(),
    });

    const r = await service.trazarTramoVivo(MENSAJERO, {
      ubicacion: UBICACION,
      ordenId: "o1",
    });

    const input = (routes.trazar.mock.calls[0] as unknown as [
      { origen: unknown; paradasEnOrden: unknown },
    ])[0];
    expect(input.origen).toEqual(UBICACION);
    expect(input.paradasEnOrden).toEqual([{ ordenId: "o1", lat: 9.95, lng: -84.07 }]);
    expect(r).toEqual({
      status: "ok",
      encodedPolyline: POLILINEA,
      distanciaM: 1200,
      duracionS: 240,
    });
    expect(marcarTramoVivo).toHaveBeenCalledWith(MENSAJERO, T0);
  });

  it("sin cliente de Routes -> no_disponible y nada que sellar", async () => {
    const { service, marcarTramoVivo } = montar({
      routes: null,
      paradas: [parada("o1")],
      ruta: ruta(),
    });

    const r = await service.trazarTramoVivo(MENSAJERO, {
      ubicacion: UBICACION,
      ordenId: "o1",
    });

    expect(r).toEqual({ status: "no_disponible" });
    expect(marcarTramoVivo).not.toHaveBeenCalled();
  });

  it("si el proveedor LANZA se degrada, no se propaga", async () => {
    // Es apoyo visual: una excepcion aqui no puede reventarle la pantalla al mensajero.
    const routes = {
      trazar: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const { service } = montar({
      routes: routes as unknown as IRoutesClient,
      paradas: [parada("o1")],
      ruta: ruta(),
    });

    const r = await service.trazarTramoVivo(MENSAJERO, {
      ubicacion: UBICACION,
      ordenId: "o1",
    });

    expect(r).toEqual({ status: "no_disponible" });
  });
});
