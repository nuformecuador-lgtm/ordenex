import { describe, it, expect, vi } from "vitest";
import { GeocodificacionService } from "@/lib/services/GeocodificacionService";
import { GeocodeRespuestaInvalidaError } from "@/lib/clients/google-geocode";
import {
  AsignabilidadCoordenadasService,
  esAsignable,
} from "@/lib/services/AsignabilidadCoordenadasService";
import { hashDireccion } from "@/lib/geo/direccion-query";
import { dedupeKeyGeocodificacion } from "@/lib/services/jobs/geocodificacion-encolado";
import type { GeocodeOutcome } from "@/lib/interfaces/external/IGeocodeClient";
import type { IJobRepository, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { IGeocodeCacheRepository } from "@/lib/interfaces/repositories/IGeocodeCacheRepository";
import type {
  IOrdenGeocodeRepository,
  OrdenGeocodeRow,
} from "@/lib/interfaces/repositories/IOrdenGeocodeRepository";
import type {
  EstadoAsignabilidad,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { JobEstado } from "@prisma/client";

/**
 * FICHA 400 (T6, R11/R16) — CONTRATO DE LAS DOS PUNTAS, EN UNA SOLA PRUEBA.
 *
 * ═══ POR QUE ESTE ARCHIVO NO USA NINGUN DOBLE INTERMEDIO ═══
 * El modo de fallo tipico de este repo es el MUDO: una punta escribe el marcador, la otra
 * deja de leerlo, y la suite sigue verde porque cada una tiene su propio test con su propio
 * doble — cada uno coherente consigo mismo, los dos desconectados. Aqui se recorre el camino
 * ENTERO con las piezas REALES:
 *
 *   `GeocodificacionService.ejecutar` LANZA
 *      -> el `message` se recorta a 500 caracteres, EXACTAMENTE como hace
 *         `JobQueueService.mensajeError` antes de persistirlo
 *      -> se arma el `JobDTO` que `findByDedupeKeys` devolveria con ese `last_error`
 *      -> se pasa al gate REAL (`AsignabilidadCoordenadasService`)
 *      -> se comprueba la clasificacion.
 *
 * Solo son dobles la red (el cliente del proveedor), la base (los repositorios) y la cola.
 * La POLITICA —quien marca, quien lee, y con que criterio— es la de produccion.
 *
 * MUTACION COMPROBADA: quitar `marcarFalloConfigGeocode` en `GeocodificacionService`, o
 * quitar el paso del marcador en `AsignabilidadCoordenadasService`, pone rojo este archivo.
 */

const ORDEN_ID = "orden-1";
const DIRECCION = "Av. Central 100";
const AHORA = new Date("2026-09-09T12:00:00.000Z");

const ORDEN_GEO: OrdenGeocodeRow = {
  id: ORDEN_ID,
  direccion: DIRECCION,
  distritoNombre: "Carmen",
  cantonNombre: "San José",
  provinciaNombre: "San José",
};

/** El MISMO recorte que `JobQueueService.mensajeError` aplica antes de `repo.fail(...)`. */
const MAX_ERROR_LEN = 500;
function comoLaCola(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.slice(0, MAX_ERROR_LEN);
}

/** El emisor REAL, con la red y la base dobladas. */
function emisor(opts: { outcome?: GeocodeOutcome; apiKey?: string | null } = {}) {
  const ordenes = {
    findParaGeocodificar: vi.fn(async () => ORDEN_GEO),
    guardarResultado: vi.fn(async () => {}),
  } as unknown as IOrdenGeocodeRepository;
  const cache = {
    findByHash: vi.fn(async () => null),
    upsert: vi.fn(async () => {}),
  } as unknown as IGeocodeCacheRepository;
  const geocodificar = vi.fn(async () => {
    if (opts.outcome === undefined) throw new GeocodeRespuestaInvalidaError("cuerpo no es JSON");
    return opts.outcome;
  });
  return new GeocodificacionService(
    ordenes,
    cache,
    { geocodificar },
    {
      GOOGLE_MAPS_API_KEY: opts.apiKey === undefined ? "clave-de-prueba" : opts.apiKey,
      GEOCODE_TIMEOUT_MS: 10_000,
    },
    () => AHORA,
    { warn: () => {} },
  );
}

function jobDeGeocodificacion(payload: Record<string, unknown> = { ordenId: ORDEN_ID }): JobDTO {
  return {
    id: "job-1",
    tipo: "geocodificacion",
    payload,
    estado: "processing",
    intentos: 1,
    maxIntentos: 8,
    runAfter: AHORA,
    lockedAt: AHORA,
    lastError: null,
    dedupeKey: dedupeKeyGeocodificacion(ORDEN_ID, hashDireccion(DIRECCION)),
    createdAt: AHORA,
    updatedAt: AHORA,
  };
}

/** El gate REAL, con una cola que devuelve el job tal como quedaria tras el fallo. */
async function clasificarConElGateReal(
  lastError: string,
  estadoDelJob: JobEstado,
): Promise<EstadoAsignabilidad | undefined> {
  const fila: JobDTO = { ...jobDeGeocodificacion(), estado: estadoDelJob, lastError };
  const cola = {
    findByDedupeKeys: vi.fn(async (keys: string[]) =>
      fila.dedupeKey !== null && keys.includes(fila.dedupeKey) ? [fila] : [],
    ),
    enqueue: vi.fn(async () => null),
  } as unknown as IJobRepository;

  const orden: OrdenAsignabilidadRow = {
    id: ORDEN_ID,
    direccion: DIRECCION,
    latitud: null,
    longitud: null,
    geocodeStatus: null,
  };
  const estados = await new AsignabilidadCoordenadasService(cola).evaluar([orden]);
  return estados.get(ORDEN_ID);
}

/** Ejecuta el emisor esperando que LANCE, y devuelve el `last_error` que la cola guardaria. */
async function lastErrorTrasFallar(
  service: GeocodificacionService,
  payload?: Record<string, unknown>,
): Promise<string> {
  const err = await service
    .ejecutar(jobDeGeocodificacion(payload))
    .then(() => null)
    .catch((e: unknown) => e);
  // No-vacuidad: si el service dejara de lanzar, este test no debe reportar `passed`
  // comparando `null` con nada.
  expect(err).not.toBeNull();
  return comoLaCola(err);
}

/* ══════════════════════════════════════════════════════════════════════════════════════ */

describe("400/R11 — las DOS causas propias recorren el camino entero y abren la puerta", () => {
  it.each(["failed", "pending", "processing"] as const)(
    "el proveedor rechaza la peticion (REQUEST_DENIED), job %s -> asignable_sin_ubicacion",
    async (estadoDelJob) => {
      const lastError = await lastErrorTrasFallar(
        emisor({
          outcome: {
            status: "config_invalida",
            detalle: "geocodificar direccion: el proveedor rechazo la peticion (REQUEST_DENIED)",
          },
        }),
      );

      const estado = await clasificarConElGateReal(lastError, estadoDelJob);

      expect(estado).toBe("asignable_sin_ubicacion");
      expect(esAsignable(estado)).toBe(true);
    },
  );

  it.each(["failed", "pending", "processing"] as const)(
    "falta la credencial (`GOOGLE_MAPS_API_KEY` ausente), job %s -> asignable_sin_ubicacion",
    async (estadoDelJob) => {
      const lastError = await lastErrorTrasFallar(emisor({ apiKey: null }));

      const estado = await clasificarConElGateReal(lastError, estadoDelJob);

      expect(estado).toBe("asignable_sin_ubicacion");
      expect(esAsignable(estado)).toBe(true);
    },
  );

  it("el recorte de la cola no rompe nada ni con un detalle enorme del proveedor", async () => {
    // R12 medido de punta a punta: el detalle real puede ser largo; el marcador va delante.
    const lastError = await lastErrorTrasFallar(
      emisor({ outcome: { status: "config_invalida", detalle: "D".repeat(3000) } }),
    );

    expect(lastError).toHaveLength(MAX_ERROR_LEN);
    expect(await clasificarConElGateReal(lastError, "failed")).toBe("asignable_sin_ubicacion");
  });
});

describe("400/R16 — las causas AJENAS siguen bloqueando, una por una", () => {
  /** Los siete fallos que NO son de configuracion, tal como los produce el sistema. */
  const AJENOS: [string, () => Promise<string>][] = [
    [
      "fallo de red",
      () =>
        lastErrorTrasFallar(
          emisor({ outcome: { status: "transitorio", detalle: "fallo de red" } }),
        ),
    ],
    [
      "timeout",
      () =>
        lastErrorTrasFallar(
          emisor({ outcome: { status: "transitorio", detalle: "timeout de la peticion" } }),
        ),
    ],
    [
      "HTTP 5xx",
      () =>
        lastErrorTrasFallar(emisor({ outcome: { status: "transitorio", detalle: "HTTP 503" } })),
    ],
    [
      "cuota (OVER_QUERY_LIMIT)",
      () =>
        lastErrorTrasFallar(
          emisor({
            outcome: {
              status: "transitorio",
              detalle: "geocodificar direccion: OVER_QUERY_LIMIT",
            },
          }),
        ),
    ],
    [
      "UNKNOWN_ERROR",
      () =>
        lastErrorTrasFallar(
          emisor({
            outcome: { status: "transitorio", detalle: "geocodificar direccion: UNKNOWN_ERROR" },
          }),
        ),
    ],
    [
      "estado desconocido del proveedor",
      () =>
        lastErrorTrasFallar(
          emisor({
            outcome: {
              status: "transitorio",
              detalle: "geocodificar direccion: estado ALGO_NUEVO",
            },
          }),
        ),
    ],
    [
      "respuesta con forma inesperada",
      // Sin `outcome`, el cliente doblado lanza el `GeocodeRespuestaInvalidaError` REAL.
      () => lastErrorTrasFallar(emisor()),
    ],
    [
      "payload invalido",
      () => lastErrorTrasFallar(emisor(), { noEsElPayloadEsperado: true }),
    ],
  ];

  it.each(AJENOS)("%s, job `failed` -> geocodificacion_agotada (sigue bloqueando)", async (
    _nombre,
    producirLastError,
  ) => {
    const lastError = await producirLastError();
    const estado = await clasificarConElGateReal(lastError, "failed");

    expect(estado).toBe("geocodificacion_agotada");
    expect(esAsignable(estado)).toBe(false);
  });

  it.each(AJENOS)("%s, job `pending` -> geocodificacion_en_curso (sigue bloqueando)", async (
    _nombre,
    producirLastError,
  ) => {
    const lastError = await producirLastError();
    const estado = await clasificarConElGateReal(lastError, "pending");

    expect(estado).toBe("geocodificacion_en_curso");
    expect(esAsignable(estado)).toBe(false);
  });

  it("el noveno ajeno: `handler no registrado` (lo escribe la cola, no el handler)", async () => {
    // Este mensaje no lo produce `GeocodificacionService` sino `JobQueueService` cuando no
    // hay handler para el tipo. Se cita LITERAL porque es el texto que de verdad acaba en
    // `last_error`, y lo que se afirma es que NO abre la puerta.
    const lastError = comoLaCola(new Error("handler no registrado para el tipo de job"));

    expect(await clasificarConElGateReal(lastError, "failed")).toBe("geocodificacion_agotada");
  });
});

describe("400 — el camino completo no se puede falsear por una sola punta", () => {
  it("si el emisor deja de marcar, el gate deja de abrir (esta es la costura protegida)", async () => {
    // Se simula la mutacion «alguien quita `marcarFalloConfigGeocode`»: el mismo detalle,
    // sin prefijo. El gate tiene que volver a bloquear. Sin esta asercion, un test que solo
    // mirara al gate seguiria verde con el emisor roto.
    const detalleSinMarcar =
      "geocodificar direccion: el proveedor rechazo la peticion (REQUEST_DENIED)";

    expect(await clasificarConElGateReal(detalleSinMarcar, "failed")).toBe(
      "geocodificacion_agotada",
    );
  });

  it("y el marcado que produce el emisor NO es el texto pelado (no coinciden por casualidad)", async () => {
    const marcado = await lastErrorTrasFallar(
      emisor({
        outcome: {
          status: "config_invalida",
          detalle: "geocodificar direccion: el proveedor rechazo la peticion (REQUEST_DENIED)",
        },
      }),
    );
    expect(marcado).not.toBe(
      "geocodificar direccion: el proveedor rechazo la peticion (REQUEST_DENIED)",
    );
    expect(marcado).toContain("REQUEST_DENIED");
  });
});
