import { describe, it, expect, vi } from "vitest";
import { buildHandlers, buildRecurrencias } from "@/app/api/cron/procesar-jobs/route";
import { JobQueueService } from "@/lib/services/JobQueueService";
import type { IJobRepository, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import type { JobTipo } from "@prisma/client";

// Feature 92 (R21) — el tipo `optimizacion_ruta` esta enganchado al drenador y NO es
// recurrente: se encola por EVENTO (recogida con debounce, gestion inmediata), nunca por
// reloj. Si se registrara en `buildRecurrencias()`, el cron lo re-agendaria cada minuto
// para TODOS los mensajeros, pagando una llamada facturada por cada uno y por minuto.

const AHORA = new Date("2026-07-20T12:00:00.000Z");

function job(tipo: JobTipo, over: Partial<JobDTO> = {}): JobDTO {
  return {
    id: `job-${tipo}`,
    tipo,
    payload: { mensajeroId: "m-1" },
    estado: "processing",
    intentos: 1,
    maxIntentos: 5,
    runAfter: AHORA,
    lockedAt: AHORA,
    lastError: null,
    dedupeKey: null,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...over,
  };
}

describe("R21 — registro en el drenador", () => {
  it("buildHandlers registra `optimizacion_ruta`", () => {
    const handlers = buildHandlers(() => AHORA);
    expect(handlers.has("optimizacion_ruta")).toBe(true);
  });

  it("buildHandlers NO pierde los handlers de las features 46/90 y 91", () => {
    // Conjunto EXACTO: anadir o quitar un tipo sin actualizar este test falla ruidosamente.
    const handlers = buildHandlers(() => AHORA);
    expect([...handlers.keys()].sort()).toEqual([
      "geocodificacion",
      "liberar_reprogramadas",
      "optimizacion_ruta",
      "webhook_estado", // feature 99
      "whatsapp_chat_envio", // feature 109
      "whatsapp_template_sync", // integracion WhatsApp
    ]);
  });

  it("buildRecurrencias NO registra `optimizacion_ruta` (no es recurrente)", () => {
    const recurrencias = buildRecurrencias();
    expect(recurrencias.has("optimizacion_ruta")).toBe(false);
    // Solo `liberar_reprogramadas` es recurrente, como antes de esta feature.
    expect([...recurrencias.keys()]).toEqual(["liberar_reprogramadas"]);
  });

  it("construir los handlers NO lanza aunque falte la credencial del proveedor", () => {
    // La fabrica construye el cliente con `projectId ?? ""` y difiere la validacion de la
    // credencial al momento de pedir el token. Si lanzara aqui, un despliegue sin el SKU
    // de Route Optimization tumbaria el registro entero del cron.
    const previo = process.env.GOOGLE_ROUTE_OPT_PROJECT_ID;
    delete process.env.GOOGLE_ROUTE_OPT_PROJECT_ID;
    delete process.env.GOOGLE_ROUTE_OPT_SA_EMAIL;
    delete process.env.GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY;
    try {
      expect(() => buildHandlers(() => AHORA)).not.toThrow();
    } finally {
      if (previo !== undefined) process.env.GOOGLE_ROUTE_OPT_PROJECT_ID = previo;
    }
  });
});

describe("R21 — un fallo de este handler NO impide drenar el resto del lote", () => {
  it("el job de optimizacion falla y los otros dos se completan igual", async () => {
    // `JobQueueService.drenar` captura job a job. Es lo que garantiza que una credencial
    // de Route Optimization ausente no tumbe `liberar_reprogramadas` (en produccion) ni
    // `geocodificacion`, que comparten este mismo cron.
    const claimed = [
      job("optimizacion_ruta"),
      job("geocodificacion", { id: "job-geo" }),
      job("liberar_reprogramadas", { id: "job-lib" }),
    ];
    const completados: string[] = [];
    const fallidos: string[] = [];
    const repo = {
      claimBatch: vi.fn(async () => claimed),
      complete: vi.fn(async (id: string) => {
        completados.push(id);
      }),
      fail: vi.fn(async (id: string) => {
        fallidos.push(id);
      }),
      enqueue: vi.fn(async () => null),
      findByDedupeKeys: vi.fn(async () => []),
    } as unknown as IJobRepository;

    const handlers = new Map<JobTipo, JobHandler>([
      [
        "optimizacion_ruta",
        async () => {
          throw new Error("optimizacion de ruta: credencial incompleta");
        },
      ],
      ["geocodificacion", async () => {}],
      ["liberar_reprogramadas", async () => {}],
    ]);

    const service = new JobQueueService(
      repo,
      handlers,
      new Map(),
      {
        JOBS_BATCH_SIZE: 10,
        JOBS_MAX_ATTEMPTS: 5,
        JOBS_BACKOFF_BASE_MS: 60_000,
        JOBS_BACKOFF_CAP_MS: 3_600_000,
        JOBS_VISIBILITY_TIMEOUT_MS: 300_000,
      },
      () => AHORA,
    );

    await service.drenar(10);

    expect(fallidos).toEqual(["job-optimizacion_ruta"]);
    expect(completados.sort()).toEqual(["job-geo", "job-lib"]);
  });
});
