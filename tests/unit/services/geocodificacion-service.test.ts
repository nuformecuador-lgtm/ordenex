import { describe, it, expect, vi } from "vitest";
import {
  GeocodificacionService,
  GeocodeNoConfiguradoError,
  GeocodeIntentoFallidoError,
  GeocodeConfigInvalidaError,
} from "@/lib/services/GeocodificacionService";
import { JobQueueService } from "@/lib/services/JobQueueService";
import { GoogleGeocodeClient, GeocodeRespuestaInvalidaError } from "@/lib/clients/google-geocode";
import { esFalloConfigGeocode } from "@/lib/geo/fallo-config-geocode";
import { OrdenGeocodeRepository } from "@/lib/repositories/OrdenGeocodeRepository";
import type { PrismaClient } from "@prisma/client";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler, RecurrenciaSpec } from "@/lib/interfaces/services/IJobQueueService";
import type { JobTipo } from "@prisma/client";
import type { GeocodeOutcome } from "@/lib/interfaces/external/IGeocodeClient";
import type {
  IOrdenGeocodeRepository,
  OrdenGeocodeRow,
} from "@/lib/interfaces/repositories/IOrdenGeocodeRepository";
import type {
  GeocodeCacheEntry,
  IGeocodeCacheRepository,
} from "@/lib/interfaces/repositories/IGeocodeCacheRepository";
import { hashDireccion, construirQueryDireccion } from "@/lib/geo/direccion-query";
import type { IGeocodeSaludService } from "@/lib/interfaces/services/IGeocodeSaludService";

// Feature 91 (R18, R20-R31) — el handler y su TABLA DE DECISION normativa (gate F1.4-Q3,
// requirements.md Bloque E). Retornar = el job se completa; lanzar = backoff y, agotados
// los intentos, dead-letter. Todo con dobles: sin DB, sin red y sin credencial.

const ORDEN_ID = "orden-1";
const AHORA = new Date("2026-07-19T12:00:00.000Z");

const ORDEN: OrdenGeocodeRow = {
  id: ORDEN_ID,
  direccion: "Av. Central 100",
  distritoNombre: "Carmen",
  cantonNombre: "San José",
  provinciaNombre: "San José",
};

const QUERY = construirQueryDireccion(ORDEN) as string;
const HASH = hashDireccion(QUERY);

function job(payload: Record<string, unknown> = { ordenId: ORDEN_ID }): JobDTO {
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
    dedupeKey: `geocodificacion:${ORDEN_ID}:${HASH.slice(0, 8)}`,
    createdAt: AHORA,
    updatedAt: AHORA,
  };
}

