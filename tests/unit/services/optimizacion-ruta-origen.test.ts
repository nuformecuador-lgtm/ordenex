import { describe, it, expect, vi } from "vitest";
import { OptimizacionRutaService, type ParadasRepo } from "@/lib/services/OptimizacionRutaService";
import type {
  IRutaOptimizadaRepository,
  RutaOptimizadaDTO,
} from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { IRouteOptimizationClient } from "@/lib/interfaces/external/IRouteOptimizationClient";
import type { ParadaRutaRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { RouteOptimizationConfig } from "@/lib/config/route-optimization";
import { distanciaHaversineKm } from "@/lib/geo/polilinea";

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
  // Feature 265: umbral de coherencia del origen. 200 km es el default del codigo; los tests
  // que ejercitan la guarda lo bajan por `config` para no depender de el.
  RUTA_ORIGEN_MAX_KM: 200,
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

function build(
  rutaPrevia: RutaOptimizadaDTO | null,
  paradas: ParadaRutaRow[],
  // Feature 265: el logger y el umbral se inyectan para poder afirmar el aviso agregado (R19)
  // y ejercitar el borde del limite (R17) sin depender del default del codigo.
  logger?: { warn: (m: string) => void },
  configOver: Partial<RouteOptimizationConfig> = {},
) {
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
      fuente: "proveedor" as const,
    })),
  } as unknown as IRouteOptimizationClient & { optimizar: ReturnType<typeof vi.fn> };

  const service = new OptimizacionRutaService(
    rutas as unknown as IRutaOptimizadaRepository,
    paradasRepo,
    client,
    { ...CONFIG, ...configOver },
    () => T0,
    logger,
  );
  return { service, rutas, client, paradasRepo };
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

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Feature 265 (R16-R23) — LA GUARDA DE COHERENCIA DEL ORIGEN
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// El caso que la motiva, medido en produccion el 2026-08-21: origen en Medellin (6.34, -75.51)
// y paradas en Costa Rica. El modelo era irresoluble y la llamada facturada solo podia fallar.
// (Ese origen concreto resulto ser una prueba del propio humano, no una incoherencia de campo:
// la guarda entra igual, pero su umbral NO esta calibrado con produccion. Ver R47.)

/** Origen del incidente. Esta a ~1.000 km del centroide de PARADAS, que esta en Costa Rica. */
const ORIGEN_LEJANO = { origenLat: 6.3422343, origenLng: -75.514335 };

/** El centroide de `PARADAS` (media aritmetica), que es lo que la guarda debe enviar. */
const CENTROIDE_PARADAS = { lat: 10.1, lng: -84.1 };

