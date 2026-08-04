import { describe, it, expect } from "vitest";
import { crearAnaliticaInvalidacionCacheHandler } from "@/lib/services/jobs/analitica-invalidacion-cache-handler";
import { CachedAnaliticaOperativaRollupRepository } from "@/lib/repositories/CachedAnaliticaOperativaRollupRepository";
import { JobQueueService } from "@/lib/services/JobQueueService";
import { dedupeKeyInvalidacion, payloadInvalidacion } from "@/lib/services/jobs/analitica-invalidacion-encolado";
import type { JobHandler, RecurrenciaSpec } from "@/lib/interfaces/services/IJobQueueService";
import type {
  ClaimOpts,
  EnqueueOpts,
  IJobRepository,
  JobDTO,
} from "@/lib/interfaces/repositories/IJobRepository";
import type { JobTipo } from "@prisma/client";
import type {
  CuboRollup,
  IAnaliticaOperativaRollupRepository,
} from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";
import type { DimensionAnalitica } from "@/lib/analytics/types";
import { cacheFalsa, cacheQueFallaAlInvalidar } from "./_cache-falsa";
import { consultaDe, cubo, MAESTRO } from "./_fake-operativa";

// Feature 128 / T6.5 — R14. EL CAMINO COMPLETO: backfill → job encolado → drenado → consulta.
//
// Mismos cinco pasos que R10, con el DRENADO REAL en el paso 4: `JobQueueService.drenar` con
// el handler de produccion registrado por tipo, exactamente como lo hace el cron.
//
// La mitad de REGISTRO de R14 —que `buildHandlers` incluya el tipo— vive en
// `tests/unit/services/jobs-registro.test.ts`: un handler que no esta registrado deja el job
// `pending` para siempre y esta mitad no llegaria a ejecutarse.

const SIN_GRANO: readonly DimensionAnalitica[] = [];
const AHORA = new Date("2026-08-03T15:00:00.000Z");

/** Cola en memoria: encola, reclama y completa. Lo justo para drenar de verdad. */
function colaEnMemoria(): IJobRepository & { filas: JobDTO[] } {
  const filas: JobDTO[] = [];
  let seq = 0;
  const repo = {
    filas,
    async enqueue(
      tipo: JobTipo,
      payload: Record<string, unknown>,
      opts?: EnqueueOpts,
    ): Promise<JobDTO | null> {
      if (opts?.dedupeKey && filas.some((f) => f.dedupeKey === opts.dedupeKey)) return null;
      seq += 1;
      const fila = {
        id: `job-${seq}`,
        tipo,
        payload,
        estado: "pending",
        intentos: 0,
        maxIntentos: 5,
        runAfter: opts?.runAfter ?? AHORA,
        lockedAt: null,
        lastError: null,
        dedupeKey: opts?.dedupeKey ?? null,
        createdAt: AHORA,
        updatedAt: AHORA,
      } as unknown as JobDTO;
      filas.push(fila);
      return fila;
    },
    async claimBatch(limit: number, _opts: ClaimOpts): Promise<JobDTO[]> {
      const candidatos = filas.filter((f) => f.estado === "pending").slice(0, limit);
      for (const f of candidatos) {
        (f as { estado: string }).estado = "processing";
        (f as { intentos: number }).intentos += 1;
      }
      return candidatos;
    },
    async complete(id: string): Promise<void> {
      const f = filas.find((x) => x.id === id);
      if (f) (f as { estado: string }).estado = "done";
    },
    async fail(id: string, error: string, runAfter: Date | null): Promise<void> {
      const f = filas.find((x) => x.id === id);
      if (f) {
        (f as { estado: string }).estado = runAfter === null ? "failed" : "pending";
        (f as { lastError: string | null }).lastError = error;
      }
    },
    async findByDedupeKeys(): Promise<JobDTO[]> {
      return [];
    },
  };
  return repo as unknown as IJobRepository & { filas: JobDTO[] };
}