interface Dobles {
  service: GeocodificacionService;
  ordenes: { findParaGeocodificar: ReturnType<typeof vi.fn>; guardarResultado: ReturnType<typeof vi.fn> };
  cache: { findByHash: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  geocodificar: ReturnType<typeof vi.fn>;
  logs: string[];
  /** FICHA 401 (T12): el doble de salud que CUENTA LLAMADAS. */
  salud: {
    registrarFalloConfig: ReturnType<typeof vi.fn>;
    registrarExitoProveedor: ReturnType<typeof vi.fn>;
  };
}

function build(opts: {
  orden?: OrdenGeocodeRow | null;
  enCache?: GeocodeCacheEntry | null;
  outcome?: GeocodeOutcome;
  apiKey?: string | null;
  /** FICHA 401: la salud revienta — el desenlace del job NO puede cambiar por eso (R11/R20). */
  saludLanza?: Error;
} = {}): Dobles {
  const ordenes = {
    findParaGeocodificar: vi.fn(async () =>
      opts.orden === undefined ? ORDEN : opts.orden,
    ),
    guardarResultado: vi.fn(async () => {}),
  };
  const cache = {
    findByHash: vi.fn(async () => opts.enCache ?? null),
    upsert: vi.fn(async () => {}),
  };
  const geocodificar = vi.fn(
    async () => opts.outcome ?? ({ status: "sin_resultados" } as GeocodeOutcome),
  );
  const logs: string[] = [];
  const salud = {
    registrarFalloConfig: vi.fn(async () => {
      if (opts.saludLanza) throw opts.saludLanza;
    }),
    registrarExitoProveedor: vi.fn(async () => {
      if (opts.saludLanza) throw opts.saludLanza;
      return 0;
    }),
  };
  const service = new GeocodificacionService(
    ordenes as unknown as IOrdenGeocodeRepository,
    cache as unknown as IGeocodeCacheRepository,
    { geocodificar },
    {
      GOOGLE_MAPS_API_KEY: opts.apiKey === undefined ? "clave-de-prueba" : opts.apiKey,
      GEOCODE_TIMEOUT_MS: 10_000,
    },
    () => AHORA,
    { warn: (m) => logs.push(m) },
    salud as unknown as IGeocodeSaludService,
  );
  return { service, ordenes, cache, geocodificar, logs, salud };
}

const OUTCOME_OK: GeocodeOutcome = {
  status: "ok",
  latitud: 9.9333,
  longitud: -84.0833,
  precision: "ROOFTOP",
  crudo: { geometry: {} },
};

describe("R18 — respuesta satisfactoria", () => {
  it("con respuesta OK escribe latitud, longitud, precision y geocoded_at", async () => {
    const d = build({ outcome: OUTCOME_OK });
    await d.service.ejecutar(job());
    expect(d.ordenes.guardarResultado).toHaveBeenCalledWith(ORDEN_ID, {
      latitud: 9.9333,
      longitud: -84.0833,
      precision: "ROOFTOP",
      status: "OK",
      geocodedAt: AHORA,
    });
  });

  it("la consulta enviada al proveedor incluye los nombres de catalogo y el pais", async () => {
    const d = build({ outcome: OUTCOME_OK });
    await d.service.ejecutar(job());
    expect(d.geocodificar).toHaveBeenCalledWith(
      "Av. Central 100, Carmen, San José, San José, Costa Rica",
    );
  });
});

describe("R20 — precision baja no descarta el resultado", () => {
  it("un resultado APPROXIMATE se guarda con su precision", async () => {
    const d = build({ outcome: { ...OUTCOME_OK, precision: "APPROXIMATE" } });
    await d.service.ejecutar(job());
    expect(d.ordenes.guardarResultado).toHaveBeenCalledWith(
      ORDEN_ID,
      expect.objectContaining({ precision: "APPROXIMATE", status: "OK", latitud: 9.9333 }),
    );
  });
});

describe("R21 — ZERO_RESULTS", () => {
  it("ZERO_RESULTS registra el estado y completa el job sin reintento", async () => {
    const d = build({ outcome: { status: "sin_resultados" } });
    // No lanzar == el drenador hace `complete` (no hay backoff ni dead-letter).
    await expect(d.service.ejecutar(job())).resolves.toBeUndefined();
    expect(d.ordenes.guardarResultado).toHaveBeenCalledWith(ORDEN_ID, {
      latitud: null,
      longitud: null,
      precision: null,
      status: "ZERO_RESULTS",
      geocodedAt: AHORA,
    });
    // No contamina la cache: solo se cachean resultados satisfactorios.
    expect(d.cache.upsert).not.toHaveBeenCalled();
  });
});

describe("R22 — INVALID_REQUEST", () => {
  it("INVALID_REQUEST registra el estado y completa el job sin reintento", async () => {
    const d = build({ outcome: { status: "consulta_invalida" } });
    await expect(d.service.ejecutar(job())).resolves.toBeUndefined();
    expect(d.ordenes.guardarResultado).toHaveBeenCalledWith(
      ORDEN_ID,
      expect.objectContaining({ status: "INVALID_REQUEST", latitud: null, longitud: null }),
    );
    expect(d.cache.upsert).not.toHaveBeenCalled();
  });
});

describe("R23 — fallos transitorios", () => {
  it("OVER_QUERY_LIMIT, UNKNOWN_ERROR, 5xx y fallo de red lanzan para reintento", async () => {
    for (const detalle of ["OVER_QUERY_LIMIT", "UNKNOWN_ERROR", "HTTP 503", "fallo de red"]) {
      const d = build({ outcome: { status: "transitorio", detalle } });
      await expect(d.service.ejecutar(job())).rejects.toBeInstanceOf(GeocodeIntentoFallidoError);
      // Un transitorio NO escribe nada en la orden: la coordenada anterior no se pisa.
      expect(d.ordenes.guardarResultado).not.toHaveBeenCalled();
    }
  });

  // FEATURE 400 (T3, R16) — la mitad que impide que el marcador se reparta a todo el mundo.
  it("400/R16: NINGUN transitorio lleva el marcador de fallo de configuracion", async () => {
    for (const detalle of ["OVER_QUERY_LIMIT", "UNKNOWN_ERROR", "HTTP 503", "fallo de red"]) {
      const d = build({ outcome: { status: "transitorio", detalle } });
      const error = (await d.service.ejecutar(job()).catch((e: unknown) => e)) as Error;
      expect(esFalloConfigGeocode(error.message)).toBe(false);
    }
  });

  // FEATURE 400 (T3, R16): los otros dos fallos AJENOS que puede producir este service.
  it("400/R16: el payload invalido tampoco lleva el marcador", async () => {
    const d = build();
    const error = (await d.service
      .ejecutar(job({ noEsElPayloadEsperado: true }))
      .catch((e: unknown) => e)) as Error;
    expect(error.message).toContain("payload invalido");
    expect(esFalloConfigGeocode(error.message)).toBe(false);
  });

  it("400/R16: una respuesta del proveedor con forma inesperada tampoco lo lleva", async () => {
    // El error REAL del cliente, no uno inventado: si algun dia se le anadiera un prefijo,
    // este test lo veria.
    const error = new GeocodeRespuestaInvalidaError("campos invalidos: results.0.geometry");
    expect(esFalloConfigGeocode(error.message)).toBe(false);
  });
});

describe("R24 — REQUEST_DENIED", () => {
  // FEATURE 400 (T4, 2026-09-09) — ESTA ASERCION CAMBIO A PROPOSITO. Hasta la 400 decia
  // `toBeInstanceOf(GeocodeIntentoFallidoError)`, y ESE literal ERA el contrato: afirmaba
  // que REQUEST_DENIED y un fallo de red eran el mismo desenlace. Justo eso es el bug que
  // esta ficha corrige, asi que la asercion se actualiza a la clase nueva y se le anade la
  // mitad negativa (ya NO son el mismo cubo).
  it("REQUEST_DENIED lanza `GeocodeConfigInvalidaError` y no escribe coordenadas", async () => {
    const d = build({ outcome: { status: "config_invalida", detalle: "REQUEST_DENIED" } });
    await expect(d.service.ejecutar(job())).rejects.toBeInstanceOf(GeocodeConfigInvalidaError);
    expect(d.ordenes.guardarResultado).not.toHaveBeenCalled();
    expect(d.cache.upsert).not.toHaveBeenCalled();
  });

  it("400/R11: su mensaje lleva el marcador de fallo de configuracion", async () => {
    const d = build({ outcome: { status: "config_invalida", detalle: "REQUEST_DENIED" } });
    const error = (await d.service.ejecutar(job()).catch((e: unknown) => e)) as Error;
    expect(esFalloConfigGeocode(error.message)).toBe(true);
    // Y el diagnostico original sigue ahi: el marcador anade, no sustituye.
    expect(error.message).toContain("REQUEST_DENIED");
  });

  it("400/R16: y NO es un `GeocodeIntentoFallidoError` — dejaron de ser el mismo cubo", async () => {
    const d = build({ outcome: { status: "config_invalida", detalle: "REQUEST_DENIED" } });
    const error = (await d.service.ejecutar(job()).catch((e: unknown) => e)) as Error;
    expect(error).not.toBeInstanceOf(GeocodeIntentoFallidoError);
  });
});

describe("R25 — sin credencial configurada", () => {
  it("sin credencial configurada falla solo el job de geo y el resto del lote se procesa", async () => {
    const d = build({ apiKey: null });
    await expect(d.service.ejecutar(job())).rejects.toBeInstanceOf(GeocodeNoConfiguradoError);
    // Nunca llega a llamar al proveedor.
    expect(d.geocodificar).not.toHaveBeenCalled();

    // Y el drenador REAL sigue procesando el resto del lote: un job de otro tipo se
    // completa aunque el de geocodificacion falle. Es el mecanismo que protege a
    // `liberar_reprogramadas`, que comparte el cron.
    const otroHandler = vi.fn(async () => {});
    const geoHandler: JobHandler = (j) => d.service.ejecutar(j);
    const jobs: JobDTO[] = [
      job(),
      { ...job(), id: "job-2", tipo: "liberar_reprogramadas" as JobTipo },
    ];
    const repo = {
      claimBatch: vi.fn(async () => jobs),
      complete: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
      enqueue: vi.fn(async () => null),
    };
    const handlers = new Map<JobTipo, JobHandler>([
      ["geocodificacion", geoHandler],
      ["liberar_reprogramadas", otroHandler],
    ]);
    const queue = new JobQueueService(
      repo as unknown as IJobRepository,
      handlers,
      new Map<JobTipo, RecurrenciaSpec>(),
      {
        JOBS_BATCH_SIZE: 10,
        JOBS_MAX_ATTEMPTS: 5,
        JOBS_BACKOFF_BASE_MS: 60_000,
        JOBS_BACKOFF_CAP_MS: 3_600_000,
        JOBS_VISIBILITY_TIMEOUT_MS: 3_600_000,
      },
      () => AHORA,
      { warn: () => {} },
    );

    const result = await queue.drenar(10);
    expect(result.procesados).toBe(2);
    expect(result.ok).toBe(1); // el job de OTRO tipo se completo
    expect(result.fallidos).toBe(1); // solo el de geocodificacion
    expect(otroHandler).toHaveBeenCalledTimes(1);
    expect(repo.complete).toHaveBeenCalledWith("job-2");
  });

  it("el mensaje de error no revela la credencial ni la direccion", async () => {
    const d = build({ apiKey: null });
    const error = (await d.service.ejecutar(job()).catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain(ORDEN.direccion as string);
    // FEATURE 400 (T4): este literal SE CONSERVA porque ES el contrato — dice CUAL es la
    // configuracion que falta, que es lo unico accionable del mensaje. La ficha 400 solo le
    // antepone el marcador, asi que sigue estando contenido.
    expect(error.message).toContain("GOOGLE_MAPS_API_KEY");
  });

  // FEATURE 400 (T3, R11): la credencial ausente es el SEGUNDO fallo nuestro, y tambien
  // tiene que llegar marcado al gate. Sin este caso, un despliegue sin credencial dejaria
  // las ordenes bloqueadas igual que el 2026-09-08.
  it("400/R11: sin credencial, el mensaje lleva el marcador de fallo de configuracion", async () => {
    const d = build({ apiKey: null });
    const error = (await d.service.ejecutar(job()).catch((e: unknown) => e)) as Error;
    expect(esFalloConfigGeocode(error.message)).toBe(true);
    expect(error).toBeInstanceOf(GeocodeNoConfiguradoError);
  });
});

// FEATURE 400 (T12, R8) — LA COORDENADA PUEDE LLEGAR DESPUES DE ASIGNAR.
//
// Es el argumento que sostiene toda la ficha (design §8-A4): dejar pasar la asignacion de
// una orden sin ubicacion es barato PORQUE el ciclo de geocodificacion sigue corriendo
// despues, y la siguiente optimizacion ya la coloca en su sitio. Si esto dejara de ser
// cierto, la puerta de la 400 habria que reconsiderarla.
//
// ⚠️ POR QUE NO BASTA UN DOBLE DEL REPOSITORIO. Lo que hay que probar es el WHERE, y un
// doble del repo no lo ve (memoria «probar el WHERE donde vive»). Aqui se usa el
// repositorio REAL con un `prisma.orden.updateMany` doblado que CAPTURA el `where`
// literalmente: si alguien anadiera `mensajeroAsignadoId: null` o un filtro por estatus,
// este test se pone rojo.
describe("400/R8 — guardarResultado escribe aunque la orden YA tenga mensajero", () => {
  const ORDEN_YA_ASIGNADA = "orden-con-mensajero";

  type ArgsUpdateMany = { where: Record<string, unknown>; data: Record<string, unknown> };

  function repoRealConPrismaDoblado() {
    const updateMany = vi.fn(async (_args: ArgsUpdateMany) => ({ count: 1 }));
    const prisma = { orden: { updateMany } } as unknown as PrismaClient;
    return { repo: new OrdenGeocodeRepository(prisma), updateMany };
  }

  it("el `where` del update filtra SOLO por id y por no-borrada: ni estatus ni mensajero", async () => {
    const { repo, updateMany } = repoRealConPrismaDoblado();

    await repo.guardarResultado(ORDEN_YA_ASIGNADA, {
      latitud: 9.9333,
      longitud: -84.0833,
      precision: "ROOFTOP",
      status: "OK",
      geocodedAt: AHORA,
    });

    const args = updateMany.mock.calls[0]![0];
    // Literal EXACTO, no `objectContaining`: un filtro extra tiene que romper esto.
    expect(args.where).toEqual({ id: ORDEN_YA_ASIGNADA, deletedAt: null });
    for (const prohibido of ["mensajeroAsignadoId", "estatusId", "estatus", "asignadoAt"]) {
      expect(Object.keys(args.where)).not.toContain(prohibido);
    }
  });

  it("y escribe de verdad las coordenadas (no es un update vacio)", async () => {
    const { repo, updateMany } = repoRealConPrismaDoblado();

    await repo.guardarResultado(ORDEN_YA_ASIGNADA, {
      latitud: 9.9333,
      longitud: -84.0833,
      precision: "ROOFTOP",
      status: "OK",
      geocodedAt: AHORA,
    });

    const args = updateMany.mock.calls[0]![0];
    expect(args.data.geocodeStatus).toBe("OK");
    expect(args.data.geocodedAt).toBe(AHORA);
    expect(String(args.data.latitud)).toBe("9.9333");
    expect(String(args.data.longitud)).toBe("-84.0833");
  });

  it("el service llama a `guardarResultado` sin consultar NUNCA si la orden tiene mensajero", async () => {
    // La otra mitad: el ciclo de geocodificacion no depende del estado de asignacion. El
    // service solo conoce `findParaGeocodificar` y `guardarResultado` — no hay ninguna via
    // por la que pudiera mirar el mensajero.
    const d = build({ outcome: OUTCOME_OK });
    await d.service.ejecutar(job());
    expect(d.ordenes.guardarResultado).toHaveBeenCalledTimes(1);
    expect(Object.keys(d.ordenes)).toEqual(["findParaGeocodificar", "guardarResultado"]);
  });
});

describe("R26/R27/R28 — almacen de coordenadas resueltas", () => {
  it("un acierto en cache escribe coordenadas sin invocar al proveedor", async () => {
    const d = build({ enCache: { latitud: 1.5, longitud: -2.5, precision: "ROOFTOP" } });
    await d.service.ejecutar(job());
    expect(d.geocodificar).not.toHaveBeenCalled();
    expect(d.cache.findByHash).toHaveBeenCalledWith(HASH);
    expect(d.ordenes.guardarResultado).toHaveBeenCalledWith(ORDEN_ID, {
      latitud: 1.5,
      longitud: -2.5,
      precision: "ROOFTOP",
      status: "OK",
      geocodedAt: AHORA,
    });
  });

  it("un fallo de cache con respuesta OK guarda la entrada en el almacen", async () => {
    const d = build({ enCache: null, outcome: OUTCOME_OK });
    await d.service.ejecutar(job());
    expect(d.cache.upsert).toHaveBeenCalledWith(HASH, {
      latitud: 9.9333,
      longitud: -84.0833,
      precision: "ROOFTOP",
      payloadCrudo: OUTCOME_OK.status === "ok" ? OUTCOME_OK.crudo : undefined,
    });
  });

  it("una entrada antigua del almacen se usa igual, sin expiracion por tiempo", async () => {
    // El repositorio devuelve la entrada sin importar su antiguedad: la cache no caduca
    // (gate F1.4-Q7). El service no pasa ningun umbral temporal a `findByHash`.
    const d = build({ enCache: { latitud: 1, longitud: 2, precision: "APPROXIMATE" } });
    await d.service.ejecutar(job());
    expect(d.cache.findByHash).toHaveBeenCalledTimes(1);
    expect(d.cache.findByHash).toHaveBeenCalledWith(HASH); // un solo argumento: la huella
    expect(d.geocodificar).not.toHaveBeenCalled();
    expect(d.ordenes.guardarResultado).toHaveBeenCalledWith(
      ORDEN_ID,
      expect.objectContaining({ latitud: 1, longitud: 2 }),
    );
  });
});

describe("R29 — idempotencia", () => {
  it("ejecutar el mismo job dos veces deja el mismo estado final", async () => {
    // 1.ª pasada: fallo de cache -> proveedor -> upsert. 2.ª: acierto de cache -> sin red.
    let entrada: GeocodeCacheEntry | null = null;
    const ordenes = {
      findParaGeocodificar: vi.fn(async () => ORDEN),
      guardarResultado: vi.fn(async () => {}),
    };
    const cache = {
      findByHash: vi.fn(async () => entrada),
      upsert: vi.fn(async (_h: string, e: GeocodeCacheEntry) => {
        entrada = { latitud: e.latitud, longitud: e.longitud, precision: e.precision };
      }),
    };
    const geocodificar = vi.fn(async () => OUTCOME_OK);
    const service = new GeocodificacionService(
      ordenes as unknown as IOrdenGeocodeRepository,
      cache as unknown as IGeocodeCacheRepository,
      { geocodificar },
      { GOOGLE_MAPS_API_KEY: "k", GEOCODE_TIMEOUT_MS: 10_000 },
      () => AHORA,
      { warn: () => {} },
    );

    await service.ejecutar(job());
    await service.ejecutar(job());

    const [primera, segunda] = ordenes.guardarResultado.mock.calls;
    expect(segunda).toEqual(primera); // mismo estado final
    expect(geocodificar).toHaveBeenCalledTimes(1); // la 2.ª acierta en cache
    expect(cache.upsert).toHaveBeenCalledTimes(1); // no duplica la entrada
  });
});

describe("R30 — orden inexistente o borrada", () => {
  it("un job de una orden inexistente o borrada se completa sin error", async () => {
    const d = build({ orden: null });
    await expect(d.service.ejecutar(job())).resolves.toBeUndefined();
    expect(d.geocodificar).not.toHaveBeenCalled();
    expect(d.ordenes.guardarResultado).not.toHaveBeenCalled();
  });
});

describe("R9 — direccion no geocodificable al ejecutar", () => {
  it("si la direccion se vacio entre el encolado y la ejecucion, registra SIN_DIRECCION y completa", async () => {
    const d = build({ orden: { ...ORDEN, direccion: "   " } });
    await expect(d.service.ejecutar(job())).resolves.toBeUndefined();
    expect(d.geocodificar).not.toHaveBeenCalled();
    expect(d.ordenes.guardarResultado).toHaveBeenCalledWith(
      ORDEN_ID,
      expect.objectContaining({ status: "SIN_DIRECCION", latitud: null }),
    );
  });
});

describe("R14 — payload del job", () => {
  it("un payload sin ordenId lanza (no se procesa una orden arbitraria)", async () => {
    const d = build();
    await expect(d.service.ejecutar(job({}))).rejects.toThrow(/payload invalido/);
    await expect(d.service.ejecutar(job({ ordenId: "" }))).rejects.toThrow(/payload invalido/);
  });
});

describe("R31 — privacidad de los logs", () => {
  it("ningun log emitido contiene direccion, coordenadas ni credencial", async () => {
    const escenarios = [
      build({ apiKey: null }),
      build({ outcome: { status: "config_invalida", detalle: "REQUEST_DENIED" } }),
      build({ outcome: OUTCOME_OK }),
      build({ outcome: { status: "sin_resultados" } }),
      build({ outcome: { status: "transitorio", detalle: "OVER_QUERY_LIMIT" } }),
    ];
    for (const d of escenarios) {
      await d.service.ejecutar(job()).catch(() => {});
      for (const linea of d.logs) {
        expect(linea).not.toContain("Av. Central 100");
        expect(linea).not.toContain("clave-de-prueba");
        expect(linea).not.toContain("9.9333");
        expect(linea).not.toContain("-84.0833");
        expect(linea).not.toContain(ORDEN_ID);
      }
    }
  });

  it("el payload crudo persistido en la cache NO arrastra la direccion en claro", async () => {
    // Este test NO usa un cliente doble: usa el GoogleGeocodeClient REAL con `fetch`
    // inyectado, porque lo que se protege es el STRIP de zod en `google-geocode.ts`. La
    // respuesta real de Google trae la direccion en claro (`formatted_address`,
    // `address_components`, `plus_code`); el schema solo declara `geometry`, asi que zod
    // la recorta antes de que llegue a `geocode_cache.payload_crudo` (R31).
    // Si alguien anade `.passthrough()` o `.catchall()` a esos schemas, este test se pone
    // ROJO: es el guardian de esa decision de privacidad.
    const DIRECCION_EN_CLARO = "Av. Central 100, Carmen, San José, 10101, Costa Rica";
    const respuestaRealDeGoogle = {
      status: "OK",
      results: [
        {
          geometry: {
            location: { lat: 9.9333, lng: -84.0833 },
            location_type: "ROOFTOP",
            viewport: { northeast: { lat: 9.94, lng: -84.08 }, southwest: { lat: 9.93, lng: -84.09 } },
          },
          formatted_address: DIRECCION_EN_CLARO,
          address_components: [
            { long_name: "100", short_name: "100", types: ["street_number"] },
            { long_name: "Avenida Central", short_name: "Av. Central", types: ["route"] },
            { long_name: "Carmen", short_name: "Carmen", types: ["locality"] },
          ],
          plus_code: { compound_code: "WQVM+2R Carmen, San José", global_code: "77P3WQVM+2R" },
          place_id: "ChIJ0000000000000000000",
          // Campo NO declarado en el schema e inexistente hoy: el proveedor amplia sin avisar.
          campo_futuro_del_proveedor: { eco_de_la_consulta: DIRECCION_EN_CLARO },
        },
      ],
    };

    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(respuestaRealDeGoogle), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const ordenes = {
      findParaGeocodificar: vi.fn(async () => ORDEN),
      guardarResultado: vi.fn(async () => {}),
    };
    const cache = {
      findByHash: vi.fn(async () => null),
      upsert: vi.fn(async () => {}),
    };
    const service = new GeocodificacionService(
      ordenes as unknown as IOrdenGeocodeRepository,
      cache as unknown as IGeocodeCacheRepository,
      new GoogleGeocodeClient({ apiKey: "clave-de-prueba", fetchImpl }),
      { GOOGLE_MAPS_API_KEY: "clave-de-prueba", GEOCODE_TIMEOUT_MS: 10_000 },
      () => AHORA,
      { warn: () => {} },
    );

    await service.ejecutar(job());

    expect(cache.upsert).toHaveBeenCalledTimes(1);
    const entry = (cache.upsert.mock.calls[0] as unknown[])[1] as { payloadCrudo: unknown };

    // Lo persistido es EXACTAMENTE lo declarado en el schema, nada mas.
    expect(entry.payloadCrudo).toEqual({
      geometry: { location: { lat: 9.9333, lng: -84.0833 }, location_type: "ROOFTOP" },
    });

    // Y explicitamente: ni las claves de PII ni la direccion en claro sobreviven.
    const persistido = JSON.stringify(entry.payloadCrudo);
    for (const prohibido of [
      "formatted_address",
      "address_components",
      "plus_code",
      "place_id",
      "campo_futuro_del_proveedor",
      DIRECCION_EN_CLARO,
      "Avenida Central",
      "Carmen",
      "Costa Rica",
    ]) {
      expect(persistido).not.toContain(prohibido);
    }
  });

  it("el codigo del service no usa console.* (los conteos del cron quedan agregados)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const fuente = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "lib", "services", "GeocodificacionService.ts"),
      "utf8",
    );
    // La asercion corre sobre el codigo EJECUTABLE, no sobre los comentarios (que si
    // mencionan `console.*` para explicar por que no se usa).
    const ejecutable = fuente
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    expect(ejecutable).not.toMatch(/console\./);
  });
});

