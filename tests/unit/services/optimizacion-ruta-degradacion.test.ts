import { describe, it, expect, vi, afterEach } from "vitest";
import { OptimizacionRutaService, type ParadasRepo } from "@/lib/services/OptimizacionRutaService";
import {
  buildOptimizacionRutaService as _noUsado,
  crearOptimizacionRutaHandler,
} from "@/lib/services/jobs/optimizacion-ruta-handler";
import { GoogleRouteOptimizationClient } from "@/lib/clients/google-route-optimization";
import { HaversineRouteOptimizationClient } from "@/lib/clients/haversine-route-optimization";
import { FallbackRouteOptimizationClient } from "@/lib/clients/fallback-route-optimization";
import type { IRutaOptimizadaRepository } from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { ParadaRutaRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { RouteOptimizationConfig } from "@/lib/config/route-optimization";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";

// Feature 265 (R9, R10, R13, R35, R48, R49) — LA CADENA ENTERA, DESDE LA RESPUESTA DEL
// PROVEEDOR HASTA LA FILA Y EL JOB.
//
// ═══ POR QUE ESTE ARCHIVO NO USA DOBLES DEL CLIENTE ═══
// Los demas tests del servicio inyectan un `IRouteOptimizationClient` falso, asi que ninguno
// ve lo que de verdad pasa cuando Google contesta lo que contesto el 2026-08-21: aqui se
// cablean el cliente REAL (con `fetch` inyectado), el compuesto REAL y el calculador local
// REAL. Es lo unico que prueba que las cuatro piezas encajan — el defecto original vivia
// justamente en la costura entre ellas.
//
// ⚠️ `_noUsado` esta importado a proposito: si alguien renombra la fabrica del handler, este
// archivo se pone rojo en vez de quedarse verde apuntando a un modulo que ya no existe.
void _noUsado;

const MENSAJERO = "m-1";
const T0 = new Date("2026-08-22T12:00:00.000Z");

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
  RUTA_ORIGEN_MAX_KM: 200,
  ROUTES_ROUTING_PREFERENCE: "TRAFFIC_UNAWARE",
};

/** Tres paradas reales de San Jose, todas dentro del umbral del origen. */
const PARADAS: ParadaRutaRow[] = [
  { ordenId: "o1", latitud: 9.9281, longitud: -84.0907, createdAt: T0 },
  { ordenId: "o2", latitud: 9.9355, longitud: -84.0839, createdAt: T0 },
  { ordenId: "o3", latitud: 9.9412, longitud: -84.1012, createdAt: T0 },
];

/** La respuesta del incidente: el proveedor no sirvio ninguna y lo explica. */
const RESPUESTA_SIN_SOLUCION = {
  routes: [{}],
  skippedShipments: [{}, {}, {}],
  validationErrors: [{}],
  metrics: { skippedMandatoryShipmentCount: 3 },
};

