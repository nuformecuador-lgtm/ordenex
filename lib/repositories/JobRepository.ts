import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
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
    const lastError = opts.lastError ?? null;
    const payloadJson = JSON.stringify(payload ?? {});

    // R7: fila `pending`, `intentos = 0`. R8: `ON CONFLICT ("dedupe_key") ... DO NOTHING`
    // apunta al indice UNICO PARCIAL (por eso el `WHERE "dedupe_key" IS NOT NULL`); un
    // `dedupe_key` repetido no crea fila y no falla. `RETURNING *` -> null si se omitio.
    // `last_error` inicial (opcional): motivo del fallo sincrono que motivo el encolado.
    const rows = await client.$queryRaw<JobRow[]>`
      INSERT INTO "jobs" (
        "id", "tipo", "payload", "estado", "intentos", "max_intentos",
        "run_after", "dedupe_key", "last_error", "created_at", "updated_at"
      )
      VALUES (
        ${id}, ${tipo}::"job_tipo", ${payloadJson}::jsonb, 'pending', 0, ${maxIntentos},
        ${runAfter}, ${dedupeKey}, ${lastError}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("dedupe_key") WHERE "dedupe_key" IS NOT NULL DO NOTHING
      RETURNING *`;
    return rows.length > 0 ? toDTO(rows[0]) : null;
  }

  async claimBatch(limit: number, opts: ClaimOpts): Promise<JobDTO[]> {
    const { now, visibilityCutoff } = opts;
    // R10-R13 (feature 90, design §3.1) + REPARTO POR TURNOS (feature 402, design §1).
    //
    // UNA sola sentencia atomica, como siempre (402/R7: ni una consulta ni una transaccion
    // mas por corrida). Lo que cambia respecto de la 90 es SOLO la regla de seleccion:
    //
    //  · `candidatos` — mismo `WHERE` de siempre (pendientes vencidos `run_after <= now`,
    //    R7/R12, O `processing` colgados `locked_at <` cutoff, R13) y ademas numera cada
    //    candidato POR SU TIPO: `ROW_NUMBER() OVER (PARTITION BY tipo ORDER BY run_after)`.
    //    El mas antiguo de cada tipo es su turno 1. Generico sobre la columna (402/R9): un
    //    tipo nuevo del enum entra solo, sin tocar este archivo.
    //  · `priorizados` — `ORDER BY turno, run_after LIMIT $limit`: el turno 1 de TODOS los
    //    tipos presentes antes que el turno 2 de ninguno. Con un solo tipo activo el lote
    //    entero sigue siendo suyo (402/R2), y los turnos que un tipo con pocos candidatos
    //    no puede llenar los ocupa el mayoritario (402/R3).
    //  · `bloqueados` — aqui, y solo aqui, se BLOQUEA: `FOR UPDATE OF j SKIP LOCKED`
    //    (R10/R11: dos workers nunca toman la misma fila, sin espera). `OF j` porque hay
    //    JOIN con una CTE y hay que decir cual es la fila a bloquear.
    //
    // POR QUE TRES CTEs Y NO UNA: Postgres prohibe `FOR UPDATE` junto a funciones de ventana
    // en la MISMA `SELECT` ("FOR UPDATE is not allowed with window functions"). El turno se
    // calcula sin bloqueo, se recorta a `$limit`, y el bloqueo se aplica al final sobre ese
    // conjunto ya fijado. Colapsarlas revienta en tiempo de ejecucion.
    //
    // POR QUE EL `WHERE` SE REPITE EN `bloqueados`, que no esta en design.md §1: sostiene la
    // exclusion mutua cuando otro worker COMMITEA entre el snapshot de esta sentencia y el
    // bloqueo. En ese caso Postgres reevalua (EvalPlanQual) las condiciones sobre la version
    // NUEVA de la fila; si la unica condicion fuera el JOIN por id, la fila que el otro
    // worker acaba de reclamar volveria a pasar y se entregaria DOS VECES. Con el predicado
    // repetido, la fila ya `processing` con `locked_at` reciente no lo cumple y se descarta,
    // que es exactamente lo que hacia el `FOR UPDATE` de la 90 al vivir dentro del `WHERE`.
    //
    // `now`/`visibilityCutoff` siguen INYECTADOS (nunca `NOW()` de Postgres) para tests
    // deterministas (design alternativa F de la 90, descartada).
    const rows = await this.prisma.$queryRaw<JobRow[]>`
      WITH candidatos AS (
        SELECT "id", "run_after",
               ROW_NUMBER() OVER (PARTITION BY "tipo" ORDER BY "run_after" ASC) AS "turno"
        FROM "jobs"
        WHERE (
          ("estado" = 'pending'    AND "run_after" <= ${now})
          OR
          ("estado" = 'processing' AND "locked_at" < ${visibilityCutoff})
        )
      ),
      priorizados AS (
        SELECT "id" FROM candidatos
        ORDER BY "turno" ASC, "run_after" ASC
        LIMIT ${limit}
      ),
      bloqueados AS (
        SELECT j."id" FROM "jobs" j
        JOIN priorizados p ON p."id" = j."id"
        WHERE (
          (j."estado" = 'pending'    AND j."run_after" <= ${now})
          OR
          (j."estado" = 'processing' AND j."locked_at" < ${visibilityCutoff})
        )
        ORDER BY j."run_after" ASC
        FOR UPDATE OF j SKIP LOCKED
      )
      UPDATE "jobs" AS j
      SET "estado" = 'processing',
          "locked_at" = ${now},
          "intentos" = j."intentos" + 1,
          "updated_at" = ${now}
      FROM bloqueados b
      WHERE j."id" = b."id"
      RETURNING j.*`;
    return rows.map(toDTO);
  }

  /**
   * Feature 92 (design §8, R4): lectura pura por igualdad sobre `dedupe_key`. UNA consulta
   * por lote, apoyada en el indice unico YA existente. `keys` vacio -> `[]` sin tocar la
   * DB (`IN ()` no es SQL valido y, ademas, seria una consulta inutil).
   *
   * NO es busqueda por prefijo: el motivo completo esta en `IJobRepository.findByDedupeKeys`.
   */
  async findByDedupeKeys(keys: string[]): Promise<JobDTO[]> {
    if (keys.length === 0) return [];
    const rows = await this.prisma.$queryRaw<JobRow[]>`
      SELECT * FROM "jobs" WHERE "dedupe_key" IN (${Prisma.join(keys)})`;
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
