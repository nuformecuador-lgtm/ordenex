import { describe, it, expect, vi } from "vitest";
import { OptimizacionRutaService, type ParadasRepo } from "@/lib/services/OptimizacionRutaService";
import type {
  IRutaOptimizadaRepository,
  RutaOptimizadaDTO,
} from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { IRouteOptimizationClient } from "@/lib/interfaces/external/IRouteOptimizationClient";
import type { ParadaRutaRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { RouteOptimizationConfig } from "@/lib/config/route-optimization";

// Feature 92 (R24/R25) — resolucion del ORIGEN de la ruta, en TRES escalones:
//
//   1. `gps` con antiguedad < RUTA_ORIGEN_TTL_MIN   -> fuente "gps"
//   2. la ultima conocida AUNQUE este vencida        -> fuente "ultima_conocida"
//   3. el CENTROIDE de las paradas                   -> fuente "centroide"
//
// R25 es la invariante transversal: la ausencia de ubicacion NUNCA aborta ni bloquea la
// optimizacion. Denegar el permiso de geolocalizacion en el navegador solo significa que
// no llega `ubicacion`, y el servicio cae al escalon siguiente. Por eso NO hay ningun
// camino en el que la falta de GPS produzca un error.

const MENSAJERO = "m-1";
const T0 = new Date("2026-07-20T12:00:00.000Z");

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
  ROUTES_ROUTING_PREFERENCE: "TRAFFIC_UNAWARE",
};

function parada(id: string, lat: number, lng: number): ParadaRutaRow {
  return { ordenId: id, latitud: lat, longitud: lng, createdAt: T0 };
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
    trazado: null,
    tramoVivoAt: null,
    tramoPorOrden: new Map(),
    secuenciaPorOrden: new Map(),
    ...over,
  };
}

function build(rutaPrevia: RutaOptimizadaDTO | null, paradas: ParadaRutaRow[]) {
  const rutas = {
    findByMensajero: vi.fn<(m: string) => Promise<RutaOptimizadaDTO | null>>(async () => rutaPrevia),
    upsertOrigen: vi.fn<(m: string, u: unknown) => Promise<void>>(async () => {}),
    reemplazarSecuencia: vi.fn<(m: string, s: string[], meta: unknown) => Promise<void>>(async () => {}),
    guardarTrazado: vi.fn<(m: string, h: string, t: unknown) => Promise<void>>(async () => {}),
    marcarTramoVivo: vi.fn<(m: string, a: Date) => Promise<void>>(async () => {}),
    marcarDesactualizada: vi.fn<(m: string, e: string) => Promise<void>>(async () => {}),
  };
  const paradasRepo: ParadasRepo = { findParadasEnReparto: vi.fn(async () => paradas) };
  const client = {
    optimizar: vi.fn(async (input: { paradas: { ordenId: string }[] }) => ({
      status: "ok" as const,
      secuencia: input.paradas.map((p) => p.ordenId),
    })),
  } as unknown as IRouteOptimizationClient & { optimizar: ReturnType<typeof vi.fn> };

  const service = new OptimizacionRutaService(
    rutas as unknown as IRutaOptimizadaRepository,
    paradasRepo,
    client,
    CONFIG,
    () => T0,
  );
  return { service, rutas, client };
}

/** Origen realmente enviado al proveedor en la llamada. */
function origenEnviado(client: { optimizar: ReturnType<typeof vi.fn> }) {
  return client.optimizar.mock.calls[0][0].origen;
}

/** Fuente que se PERSISTE con la secuencia (la que la UI muestra al mensajero). */
function origenPersistido(rutas: { reemplazarSecuencia: { mock: { calls: unknown[][] } } }) {
  return (rutas.reemplazarSecuencia.mock.calls[0][2] as { origen: { fuente: string } }).origen;
}

const PARADAS = [parada("o1", 10.0, -84.0), parada("o2", 10.2, -84.2)];

describe("R24 escalon 1 — gps RECIENTE", () => {
  it("una ubicacion gps dentro del TTL se usa como origen con fuente `gps`", async () => {
    const { service, rutas, client } = build(
      ruta({
        origenLat: 9.95,
        origenLng: -84.05,
        origenAt: new Date(T0.getTime() - 60 * 60_000), // hace 60 min (< 120)
        origenFuente: "gps",
      }),
      PARADAS,
    );

    await service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(origenEnviado(client)).toEqual({ lat: 9.95, lng: -84.05 });
    expect(origenPersistido(rutas).fuente).toBe("gps");
  });

  it("la ubicacion que llega en la llamada se persiste ANTES de optimizar y manda como origen", async () => {
    // R23: `upsertOrigen` corre antes de leer la ruta, de modo que la posicion recien
    // capturada es la que se usa en esta misma optimizacion.
    const { service, rutas } = build(null, PARADAS);

    await service.ejecutar(MENSAJERO, { motivo: "manual", ubicacion: { lat: 9.9, lng: -84.1 } });

    expect(rutas.upsertOrigen).toHaveBeenCalledWith(MENSAJERO, {
      lat: 9.9,
      lng: -84.1,
      capturadaAt: T0,
      fuente: "gps",
    });
    expect(rutas.upsertOrigen.mock.invocationCallOrder[0]).toBeLessThan(
      rutas.findByMensajero.mock.invocationCallOrder[0],
    );
  });
});

