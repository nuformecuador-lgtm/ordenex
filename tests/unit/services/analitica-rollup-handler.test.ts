import { describe, it, expect, vi } from "vitest";
import {
  crearAnaliticaRollupDiarioHandler,
  proximaCorridaRollupCR,
  recurrenciaAnaliticaRollupDiario,
  type RollupJobLogger,
} from "@/lib/services/jobs/analitica-rollup-diario-handler";
import {
  DEDUPE_PREFIX,
  dedupeKeyRollup,
} from "@/lib/services/jobs/analitica-rollup-diario-encolado";
import { seedJobAnaliticaRollupDiario } from "@/scripts/seed-jobs-analitica-rollup-diario";
import { esDestinoLocalOrdenex } from "@/scripts/rollup-analitica-manual";
import { validarFechaInvocacionManual } from "@/lib/analytics/rollup-dia";
import type {
  IAnaliticaRollupService,
  ResumenCorrida,
} from "@/lib/interfaces/services/IAnaliticaRollupService";
import type { IJobRepository, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";

// Feature 124 / T4.2-T4.3-T4.6 — el JOB: fecha objetivo, recurrencia, dedupe, resumen y
// propagacion del fallo. Todo con dobles en memoria: aqui no hay base ni Prisma.
//
// Cubre R8 (reloj inyectado), R32 (nada de BigInt en el log), R36 (recurrencia + dedupe por
// fecha OBJETIVO), R37 (solo conteos agregados) R38 (el fallo se propaga) y R39 (tope de
// antiguedad de la invocacion manual).

/** Job cualquiera: el handler del rollup NO mira el payload (lo deriva del reloj). */
const JOB_VACIO = {
  id: "job-1",
  tipo: "analitica_rollup_diario",
  payload: {},
  estado: "processing",
  intentos: 1,
  maxIntentos: 5,
  runAfter: new Date("2026-08-02T06:30:00.000Z"),
  lockedAt: new Date("2026-08-02T06:30:05.000Z"),
  lastError: null,
  dedupeKey: "analitica_rollup_diario:2026-08-01",
  createdAt: new Date("2026-08-01T06:30:00.000Z"),
  updatedAt: new Date("2026-08-01T06:30:00.000Z"),
} as unknown as JobDTO;

function resumen(over: Partial<ResumenCorrida> = {}): ResumenCorrida {
  return { fecha: "2026-08-01", filasEscritas: 12, filasRetiradas: 3, ms: 420, ...over };
}

function servicioQueDevuelve(r: ResumenCorrida = resumen()): {
  service: IAnaliticaRollupService;
  fechasPedidas: string[];
} {
  const fechasPedidas: string[] = [];
  const service: IAnaliticaRollupService = {
    agregarFecha: async (fecha: string) => {
      fechasPedidas.push(fecha);
      return { ...r, fecha };
    },
  };
  return { service, fechasPedidas };
}

function loggerEspia(): { logger: RollupJobLogger; lineas: string[] } {
  const lineas: string[] = [];
  return { logger: { info: (m) => lineas.push(m) }, lineas };
}

describe("R8/D3 — el handler agrega la fecha que ACABA DE CERRAR (D-1)", () => {
  it("con el reloj congelado a las 00:30 CR del 2 de agosto, agrega el 1 de agosto", async () => {
    // 00:30 CR del 2026-08-02 == 06:30 UTC del 2026-08-02. La fecha objetivo es D-1.
    const { service, fechasPedidas } = servicioQueDevuelve();
    const handler = crearAnaliticaRollupDiarioHandler(
      service,
      () => new Date("2026-08-02T06:30:00.000Z"),
      loggerEspia().logger,
    );

    await handler(JOB_VACIO);

    expect(fechasPedidas).toEqual(["2026-08-01"]);
  });

  it("delega UNA sola vez por corrida: el handler no agrega nada por su cuenta", async () => {
    const { service, fechasPedidas } = servicioQueDevuelve();
    const handler = crearAnaliticaRollupDiarioHandler(
      service,
      () => new Date("2026-08-02T06:30:00.000Z"),
      loggerEspia().logger,
    );

    await handler(JOB_VACIO);

    expect(fechasPedidas).toHaveLength(1);
  });

  it("el reloj esta INYECTADO: mover `now` mueve la fecha objetivo", async () => {
    // Si alguien pusiera `new Date()` dentro del handler, este test dejaria de controlar
    // la fecha y las dos corridas pedirian el mismo dia.
    const { service, fechasPedidas } = servicioQueDevuelve();
    const { logger } = loggerEspia();
    await crearAnaliticaRollupDiarioHandler(
      service,
      () => new Date("2026-08-02T06:30:00.000Z"),
      logger,
    )(JOB_VACIO);
    await crearAnaliticaRollupDiarioHandler(
      service,
      () => new Date("2026-12-01T06:30:00.000Z"),
      logger,
    )(JOB_VACIO);

    expect(fechasPedidas).toEqual(["2026-08-01", "2026-11-30"]);
  });
});

describe("R37/R32 — el resumen que se registra son CONTEOS y nada mas", () => {
  it("registra fecha, filas escritas, filas retiradas y ms", async () => {
    const { service } = servicioQueDevuelve(
      resumen({ filasEscritas: 12, filasRetiradas: 3, ms: 420 }),
    );
    const { logger, lineas } = loggerEspia();

    await crearAnaliticaRollupDiarioHandler(
      service,
      () => new Date("2026-08-02T06:30:00.000Z"),
      logger,
    )(JOB_VACIO);

    expect(lineas).toHaveLength(1);
    const json = JSON.parse(lineas[0].replace("[analitica_rollup_diario] ", "")) as Record<
      string,
      unknown
    >;
    expect(json).toEqual({
      job: "analitica_rollup_diario",
      fecha: "2026-08-01",
      filasEscritas: 12,
      filasRetiradas: 3,
      ms: 420,
    });
  });

  it("R32 — la linea se SERIALIZA: un `BigInt` crudo en el registro haria lanzar el handler", async () => {
    // `seg_ciclo_acum` es BIGINT en la base y `JSON.stringify(1n)` lanza `TypeError`. Que la
    // linea de log pase por `JSON.stringify` es deliberado: si alguien mete un BigInt en el
    // resumen, el job muere aqui, en un handler de dos lineas, y este test se pone rojo.
    const { service } = servicioQueDevuelve();
    const { logger, lineas } = loggerEspia();

    await expect(
      crearAnaliticaRollupDiarioHandler(
        service,
        () => new Date("2026-08-02T06:30:00.000Z"),
        logger,
      )(JOB_VACIO),
    ).resolves.toBeUndefined();

    expect(() => JSON.stringify(JSON.parse(lineas[0].slice(lineas[0].indexOf("{"))))).not.toThrow();
  });

  it("R37 — el registro NO lleva ids, destinatarios ni telefonos", async () => {
    const { service } = servicioQueDevuelve();
    const { logger, lineas } = loggerEspia();

    await crearAnaliticaRollupDiarioHandler(
      service,
      () => new Date("2026-08-02T06:30:00.000Z"),
      logger,
    )(JOB_VACIO);

    for (const prohibido of ["destinatario", "telefono", "num_guia", "numGuia", "ordenId"]) {
      expect(lineas[0]).not.toContain(prohibido);
    }
  });
});

describe("R38 — un fallo del servicio se PROPAGA (nada de `catch` vacio)", () => {
  it("el rechazo del servicio sale del handler tal cual", async () => {
    const boom = new Error("rollup analitica 2026-08-01: fallo en la etapa escritura");
    const service: IAnaliticaRollupService = {
      agregarFecha: async () => {
        throw boom;
      },
    };

    await expect(
      crearAnaliticaRollupDiarioHandler(
        service,
        () => new Date("2026-08-02T06:30:00.000Z"),
        loggerEspia().logger,
      )(JOB_VACIO),
    ).rejects.toBe(boom);
  });

  it("un fallo NO deja linea de resumen: el job no se registra como corrido", async () => {
    const { logger, lineas } = loggerEspia();
    const service: IAnaliticaRollupService = {
      agregarFecha: async () => {
        throw new Error("repositorio caido");
      },
    };

    await expect(
      crearAnaliticaRollupDiarioHandler(service, () => new Date("2026-08-02T06:30:00.000Z"), logger)(
        JOB_VACIO,
      ),
    ).rejects.toThrow("repositorio caido");
    expect(lineas).toEqual([]);
  });
});

describe("D3/R36 — la recurrencia: 00:30 CR (06:30 UTC) del dia siguiente", () => {
  it("desde las 06:30 UTC del 2 de agosto, la siguiente es el 3 a las 06:30 UTC", () => {
    const now = new Date("2026-08-02T06:30:00.000Z");
    expect(proximaCorridaRollupCR(now).toISOString()).toBe("2026-08-03T06:30:00.000Z");
  });

  it("desde justo ANTES del corte (05:59:59 UTC), la siguiente es HOY a las 06:30 UTC", () => {
    // 05:59:59 UTC del 2 de agosto es todavia el 1 de agosto en CR (23:59:59 CR), asi que
    // el dia CR siguiente empieza esa misma manana UTC.
    const now = new Date("2026-08-02T05:59:59.000Z");
    expect(proximaCorridaRollupCR(now).toISOString()).toBe("2026-08-02T06:30:00.000Z");
  });

  it("es ESTRICTAMENTE posterior a `now` en instantes repartidos por todo el dia CR", () => {
    for (const iso of [
      "2026-08-02T06:00:00.000Z", // 00:00 CR
      "2026-08-02T06:29:59.999Z", // un ms antes de la corrida del dia
      "2026-08-02T06:30:00.000Z", // la corrida misma: la siguiente es la de manana
      "2026-08-02T17:00:00.000Z",
      "2026-08-03T05:59:59.999Z", // 23:59:59.999 CR
    ]) {
      const now = new Date(iso);
      expect(proximaCorridaRollupCR(now).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("cruza fin de mes y fin de anio sin aritmetica propia", () => {
    expect(proximaCorridaRollupCR(new Date("2026-09-01T05:00:00.000Z")).toISOString()).toBe(
      "2026-09-01T06:30:00.000Z",
    );
    expect(proximaCorridaRollupCR(new Date("2027-01-01T05:00:00.000Z")).toISOString()).toBe(
      "2027-01-01T06:30:00.000Z",
    );
  });

  it("el `dedupeKey` es el de la fecha que ESA corrida agregara, no el de la fecha de corrida", () => {
    // La corrida del 3 de agosto a las 00:30 CR agrega el 2 de agosto.
    const { runAfter, dedupeKey } = recurrenciaAnaliticaRollupDiario.siguiente(
      new Date("2026-08-02T06:30:00.000Z"),
    );
    expect(runAfter.toISOString()).toBe("2026-08-03T06:30:00.000Z");
    expect(dedupeKey).toBe("analitica_rollup_diario:2026-08-02");
  });

  it("R36 — dos siembras del MISMO objetivo producen la MISMA clave (colisionan)", async () => {
    // Sembrar a las 10:00 CR y volver a sembrar a las 20:00 CR del mismo dia CR apunta a la
    // misma corrida y, sobre todo, al mismo dia OBJETIVO: una sola fila en `jobs`.
    const claves: (string | undefined)[] = [];
    const repo = {
      enqueue: vi.fn(async (_t: unknown, _p: unknown, opts?: { dedupeKey?: string }) => {
        claves.push(opts?.dedupeKey);
        return claves.length === 1 ? ({ id: "j1" } as unknown as JobDTO) : null;
      }),
    } as unknown as IJobRepository;

    await seedJobAnaliticaRollupDiario(repo, new Date("2026-08-02T16:00:00.000Z"));
    await seedJobAnaliticaRollupDiario(repo, new Date("2026-08-03T02:00:00.000Z"));

    expect(claves).toEqual([
      "analitica_rollup_diario:2026-08-02",
      "analitica_rollup_diario:2026-08-02",
    ]);
    expect(new Set(claves).size).toBe(1);
  });

  it("la clave del encolado usa el prefijo del tipo y la fecha objetivo", () => {
    expect(DEDUPE_PREFIX).toBe("analitica_rollup_diario");
    expect(dedupeKeyRollup("2026-08-01")).toBe("analitica_rollup_diario:2026-08-01");
  });
});

describe("R39 — la invocacion manual admite SOLO hoy o ayer", () => {
  const AHORA = new Date("2026-08-02T18:00:00.000Z"); // 12:00 CR del 2 de agosto

  it("admite hoy y ayer en calendario CR", () => {
    expect(validarFechaInvocacionManual("2026-08-02", AHORA).ok).toBe(true);
    expect(validarFechaInvocacionManual("2026-08-01", AHORA).ok).toBe(true);
  });

  it("rechaza `hoy - 10 dias` remitiendo al backfill de la 125", () => {
    const r = validarFechaInvocacionManual("2026-07-23", AHORA);
    expect(r.ok).toBe(false);
    expect(r.ok === false ? r.motivo : "").toMatch(/125/);
  });

  it("rechaza incluso `ayer - 1`: la frontera es exacta, no aproximada", () => {
    expect(validarFechaInvocacionManual("2026-07-31", AHORA).ok).toBe(false);
  });
});

describe("R39 — guarda de host de la invocacion manual (patron de la 123)", () => {
  it("acepta solo `localhost:5432/ordenex`", () => {
    expect(esDestinoLocalOrdenex("postgresql://u:p@localhost:5432/ordenex?schema=public")).toBe(
      true,
    );
    expect(esDestinoLocalOrdenex("postgresql://u:p@127.0.0.1:5432/ordenex")).toBe(true);
  });

  it("aborta ante cualquier otro destino: puerto, base u host distintos", () => {
    expect(esDestinoLocalOrdenex("postgresql://u:p@db.supabase.co:5432/postgres")).toBe(false);
    expect(esDestinoLocalOrdenex("postgresql://u:p@localhost:6543/ordenex")).toBe(false);
    expect(esDestinoLocalOrdenex("postgresql://u:p@localhost:5432/otra_base")).toBe(false);
    expect(esDestinoLocalOrdenex("no-es-una-url")).toBe(false);
  });
});
