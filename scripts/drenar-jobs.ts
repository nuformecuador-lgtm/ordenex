// Drenado MANUAL y SELECTIVO de la cola `jobs` (tabla `jobs`, features 90/91/92/99/…).
//
// Uso:
//   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/drenar-jobs.ts --listar
//   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/drenar-jobs.ts --tipo=webhook_estado
//   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/drenar-jobs.ts --tipo=webhook_estado,geocodificacion --limite=5 --vueltas=1
//
// POR QUE EXISTE, si ya hay un cron. En produccion el drenado lo dispara Vercel Cron cada
// minuto contra `/api/cron/procesar-jobs`, que reclama el lote SIN mirar el tipo. En local
// eso es justo lo que no se quiere para probar UN tipo: un `claimBatch` sin filtro se lleva
// por delante los `optimizacion_ruta` y `geocodificacion` pendientes (cuota facturable de
// Google) y los `whatsapp_*` (mensajes REALES a numeros reales). Este script acota el claim
// a los tipos que se piden y deja el resto de la cola intacto.
//
// QUE NO REIMPLEMENTA: ni los handlers ni la politica de reintentos. Los handlers salen de
// `buildHandlers()` del propio route —asi un tipo nuevo queda cubierto sin tocar este
// archivo— y el ciclo claim -> handler -> complete/backoff/dead-letter es el
// `JobQueueService` real. Lo unico propio es el decorador del repo que filtra el claim.
//
// GUARDA DE HOST (patron de `rollup-analitica-manual.ts`): aborta si `DATABASE_URL` no
// apunta a `localhost:5432/ordenex`. Este script ejecuta EFECTOS EXTERNOS —POST firmados a
// callbacks de integradores, llamadas a Google, envios de WhatsApp—; correrlo por descuido
// contra produccion no es un incidente recuperable. `--host-remoto` lo permite a proposito.
import type {
  ClaimOpts,
  IJobRepository,
  JobDTO,
} from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler, RecurrenciaSpec } from "@/lib/interfaces/services/IJobQueueService";
import type { JobTipo } from "@prisma/client";
import { JobQueueService } from "@/lib/services/JobQueueService";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadJobsConfig } from "@/lib/config/jobs";
import { buildHandlers, buildRecurrencias } from "@/app/api/cron/procesar-jobs/route";

/* -------------------------------------------------------------------------- */
/* Argumentos                                                                  */
/* -------------------------------------------------------------------------- */

interface Opciones {
  tipos: string[];
  listar: boolean;
  limite: number | null;
  vueltas: number;
  seco: boolean;
  hostRemoto: boolean;
}

function parsearArgs(argv: string[]): Opciones {
  const opts: Opciones = {
    tipos: [],
    listar: false,
    limite: null,
    vueltas: 20,
    seco: false,
    hostRemoto: false,
  };
  for (const arg of argv) {
    if (arg === "--listar") opts.listar = true;
    else if (arg === "--seco" || arg === "--dry-run") opts.seco = true;
    else if (arg === "--host-remoto") opts.hostRemoto = true;
    else if (arg.startsWith("--tipo=") || arg.startsWith("--tipos=")) {
      opts.tipos = arg
        .slice(arg.indexOf("=") + 1)
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    } else if (arg.startsWith("--limite=")) {
      opts.limite = Number.parseInt(arg.slice("--limite=".length), 10);
    } else if (arg.startsWith("--vueltas=")) {
      opts.vueltas = Number.parseInt(arg.slice("--vueltas=".length), 10);
    } else {
      throw new Error(`argumento no reconocido: ${arg}`);
    }
  }
  return opts;
}

/* -------------------------------------------------------------------------- */
/* Guarda de host                                                              */
/* -------------------------------------------------------------------------- */

const HOST_LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);

