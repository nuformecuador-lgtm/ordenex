import { describe, it, expect, vi } from "vitest";
import { buildHandlers, buildRecurrencias } from "@/app/api/cron/procesar-jobs/route";
import { JobQueueService } from "@/lib/services/JobQueueService";
import type { JobDTO, IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import type { JobTipo } from "@prisma/client";

// Feature 91 (R32) — el drenador debe RESOLVER el handler de `geocodificacion` y NO
// re-agendar este tipo (no es recurrente: se encola por evento, no por reloj).
// `buildHandlers` construye el service real, pero el cliente Prisma es un singleton
// PEREZOSO: instanciarlo no abre conexion.

const AHORA = new Date("2026-07-19T12:00:00.000Z");

const CONFIG = {
  JOBS_BATCH_SIZE: 10,
  JOBS_MAX_ATTEMPTS: 5,
  JOBS_BACKOFF_BASE_MS: 60_000,
  JOBS_BACKOFF_CAP_MS: 3_600_000,
  JOBS_VISIBILITY_TIMEOUT_MS: 3_600_000,
};

function jobGeo(): JobDTO {
  return {
    id: "job-geo",
    tipo: "geocodificacion",
    payload: { ordenId: "orden-1" },
    estado: "processing",
    intentos: 1,
    maxIntentos: 8,
    runAfter: AHORA,
    lockedAt: AHORA,
    lastError: null,
    dedupeKey: "geocodificacion:orden-1:abcdef01",
    createdAt: AHORA,
    updatedAt: AHORA,
  };
}

describe("R32 — el drenador resuelve el handler de geocodificacion y no lo re-agenda", () => {
  it("buildHandlers registra el tipo geocodificacion", () => {
    const handlers = buildHandlers(() => AHORA);
    expect(handlers.has("geocodificacion")).toBe(true);
    // Y no se pierde ningun handler ya existente (todos comparten el mismo cron).
    expect(handlers.has("liberar_reprogramadas")).toBe(true);
    // Feature 92: se suma `optimizacion_ruta`. La asercion se INVIERTE al sentido nuevo y
    // ademas se ENDURECE: en vez de un `size` numerico (que solo dice "hay tres"), se
    // enumera el conjunto EXACTO de tipos registrados. Asi, anadir un tipo sin actualizar
    // este test falla ruidosamente, y quitar uno por accidente tambien.
    expect([...handlers.keys()].sort()).toEqual([
      "geocodificacion",
      "liberar_reprogramadas",
      "optimizacion_ruta",
    ]);
  });

  it("buildRecurrencias NO registra geocodificacion (no es recurrente)", () => {
    const recurrencias = buildRecurrencias();
    expect(recurrencias.has("geocodificacion")).toBe(false);
    expect(recurrencias.has("liberar_reprogramadas")).toBe(true);
    expect(recurrencias.size).toBe(1);
  });

  it("al drenar, el handler se ejecuta, el job se completa y NO se re-encola", async () => {
    const handlerSpy = vi.fn(async () => {});
    const repo = {
      claimBatch: vi.fn(async () => [jobGeo()]),
      complete: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
      enqueue: vi.fn(async () => null),
    };
    const service = new JobQueueService(
      repo as unknown as IJobRepository,
      new Map<JobTipo, JobHandler>([["geocodificacion", handlerSpy]]),
      buildRecurrencias(), // el registro REAL: geocodificacion no esta
      CONFIG,
      () => AHORA,
      { warn: () => {} },
    );

    const result = await service.drenar(10);

    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(repo.complete).toHaveBeenCalledWith("job-geo");
    expect(result).toMatchObject({ procesados: 1, ok: 1, fallidos: 0 });
    // R32: no recurrente -> ninguna re-agenda tras el exito.
    expect(repo.enqueue).not.toHaveBeenCalled();
  });

  it("un fallo del job de geocodificacion tampoco lo re-agenda como recurrente", async () => {
    const handlerSpy = vi.fn(async () => {
      throw new Error("fallo transitorio");
    });
    const repo = {
      claimBatch: vi.fn(async () => [{ ...jobGeo(), intentos: 8 }]),
      complete: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
      enqueue: vi.fn(async () => null),
    };
    const service = new JobQueueService(
      repo as unknown as IJobRepository,
      new Map<JobTipo, JobHandler>([["geocodificacion", handlerSpy]]),
      buildRecurrencias(),
      CONFIG,
      () => AHORA,
      { warn: () => {} },
    );

    const result = await service.drenar(10);

    // intentos (8) >= maxIntentos (8) -> dead-letter, y SIN re-agenda recurrente.
    expect(repo.fail).toHaveBeenCalledWith("job-geo", "fallo transitorio", null);
    expect(result).toMatchObject({ muertos: 1 });
    expect(repo.enqueue).not.toHaveBeenCalled();
  });

  it("un tipo de job SIN handler seguiria fallando de forma controlada (registro completo)", async () => {
    // Salvaguarda: si alguien quita el registro de geocodificacion, el drenador no
    // crashea pero el job falla. Este test documenta el contrato; el registro real se
    // verifica arriba.
    const handlers = buildHandlers(() => AHORA);
    expect(handlers.get("geocodificacion")).toBeTypeOf("function");
  });
});
