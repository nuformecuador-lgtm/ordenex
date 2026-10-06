import { pathToFileURL } from "node:url";
import type { IJobRepository, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import {
  dedupeKeyMantenimiento,
  proximaCorridaMantenimiento,
} from "@/lib/services/jobs/whatsapp-envio-mantenimiento-handler";

// Ficha 474 (design §1.6) — siembra IDEMPOTENTE de la PRIMERA fila `whatsapp_envio_mantenimiento`
// (proxima 03:30 CR = 09:30 UTC). La MISMA fila la siembra la migracion
// `20261005120200_seed_whatsapp_envio_mantenimiento` con la MISMA `dedupe_key`: las dos vias
// coinciden y `enqueue` hace `ON CONFLICT DO NOTHING`, asi que correr las dos no duplica. Esta va
// registrada en `SIEMBRAS_RECURRENTES` para que `scripts/migrate-deploy.ts` la re-siembre en cada
// despliegue si alguien recrea la base (la red de la ficha 313).
export async function seedJobWhatsappEnvioMantenimiento(
  repo: IJobRepository,
  now: Date = new Date(),
): Promise<JobDTO | null> {
  const runAfter = proximaCorridaMantenimiento(now);
  return repo.enqueue("whatsapp_envio_mantenimiento", {}, {
    runAfter,
    dedupeKey: dedupeKeyMantenimiento(runAfter),
    maxIntentos: 3,
  });
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // sin .env: se usan las variables ya presentes en process.env
  }
  const prisma = getPrismaClient();
  try {
    const fila = await seedJobWhatsappEnvioMantenimiento(new JobRepository(prisma));
    console.log(
      fila === null
        ? "Seed whatsapp_envio_mantenimiento: la fila ya existia (idempotente, sin cambios)."
        : `Seed whatsapp_envio_mantenimiento: fila sembrada (run_after=${fila.runAfter.toISOString()}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error("Fallo el seed de whatsapp_envio_mantenimiento:", error);
    process.exit(1);
  });
}