// ---------------------------------------------------------------------------
// FICHA 401 (T12) — LOS TRES PUNTOS DE LLAMADA A LA SALUD, Y LOS SEIS DONDE NO SE LLAMA.
//
// Cubre R6, R13, R14, R17, R20 y R25. El doble de salud CUENTA LLAMADAS: es la única forma de
// medir «aquí sí, aquí no» sin base de datos, y el «aquí no» es la mitad del requisito — un
// acierto de caché que disparara la recuperación reviviría jobs con el proveedor todavía caído.
// ---------------------------------------------------------------------------

describe("401/R2 — la caída se evalúa en los DOS caminos de configuración propia", () => {
  it("⭑ `config_invalida`: una llamada a `registrarFalloConfig`, con el id del job", async () => {
    const d = build({ outcome: { status: "config_invalida", detalle: "REQUEST_DENIED" } });

    await expect(d.service.ejecutar(job())).rejects.toBeInstanceOf(GeocodeConfigInvalidaError);

    expect(d.salud.registrarFalloConfig).toHaveBeenCalledTimes(1);
    expect(d.salud.registrarFalloConfig).toHaveBeenCalledWith("job-1", AHORA);
    expect(d.salud.registrarExitoProveedor).not.toHaveBeenCalled();
  });

  it("⭑ credencial AUSENTE: el otro camino que la 400 marca, también evalúa", async () => {
    const d = build({ apiKey: null });

    await expect(d.service.ejecutar(job())).rejects.toBeInstanceOf(GeocodeNoConfiguradoError);

    expect(d.salud.registrarFalloConfig).toHaveBeenCalledTimes(1);
    expect(d.salud.registrarFalloConfig).toHaveBeenCalledWith("job-1", AHORA);
  });

  it("⭑ R11: con la salud LANZANDO, el `throw` del job sigue ocurriendo IGUAL", async () => {
    // LA COLA MANDA. Si el aviso pudiera cambiar el desenlace, un fallo de la campana convertiría
    // un job que debe reintentarse en otra cosa.
    const rota = build({
      outcome: { status: "config_invalida", detalle: "REQUEST_DENIED" },
      saludLanza: new Error("salud caida"),
    });
    await expect(rota.service.ejecutar(job())).rejects.toBeInstanceOf(GeocodeConfigInvalidaError);

    const sinCredencial = build({ apiKey: null, saludLanza: new Error("salud caida") });
    await expect(sinCredencial.service.ejecutar(job())).rejects.toBeInstanceOf(
      GeocodeNoConfiguradoError,
    );
    // Y el fallo queda registrado, no en un `catch` vacío.
    expect(sinCredencial.logs.some((l) => l.includes("salud caida"))).toBe(true);
  });

  it("el mensaje que se lanza sigue llevando el marcador de la 400: esta ficha no lo toca", async () => {
    const d = build({ outcome: { status: "config_invalida", detalle: "REQUEST_DENIED" } });
    const error = await d.service.ejecutar(job()).catch((e: Error) => e);
    expect(esFalloConfigGeocode((error as Error).message)).toBe(true);
  });
});

