import { describe, it, expect, vi } from "vitest";
import { buildHandlers, buildRecurrencias } from "@/app/api/cron/procesar-jobs/route";
import { JobQueueService } from "@/lib/services/JobQueueService";
import type { JobDTO, IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import type { JobTipo } from "@prisma/client";

// Feature 99 (R26) — el drenador debe RESOLVER el handler de `webhook_estado` y NO re-agendar
// este tipo (se encola por evento, no por reloj). Patron procesar-jobs-geocodificacion.

const AHORA = new Date("2026-07-21T12:00:00.000Z");

const CONFIG = {
  JOBS_BATCH_SIZE: 10,
  JOBS_MAX_ATTEMPTS: 5,
  JOBS_BACKOFF_BASE_MS: 60_000,
  JOBS_BACKOFF_CAP_MS: 3_600_000,
  JOBS_VISIBILITY_TIMEOUT_MS: 3_600_000,
};

function jobWebhook(): JobDTO {
  return {
    id: "job-webhook",
    tipo: "webhook_estado",
    payload: { ordenId: "orden-1", estatusDestinoId: "s1", ocurridoAt: "2026-07-21T10:00:00.000Z" },
    estado: "processing",
    intentos: 1,
    maxIntentos: 5,
    runAfter: AHORA,
    lockedAt: AHORA,
    lastError: null,
    dedupeKey: "webhook_estado:orden-1:s1:2026-07-21T10:00:00.000Z",
    createdAt: AHORA,
    updatedAt: AHORA,
  };
}

describe("R26 — el drenador resuelve el handler de webhook_estado y no lo re-agenda", () => {
  it("buildHandlers registra el tipo webhook_estado sin perder los demas", () => {
    const handlers = buildHandlers(() => AHORA);
    expect(handlers.has("webhook_estado")).toBe(true);
    expect(handlers.get("webhook_estado")).toBeTypeOf("function");
    expect([...handlers.keys()].sort()).toEqual([
      "analitica_rollup_diario", // feature 124
      "geocodificacion",
      "liberar_reprogramadas",
      "optimizacion_ruta",
      "webhook_estado",
      "whatsapp_chat_envio", // feature 109
      "whatsapp_template_sync", // integracion WhatsApp
    ]);
  });

  it("buildRecurrencias NO registra webhook_estado (no es recurrente)", () => {
    const recurrencias = buildRecurrencias();
    expect(recurrencias.has("webhook_estado")).toBe(false);
    // Feature 124: el rollup diario entra al registro de recurrencias (00:30 CR). La lista
    // sigue CERRADA y en orden de insercion: es lo que caza que un tipo por EVENTO se cuele
    // aqui y se re-agende solo, y tambien que un refactor pierda uno por el camino.
    expect([...recurrencias.keys()]).toEqual([
      "liberar_reprogramadas",
      "analitica_rollup_diario",
    ]);
  });

  it("al drenar, el handler se ejecuta, el job se completa y NO se re-encola", async () => {
    const handlerSpy = vi.fn(async () => {});
    const repo = {
      claimBatch: vi.fn(async () => [jobWebhook()]),
      complete: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
      enqueue: vi.fn(async () => null),
    };
    const service = new JobQueueService(
      repo as unknown as IJobRepository,
      new Map<JobTipo, JobHandler>([["webhook_estado", handlerSpy]]),
      buildRecurrencias(),
      CONFIG,
      () => AHORA,
      { warn: () => {} },
    );

    const result = await service.drenar(10);

    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(repo.complete).toHaveBeenCalledWith("job-webhook");
    expect(result).toMatchObject({ procesados: 1, ok: 1, fallidos: 0 });
    expect(repo.enqueue).not.toHaveBeenCalled(); // R26: no recurrente
  });

  it("un fallo transitorio persiste last_error via fail y no re-agenda (R31)", async () => {
    const handlerSpy = vi.fn(async () => {
      throw new Error("entregar webhook: HTTP 503");
    });
    const repo = {
      claimBatch: vi.fn(async () => [jobWebhook()]),
      complete: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
      enqueue: vi.fn(async () => null),
    };
    const service = new JobQueueService(
      repo as unknown as IJobRepository,
      new Map<JobTipo, JobHandler>([["webhook_estado", handlerSpy]]),
      buildRecurrencias(),
      CONFIG,
      () => AHORA,
      { warn: () => {} },
    );

    await service.drenar(10);

    // R31: el detalle del fallo llega a `jobs.last_error` via JobQueueService.fail; como
    // intentos (1) < maxIntentos (5), se re-agenda con backoff (runAfter no null), no muere.
    expect(repo.fail).toHaveBeenCalledTimes(1);
    const [id, mensaje, runAfter] = repo.fail.mock.calls[0] as unknown as [
      string,
      string,
      Date | null,
    ];
    expect(id).toBe("job-webhook");
    expect(mensaje).toBe("entregar webhook: HTTP 503");
    expect(runAfter).not.toBeNull();
  });
});
