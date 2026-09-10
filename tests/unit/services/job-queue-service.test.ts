import { describe, it, expect } from "vitest";
import { JobQueueService } from "@/lib/services/JobQueueService";
import type {
  ClaimOpts,
  EnqueueOpts,
  IJobRepository,
  JobDTO,
} from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler, RecurrenciaSpec } from "@/lib/interfaces/services/IJobQueueService";
import type { JobsConfig } from "@/lib/config/jobs";
import type { JobTipo } from "@prisma/client";
// FICHA 403: el productor REAL de la sugerencia de espera. Se usa el de verdad y no un objeto
// inventado para que este test se rompa si el campo cambia de nombre en el otro lado.
import { WebhookEntregaFallidaError } from "@/lib/services/WebhookEstadoService";

// Feature 90 (R14/R15/R16/R23/R24) — logica del drenador con dobles de `IJobRepository` y
// handlers fake: backoff exponencial acotado, dead-letter al agotar `max_intentos`,
// recurrencia en exito Y en fallo terminal, `last_error` sin secreto. Sin DB ni red.

const SECRET = "s3cr3t-cron"; // sentinela: nunca debe aparecer en last_error (R15)
const TIPO: JobTipo = "liberar_reprogramadas";
const NOW = new Date("2026-07-19T12:00:00.000Z");

interface FailCall {
  id: string;
  error: string;
  runAfter: Date | null;
}