function respuestaHttp(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** Servicio REAL con el compuesto REAL; solo la red y la base son dobles. */
function armarCadena(body: unknown) {
  const rutas = {
    findByMensajero: vi.fn(async () => null),
    upsertOrigen: vi.fn<(m: string, u: unknown) => Promise<void>>(async () => {}),
    reemplazarSecuencia: vi.fn<(m: string, s: string[], meta: unknown) => Promise<void>>(
      async () => {},
    ),
    guardarTrazado: vi.fn<(m: string, h: string, t: unknown) => Promise<void>>(async () => {}),
    marcarTramoVivo: vi.fn<(m: string, a: Date) => Promise<void>>(async () => {}),
    marcarDesactualizada: vi.fn<(m: string, e: string) => Promise<void>>(async () => {}),
  };
  const paradasRepo: ParadasRepo = { findParadasEnReparto: async () => PARADAS };
  const fetchImpl = vi.fn(async () => respuestaHttp(body));
  const warn = vi.fn();

  const google = new GoogleRouteOptimizationClient({
    projectId: "proyecto-de-prueba",
    getToken: async () => "ya29.token-de-prueba",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const client = new FallbackRouteOptimizationClient(
    google,
    new HaversineRouteOptimizationClient(),
    { warn },
  );

  const service = new OptimizacionRutaService(
    rutas as unknown as IRutaOptimizadaRepository,
    paradasRepo,
    client,
    CONFIG,
    () => T0,
    { warn },
  );
  return { service, rutas, fetchImpl, warn };
}

function job(): JobDTO {
  return {
    id: "job-1",
    tipo: "optimizacion_ruta",
    payload: { mensajeroId: MENSAJERO },
    estado: "processing",
    intentos: 1,
    maxIntentos: 5,
    runAfter: T0,
    lockedAt: T0,
    lastError: null,
    dedupeKey: null,
    createdAt: T0,
    updatedAt: T0,
  };
}

/** La meta con la que se persistio la secuencia. */
function metaDe(rutas: { reemplazarSecuencia: { mock: { calls: unknown[][] } } }) {
  return rutas.reemplazarSecuencia.mock.calls[0][2] as {
    huellaSet: string;
    secuenciaFuente: "proveedor" | "local" | null;
  };
}

describe("265/R9, R10, R35 — el proveedor no las sirve todas: se ordena TODO en local", () => {
  it("la secuencia persistida cubre las TRES paradas y queda marcada `local`", async () => {
    const { service, rutas } = armarCadena(RESPUESTA_SIN_SOLUCION);

    const r = await service.ejecutar(MENSAJERO, { motivo: "debounce", jobCreatedAt: T0 });

    expect(r).toMatchObject({ status: "ok", paradas: 3, secuenciaFuente: "local" });
    // R10: TODAS, ni una menos. Sin esto, una parada saltada desapareceria del mapa y del
    // orden del mensajero, indistinguible de una parada sin geocodificar.
    const persistida = rutas.reemplazarSecuencia.mock.calls[0][1] as string[];
    expect([...persistida].sort()).toEqual(["o1", "o2", "o3"]);
    expect(metaDe(rutas).secuenciaFuente).toBe("local");
    // R15: la ruta NO queda desactualizada — no hubo fallo que conservar.
    expect(rutas.marcarDesactualizada).not.toHaveBeenCalled();
  });

  it("una respuesta COMPLETA del proveedor se persiste marcada `proveedor`", async () => {
    // La mitad negativa de lo anterior: si esto tambien dijera `local`, la marca no
    // distinguiria nada y el aviso del mensajero apareceria siempre.
    const { service, rutas } = armarCadena({
      routes: [{ visits: [{ shipmentIndex: 2 }, { shipmentIndex: 0 }, { shipmentIndex: 1 }] }],
    });

    await service.ejecutar(MENSAJERO, { motivo: "debounce", jobCreatedAt: T0 });

    expect(rutas.reemplazarSecuencia.mock.calls[0][1]).toEqual(["o3", "o1", "o2"]);
    expect(metaDe(rutas).secuenciaFuente).toBe("proveedor");
  });
});

describe("265/R13 — al degradar, el job COMPLETA: sin reintento, sin backoff, sin dead-letter", () => {
  it("`crearOptimizacionRutaHandler` NO lanza", async () => {
    // Reintentar una respuesta DETERMINISTA gasta llamadas pagadas por algo que no va a
    // cambiar y llena el dead-letter de ruido permanente. Medido: 72 eventos con la misma
    // entrada y la misma respuesta.
    const { service, rutas, fetchImpl } = armarCadena(RESPUESTA_SIN_SOLUCION);

    await expect(crearOptimizacionRutaHandler(service)(job())).resolves.toBeUndefined();

    expect(rutas.reemplazarSecuencia).toHaveBeenCalledTimes(1);
    // Y UNA sola llamada facturada, no una por reintento.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("pero un fallo de VERDAD del proveedor sigue lanzando (la cola debe verlo)", async () => {
    // Mitad negativa: sin ella, un `catch` demasiado ancho convertiria cualquier fallo en un
    // job completado y la ruta dejaria de actualizarse en silencio.
    const { service } = armarCadena({ routes: "no-es-un-array" });
    await expect(crearOptimizacionRutaHandler(service)(job())).rejects.toThrow();
  });
});

describe("265/R48 — con la traza APAGADA no cambia ninguna decision ni ningun motivo", () => {
  const previo = process.env.RUTA_DEBUG_LOG;
  afterEach(() => {
    if (previo === undefined) delete process.env.RUTA_DEBUG_LOG;
    else process.env.RUTA_DEBUG_LOG = previo;
    vi.restoreAllMocks();
  });

  it("apagada y encendida producen la MISMA secuencia, la misma marca y el mismo aviso", async () => {
    async function correr(valor: string | undefined) {
      if (valor === undefined) delete process.env.RUTA_DEBUG_LOG;
      else process.env.RUTA_DEBUG_LOG = valor;
      const { service, rutas, warn } = armarCadena(RESPUESTA_SIN_SOLUCION);
      const r = await service.ejecutar(MENSAJERO, { motivo: "debounce", jobCreatedAt: T0 });
      return {
        resultado: r,
        secuencia: rutas.reemplazarSecuencia.mock.calls[0][1] as string[],
        fuente: metaDe(rutas).secuenciaFuente,
        avisos: warn.mock.calls.map((c) => c[0] as string),
      };
    }

    const apagada = await correr("0");
    const ausente = await correr(undefined); // 265/P7: sin variable, tambien apagada
    const encendida = await correr("1");

    for (const otra of [ausente, encendida]) {
      expect(otra.secuencia).toEqual(apagada.secuencia);
      expect(otra.fuente).toBe(apagada.fuente);
      expect(otra.avisos).toEqual(apagada.avisos);
      expect(otra.resultado).toEqual(apagada.resultado);
    }
    // Y lo que se decidio con la traza apagada no es «no hacer nada».
    expect(apagada.fuente).toBe("local");
    expect(apagada.avisos.length).toBeGreaterThan(0);
  });

  it("con la traza apagada NO se imprime una sola linea; encendida SI", async () => {
    // La otra mitad de P7: el default invertido tiene que APAGAR de verdad, no solo permitir
    // apagar. Un default que sigue imprimiendo deja preview volcando coordenadas de entrega.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    delete process.env.RUTA_DEBUG_LOG;
    const sinVariable = armarCadena(RESPUESTA_SIN_SOLUCION);
    await sinVariable.service.ejecutar(MENSAJERO, { motivo: "debounce", jobCreatedAt: T0 });
    expect(log).not.toHaveBeenCalled();

    process.env.RUTA_DEBUG_LOG = "1";
    const encendida = armarCadena(RESPUESTA_SIN_SOLUCION);
    await encendida.service.ejecutar(MENSAJERO, { motivo: "debounce", jobCreatedAt: T0 });
    expect(log).toHaveBeenCalled();
    expect((log.mock.calls[0][0] as string).startsWith("optimizer***:")).toBe(true);
  });
});

describe("265/R49 — sin codigos de motivo, el aviso y el motivo siguen completos", () => {
  it("el aviso agregado nombra la causa con conteos y no deja huecos", async () => {
    // La respuesta del incidente NO trae ningun codigo reconocible: es el caso normal, no un
    // fallo. Un `undefined`, una lista vacia impresa o un «(sin motivos)» de relleno serian
    // ruido que alguien acabaria diagnosticando como un bug.
    const { service, warn } = armarCadena(RESPUESTA_SIN_SOLUCION);

    await service.ejecutar(MENSAJERO, { motivo: "debounce", jobCreatedAt: T0 });

    const aviso = warn.mock.calls.map((c) => c[0] as string).join(" | ");
    expect(aviso).toContain("0 de 3");
    expect(aviso).not.toMatch(/undefined|\[\]|sin motivos/i);
    // Y ninguna coordenada ni identificador se cuela en el aviso (R6).
    for (const prohibido of ["9.9281", "-84.0907", "o1"]) {
      expect(aviso).not.toContain(prohibido);
    }
  });
});
