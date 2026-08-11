import { describe, it, expect } from "vitest";
import type { JobTipo } from "@prisma/client";
import type {
  ClaimOpts,
  EnqueueOpts,
  IJobRepository,
  JobDTO,
} from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler, RecurrenciaSpec } from "@/lib/interfaces/services/IJobQueueService";
import { TAGS_FINANCIERA, TAGS_OPERATIVA } from "@/lib/analytics/cache-tags";
import { crearAnaliticaInvalidacionCacheHandler } from "@/lib/services/jobs/analitica-invalidacion-cache-handler";
import {
  dedupeKeyInvalidacion,
  dedupeKeyInvalidacionSinRango,
  payloadInvalidacion,
  payloadInvalidacionDeDominio,
} from "@/lib/services/jobs/analitica-invalidacion-encolado";
import { JobQueueService } from "@/lib/services/JobQueueService";
import { cacheFalsa, cacheQueFallaAlInvalidar } from "./_cache-falsa";
import { libroFinanciero } from "./_libro-financiero";

// Feature 179 / T3.9 + T3.8 — R27: EL CAMINO COMPLETO DEL OCTAVO ESCRITOR.
//
//   backfill de tesoreria -> job encolado -> DRENADO REAL -> la consulta financiera cambia
//
// El paso 4 es `JobQueueService.drenar` con el handler de produccion registrado por tipo,
// exactamente como lo hace el cron `* * * * *`. No se espia `enqueue`: eso probaria que alguien
// escribio una linea, no que la cifra servida cambie.
//
// ⚠ Y AQUI R11 DE LA 128 SIGUE APLICANDO TAL CUAL, al contrario que en los siete escritores en
// request. La desviacion de D4 —no propagar el fallo de invalidacion— vale SOLO donde el
// llamador es una Server Action sobre dinero ya confirmado. Aqui el llamador vuelve a ser un JOB
// idempotente con backoff y dead-letter, donde fallar es exactamente lo correcto porque el
// reintento es gratis y no lo ve nadie. El ultimo bloque lo mide.

const AHORA = new Date("2026-08-10T18:30:00.000Z");

const CONFIG_JOBS = {
  JOBS_BATCH_SIZE: 10,
  JOBS_MAX_ATTEMPTS: 5,
  JOBS_VISIBILITY_TIMEOUT_MS: 60_000,
  JOBS_BACKOFF_BASE_MS: 1000,
} as unknown as ConstructorParameters<typeof JobQueueService>[3];

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

function drenador(cache: Parameters<typeof crearAnaliticaInvalidacionCacheHandler>[0], cola: IJobRepository) {
  return new JobQueueService(
    cola,
    new Map<JobTipo, JobHandler>([
      ["analitica_invalidacion_cache", crearAnaliticaInvalidacionCacheHandler(cache)],
    ]),
    new Map<JobTipo, RecurrenciaSpec>(),
    CONFIG_JOBS,
    () => AHORA,
  );
}

describe("R27 · tras drenar el job del backfill de tesoreria, la consulta financiera sirve las cifras nuevas", () => {
  it("los cinco pasos, con el drenador real en el paso 4", async () => {
    const libro = libroFinanciero();

    // (1) el tablero cachea la cifra de hoy
    libro.moverAlMargen("1000.00");
    expect(await libro.consultar()).toBe("1000.00");

    // (2) el backfill de tesoreria escribe las filas de caja que faltaban
    libro.moverAlMargen("4500.00");
    // (3) y el tablero sigue sirviendo lo cacheado: el script NO puede llamar a `revalidateTag`
    expect(await libro.consultar()).toBe("1000.00");

    // ... asi que ENCOLA, tal y como lo hace `scripts/backfill-caja-tesoreria.ts`
    const cola = colaEnMemoria();
    await cola.enqueue(
      "analitica_invalidacion_cache",
      payloadInvalidacionDeDominio("financiera"),
      { dedupeKey: dedupeKeyInvalidacionSinRango("financiera", AHORA) },
    );

    // (4) EL DRENADO REAL, con el handler de produccion registrado por tipo
    const resultado = await drenador(libro.cache, cola).drenar(10);
    expect(resultado).toMatchObject({ ok: 1 });

    // (5)
    expect(
      await libro.consultar(),
      "la invalidacion NO llego: el backfill de tesoreria inserto filas de caja y la consulta " +
        "financiera sigue sirviendo las cifras anteriores.",
    ).toBe("5500.00");
    expect(libro.cache.invalidaciones.map((i) => i.origen)).toEqual(["job_backfill_tesoreria"]);
  });
});

