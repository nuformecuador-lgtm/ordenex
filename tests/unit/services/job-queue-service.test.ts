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
