import { pathToFileURL } from "node:url";
import type { IJobRepository, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import {
  dedupeKeyLiberar,
  proximaCorridaLiberarCR,
} from "@/lib/services/jobs/liberar-reprogramadas-handler";

// Feature 90 (R26) — seed inicial IDEMPOTENTE de la PRIMERA fila `liberar_reprogramadas`.
// Siembra la proxima corrida (proximo 00:00 CR) con su `dedupe_key` de dia CR; `enqueue`
// hace `ON CONFLICT DO NOTHING`, asi que re-ejecutarlo NO duplica (R26). Payload vacio `{}`
// (gate F1.4-3): el handler deriva la fecha de `now` al ejecutar. A partir de ahi la cola se
// auto-perpetua (la recurrencia re-agenda cada corrida, R23/R24). Recibe el repo por
// parametro para testear sin conexion real.
export async function seedJobLiberarReprogramadas(
  repo: IJobRepository,
  now: Date = new Date(),
): Promise<JobDTO | null> {
  const runAfter = proximaCorridaLiberarCR(now);
  return repo.enqueue(
    "liberar_reprogramadas",
    {},
    { runAfter, dedupeKey: dedupeKeyLiberar(runAfter) },
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
    const fila = await seedJobLiberarReprogramadas(new JobRepository(prisma));
    console.log(
      fila === null
        ? "Seed liberar_reprogramadas: la fila ya existia (idempotente, sin cambios)."
        : `Seed liberar_reprogramadas: fila sembrada (run_after=${fila.runAfter.toISOString()}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Solo auto-ejecuta cuando este archivo es el entrypoint (no cuando un test lo importa).
const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error("Fallo el seed de liberar_reprogramadas:", error);
    process.exit(1);
  });
}
