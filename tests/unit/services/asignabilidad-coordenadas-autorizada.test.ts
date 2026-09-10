import { describe, it, expect, vi } from "vitest";
import {
  AsignabilidadCoordenadasService,
  esAsignable,
} from "@/lib/services/AsignabilidadCoordenadasService";
import {
  MOTIVOS_AUTORIZABLES_SIN_UBICACION,
  esMotivoAutorizableSinUbicacion,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type {
  EstadoAsignabilidad,
  EstadoBloqueante,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { IJobRepository, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobEstado } from "@prisma/client";
import { hashDireccion } from "@/lib/geo/direccion-query";
import { dedupeKeyGeocodificacion } from "@/lib/services/jobs/geocodificacion-encolado";

// ════════════════════════════════════════════════════════════════════════════════════════
// FICHA 407 (T2/T3, 2026-09-10) — LA MARCA: UNA PERSONA AUTORIZA ASIGNAR SIN UBICACION
//
// El caso que la origina, medido en produccion: guia 76068276 (Quesada / San Carlos), con
// `geocode_status = ZERO_RESULTS` y sin coordenadas, CINCO DIAS parada porque el gate de la
// feature 92 la clasifica `direccion_no_geocodificable` y ningun camino de asignacion la deja
// pasar — aunque su direccion de referencias sea perfectamente seguible para el mensajero.
//
// Lo que este archivo protege, y es lo delicado de un parametro que DESACTIVA una guarda:
//   - la marca solo abre la puerta del desenlace DETERMINISTA (R1), y en la rama R3;
//   - NO puede comerse ningun estado de cola, aunque venga puesta (R2);
//   - NO puede aplicarse a una orden que no esta en el lote (R3);
//   - NO tiene ningun efecto observable si la orden ya tiene coordenadas (R4);
//   - NO SE PEGA: no sobrevive a la llamada (R9). Nada se persiste, por decision del humano.
// ════════════════════════════════════════════════════════════════════════════════════════

const DIRECCION = "DE LA CLINICA VETERINARIA MASCOTICAS, 75 METROS HACIA EL SUR";

function orden(over: Partial<OrdenAsignabilidadRow> = {}): OrdenAsignabilidadRow {
  return {
    id: "o1",
    direccion: DIRECCION,
    latitud: null,
    longitud: null,
    geocodeStatus: null,
    ...over,
  };
}

function claveDe(ordenId: string, direccion = DIRECCION): string {
  return dedupeKeyGeocodificacion(ordenId, hashDireccion(direccion));
}

function job(dedupeKey: string, estado: JobEstado, over: Partial<JobDTO> = {}): JobDTO {
  return {
    id: `job-${dedupeKey}`,
    tipo: "geocodificacion",
    payload: {},
    estado,
    intentos: 0,
    maxIntentos: 8,
    runAfter: new Date(),
    lockedAt: null,
    lastError: null,
    dedupeKey,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

/** Cola en memoria: `findByDedupeKeys` filtra por igualdad, como el indice unico real. */
function cola(jobs: JobDTO[] = [], enqueueImpl?: () => Promise<JobDTO | null>) {
  const enqueue = vi.fn(enqueueImpl ?? (async () => null));
  const findByDedupeKeys = vi.fn(async (keys: string[]) =>
    jobs.filter((j) => j.dedupeKey !== null && keys.includes(j.dedupeKey)),
  );
  return {
    enqueue,
    findByDedupeKeys,
    claimBatch: vi.fn(async () => []),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  } as unknown as IJobRepository;
}

/** Los tres `geocode_status` DETERMINISTAS: los unicos que producen la rama R3. */
const STATUS_DETERMINISTAS = ["ZERO_RESULTS", "INVALID_REQUEST", "SIN_DIRECCION"] as const;

describe("407/R1 — con la marca, la direccion irresoluble pasa el gate", () => {
  it.each(STATUS_DETERMINISTAS)(
    "geocode_status %s + sin coordenadas + id autorizado -> asignable_sin_ubicacion_autorizada",
    async (status) => {
      const service = new AsignabilidadCoordenadasService(cola());

      const r = await service.evaluar(
        [orden({ id: "o1", geocodeStatus: status })],
        new Set(["o1"]),
      );

      expect(r.get("o1")).toBe("asignable_sin_ubicacion_autorizada");
      // Y ademas DEJA PASAR: el estado nuevo no sirve de nada si `esAsignable` no lo reconoce.
      expect(esAsignable(r.get("o1"))).toBe(true);
    },
  );

  it("R5 (no-regresion): la MISMA fila SIN la marca sigue bloqueando", async () => {
    const service = new AsignabilidadCoordenadasService(cola());

    const r = await service.evaluar([orden({ id: "o1", geocodeStatus: "ZERO_RESULTS" })]);

    expect(r.get("o1")).toBe("direccion_no_geocodificable");
    expect(esAsignable(r.get("o1"))).toBe(false);
  });

  it("la rama R3 NO toca la cola, tampoco con la marca puesta (cero consultas nuevas)", async () => {
    const repo = cola();
    const service = new AsignabilidadCoordenadasService(repo);

    await service.evaluar([orden({ id: "o1", geocodeStatus: "ZERO_RESULTS" })], new Set(["o1"]));

    expect(repo.findByDedupeKeys).not.toHaveBeenCalled();
    expect(repo.enqueue).not.toHaveBeenCalled();
  });

  // El olvido MUDO que el tipo no caza: `esAsignable` se implementa contra un array
  // `readonly EstadoAsignable[]`, y un array mas CORTO que su tipo compila igual. Sin este
  // caso, el gate devolveria el estado nuevo y los dos writers lo tratarian como bloqueante.
  it("esAsignable('asignable_sin_ubicacion_autorizada') es true — caso EXPLICITO", () => {
    expect(esAsignable("asignable_sin_ubicacion_autorizada")).toBe(true);
    // Los otros dos siguen pasando, y un bloqueante sigue sin pasar (no-vacuidad del caso).
    expect(esAsignable("asignable")).toBe(true);
    expect(esAsignable("asignable_sin_ubicacion")).toBe(true);
    expect(esAsignable("direccion_no_geocodificable")).toBe(false);
  });
});

describe("407/R2 — la marca NO se come ningun estado de la cola", () => {
  /**
   * Los CUATRO desenlaces no-deterministas, cada uno con la receta que lo produce en el gate
   * real. Ninguno es un veredicto definitivo sobre la direccion: `_en_curso`/`_encolada` aun
   * pueden resolverse solos y `_agotada` la cubre la feature 400 cuando el fallo es nuestro.
   */
  const DE_LA_COLA: {
    estado: EstadoAsignabilidad;
    repo: () => IJobRepository;
  }[] = [
    { estado: "geocodificacion_agotada", repo: () => cola([job(claveDe("o1"), "failed")]) },
    { estado: "geocodificacion_en_curso", repo: () => cola([job(claveDe("o1"), "processing")]) },
    { estado: "geocodificacion_encolada", repo: () => cola([]) },
    {
      estado: "geocodificacion_no_encolable",
      repo: () =>
        cola([], async () => {
          throw new Error("DB caida");
        }),
    },
  ];

  it.each(DE_LA_COLA)(
    "$estado sigue bloqueando AUNQUE la orden venga marcada",
    async ({ estado, repo }) => {
      const service = new AsignabilidadCoordenadasService(repo());

      // `geocodeStatus: null` -> la orden NO entra en la rama R3, que es donde vive la marca.
      const r = await service.evaluar([orden({ id: "o1" })], new Set(["o1"]));

      expect(r.get("o1")).toBe(estado);
      expect(esAsignable(r.get("o1"))).toBe(false);
    },
  );

  it("un lote mixto: la irresoluble marcada pasa, la que esta en curso marcada NO", async () => {
    // El caso que la mutacion «sacar el `if` de la rama R3 y ponerlo como paso propio» rompe:
    // ahi las DOS saldrian autorizadas y `o2` entraria a una ruta pudiendo geocodificarse sola.
    const service = new AsignabilidadCoordenadasService(cola([job(claveDe("o2"), "pending")]));

    const r = await service.evaluar(
      [orden({ id: "o1", geocodeStatus: "ZERO_RESULTS" }), orden({ id: "o2" })],
      new Set(["o1", "o2"]),
    );

    expect(r.get("o1")).toBe("asignable_sin_ubicacion_autorizada");
    expect(r.get("o2")).toBe("geocodificacion_en_curso");
  });
});

describe("407/R3 — la marca solo alcanza a las ordenes del lote", () => {
  it("un id marcado que NO esta en el lote no cambia el estado de nadie", async () => {
    const service = new AsignabilidadCoordenadasService(cola());
    const lote = [
      orden({ id: "o1", geocodeStatus: "ZERO_RESULTS" }),
      orden({ id: "o2", geocodeStatus: "INVALID_REQUEST" }),
    ];

    const r = await service.evaluar(lote, new Set(["o-de-otro-lote"]));

    expect([...r.entries()]).toEqual([
      ["o1", "direccion_no_geocodificable"],
      ["o2", "direccion_no_geocodificable"],
    ]);
    // Y el gate no se invento una entrada para el id ajeno.
    expect(r.has("o-de-otro-lote")).toBe(false);
    expect(r.size).toBe(2);
  });

  it("marcar UNA no arrastra a las demas del mismo lote", async () => {
    const service = new AsignabilidadCoordenadasService(cola());

    const r = await service.evaluar(
      [
        orden({ id: "o1", geocodeStatus: "ZERO_RESULTS" }),
        orden({ id: "o2", geocodeStatus: "ZERO_RESULTS" }),
      ],
      new Set(["o1"]),
    );

    expect(r.get("o1")).toBe("asignable_sin_ubicacion_autorizada");
    expect(r.get("o2")).toBe("direccion_no_geocodificable");
  });
});

describe("407/R4 — con coordenadas, la marca no tiene NINGUN efecto observable", () => {
  it("lat/lng presentes + id marcado -> `asignable`, no el estado nuevo", async () => {
    const service = new AsignabilidadCoordenadasService(cola());

    const r = await service.evaluar(
      [orden({ id: "o1", latitud: 10.1, longitud: -84.4, geocodeStatus: "ZERO_RESULTS" })],
      new Set(["o1"]),
    );

    // R2 del gate gana ANTES de llegar a la rama R3: la marca no puede adelantarsele.
    expect(r.get("o1")).toBe("asignable");
    expect(r.get("o1")).not.toBe("asignable_sin_ubicacion_autorizada");
  });
});

describe("407/R9 — la marca NO se persiste ni se queda pegada a la instancia", () => {
  it("la segunda llamada SIN marca, sobre la MISMA fila, vuelve a bloquear", async () => {
    const service = new AsignabilidadCoordenadasService(cola());
    const fila = orden({ id: "o1", geocodeStatus: "ZERO_RESULTS" });

    const primera = await service.evaluar([fila], new Set(["o1"]));
    const segunda = await service.evaluar([fila]);

    expect(primera.get("o1")).toBe("asignable_sin_ubicacion_autorizada");
    expect(segunda.get("o1")).toBe("direccion_no_geocodificable");
  });

  it("tampoco muta la fila que recibio: la proyeccion sigue siendo la de la base", async () => {
    const service = new AsignabilidadCoordenadasService(cola());
    const fila = orden({ id: "o1", geocodeStatus: "ZERO_RESULTS" });

    await service.evaluar([fila], new Set(["o1"]));

    // Si el gate «marcara» la fila, la autorizacion viajaria como si fuera un hecho de la
    // base — que es exactamente lo que el design §8-A5 descarta.
    expect(fila).toEqual({
      id: "o1",
      direccion: DIRECCION,
      latitud: null,
      longitud: null,
      geocodeStatus: "ZERO_RESULTS",
    });
  });

  it("y una instancia NUEVA tampoco hereda nada (no hay estado de modulo)", async () => {
    const primera = new AsignabilidadCoordenadasService(cola());
    await primera.evaluar([orden({ id: "o1", geocodeStatus: "ZERO_RESULTS" })], new Set(["o1"]));

    const segunda = new AsignabilidadCoordenadasService(cola());
    const r = await segunda.evaluar([orden({ id: "o1", geocodeStatus: "ZERO_RESULTS" })]);

    expect(r.get("o1")).toBe("direccion_no_geocodificable");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════
// T3 (R17) — EL PREDICADO DE LA UI NO PUEDE DIVERGIR DEL GATE
//
// La leccion de la 271: una pantalla que ofrece lo que el servidor va a negar produce un
// mensaje falso que no se arregla nunca. Aqui no se compara la lista contra una copia de si
// misma —eso siempre estaria verde—: se ata cada motivo al COMPORTAMIENTO REAL del gate.
// ════════════════════════════════════════════════════════════════════════════════════════
describe("407/R17 — `esMotivoAutorizableSinUbicacion` es true si y solo si el gate lo honra", () => {
  /**
   * Exhaustividad tipada: si alguien anade un estado BLOQUEANTE nuevo a la union, este
   * `Record` deja de compilar y hay que clasificarlo aqui a mano. Una lista suelta se
   * desactualizaria en silencio, que es el fallo que este bloque existe para impedir.
   */
  const BLOQUEANTES_EXHAUSTIVO: Record<EstadoBloqueante, true> = {
    direccion_no_geocodificable: true,
    geocodificacion_agotada: true,
    geocodificacion_en_curso: true,
    geocodificacion_encolada: true,
    geocodificacion_no_encolable: true,
  };

  /** La receta que produce CADA estado bloqueante en el gate real (fila + cola). */
  const RECETA: Record<EstadoBloqueante, { fila: OrdenAsignabilidadRow; repo: IJobRepository }> = {
    direccion_no_geocodificable: {
      fila: orden({ id: "o1", geocodeStatus: "ZERO_RESULTS" }),
      repo: cola(),
    },
    geocodificacion_agotada: {
      fila: orden({ id: "o1" }),
      repo: cola([job(claveDe("o1"), "failed")]),
    },
    geocodificacion_en_curso: {
      fila: orden({ id: "o1" }),
      repo: cola([job(claveDe("o1"), "processing")]),
    },
    geocodificacion_encolada: { fila: orden({ id: "o1" }), repo: cola([]) },
    geocodificacion_no_encolable: {
      fila: orden({ id: "o1" }),
      repo: cola([], async () => {
        throw new Error("DB caida");
      }),
    },
  };

  const BLOQUEANTES = Object.keys(BLOQUEANTES_EXHAUSTIVO) as EstadoBloqueante[];

  it("las recetas producen EXACTAMENTE el estado que dicen (no-vacuidad del bloque)", async () => {
    for (const motivo of BLOQUEANTES) {
      const { fila, repo } = RECETA[motivo];
      const r = await new AsignabilidadCoordenadasService(repo).evaluar([fila]);
      expect(r.get("o1"), `la receta de ${motivo} no produce ese estado`).toBe(motivo);
    }
  });

  it.each(
    (Object.keys(BLOQUEANTES_EXHAUSTIVO) as EstadoBloqueante[]).map((motivo) => ({ motivo })),
  )("$motivo: el predicado y el gate dicen lo MISMO", async ({ motivo }) => {
    const { fila, repo } = RECETA[motivo];

    const conMarca = await new AsignabilidadCoordenadasService(repo).evaluar(
      [fila],
      new Set(["o1"]),
    );
    const gateLoDejaPasar = esAsignable(conMarca.get("o1"));

    expect(esMotivoAutorizableSinUbicacion(motivo)).toBe(gateLoDejaPasar);
  });

  it("hay al menos uno de cada lado: la equivalencia no es trivialmente cierta", () => {
    const autorizables = BLOQUEANTES.filter(esMotivoAutorizableSinUbicacion);
    const noAutorizables = BLOQUEANTES.filter((m) => !esMotivoAutorizableSinUbicacion(m));

    expect(autorizables).toEqual(["direccion_no_geocodificable"]);
    expect(noAutorizables.length).toBe(4);
  });

  it("un motivo que no es del gate NUNCA es autorizable (defecto seguro)", () => {
    expect(esMotivoAutorizableSinUbicacion("orden no existe")).toBe(false);
    expect(esMotivoAutorizableSinUbicacion("zona_ajena")).toBe(false);
    expect(esMotivoAutorizableSinUbicacion("")).toBe(false);
    // Y tampoco los estados que YA pasan el gate: no hay nada que autorizar ahi.
    expect(esMotivoAutorizableSinUbicacion("asignable")).toBe(false);
    expect(esMotivoAutorizableSinUbicacion("asignable_sin_ubicacion")).toBe(false);
  });

  it("la lista exportada es la fuente unica y no esta vacia", () => {
    expect([...MOTIVOS_AUTORIZABLES_SIN_UBICACION]).toEqual(["direccion_no_geocodificable"]);
  });
});
