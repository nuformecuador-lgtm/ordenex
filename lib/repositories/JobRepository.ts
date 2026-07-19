import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { JobEstado, JobTipo } from "@prisma/client";
import type {
  ClaimOpts,
  EnqueueOpts,
  IJobRepository,
  JobDTO,
  JobTxClient,
} from "@/lib/interfaces/repositories/IJobRepository";
import { loadJobsConfig } from "@/lib/config/jobs";

// Cliente Prisma minimo consumido (patron `ApiKeyRepository`): CRUD via `$queryRaw`
// (ON CONFLICT / claim atomico exigen SQL crudo) mas `$executeRaw` para complete/fail.
type JobPrismaClient = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

// Fila cruda tal cual la devuelve `$queryRaw` (columnas snake_case). `payload` llega ya
// deserializado (Prisma mapea jsonb a valor JS). Los enteros de Postgres (`intentos`,
// `max_intentos`) pueden llegar como number o bigint segun el driver: se normalizan.
interface JobRow {
  id: string;
  tipo: JobTipo;
  payload: unknown;
  estado: JobEstado;
  intentos: number | bigint;
  max_intentos: number | bigint;
  run_after: Date;
  locked_at: Date | null;
  last_error: string | null;
  dedupe_key: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDTO(row: JobRow): JobDTO {
  return {
    id: row.id,
    tipo: row.tipo,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    estado: row.estado,
    intentos: Number(row.intentos),
    maxIntentos: Number(row.max_intentos),
    runAfter: row.run_after,
    lockedAt: row.locked_at,
    lastError: row.last_error,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Feature 90 (design §3) — repositorio de la cola de jobs. Solo queries: el backoff, la
 * decision terminal (dead-letter) y la recurrencia viven en `JobQueueService`. El claim es
 * una unica sentencia atomica con `FOR UPDATE SKIP LOCKED` (§3.1). Devuelve DTOs planos.
 */
export class JobRepository implements IJobRepository {
  constructor(private readonly prisma: JobPrismaClient) {}

  async enqueue(
    tipo: JobTipo,
    payload: Record<string, unknown>,
    opts: EnqueueOpts = {},
    tx?: JobTxClient,
  ): Promise<JobDTO | null> {
    // R9: si viene un `tx` externo (transactional-outbox de 91/92), la insercion va DENTRO
    // de esa transaccion; si no, sobre el cliente propio. Ambos exponen `$queryRaw`.
    const client: JobTxClient = tx ?? (this.prisma as unknown as JobTxClient);
    const id = randomUUID();
    // Gate F1.4-2: `max_intentos` por-fila, default desde config con override por tipo.
    const maxIntentos = opts.maxIntentos ?? loadJobsConfig().JOBS_MAX_ATTEMPTS;
    const runAfter = opts.runAfter ?? new Date();
    const dedupeKey = opts.dedupeKey ?? null;
    const payloadJson = JSON.stringify(payload ?? {});

    // R7: fila `pending`, `intentos = 0`. R8: `ON CONFLICT ("dedupe_key") ... DO NOTHING`
    // apunta al indice UNICO PARCIAL (por eso el `WHERE "dedupe_key" IS NOT NULL`); un
    // `dedupe_key` repetido no crea fila y no falla. `RETURNING *` -> null si se omitio.
    const rows = await client.$queryRaw<JobRow[]>`
      INSERT INTO "jobs" (
        "id", "tipo", "payload", "estado", "intentos", "max_intentos",
        "run_after", "dedupe_key", "created_at", "updated_at"
      )
      VALUES (
        ${id}, ${tipo}::"job_tipo", ${payloadJson}::jsonb, 'pending', 0, ${maxIntentos},
        ${runAfter}, ${dedupeKey}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("dedupe_key") WHERE "dedupe_key" IS NOT NULL DO NOTHING
      RETURNING *`;
    return rows.length > 0 ? toDTO(rows[0]) : null;
  }

  async claimBatch(limit: number, opts: ClaimOpts): Promise<JobDTO[]> {
    const { now, visibilityCutoff } = opts;
    // R10-R13: una sola sentencia atomica. La CTE `candidatos` selecciona pendientes
    // vencidos (`run_after <= now`, R7/R12) O `processing` colgados (`locked_at <` cutoff,
    // R13), los BLOQUEA con `FOR UPDATE SKIP LOCKED` (R10/R11: dos workers nunca toman la
    // misma fila, sin espera) y el UPDATE los marca `processing`, sella `locked_at` e
    // incrementa `intentos`. `now`/`visibilityCutoff` INYECTADOS (no `NOW()` de Postgres)
    // para tests deterministas (design alternativa F descartada).
    const rows = await this.prisma.$queryRaw<JobRow[]>`
      WITH candidatos AS (
        SELECT "id" FROM "jobs"
        WHERE (
          ("estado" = 'pending'    AND "run_after" <= ${now})
          OR
          ("estado" = 'processing' AND "locked_at" < ${visibilityCutoff})
        )
        ORDER BY "run_after" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "jobs" AS j
      SET "estado" = 'processing',
          "locked_at" = ${now},
          "intentos" = j."intentos" + 1,
          "updated_at" = ${now}
      FROM candidatos c
      WHERE j."id" = c."id"
      RETURNING j.*`;
    return rows.map(toDTO);
  }

  async complete(id: string): Promise<void> {
    // R14: exito -> `done`. `updated_at` a mano (el raw no dispara el @updatedAt de Prisma).
    await this.prisma.$executeRaw`
      UPDATE "jobs"
      SET "estado" = 'done', "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}`;
  }

  async fail(id: string, error: string, runAfter: Date | null): Promise<void> {
    if (runAfter !== null) {
      // R15: aun quedan intentos -> re-agenda pendiente con el `run_after` del backoff.
      await this.prisma.$executeRaw`
        UPDATE "jobs"
        SET "estado" = 'pending',
            "run_after" = ${runAfter},
            "last_error" = ${error},
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${id}`;
    } else {
      // R16: intentos agotados -> dead-letter `failed`, sin re-agendar.
      await this.prisma.$executeRaw`
        UPDATE "jobs"
        SET "estado" = 'failed',
            "last_error" = ${error},
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${id}`;
    }
  }
}
