// Feature 90 (design §3) — contrato del repositorio de la cola de jobs. Solo queries
// Prisma (docs/architecture.md): sin logica de negocio (el backoff, la decision terminal y
// la recurrencia viven en `JobQueueService`). La interfaz NO expone `PrismaClient`.
import type { JobEstado, JobTipo } from "@prisma/client";

/**
 * DTO plano de un job (nunca la entidad Prisma cruda). `payload` se tipa como
 * `Record<string, unknown>` (JSONB); el handler de cada tipo lo interpreta.
 */
export interface JobDTO {
  id: string;
  tipo: JobTipo;
  payload: Record<string, unknown>;
  estado: JobEstado;
  intentos: number;
  maxIntentos: number;
  runAfter: Date;
  lockedAt: Date | null;
  lastError: string | null;
  dedupeKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Opciones del encolado (R7/R8). Todo opcional: `enqueue` rellena los defaults. */
export interface EnqueueOpts {
  /** Cuando puede reclamarse el job. Default `now()` de la DB (encolado inmediato). */
  runAfter?: Date;
  /** `max_intentos` por-fila (override por tipo, gate F1.4-2). Default `JOBS_MAX_ATTEMPTS`. */
  maxIntentos?: number;
  /** Clave de idempotencia; si ya existe una fila con ella, el insert se omite (R8). */
  dedupeKey?: string;
}

/** Reloj/umbrales inyectados al claim para tests deterministas (R12/R13). */
export interface ClaimOpts {
  /** Momento de la corrida. Filtra `pending` vencidos (`run_after <= now`) y sella `locked_at`. */
  now: Date;
  /** `now - JOBS_VISIBILITY_TIMEOUT_MS`: `processing` con `locked_at` mas antiguo se rescata. */
  visibilityCutoff: Date;
}

/**
 * Cliente Prisma minimo consumido por el repo (patron `ApiKeyRepository`). Incluye
 * `$queryRawUnsafe`/`$executeRaw` para el claim atomico y `job` para el CRUD sencillo.
 */
export interface IJobRepository {
  /**
   * R7/R8/R9: inserta una fila `pending` (`intentos = 0`, `run_after` = `opts.runAfter ??
   * now()`). Con `ON CONFLICT ("dedupe_key") DO NOTHING`: si la `dedupeKey` ya existe, NO
   * crea fila y NO falla (idempotencia). Si se pasa `tx`, ejecuta la insercion dentro de esa
   * transaccion externa (soporte transactional-outbox para 91/92), sin abrir una propia.
   * Devuelve el `JobDTO` insertado, o `null` si el conflicto lo omitio.
   */
  enqueue(
    tipo: JobTipo,
    payload: Record<string, unknown>,
    opts?: EnqueueOpts,
    tx?: JobTxClient,
  ): Promise<JobDTO | null>;

  /**
   * R10-R13: reclama atomicamente hasta `limit` jobs candidatos con `FOR UPDATE SKIP
   * LOCKED` (pendientes vencidos O `processing` colgados por visibility timeout), marcandolos
   * `processing`, sellando `locked_at = now` e incrementando `intentos`. Devuelve exactamente
   * las filas reclamadas. Dos workers concurrentes nunca reciben la misma fila (SKIP LOCKED).
   */
  claimBatch(limit: number, opts: ClaimOpts): Promise<JobDTO[]>;

  /** R14: marca el job `done`. */
  complete(id: string): Promise<void>;

  /**
   * R15/R16: persiste el desenlace de un fallo. Si `runAfter` NO es null -> re-agenda
   * (`estado = 'pending'`, `run_after = runAfter`, `last_error = error`). Si `runAfter` es
   * null -> dead-letter (`estado = 'failed'`, `last_error = error`). La DECISION (backoff vs
   * terminal) la toma el service; el repo solo persiste.
   */
  fail(id: string, error: string, runAfter: Date | null): Promise<void>;
}

/**
 * Cliente transaccional aceptado por `enqueue(..., tx)`: el `tx` que Prisma pasa al
 * callback de `$transaction`. Se tipa por lo que el repo usa (`$executeRaw`/`$queryRaw`),
 * evitando acoplar la interfaz a `PrismaClient` completo.
 */
export type JobTxClient = {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
};