describe("401/R13-R14 — la recuperación viaja SÓLO en la estela de un éxito REAL", () => {
  it("⭑ R13: tras un `ok` del proveedor, se invoca la recuperación exactamente UNA vez", async () => {
    const d = build({ outcome: OUTCOME_OK });

    await d.service.ejecutar(job());

    expect(d.salud.registrarExitoProveedor).toHaveBeenCalledTimes(1);
    expect(d.salud.registrarExitoProveedor).toHaveBeenCalledWith(AHORA);
  });

  it("⭑ R13: la recuperación va DESPUÉS de escribir la caché y la orden", async () => {
    // Lo que ya está escrito manda. Si se invocara antes, un fallo de la recuperación —aunque hoy
    // esté envuelto— habría dejado el trabajo bueno a medias.
    const orden: string[] = [];
    const d = build({ outcome: OUTCOME_OK });
    d.cache.upsert.mockImplementation(async () => {
      orden.push("cache");
    });
    d.ordenes.guardarResultado.mockImplementation(async () => {
      orden.push("orden");
    });
    d.salud.registrarExitoProveedor.mockImplementation(async () => {
      orden.push("recuperacion");
      return 0;
    });

    await d.service.ejecutar(job());

    expect(orden).toEqual(["cache", "orden", "recuperacion"]);
  });

  it("⭑ R14: un ACIERTO DE CACHÉ no invoca la recuperación, y el job termina igual", async () => {
    // ES LA DECISIÓN CENTRAL DE R14: la caché se resuelve sin tocar la red, así que SIGUE
    // FUNCIONANDO DURANTE UN CORTE. Tomarla por prueba de que el proveedor volvió reviviría jobs
    // con la credencial todavía rota, y cada uno quemaría sus 8 intentos.
    const d = build({ enCache: { latitud: 1.5, longitud: -2.5, precision: "ROOFTOP" } });

    await expect(d.service.ejecutar(job())).resolves.toBeUndefined();

    expect(d.geocodificar).not.toHaveBeenCalled();
    expect(d.salud.registrarExitoProveedor).not.toHaveBeenCalled();
    expect(d.salud.registrarFalloConfig).not.toHaveBeenCalled();
    // Y la orden se escribió igual: la no-llamada no cambia nada del desenlace.
    expect(d.ordenes.guardarResultado).toHaveBeenCalledTimes(1);
  });
});