function makeJob(over: Partial<JobDTO> = {}): JobDTO {
  return {
    id: "job-1",
    tipo: TIPO,
    payload: {},
    estado: "processing",
    intentos: 1,
    maxIntentos: 3,
    runAfter: NOW,
    lockedAt: NOW,
    lastError: null,
    dedupeKey: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function fakeRepo(claimed: JobDTO[]) {
  const calls = {
    claim: [] as { limit: number; opts: ClaimOpts }[],
    complete: [] as string[],
    fail: [] as FailCall[],
    enqueue: [] as { tipo: JobTipo; payload: Record<string, unknown>; opts?: EnqueueOpts }[],
  };
  const repo: IJobRepository = {
    async claimBatch(limit, opts) {
      calls.claim.push({ limit, opts });
      return claimed;
    },
    async complete(id) {
      calls.complete.push(id);
    },
    // Feature 92 (R4): lectura nueva de la interfaz. `JobQueueService` no la usa; el
    // doble la implementa para satisfacer el contrato, devolviendo vacio.
    async findByDedupeKeys() {
      return [];
    },
    async fail(id, error, runAfter) {
      calls.fail.push({ id, error, runAfter });
    },
    async enqueue(tipo, payload, opts) {
      calls.enqueue.push({ tipo, payload, opts });
      return null;
    },
  };
  return { repo, calls };
}

const CONFIG: JobsConfig = {
  JOBS_BATCH_SIZE: 10,
  JOBS_MAX_ATTEMPTS: 3,
  JOBS_BACKOFF_BASE_MS: 1000,
  JOBS_BACKOFF_CAP_MS: 3000,
  JOBS_VISIBILITY_TIMEOUT_MS: 60_000,
};

const okHandler: JobHandler = async () => {};
const boomHandler: JobHandler = async () => {
  throw new Error("handler exploto (db down)"); // sin secreto
};

const recurrenciaFake: RecurrenciaSpec = {
  siguiente: () => ({
    runAfter: new Date("2026-07-20T06:00:00.000Z"),
    dedupeKey: "liberar_reprogramadas:2026-07-20",
  }),
};

function service(
  claimed: JobDTO[],
  handler: JobHandler,
  opts: { recurrente?: boolean } = {},
) {
  const { repo, calls } = fakeRepo(claimed);
  const handlers = new Map<JobTipo, JobHandler>([[TIPO, handler]]);
  const recurrencias = new Map<JobTipo, RecurrenciaSpec>(
    opts.recurrente ? [[TIPO, recurrenciaFake]] : [],
  );
  const svc = new JobQueueService(repo, handlers, recurrencias, CONFIG, () => NOW, {
    warn: () => {},
  });
  return { svc, calls };
}

describe("JobQueueService.drenar — visibility cutoff y claim (R10/R13)", () => {
  it("reclama con now y visibilityCutoff = now - JOBS_VISIBILITY_TIMEOUT_MS", async () => {
    const { svc, calls } = service([], okHandler);
    await svc.drenar(7);
    expect(calls.claim).toHaveLength(1);
    expect(calls.claim[0].limit).toBe(7);
    expect(calls.claim[0].opts.now).toEqual(NOW);
    expect(calls.claim[0].opts.visibilityCutoff).toEqual(
      new Date(NOW.getTime() - CONFIG.JOBS_VISIBILITY_TIMEOUT_MS),
    );
  });
});

describe("JobQueueService.drenar — exito (R14)", () => {
  it("handler ok -> complete y ok=1", async () => {
    const { svc, calls } = service([makeJob()], okHandler);
    const res = await svc.drenar(10);
    expect(calls.complete).toEqual(["job-1"]);
    expect(calls.fail).toHaveLength(0);
    expect(res).toEqual({ procesados: 1, ok: 1, fallidos: 0, reintentados: 0, muertos: 0 });
  });
});

describe("JobQueueService.drenar — backoff exponencial acotado (R15)", () => {
  it("intentos 1,2,3 -> runAfter = now + base*2^(n-1) saturado en cap", async () => {
    const casos = [
      { intentos: 1, esperado: 1000 }, // base
      { intentos: 2, esperado: 2000 }, // base*2
      { intentos: 3, esperado: 3000 }, // base*4 = 4000 -> saturado en cap 3000
    ];
    for (const { intentos, esperado } of casos) {
      // maxIntentos alto para que NO sea terminal (probamos el reintento, no el dead-letter)
      const { svc, calls } = service([makeJob({ intentos, maxIntentos: 99 })], boomHandler);
      const res = await svc.drenar(10);
      expect(calls.fail).toHaveLength(1);
      expect(calls.fail[0].runAfter).toEqual(new Date(NOW.getTime() + esperado));
      expect(res.reintentados).toBe(1);
      expect(res.muertos).toBe(0);
    }
  });

  it("R15: last_error NO contiene el secreto", async () => {
    const { svc, calls } = service([makeJob({ intentos: 1, maxIntentos: 99 })], boomHandler);
    await svc.drenar(10);
    expect(calls.fail[0].error).not.toContain(SECRET);
    expect(calls.fail[0].error).toContain("handler exploto");
  });
});

describe("JobQueueService.drenar — dead-letter (R16)", () => {
  it("intentos >= maxIntentos -> fail(id, msg, null) y muertos=1, sin reintento", async () => {
    const { svc, calls } = service([makeJob({ intentos: 3, maxIntentos: 3 })], boomHandler);
    const res = await svc.drenar(10);
    expect(calls.fail).toHaveLength(1);
    expect(calls.fail[0].runAfter).toBeNull();
    expect(res).toEqual({ procesados: 1, ok: 0, fallidos: 1, reintentados: 0, muertos: 1 });
  });
});

describe("JobQueueService.drenar — recurrencia (R23/R24)", () => {
  it("R23: exito de un tipo recurrente re-agenda la proxima ocurrencia", async () => {
    const { svc, calls } = service([makeJob()], okHandler, { recurrente: true });
    await svc.drenar(10);
    expect(calls.enqueue).toHaveLength(1);
    expect(calls.enqueue[0].tipo).toBe(TIPO);
    expect(calls.enqueue[0].payload).toEqual({}); // gate F1.4-3: payload vacio
    expect(calls.enqueue[0].opts?.dedupeKey).toBe("liberar_reprogramadas:2026-07-20");
    expect(calls.enqueue[0].opts?.runAfter).toEqual(new Date("2026-07-20T06:00:00.000Z"));
  });

  it("R24: fallo TERMINAL de un recurrente igual re-agenda la proxima ocurrencia", async () => {
    const { svc, calls } = service(
      [makeJob({ intentos: 3, maxIntentos: 3 })],
      boomHandler,
      { recurrente: true },
    );
    const res = await svc.drenar(10);
    expect(res.muertos).toBe(1);
    expect(calls.fail[0].runAfter).toBeNull(); // dead-letter
    expect(calls.enqueue).toHaveLength(1); // R24: reprograma pese al fallo terminal
    expect(calls.enqueue[0].opts?.dedupeKey).toBe("liberar_reprogramadas:2026-07-20");
  });

  it("un tipo NO recurrente no re-agenda nada en exito", async () => {
    const { svc, calls } = service([makeJob()], okHandler, { recurrente: false });
    await svc.drenar(10);
    expect(calls.enqueue).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FICHA 403 (T9, design §6) — EL HOOK GENERICO DE `retryAfterMs`.
//
// `JobQueueService` lo comparten NUEVE tipos de job y no debe saber que existe un webhook, ni un
// 429, ni una «suscripcion pausada»: solo lee «este error trae una sugerencia de espera». Por eso
// los casos de abajo usan `WebhookEntregaFallidaError` —el productor REAL, no un objeto
// inventado— pero afirman sobre el comportamiento generico.
//
// LA SUGERENCIA SE ACOTA POR LOS DOS LADOS, y cada cota tiene su motivo:
//   · nunca MENOR que el backoff que ya tocaba (R14, "nunca menor"): si no, un `Retry-After: 1`
//     convertiria un 429 en un martilleo mas agresivo que el de hoy;
//   · nunca MAYOR que `JOBS_BACKOFF_CAP_MS` (R17): un valor extremo o malformado de un destino
//     hostil, o una racha de pausa muy larga, no pueden dejar un job parado indefinidamente.
// ---------------------------------------------------------------------------

/** Handler que falla con la sugerencia de espera del webhook (429 o intervalo de pausa). */
function handlerConHint(retryAfterMs?: number): JobHandler {
  return async () => {
    throw new WebhookEntregaFallidaError("entregar webhook: HTTP 429", retryAfterMs);
  };
}

describe("403/R14/R17 — la sugerencia de espera del error mueve el `runAfter`", () => {
  it("⭑ SIN sugerencia el comportamiento es EXACTAMENTE el de antes de esta ficha", () => {
    // La no-regresion de los otros ocho tipos de job, dicha con el mismo productor: un
    // `WebhookEntregaFallidaError` sin `retryAfterMs` no debe cambiar nada.
    return (async () => {
      const { svc, calls } = service([makeJob({ intentos: 1, maxIntentos: 99 })], handlerConHint());
      await svc.drenar(10);
      expect(calls.fail[0].runAfter).toEqual(new Date(NOW.getTime() + 1000)); // base, sin tocar
    })();
  });

  it("⭑ una sugerencia MENOR que el backoff generico se ignora: manda el backoff (R14)", async () => {
    // intentos=2 -> backoff = base*2 = 2000. El destino pide 500 ms.
    const { svc, calls } = service(
      [makeJob({ intentos: 2, maxIntentos: 99 })],
      handlerConHint(500),
    );
    await svc.drenar(10);
    expect(calls.fail[0].runAfter).toEqual(new Date(NOW.getTime() + 2000));
  });

  it("⭑ una sugerencia MAYOR gana… hasta el cap, y ni un milisegundo mas (R17)", async () => {
    // intentos=1 -> backoff = 1000. Cap de este test = 3000.
    const casos = [
      { hint: 2500, esperado: 2500 }, // entre el backoff y el cap: se usa la sugerencia
      { hint: 3000, esperado: 3000 }, // justo el cap
      { hint: 3_600_000, esperado: 3000 }, // el INTERVALO DE PAUSA de 1 h -> acotado al cap
      { hint: 999_999_999_000, esperado: 3000 }, // `Retry-After` extremo de un destino hostil
    ];
    for (const { hint, esperado } of casos) {
      const { svc, calls } = service(
        [makeJob({ intentos: 1, maxIntentos: 99 })],
        handlerConHint(hint),
      );
      await svc.drenar(10);
      expect(calls.fail[0].runAfter, `hint ${hint}`).toEqual(new Date(NOW.getTime() + esperado));
    }
  });

  it("una sugerencia que no es un numero usable no rompe nada", async () => {
    // El hook es duck-typed: cualquier error puede traer la propiedad. Un valor absurdo debe
    // degradar al backoff normal, no propagar un `NaN` al `runAfter` (que produciria un
    // `Invalid Date` en la columna y un job irrecuperable, sin error visible).
    for (const basura of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      const boom: JobHandler = async () => {
        throw Object.assign(new Error("algo fallo"), { retryAfterMs: basura });
      };
      const { svc, calls } = service([makeJob({ intentos: 1, maxIntentos: 99 })], boom);
      await svc.drenar(10);
      expect(calls.fail[0].runAfter, `con ${String(basura)}`).toEqual(
        new Date(NOW.getTime() + 1000),
      );
    }
  });
});

describe("403/R16 — la sugerencia NO salva a un job de morir", () => {
  it("⭑ cinco 429 seguidos con `Retry-After` siguen terminando en `failed`", async () => {
    // R16 literal: un 429 —o una racha en pausa— sigue contando como intento y el job sigue
    // muriendo al agotar `MAX_INTENTOS_WEBHOOK`, exactamente igual que hoy. Si la sugerencia
    // tocara el conteo, un destino saturado dejaria jobs vivos para siempre.
    const MAX = 5;
    let ultimo: FailCall | undefined;
    for (let intento = 1; intento <= MAX; intento++) {
      const { svc, calls } = service(
        [makeJob({ intentos: intento, maxIntentos: MAX })],
        handlerConHint(3_600_000),
      );
      const res = await svc.drenar(10);
      ultimo = calls.fail[0];
      if (intento < MAX) {
        expect(res.reintentados, `intento ${intento}`).toBe(1);
        expect(res.muertos, `intento ${intento}`).toBe(0);
        expect(ultimo.runAfter, `intento ${intento}`).not.toBeNull();
      } else {
        expect(res.muertos).toBe(1);
        expect(res.reintentados).toBe(0);
      }
    }
    // Dead-letter: `runAfter` null pese a que el error traia una sugerencia de una hora. No hay
    // proximo intento que retrasar.
    expect(ultimo!.runAfter).toBeNull();
  });
});

describe("JobQueueService.drenar — handler no registrado", () => {
  it("sin handler para el tipo -> fallo controlado (no crash) contado como fallido", async () => {
    const { repo, calls } = fakeRepo([makeJob({ intentos: 1, maxIntentos: 3 })]);
    const svc = new JobQueueService(
      repo,
      new Map<JobTipo, JobHandler>(), // registro vacio
      new Map(),
      CONFIG,
      () => NOW,
      { warn: () => {} },
    );
    const res = await svc.drenar(10);
    expect(res.fallidos).toBe(1);
    expect(calls.fail).toHaveLength(1);
    expect(calls.complete).toHaveLength(0);
  });
});

/**
 * FEATURE 402 (R8) — el desglose por tipo de cada corrida, en el log.
 *
 * PARA QUE SIRVE: con el reparto por turnos, la pregunta operativa deja de ser «cuantos jobs
 * corrieron» y pasa a ser «que tipos avanzaron». Sin este log, la unica forma de ver que un
 * tipo lleva media hora sin ejecutarse es consultar a mano la tabla `jobs` — que es justo lo
 * que hubo que hacer en el incidente del 2026-09-09.
 *
 * LO QUE ESTE TEST *NO* PRUEBA, y conviene decirlo: nada del reparto en si. El reparto vive en
 * el SQL y se mide en `tests/integration/db/job-repository-reparto-por-tipo.int.test.ts`; aqui
 * el `claimBatch` es un doble que devuelve lo que se le diga.
 */
describe("JobQueueService.drenar — desglose por tipo en el log (402/R8)", () => {
  /** Servicio con un logger que ADEMAS implementa `info` (espia de mensajes). */
  function servicioConInfo(claimed: JobDTO[]) {
    const { repo, calls } = fakeRepo(claimed);
    const mensajes: string[] = [];
    const handlers = new Map<JobTipo, JobHandler>([
      [TIPO, okHandler],
      ["webhook_estado", okHandler],
      ["geocodificacion", okHandler],
    ]);
    const svc = new JobQueueService(repo, handlers, new Map(), CONFIG, () => NOW, {
      warn: () => {},
      info: (m) => mensajes.push(m),
    });
    return { svc, mensajes, calls };
  }

  /** El desglose viaja DENTRO del mensaje; se parsea, no se compara el texto que lo rodea. */
  function desgloseDe(mensaje: string): unknown {
    const json = mensaje.match(/\{[\s\S]*\}/)?.[0];
    expect(json, `el mensaje no lleva un desglose JSON: ${mensaje}`).toBeDefined();
    return JSON.parse(json as string);
  }

  it("R8: con jobs de DOS tipos, registra `{tipo: cantidad}` una sola vez", async () => {
    const { svc, mensajes } = servicioConInfo([
      makeJob({ id: "w-1", tipo: "webhook_estado" }),
      makeJob({ id: "w-2", tipo: "webhook_estado" }),
      makeJob({ id: "g-1", tipo: "geocodificacion" }),
    ]);

    await svc.drenar(10);

    expect(mensajes).toHaveLength(1);
    expect(desgloseDe(mensajes[0])).toEqual({ webhook_estado: 2, geocodificacion: 1 });
  });

  it("R8: lote VACIO -> no registra nada (no hay corrida que diagnosticar)", async () => {
    const { svc, mensajes } = servicioConInfo([]);
    await svc.drenar(10);
    expect(mensajes).toEqual([]);
  });

  it("R8: el mensaje NO lleva payload, ni ids, ni ningun dato de dominio", async () => {
    const { svc, mensajes } = servicioConInfo([
      makeJob({
        id: "orden-secreta-1",
        tipo: "geocodificacion",
        payload: { telefono: "88887777" },
      }),
    ]);

    await svc.drenar(10);

    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]).not.toContain("orden-secreta-1");
    expect(mensajes[0]).not.toContain("88887777");
    expect(mensajes[0]).not.toContain("telefono");
    expect(desgloseDe(mensajes[0])).toEqual({ geocodificacion: 1 });
  });

  it("un logger SIN `info` (los diez dobles que ya existen) no rompe el drenado", async () => {
    // `info` es OPCIONAL en la interfaz y se invoca con `?.`: un doble antiguo sigue valiendo.
    const { repo, calls } = fakeRepo([makeJob({ tipo: "webhook_estado" })]);
    const svc = new JobQueueService(
      repo,
      new Map<JobTipo, JobHandler>([["webhook_estado", okHandler]]),
      new Map(),
      CONFIG,
      () => NOW,
      { warn: () => {} },
    );

    const res = await svc.drenar(10);

    expect(res.ok).toBe(1);
    expect(calls.complete).toHaveLength(1);
  });
});