describe("R27 · la COMPATIBILIDAD HACIA ATRAS es un requisito, no una cortesia", () => {
  it("un job SIN `dominio` —los que la 128 ya encola— sigue invalidando la OPERATIVA", async () => {
    const cache = cacheFalsa();
    const cola = colaEnMemoria();

    // Exactamente el payload de `scripts/backfill-analitica.ts`: `{ desde, hasta }`, sin dominio.
    await cola.enqueue("analitica_invalidacion_cache", payloadInvalidacion("2026-07-20", "2026-07-22"));
    await drenador(cache, cola).drenar(10);

    // Sin el default explicito, esos jobs dejarian de invalidar y NADA fallaria: la cifra
    // recomputada se quedaria invisible hasta el TTL. Su testigo formal es
    // `cache-invalidacion-backfill.test.ts` de la 128, que NO se ha modificado.
    expect(cache.invalidaciones).toEqual([{ origen: "backfill", tags: [...TAGS_OPERATIVA] }]);
  });

  it("y un `dominio` desconocido cae al default en vez de dejar el job en dead-letter", async () => {
    const cache = cacheFalsa();
    const cola = colaEnMemoria();

    await cola.enqueue("analitica_invalidacion_cache", { dominio: "ventas" });
    const r = await drenador(cache, cola).drenar(10);

    expect(r).toMatchObject({ ok: 1 });
    expect(cache.invalidaciones.map((i) => i.origen)).toEqual(["backfill"]);
  });

  it("cada dominio invalida SU tag y ninguno el del otro", async () => {
    const cache = cacheFalsa();
    const cola = colaEnMemoria();

    await cola.enqueue("analitica_invalidacion_cache", payloadInvalidacionDeDominio("financiera"));
    await drenador(cache, cola).drenar(10);

    expect(cache.invalidaciones).toEqual([
      { origen: "job_backfill_tesoreria", tags: [...TAGS_FINANCIERA] },
    ]);
    expect(TAGS_FINANCIERA[0]).not.toBe(TAGS_OPERATIVA[0]);
  });

  it("las claves de los dos dominios en el MISMO instante no se deduplican entre si", async () => {
    const cola = colaEnMemoria();
    // La clave del backfill de tesoreria (sin rango, con dominio) frente a la que la 128 emite
    // desde `scripts/backfill-analitica.ts` (con rango). La separacion es ESTRUCTURAL: donde una
    // lleva `financiera:sin-rango`, la otra lleva `2026-07-20..2026-07-22`.
    const financiera = dedupeKeyInvalidacionSinRango("financiera", AHORA);
    const operativa = dedupeKeyInvalidacion("2026-07-20", "2026-07-22", AHORA);

    expect(financiera).not.toBe(operativa);
    expect(financiera).toContain("financiera");
    await cola.enqueue("analitica_invalidacion_cache", payloadInvalidacionDeDominio("financiera"), {
      dedupeKey: financiera,
    });
    await cola.enqueue("analitica_invalidacion_cache", payloadInvalidacion("2026-07-20", "2026-07-22"), {
      dedupeKey: operativa,
    });

    // `ON CONFLICT (dedupe_key) DO NOTHING`: si la clave no distinguiera el dominio, aqui
    // quedaria UNA fila y una de las dos invalidaciones desapareceria en silencio.
    expect(cola.filas).toHaveLength(2);
  });
});

describe("R11 de la 128 · aqui el llamador vuelve a ser un job, y una invalidacion fallida DEBE fallar", () => {
  it("el job no se marca hecho: `JobQueueService` lo reintenta con backoff", async () => {
    const cola = colaEnMemoria();
    await cola.enqueue("analitica_invalidacion_cache", payloadInvalidacionDeDominio("financiera"));

    const r = await drenador(cacheQueFallaAlInvalidar(), cola).drenar(10);

    // Si alguien aplicara aqui la desviacion de D4 —no propagar— perderia el reintento con
    // backoff que la cola regala, y la cache financiera se quedaria vieja sin senal.
    expect(r).toMatchObject({ ok: 0 });
    expect(cola.filas[0].estado).not.toBe("done");
  });
});