function rollupMutable(inicial: number) {
  let entregas = inicial;
  const repo: IAnaliticaOperativaRollupRepository = {
    async agregarCubos(): Promise<readonly CuboRollup[]> {
      return [cubo({ fecha: "2026-07-21", entregas })];
    },
    async etiquetasDeEstatus() {
      return new Map();
    },
  };
  return { repo, fijar: (n: number) => (entregas = n) };
}

const CONFIG_JOBS = {
  JOBS_BATCH_SIZE: 10,
  JOBS_MAX_ATTEMPTS: 5,
  JOBS_VISIBILITY_TIMEOUT_MS: 60_000,
  JOBS_BACKOFF_BASE_MS: 1000,
} as unknown as ConstructorParameters<typeof JobQueueService>[3];

describe("R14 · tras drenar el job encolado por el backfill, la consulta devuelve las cifras recomputadas", () => {
  it("los cinco pasos, con el drenador real en el paso 4", async () => {
    const cache = cacheFalsa();
    const origen = rollupMutable(10);
    const lector = new CachedAnaliticaOperativaRollupRepository(origen.repo, cache);
    const consulta = consultaDe("entregas", MAESTRO, {
      rango: "personalizado",
      desde: "2026-07-20",
      hasta: "2026-07-22",
    });

    // (1)
    expect((await lector.agregarCubos(consulta, SIN_GRANO))[0].entregas).toBe(10);
    // (2) el backfill recomputa el rango: las filas del rollup cambian
    origen.fijar(77);
    // (3) sin invalidar, se sigue sirviendo lo viejo
    expect((await lector.agregarCubos(consulta, SIN_GRANO))[0].entregas).toBe(10);

    // ... y el script encola la invalidacion, tal y como lo hace `scripts/backfill-analitica.ts`
    const cola = colaEnMemoria();
    await cola.enqueue(
      "analitica_invalidacion_cache",
      payloadInvalidacion("2026-07-20", "2026-07-22"),
      { dedupeKey: dedupeKeyInvalidacion("2026-07-20", "2026-07-22", AHORA) },
    );

    // (4) EL DRENADO REAL: `JobQueueService` con el handler de produccion registrado por tipo
    const handlers = new Map<JobTipo, JobHandler>([
      ["analitica_invalidacion_cache", crearAnaliticaInvalidacionCacheHandler(cache)],
    ]);
    const servicio = new JobQueueService(
      cola,
      handlers,
      new Map<JobTipo, RecurrenciaSpec>(),
      CONFIG_JOBS,
      () => AHORA,
    );
    const resultado = await servicio.drenar(10);
    expect(resultado).toMatchObject({ ok: 1 });

    // (5)
    expect(
      (await lector.agregarCubos(consulta, SIN_GRANO))[0].entregas,
      "la invalidacion NO llego: el backfill recomputo el rango y la consulta sigue sirviendo " +
        "las cifras anteriores.",
    ).toBe(77);
    expect(cache.invalidaciones.map((i) => i.origen)).toEqual(["backfill"]);
  });

  it("si la invalidacion lanza, el job NO se marca hecho: se cuenta como fallo (R11)", async () => {
    const cola = colaEnMemoria();
    await cola.enqueue("analitica_invalidacion_cache", payloadInvalidacion("2026-07-20", "2026-07-22"));
    const servicio = new JobQueueService(
      cola,
      new Map<JobTipo, JobHandler>([
        [
          "analitica_invalidacion_cache",
          crearAnaliticaInvalidacionCacheHandler(cacheQueFallaAlInvalidar()),
        ],
      ]),
      new Map<JobTipo, RecurrenciaSpec>(),
      CONFIG_JOBS,
      () => AHORA,
    );

    const resultado = await servicio.drenar(10);
    expect(resultado).toMatchObject({ ok: 0 });
    expect(cola.filas[0].estado).not.toBe("done");
  });
});
