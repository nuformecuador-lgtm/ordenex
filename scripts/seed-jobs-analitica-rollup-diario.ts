import { pathToFileURL } from "node:url";
import type { IJobRepository, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { proximaCorridaRollupCR } from "@/lib/services/jobs/analitica-rollup-diario-handler";
import { dedupeKeyRollup } from "@/lib/services/jobs/analitica-rollup-diario-encolado";
import { fechaObjetivo } from "@/lib/analytics/rollup-dia";

// Feature 124 (D4->C1, R36) — seed inicial IDEMPOTENTE de la PRIMERA fila
// `analitica_rollup_diario`. Siembra la proxima corrida (proximas 00:30 CR = 06:30 UTC) con
// el `dedupe_key` de la FECHA QUE ESA CORRIDA AGREGARA (D-1 respecto de la corrida, no la
// fecha de la corrida). `enqueue` hace `ON CONFLICT DO NOTHING`, asi que re-ejecutarlo NO
// duplica. Payload vacio `{}`: el handler deriva la fecha objetivo de `now` al ejecutar. A
// partir de ahi la cola se auto-perpetua (la recurrencia re-agenda cada corrida). Recibe el
// repo por parametro para testear sin conexion real.
//
// Este script NO nombra la tabla del rollup ni la consulta de ninguna forma: solo encola.
export async function seedJobAnaliticaRollupDiario(
  repo: IJobRepository,
  now: Date = new Date(),
): Promise<JobDTO | null> {
  const runAfter = proximaCorridaRollupCR(now);
  return repo.enqueue(
    "analitica_rollup_diario",
    {},
    { runAfter, dedupeKey: dedupeKeyRollup(fechaObjetivo(runAfter)) },
  );
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // sin .env: se usan las variables ya presentes en process.env
  }

  const prisma = getPrismaClient();
  try {
    const fila = await seedJobAnaliticaRollupDiario(new JobRepository(prisma));
    console.log(
      fila === null
        ? "Seed analitica_rollup_diario: la fila ya existia (idempotente, sin cambios)."
        : `Seed analitica_rollup_diario: fila sembrada (run_after=${fila.runAfter.toISOString()}, dedupe_key=${fila.dedupeKey ?? "-"}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Solo auto-ejecuta cuando este archivo es el entrypoint (no cuando un test lo importa).
const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error("Fallo el seed de analitica_rollup_diario:", error);
    process.exit(1);
  });
}