describe("401/R6-R17-R25 — los desenlaces donde NO se llama a la salud, ni una vez", () => {
  const NO_LLAMAN: [string, Parameters<typeof build>[0]][] = [
    ["acierto de caché", { enCache: { latitud: 1, longitud: 2, precision: "ROOFTOP" } }],
    ["sin_resultados (dirección irresoluble)", { outcome: { status: "sin_resultados" } }],
    ["consulta_invalida (dirección irresoluble)", { outcome: { status: "consulta_invalida" } }],
    ["SIN_DIRECCION", { orden: { ...ORDEN, direccion: "   " } }],
    ["orden inexistente o borrada", { orden: null }],
    ["transitorio (red, timeout, 5xx, cuota)", { outcome: { status: "transitorio", detalle: "OVER_QUERY_LIMIT" } }],
  ];

  it.each(NO_LLAMAN)("⭑ %s → CERO llamadas de los dos tipos", async (_nombre, opciones) => {
    const d = build(opciones);

    await d.service.ejecutar(job()).catch(() => {});

    expect(d.salud.registrarFalloConfig).not.toHaveBeenCalled();
    expect(d.salud.registrarExitoProveedor).not.toHaveBeenCalled();
  });

  it("⭑ R17: los tres desenlaces DETERMINISTAS de dirección COMPLETAN el job, no lo matan", async () => {
    // Por eso el conjunto recuperable y el de «dirección mala» son disjuntos POR CONSTRUCCIÓN: una
    // dirección irresoluble nunca produce una fila `failed`, así que no puede ser elegible para
    // revivir. No hay ninguna lista de exclusiones que alguien deba mantener.
    for (const [opciones, estado] of [
      [{ outcome: { status: "sin_resultados" } }, "ZERO_RESULTS"],
      [{ outcome: { status: "consulta_invalida" } }, "INVALID_REQUEST"],
      [{ orden: { ...ORDEN, direccion: "   " } }, "SIN_DIRECCION"],
    ] as [Parameters<typeof build>[0], string][]) {
      const d = build(opciones);
      await expect(d.service.ejecutar(job())).resolves.toBeUndefined(); // retorna = `complete`
      expect(d.ordenes.guardarResultado).toHaveBeenCalledWith(
        ORDEN_ID,
        expect.objectContaining({ status: estado }),
      );
      expect(d.salud.registrarExitoProveedor).not.toHaveBeenCalled();
    }
  });

  it("⭑ R25: durante `config_invalida` la recuperación no se invoca NI UNA VEZ", async () => {
    // Mientras la geocodificación siga caída no se devuelve nada a la cola. La recuperación se
    // dispara sólo tras una respuesta satisfactoria del proveedor, que no puede coexistir con un
    // corte de configuración (es global y determinista).
    const d = build({ outcome: { status: "config_invalida", detalle: "REQUEST_DENIED" } });

    await d.service.ejecutar(job()).catch(() => {});

    expect(d.salud.registrarExitoProveedor).not.toHaveBeenCalled();
  });
});