describe("265/R16, R17, R23 — un origen incoherente se SUSTITUYE, y el trabajo continua", () => {
  it("se llama al proveedor con el CENTROIDE, no con el origen lejano", async () => {
    const { service, rutas, client } = build(
      ruta({ ...ORIGEN_LEJANO, origenAt: T0, origenFuente: "gps" }),
      PARADAS,
    );

    const r = await service.ejecutar(MENSAJERO, { motivo: "manual" });

    // R17: se afirma el ARGUMENTO de la llamada facturada, no solo el resultado.
    expect(origenEnviado(client)).toEqual(CENTROIDE_PARADAS);
    // R23: descartar un origen malo NO cancela el trabajo.
    expect(r.status).toBe("ok");
    expect(client.optimizar).toHaveBeenCalledTimes(1);
    // Y la fuente que se PERSISTE dice que el punto de partida es aproximado.
    expect(origenPersistido(rutas).fuente).toBe("centroide");
  });

  it("R19: avisa con la distancia redondeada y el numero de paradas, SIN coordenadas", async () => {
    const warn = vi.fn();
    const { service } = build(
      ruta({ ...ORIGEN_LEJANO, origenAt: T0, origenFuente: "gps" }),
      PARADAS,
      { warn },
    );

    await service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(warn).toHaveBeenCalledTimes(1);
    const mensaje = warn.mock.calls[0][0] as string;
    expect(mensaje).toMatch(/\d+ km/);
    expect(mensaje).toContain("2 paradas");
    for (const coordenada of ["6.34", "-75.51", "10.1", "-84.1"]) {
      expect(mensaje).not.toContain(coordenada);
    }
  });

  it("R18: aplica tambien a `ultima_conocida`, no solo a `gps`", async () => {
    // El origen del incidente era `gps` RECIENTE: frescura y coherencia son cosas distintas.
    // Acotar la guarda a una sola fuente dejaria el otro camino abierto.
    const { service, rutas, client } = build(
      ruta({ ...ORIGEN_LEJANO, origenAt: new Date(T0.getTime() - 500 * 60_000), origenFuente: "gps" }),
      PARADAS,
    );

    await service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(origenEnviado(client)).toEqual(CENTROIDE_PARADAS);
    expect(origenPersistido(rutas).fuente).toBe("centroide");
  });

  it("R18 bis: si el origen YA es el centroide, no se toca (ni se avisa)", async () => {
    // Seria comparar un punto consigo mismo —siempre 0— y es lo que garantiza que la
    // sustitucion no puede entrar en bucle.
    const warn = vi.fn();
    const { service, rutas, client } = build(null, PARADAS, { warn });

    await service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(origenEnviado(client)).toEqual(CENTROIDE_PARADAS);
    expect(origenPersistido(rutas).fuente).toBe("centroide");
    expect(warn).not.toHaveBeenCalled();
  });

  it("un origen COHERENTE se respeta: la guarda no degrada rutas sanas", async () => {
    const { service, rutas, client } = build(
      ruta({ origenLat: 9.95, origenLng: -84.05, origenAt: T0, origenFuente: "gps" }),
      PARADAS,
    );

    await service.ejecutar(MENSAJERO, { motivo: "manual" });

    expect(origenEnviado(client)).toEqual({ lat: 9.95, lng: -84.05 });
    expect(origenPersistido(rutas).fuente).toBe("gps");
  });

  it("`>` y no `>=`: una distancia EXACTAMENTE igual al limite NO sustituye", async () => {
    // El umbral se INYECTA por config —no se depende del default de 200— y la distancia se
    // calcula con la misma formula del repo para poder poner el limite justo en el borde.
    const origen = { lat: 9.0, lng: -84.1 };
    const km = distanciaHaversineKm(origen, CENTROIDE_PARADAS);
    expect(km).toBeGreaterThan(1); // si esto fuera ~0, el borde no probaria nada

    const enElBorde = build(
      ruta({ origenLat: origen.lat, origenLng: origen.lng, origenAt: T0, origenFuente: "gps" }),
      PARADAS,
      undefined,
      { RUTA_ORIGEN_MAX_KM: km },
    );
    await enElBorde.service.ejecutar(MENSAJERO, { motivo: "manual" });
    expect(origenEnviado(enElBorde.client)).toEqual(origen);

    // Un metro por debajo del limite y ya no cuadra: la guarda sustituye.
    const pasado = build(
      ruta({ origenLat: origen.lat, origenLng: origen.lng, origenAt: T0, origenFuente: "gps" }),
      PARADAS,
      undefined,
      { RUTA_ORIGEN_MAX_KM: km - 0.001 },
    );
    await pasado.service.ejecutar(MENSAJERO, { motivo: "manual" });
    expect(origenEnviado(pasado.client)).toEqual(CENTROIDE_PARADAS);
  });

  it("R20: la HUELLA se calcula con el origen FINAL, el que de verdad se envio", async () => {
    // Si se calculara con el origen viejo, la huella describiria una llamada que no se hizo y
    // la guarda de «sin cambios» empezaria a cortar por el motivo equivocado.
    const conLejano = build(
      ruta({ ...ORIGEN_LEJANO, origenAt: T0, origenFuente: "gps" }),
      PARADAS,
    );
    await conLejano.service.ejecutar(MENSAJERO, { motivo: "manual" });
    const huellaTrasSustituir = (
      conLejano.rutas.reemplazarSecuencia.mock.calls[0][2] as { huellaSet: string }
    ).huellaSet;

    // La misma ejecucion partiendo YA del centroide (sin ruta previa) debe dar la MISMA huella.
    const desdeCentroide = build(null, PARADAS);
    await desdeCentroide.service.ejecutar(MENSAJERO, { motivo: "manual" });
    const huellaCentroide = (
      desdeCentroide.rutas.reemplazarSecuencia.mock.calls[0][2] as { huellaSet: string }
    ).huellaSet;

    expect(huellaTrasSustituir).toBe(huellaCentroide);
  });

  it("R22: la guarda no anade NI UNA llamada al proveedor NI UNA lectura de la base", async () => {
    const conLejano = build(
      ruta({ ...ORIGEN_LEJANO, origenAt: T0, origenFuente: "gps" }),
      PARADAS,
    );
    await conLejano.service.ejecutar(MENSAJERO, { motivo: "manual" });

    const sano = build(
      ruta({ origenLat: 9.95, origenLng: -84.05, origenAt: T0, origenFuente: "gps" }),
      PARADAS,
    );
    await sano.service.ejecutar(MENSAJERO, { motivo: "manual" });

    // Mismo numero de llamadas facturadas y de lecturas con y sin sustitucion.
    expect(conLejano.client.optimizar).toHaveBeenCalledTimes(1);
    expect(conLejano.rutas.findByMensajero).toHaveBeenCalledTimes(
      sano.rutas.findByMensajero.mock.calls.length,
    );
    expect(conLejano.paradasRepo.findParadasEnReparto).toHaveBeenCalledTimes(
      (sano.paradasRepo.findParadasEnReparto as ReturnType<typeof vi.fn>).mock.calls.length,
    );
  });
});

describe("R25 bis — los escenarios de origen siguen sin lanzar con la guarda puesta", () => {
  it("ningun escalon del fallback lanza: los cuatro estados posibles resuelven", async () => {
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