describe("R24 escalon 2 — ultima conocida AUNQUE este vencida", () => {
  it("un gps mas viejo que el TTL sigue sirviendo, pero la fuente pasa a `ultima_conocida`", async () => {
    // No se descarta: un punto de partida viejo es mucho mejor que el centroide. Lo que
    // cambia es la FUENTE, para que la UI pueda avisar de que es aproximado.
    const { service, rutas, client } = build(
      ruta({
        origenLat: 9.95,
        origenLng: -84.05,
        origenAt: new Date(T0.getTime() - 200 * 60_000), // hace 200 min (> 120)
        origenFuente: "gps",
      }),
      PARADAS,
    );

    await service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(origenEnviado(client)).toEqual({ lat: 9.95, lng: -84.05 });
    expect(origenPersistido(rutas).fuente).toBe("ultima_conocida");
  });

  it("una ubicacion SIN instante de captura se trata como vencida", async () => {
    const { service, rutas } = build(
      ruta({ origenLat: 9.95, origenLng: -84.05, origenAt: null, origenFuente: "gps" }),
      PARADAS,
    );
    await service.ejecutar(MENSAJERO, { motivo: "manual" });
    expect(origenPersistido(rutas).fuente).toBe("ultima_conocida");
  });

  it("justo en el limite del TTL sigue contando como `gps`", async () => {
    const { service, rutas } = build(
      ruta({
        origenLat: 9.95,
        origenLng: -84.05,
        origenAt: new Date(T0.getTime() - 120 * 60_000), // exactamente el TTL
        origenFuente: "gps",
      }),
      PARADAS,
    );
    await service.ejecutar(MENSAJERO, { motivo: "manual" });
    expect(origenPersistido(rutas).fuente).toBe("gps");
  });
});

describe("R24 escalon 3 — CENTROIDE de las paradas", () => {
  it("sin ninguna ubicacion conocida, el origen es el centroide y la fuente lo dice", async () => {
    // Se eligio el centroide porque el esquema NO tiene coordenadas de zona ni de bodega
    // (verificado) y no requiere ninguna llamada externa. Anadirlas es un seguimiento.
    const { service, rutas, client } = build(null, PARADAS);

    await service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(origenEnviado(client)).toEqual({ lat: 10.1, lng: -84.1 }); // media aritmetica
    expect(origenPersistido(rutas).fuente).toBe("centroide");
  });

  it("una ruta previa SIN coordenadas de origen tambien cae al centroide", async () => {
    const { service, rutas } = build(ruta({ origenLat: null, origenLng: null }), PARADAS);
    await service.ejecutar(MENSAJERO, { motivo: "manual" });
    expect(origenPersistido(rutas).fuente).toBe("centroide");
  });

  it("el centroide se calcula SOLO sobre las paradas con coordenadas (R37)", async () => {
    const { service, client } = build(null, [
      parada("o1", 10.0, -84.0),
      parada("o2", 10.2, -84.2),
      { ordenId: "o3", latitud: null, longitud: null, createdAt: T0 },
    ]);
    await service.ejecutar(MENSAJERO, { motivo: "manual" });
    // Si la parada sin coordenadas entrara al promedio, saldria NaN.
    expect(origenEnviado(client)).toEqual({ lat: 10.1, lng: -84.1 });
  });
});

describe("R25 — la ausencia de geolocalizacion NUNCA aborta la optimizacion", () => {
  it("sin `ubicacion` (permiso denegado) la optimizacion corre igual, degradando el origen", async () => {
    const { service, rutas, client } = build(null, PARADAS);

    const r = await service.ejecutar(MENSAJERO, { motivo: "manual" }); // sin ubicacion

    expect(r.status).toBe("ok");
    expect(client.optimizar).toHaveBeenCalledTimes(1);
    expect(origenPersistido(rutas).fuente).toBe("centroide");
    // Y no se registra ninguna ubicacion nueva: no habia ninguna que registrar.
    expect(rutas.upsertOrigen).not.toHaveBeenCalled();
  });

  it("ningun escalon del fallback lanza: los tres estados posibles resuelven", async () => {
    const escenarios: (RutaOptimizadaDTO | null)[] = [
      null,
      ruta(),
      ruta({ origenLat: 9.9, origenLng: -84.1, origenAt: T0, origenFuente: "gps" }),
      ruta({ origenLat: 9.9, origenLng: -84.1, origenAt: null, origenFuente: null }),
    ];
    for (const escenario of escenarios) {
      const { service } = build(escenario, PARADAS);
      await expect(service.ejecutar(MENSAJERO, { motivo: "manual" })).resolves.toMatchObject({
        status: "ok",
      });
    }
  });
});