describe("401/R20 — una recuperación caída NO revierte una geocodificación buena", () => {
  it("⭑ con `registrarExitoProveedor` lanzando, el job se completa IGUAL", async () => {
    // La dirección contraria sería mucho peor: una recuperación caída revertiría un trabajo bueno
    // que ya está escrito, y el job volvería a la cola a pagar otra llamada al proveedor.
    const d = build({ outcome: OUTCOME_OK, saludLanza: new Error("recuperacion caida") });

    await expect(d.service.ejecutar(job())).resolves.toBeUndefined();

    expect(d.cache.upsert).toHaveBeenCalledTimes(1);
    expect(d.ordenes.guardarResultado).toHaveBeenCalledWith(
      ORDEN_ID,
      expect.objectContaining({ status: "OK" }),
    );
  });

  it("⭑ y el fallo queda LOGUEADO con contexto, sin PII", async () => {
    const d = build({ outcome: OUTCOME_OK, saludLanza: new Error("recuperacion caida") });

    await d.service.ejecutar(job());

    const linea = d.logs.find((l) => l.includes("recuperacion caida"));
    expect(linea).toBeDefined();
    expect(linea).toContain("best-effort");
    expect(linea).not.toContain("Av. Central 100");
    expect(linea).not.toContain("clave-de-prueba");
    expect(linea).not.toContain(ORDEN_ID);
  });
});

describe("401/R12 — el DEFAULT del colaborador de salud es el no-op", () => {
  it("⭑ un service construido SIN cablearlo no consulta ni escribe nada", async () => {
    // Es lo que impide que las decenas de suites que construyen este service toquen la base local,
    // que en este repo es COMPARTIDA entre worktrees. El real lo inyecta el composition root, y
    // que lo inyecte lo vigilan las guardias de `notificacion-notificadores-reales.test.ts`.
    const service = new GeocodificacionService(
      { findParaGeocodificar: vi.fn(async () => ORDEN), guardarResultado: vi.fn(async () => {}) } as unknown as IOrdenGeocodeRepository,
      { findByHash: vi.fn(async () => null), upsert: vi.fn(async () => {}) } as unknown as IGeocodeCacheRepository,
      { geocodificar: vi.fn(async () => OUTCOME_OK) },
      { GOOGLE_MAPS_API_KEY: "clave-de-prueba", GEOCODE_TIMEOUT_MS: 10_000 },
      () => AHORA,
      { warn: () => {} },
      // ← sin séptimo argumento: `geocodeSaludNoOp`
    );

    await expect(service.ejecutar(job())).resolves.toBeUndefined();
  });
});
