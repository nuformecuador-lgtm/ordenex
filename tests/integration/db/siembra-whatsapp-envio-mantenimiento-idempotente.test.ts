import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, afterAll } from "vitest";
import type { JobTipo, PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";
import { JobRepository } from "@/lib/repositories/JobRepository";
import type { EnqueueOpts, IJobRepository, JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";
import { seedJobWhatsappEnvioMantenimiento } from "@/scripts/seed-jobs-whatsapp-envio-mantenimiento";
import { recurrenciaWhatsappEnvioMantenimiento } from "@/lib/services/jobs/whatsapp-envio-mantenimiento-handler";

// FICHA 474 (T1.3, design §1.6) — la siembra del mantenimiento diario es IDEMPOTENTE, y las TRES
// vias que la producen (la migracion, el script de `migrate-deploy` y la recurrencia de la cola)
// usan la MISMA `dedupe_key`. Medido CONTANDO FILAS contra Postgres (patron de la ficha 313).
// Todo dentro de una transaccion revertida.

const TIPO: JobTipo = "whatsapp_envio_mantenimiento";
const MIGRACION = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "db",
  "migrations",
  "20261005120200_seed_whatsapp_envio_mantenimiento",
  "migration.sql",
);

const PRIMER_INSTANTE = new Date("2026-08-02T16:00:00.000Z"); // proxima corrida: 2026-08-03 09:30 UTC
const SEGUNDO_INSTANTE = new Date("2026-08-03T02:00:00.000Z"); // misma proxima corrida

const describeDb = HAY_BASE_DE_DATOS ? describe : describe.skip;
let prisma: PrismaClient | null = null;
function prismaDeTest(): PrismaClient {
  prisma ??= crearPrismaDeTest();
  return prisma;
}
afterAll(async () => {
  await prisma?.$disconnect();
});

async function contarJobs(tx: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }): Promise<number> {
  const filas = (await tx.$queryRaw`SELECT count(*)::int AS n FROM "jobs" WHERE "tipo" = 'whatsapp_envio_mantenimiento'`) as {
    n: number;
  }[];
  return filas[0].n;
}

function repoEnTx(tx: unknown): IJobRepository {
  const real = new JobRepository(prismaDeTest());
  return {
    enqueue: (tipo: JobTipo, payload: Record<string, unknown>, opts?: EnqueueOpts) =>
      real.enqueue(tipo, payload, opts, tx as JobTxClient),
  } as unknown as IJobRepository;
}

describeDb("474 · la siembra del mantenimiento no duplica", () => {
  it("dos siembras de la misma corrida y el reencolado de la recurrencia dejan UNA fila", async () => {
    const r = await enTransaccionRevertida(prismaDeTest(), async (tx) => {
      const repo = repoEnTx(tx);
      const antes = await contarJobs(tx);
      const primera = await seedJobWhatsappEnvioMantenimiento(repo, PRIMER_INSTANTE);
      const trasPrimera = await contarJobs(tx);
      const segunda = await seedJobWhatsappEnvioMantenimiento(repo, SEGUNDO_INSTANTE);
      const { runAfter, dedupeKey } = recurrenciaWhatsappEnvioMantenimiento.siguiente(PRIMER_INSTANTE);
      const reencolada = await repo.enqueue(TIPO, {}, { runAfter, dedupeKey });
      const trasTodo = await contarJobs(tx);
      return { antes, trasPrimera, trasTodo, primera, segunda, reencolada };
    });
    expect(r.trasPrimera).toBe(r.antes + 1);
    expect(r.primera?.dedupeKey).toBe("whatsapp_envio_mantenimiento:2026-08-03");
    expect(r.primera?.runAfter.toISOString()).toBe("2026-08-03T09:30:00.000Z");
    expect(r.segunda).toBeNull();
    expect(r.reencolada).toBeNull();
    expect(r.trasTodo).toBe(r.antes + 1);
  });

  it("⭑ la MIGRACION y el script siembran la MISMA fila (misma clave): juntos, una sola", async () => {
    const sql = fs.readFileSync(MIGRACION, "utf8");
    const r = await enTransaccionRevertida(prismaDeTest(), async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM "jobs" WHERE "tipo" = 'whatsapp_envio_mantenimiento'`);
      await tx.$executeRawUnsafe(sql);
      const trasMigracion = await contarJobs(tx);
      await tx.$executeRawUnsafe(sql); // re-ejecutar la migracion
      const trasRepetir = await contarJobs(tx);
      const porScript = await seedJobWhatsappEnvioMantenimiento(repoEnTx(tx), new Date());
      const trasScript = await contarJobs(tx);
      return { trasMigracion, trasRepetir, trasScript, porScript };
    });
    expect(r.trasMigracion).toBe(1);
    expect(r.trasRepetir).toBe(1);
    expect(r.porScript).toBeNull();
    expect(r.trasScript).toBe(1);
  });
});
