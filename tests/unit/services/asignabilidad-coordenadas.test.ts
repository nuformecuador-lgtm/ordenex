import { describe, it, expect, vi } from "vitest";
import { AsignabilidadCoordenadasService } from "@/lib/services/AsignabilidadCoordenadasService";
import type { OrdenAsignabilidadRow } from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { IJobRepository, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobEstado } from "@prisma/client";
import { hashDireccion } from "@/lib/geo/direccion-query";
import { dedupeKeyGeocodificacion } from "@/lib/services/jobs/geocodificacion-encolado";

// Feature 92 (R1-R7) — el gate de asignabilidad por coordenadas, con dobles y sin DB.
//
// Los DOS puntos duros que este archivo protege (design §0.1 y §0.3):
//  1. la fuente de verdad de "direccion no encontrada" es la ORDEN (`geocode_status`), NO
//     la cola: `GeocodificacionService` COMPLETA el job en ZERO_RESULTS / INVALID_REQUEST
//     / SIN_DIRECCION, asi que ese caso jamas aparece como job `failed`;
//  2. "intentos agotados" ⇔ `estado === 'failed'` y NADA MAS: `claimBatch` incrementa
//     `intentos` AL RECLAMAR, asi que `intentos >= maxIntentos` en un `processing` es un
//     job corriendo su ULTIMO intento, que todavia puede resolverse.

const DIRECCION = "Av. Central 100";

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
  const repo = {
    enqueue,
    findByDedupeKeys,
    claimBatch: vi.fn(async () => []),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  } as unknown as IJobRepository;
  return { repo, enqueue, findByDedupeKeys };
}

describe("R1 — los SEIS estados de asignabilidad son alcanzables", () => {
  it("clasifica un lote que produce los seis estados, uno por orden", async () => {
    const jobs = [
      job(claveDe("o-agotada"), "failed"),
      job(claveDe("o-encurso"), "processing"),
    ];
    let n = 0;
    const { repo } = cola(jobs, async () => {
      // La segunda orden sin job revienta al encolar -> `geocodificacion_no_encolable`.
      if (++n === 2) throw new Error("DB caida");
      return null;
    });

    const estados = await new AsignabilidadCoordenadasService(repo).evaluar([
      orden({ id: "o-ok", latitud: 9.93, longitud: -84.09 }),
      orden({ id: "o-nogeo", geocodeStatus: "ZERO_RESULTS" }),
      orden({ id: "o-agotada" }),
      orden({ id: "o-encurso" }),
      orden({ id: "o-encolada" }),
      orden({ id: "o-noencolable" }),
    ]);

    expect([...estados.values()].sort()).toEqual(
      [
        "asignable",
        "direccion_no_geocodificable",
        "geocodificacion_agotada",
        "geocodificacion_encolada",
        "geocodificacion_en_curso",
        "geocodificacion_no_encolable",
      ].sort(),
    );
    expect(estados.get("o-ok")).toBe("asignable");
    expect(estados.get("o-nogeo")).toBe("direccion_no_geocodificable");
    expect(estados.get("o-agotada")).toBe("geocodificacion_agotada");
    expect(estados.get("o-encurso")).toBe("geocodificacion_en_curso");
    expect(estados.get("o-encolada")).toBe("geocodificacion_encolada");
    expect(estados.get("o-noencolable")).toBe("geocodificacion_no_encolable");
  });

  it("lote vacio -> mapa vacio sin consultar la cola", async () => {
    const { repo, findByDedupeKeys } = cola();
    expect((await new AsignabilidadCoordenadasService(repo).evaluar([])).size).toBe(0);
    expect(findByDedupeKeys).not.toHaveBeenCalled();
  });
});