function esBaseLocal(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return (
      HOST_LOCAL.has(url.hostname) &&
      url.port === "5432" &&
      url.pathname.replace(/^\//, "") === "ordenex"
    );
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Repo con el claim acotado por tipo                                          */
/* -------------------------------------------------------------------------- */

/** Fila cruda de `jobs` tal como la devuelve el `RETURNING j.*`. */
interface JobRow {
  id: string;
  tipo: JobTipo;
  payload: Record<string, unknown> | null;
  estado: JobDTO["estado"];
  intentos: number;
  max_intentos: number;
  run_after: Date;
  locked_at: Date | null;
  last_error: string | null;
  dedupe_key: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDTO(r: JobRow): JobDTO {
  return {
    id: r.id,
    tipo: r.tipo,
    payload: r.payload ?? {},
    estado: r.estado,
    intentos: Number(r.intentos),
    maxIntentos: Number(r.max_intentos),
    runAfter: r.run_after,
    lockedAt: r.locked_at,
    lastError: r.last_error,
    dedupeKey: r.dedupe_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Repositorio REAL con una sola diferencia: el `claimBatch` lleva `tipo = ANY(tipos)`. La
 * sentencia es, por lo demas, la MISMA que `JobRepository.claimBatch` (CTE + `FOR UPDATE
 * SKIP LOCKED` + `intentos + 1`), para que el comportamiento de reclamo, rescate por
 * visibility timeout y concurrencia sea identico al del cron.
 */
function repoFiltrado(
  prisma: ReturnType<typeof getPrismaClient>,
  tipos: string[],
): IJobRepository {
  const base = new JobRepository(prisma);
  return {
    enqueue: base.enqueue.bind(base),
    complete: base.complete.bind(base),
    fail: base.fail.bind(base),
    findByDedupeKeys: base.findByDedupeKeys.bind(base),
    async claimBatch(limit: number, opts: ClaimOpts): Promise<JobDTO[]> {
      const { now, visibilityCutoff } = opts;
      const rows = await prisma.$queryRaw<JobRow[]>`
        WITH candidatos AS (
          SELECT "id" FROM "jobs"
          WHERE "tipo"::text = ANY(${tipos})
            AND (
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
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Informe de la cola                                                          */
/* -------------------------------------------------------------------------- */

async function listar(prisma: ReturnType<typeof getPrismaClient>): Promise<void> {
  const filas = await prisma.$queryRaw<
    { tipo: string; estado: string; n: bigint; vencidos: bigint; proximo: Date | null }[]
  >`
    SELECT tipo::text AS tipo,
           estado::text AS estado,
           COUNT(*) AS n,
           COUNT(*) FILTER (WHERE estado = 'pending' AND run_after <= now()) AS vencidos,
           MIN(run_after) AS proximo
    FROM jobs GROUP BY 1, 2 ORDER BY 1, 2`;
  console.log("tipo                            estado       total  vencidos  proximo");
  console.log("-".repeat(84));
  for (const f of filas) {
    console.log(
      `${f.tipo.padEnd(31)} ${f.estado.padEnd(11)} ${String(f.n).padStart(5)} ${String(
        f.vencidos,
      ).padStart(9)}  ${f.proximo?.toISOString() ?? "-"}`,
    );
  }
  if (filas.length === 0) console.log("(cola vacia)");
}

/** Que se reclamaria con estos tipos, sin tocar nada (`--seco`). */
async function previsualizar(
  prisma: ReturnType<typeof getPrismaClient>,
  tipos: string[],
): Promise<void> {
  const filas = await prisma.$queryRaw<{ tipo: string; n: bigint }[]>`
    SELECT tipo::text AS tipo, COUNT(*) AS n
    FROM jobs
    WHERE tipo::text = ANY(${tipos}) AND estado = 'pending' AND run_after <= now()
    GROUP BY 1 ORDER BY 1`;
  console.log("\n[seco] se reclamarian (pendientes VENCIDOS):");
  if (filas.length === 0) console.log("  (ninguno)");
  for (const f of filas) console.log(`  ${f.tipo.padEnd(31)} ${String(f.n).padStart(5)}`);
  console.log("\n[seco] nada se ejecuto ni se modifico.");
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const opts = parsearArgs(process.argv.slice(2));

  if (!opts.hostRemoto && !esBaseLocal(process.env.DATABASE_URL)) {
    console.error(
      "ABORTADO: DATABASE_URL no apunta a localhost:5432/ordenex.\n" +
        "Este script ejecuta efectos externos reales (webhooks firmados, Google, WhatsApp).\n" +
        "Si de verdad quieres correrlo contra esa base, pasa --host-remoto.",
    );
    process.exitCode = 1;
    return;
  }

  const prisma = getPrismaClient();
  try {
    if (opts.listar || opts.tipos.length === 0) {
      await listar(prisma);
      if (opts.tipos.length === 0 && !opts.listar) {
        console.log("\nFalta --tipo=<a,b>. Tipos disponibles: los de la columna `tipo` de arriba.");
      }
      if (!opts.listar || opts.tipos.length === 0) return;
    }

    const now = () => new Date();
    // Handlers REALES del cron: un tipo nuevo registrado alli queda cubierto aqui solo.
    const todos = buildHandlers(now);
    const desconocidos = opts.tipos.filter((t) => !todos.has(t as JobTipo));
    if (desconocidos.length > 0) {
      console.error(
        `Tipo(s) sin handler registrado: ${desconocidos.join(", ")}\n` +
          `Registrados: ${[...todos.keys()].join(", ")}`,
      );
      process.exitCode = 1;
      return;
    }

    if (opts.seco) {
      await previsualizar(prisma, opts.tipos);
      return;
    }

    const handlers = new Map<JobTipo, JobHandler>(
      opts.tipos.map((t) => [t as JobTipo, todos.get(t as JobTipo)!]),
    );
    // Solo la recurrencia de los tipos pedidos: re-agendar la de un tipo que no se esta
    // drenando seria escribir en la cola por la puerta de atras.
    const recurrenciasTodas = buildRecurrencias();
    const recurrencias = new Map<JobTipo, RecurrenciaSpec>(
      opts.tipos
        .filter((t) => recurrenciasTodas.has(t as JobTipo))
        .map((t) => [t as JobTipo, recurrenciasTodas.get(t as JobTipo)!]),
    );

    const config = loadJobsConfig();
    const lote = opts.limite ?? config.JOBS_BATCH_SIZE;
    const service = new JobQueueService(
      repoFiltrado(prisma, opts.tipos),
      handlers,
      recurrencias,
      config,
      now,
    );

    console.log(`Drenando ${opts.tipos.join(", ")} — lote ${lote}, max ${opts.vueltas} vueltas\n`);
    const total = { procesados: 0, ok: 0, fallidos: 0, reintentados: 0, muertos: 0 };
    for (let vuelta = 1; vuelta <= opts.vueltas; vuelta += 1) {
      const r = await service.drenar(lote);
      console.log(`vuelta ${String(vuelta).padStart(2)}:`, r);
      total.procesados += r.procesados;
      total.ok += r.ok;
      total.fallidos += r.fallidos;
      total.reintentados += r.reintentados;
      total.muertos += r.muertos;
      // Cero reclamados = no queda nada VENCIDO; lo reintentado se fue al futuro por backoff.
      if (r.procesados === 0) break;
    }
    console.log("\nTOTAL:", total);

    const resumen = await prisma.$queryRaw<{ tipo: string; estado: string; n: bigint }[]>`
      SELECT tipo::text AS tipo, estado::text AS estado, COUNT(*) AS n
      FROM jobs WHERE tipo::text = ANY(${opts.tipos}) GROUP BY 1, 2 ORDER BY 1, 2`;
    console.log("\nestado final de la cola para esos tipos:");
    for (const r of resumen) {
      console.log(`  ${r.tipo.padEnd(31)} ${r.estado.padEnd(11)} ${String(r.n).padStart(5)}`);
    }

    const errores = await prisma.$queryRaw<{ last_error: string; n: bigint }[]>`
      SELECT left(last_error, 200) AS last_error, COUNT(*) AS n
      FROM jobs
      WHERE tipo::text = ANY(${opts.tipos}) AND last_error IS NOT NULL AND last_error <> ''
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10`;
    if (errores.length > 0) {
      console.log("\nerrores mas frecuentes (`last_error`):");
      for (const e of errores) console.log(`  [${String(e.n).padStart(3)}] ${e.last_error}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