describe("R2 — con coordenadas es asignable SIN tocar la cola", () => {
  it("una orden con lat y lng no consulta `jobs` en absoluto", async () => {
    const { repo, findByDedupeKeys } = cola();
    const estados = await new AsignabilidadCoordenadasService(repo).evaluar([
      orden({ latitud: 9.93, longitud: -84.09 }),
    ]);
    expect(estados.get("o1")).toBe("asignable");
    expect(findByDedupeKeys).not.toHaveBeenCalled();
  });

  it("MEDIA coordenada (solo lat) NO es asignable: se sigue al arbol", async () => {
    const { repo, findByDedupeKeys } = cola();
    await new AsignabilidadCoordenadasService(repo).evaluar([orden({ latitud: 9.93 })]);
    expect(findByDedupeKeys).toHaveBeenCalledTimes(1);
  });
});

describe("R3 — los desenlaces DETERMINISTAS se leen de la ORDEN, no de la cola", () => {
  it.each(["ZERO_RESULTS", "INVALID_REQUEST", "SIN_DIRECCION"])(
    "geocode_status %s -> direccion_no_geocodificable sin consultar `jobs`",
    async (status) => {
      const { repo, findByDedupeKeys, enqueue } = cola();
      const estados = await new AsignabilidadCoordenadasService(repo).evaluar([
        orden({ geocodeStatus: status }),
      ]);
      expect(estados.get("o1")).toBe("direccion_no_geocodificable");
      expect(findByDedupeKeys).not.toHaveBeenCalled();
      // Y sobre todo: NO se re-encola. Ese bucle es el que pagaria una llamada al
      // proveedor por cada intento de asignacion de una direccion sabida irresoluble.
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  it("`OK` NO es determinista-negativo: si no hay coordenadas, se sigue al arbol", async () => {
    const { repo, findByDedupeKeys } = cola();
    await new AsignabilidadCoordenadasService(repo).evaluar([orden({ geocodeStatus: "OK" })]);
    expect(findByDedupeKeys).toHaveBeenCalledTimes(1);
  });
});

describe("R4 — clave EXACTA reconstruida y UNA sola consulta por lote", () => {
  it("consulta por igualdad con la clave que escribe el writer, no por prefijo", async () => {
    const { repo, findByDedupeKeys } = cola();
    await new AsignabilidadCoordenadasService(repo).evaluar([
      orden({ id: "o1" }),
      orden({ id: "o2", direccion: "Otra calle 5" }),
    ]);
    expect(findByDedupeKeys).toHaveBeenCalledTimes(1); // UNA consulta para todo el lote
    expect(findByDedupeKeys.mock.calls[0][0]).toEqual([
      claveDe("o1"),
      claveDe("o2", "Otra calle 5"),
    ]);
    // Ninguna clave lleva comodines: no es una busqueda por prefijo.
    for (const k of findByDedupeKeys.mock.calls[0][0]) expect(k).not.toContain("%");
  });

  it("un lote de 10 ordenes sigue haciendo UNA sola consulta", async () => {
    const { repo, findByDedupeKeys } = cola();
    const ordenes = Array.from({ length: 10 }, (_, i) => orden({ id: `o${i}` }));
    await new AsignabilidadCoordenadasService(repo).evaluar(ordenes);
    expect(findByDedupeKeys).toHaveBeenCalledTimes(1);
    expect(findByDedupeKeys.mock.calls[0][0]).toHaveLength(10);
  });
});

describe("R5 — 'intentos agotados' ⇔ estado === 'failed', y NADA MAS", () => {
  it("job `failed` -> geocodificacion_agotada", async () => {
    const { repo } = cola([job(claveDe("o1"), "failed")]);
    const estados = await new AsignabilidadCoordenadasService(repo).evaluar([orden()]);
    expect(estados.get("o1")).toBe("geocodificacion_agotada");
  });

  it("NORMATIVO: `processing` con intentos === maxIntentos NO es agotado (esta corriendo su ultimo intento)", async () => {
    // `claimBatch` incrementa `intentos` ANTES de ejecutar el handler. Si el predicado
    // fuera `intentos >= maxIntentos`, esta orden quedaria bloqueada aunque el job este a
    // punto de escribirle coordenadas.
    const { repo } = cola([
      job(claveDe("o1"), "processing", { intentos: 8, maxIntentos: 8 }),
    ]);
    const estados = await new AsignabilidadCoordenadasService(repo).evaluar([orden()]);
    expect(estados.get("o1")).toBe("geocodificacion_en_curso");
    expect(estados.get("o1")).not.toBe("geocodificacion_agotada");
  });
});

describe("R6 — job en vuelo", () => {
  it.each(["pending", "processing"] as const)("estado %s -> geocodificacion_en_curso", async (estado) => {
    const { repo, enqueue } = cola([job(claveDe("o1"), estado)]);
    const estados = await new AsignabilidadCoordenadasService(repo).evaluar([orden()]);
    expect(estados.get("o1")).toBe("geocodificacion_en_curso");
    // No se duplica el encolado de un job que ya existe.
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("R7 — sin job para la direccion VIGENTE se encola una geocodificacion puntual", () => {
  it("sin ninguna fila -> encola y clasifica geocodificacion_encolada", async () => {
    const { repo, enqueue } = cola([]);
    const estados = await new AsignabilidadCoordenadasService(repo).evaluar([orden()]);
    expect(estados.get("o1")).toBe("geocodificacion_encolada");
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [tipo, payload, opts] = enqueue.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      { dedupeKey: string },
    ];
    expect(tipo).toBe("geocodificacion");
    expect(payload).toEqual({ ordenId: "o1" }); // PII: solo el id, nunca la direccion
    expect(opts.dedupeKey).toBe(claveDe("o1"));
  });

  it("job `done` SIN coordenadas y sin status determinista -> se vuelve a encolar", async () => {
    const { repo, enqueue } = cola([job(claveDe("o1"), "done")]);
    const estados = await new AsignabilidadCoordenadasService(repo).evaluar([orden()]);
    expect(estados.get("o1")).toBe("geocodificacion_encolada");
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("el encolado va FUERA de transaccion (la asignacion se aborta y el job debe sobrevivir)", async () => {
    const { repo, enqueue } = cola([]);
    await new AsignabilidadCoordenadasService(repo).evaluar([orden()]);
    // 4.º argumento de `enqueue` = cliente transaccional del writer. Aqui debe ser
    // `undefined`: si se enganchara a la tx de la asignacion, el abort (R8) se llevaria
    // por delante el job y la orden nunca se geocodificaria.
    expect((enqueue.mock.calls[0] as unknown[])[3]).toBeUndefined();
  });

  it("si el encolado LANZA -> geocodificacion_no_encolable, sin propagar la excepcion", async () => {
    const { repo } = cola([], async () => {
      throw new Error("DB caida");
    });
    const estados = await new AsignabilidadCoordenadasService(repo).evaluar([
      orden({ id: "o1" }),
      orden({ id: "o2" }),
    ]);
    // El gate DEBE devolver un estado por cada orden para que el writer arme su `detalle`
    // completo, en vez de reventar el lote entero con una excepcion opaca.
    expect(estados.get("o1")).toBe("geocodificacion_no_encolable");
    expect(estados.get("o2")).toBe("geocodificacion_no_encolable");
  });
});

describe("R4/R7 — direccion CORREGIDA: el job `failed` del hash viejo NO bloquea", () => {
  it("una orden cuya direccion cambio se re-encola en vez de heredar el fallo anterior", async () => {
    // El job viejo responde por una direccion que YA NO EXISTE. Con busqueda por PREFIJO
    // (`geocodificacion:o1:%`) este `failed` bloquearia la orden para siempre, aunque el
    // operador ya hubiera corregido la direccion.
    const { repo, enqueue } = cola([job(claveDe("o1", "Direccion VIEJA mala"), "failed")]);

    const estados = await new AsignabilidadCoordenadasService(repo).evaluar([
      orden({ id: "o1", direccion: "Direccion NUEVA corregida" }),
    ]);

    expect(estados.get("o1")).toBe("geocodificacion_encolada");
    expect(estados.get("o1")).not.toBe("geocodificacion_agotada");
    expect(enqueue).toHaveBeenCalledTimes(1);
    const opts = (enqueue.mock.calls[0] as unknown[])[2] as { dedupeKey: string };
    expect(opts.dedupeKey).toBe(claveDe("o1", "Direccion NUEVA corregida"));
  });
});
