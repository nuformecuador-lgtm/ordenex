import { describe, it, expect, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
} from "./_postgres-real";
import { JobRepository } from "@/lib/repositories/JobRepository";
import type {
  EnqueueOpts,
  IJobRepository,
  JobTxClient,
} from "@/lib/interfaces/repositories/IJobRepository";
import type { JobTipo } from "@prisma/client";
import { seedJobLiberarReprogramadas } from "@/scripts/seed-jobs-liberar-reprogramadas";
import { recurrenciaLiberarReprogramadas } from "@/lib/services/jobs/liberar-reprogramadas-handler";

// FICHA 313 — LA SIEMBRA DE `liberar_reprogramadas` ES IDEMPOTENTE, MEDIDO CONTRA POSTGRES.
//
// POR QUE HACE FALTA ESTE ARCHIVO. Desde la ficha 313 la siembra corre en CADA despliegue
// (`scripts/migrate-deploy.ts`), no una vez a mano. Toda la seguridad de eso descansa en un
// hecho del MOTOR: `ON CONFLICT ("dedupe_key") WHERE "dedupe_key" IS NOT NULL DO NOTHING` en
// `JobRepository.enqueue`. Ese hecho no lo puede demostrar un doble —un repo falso devuelve lo
// que le programen— ni una regex sobre el SQL. Se demuestra CONTANDO FILAS.
//
// El gemelo de este archivo para el otro recurrente es
// `tests/integration/db/job-tipo-analitica-rollup-migration.test.ts` (R36 de la 124). El de
// `liberar_reprogramadas` no existia: la feature 90 dejo la siembra sin test propio (anotado
// como menor en `progress/review_90.md`), y fue justo esa serie la que en produccion se quedo
// con 0 filas y 40 ordenes atrapadas en `reprogramada` el 2026-08-28.
//
// Todo corre dentro de una transaccion que SIEMPRE se revierte: la base local la comparten
// varias sesiones y esto no puede dejar un job encolado detras.
//
// Si no hay `DATABASE_URL` alcanzable, el bloque se SALTA (aparece como skipped, no como
// passed): sin base no hay nada que medir, y fingir lo contrario seria peor que no tenerlo.

const VALOR: JobTipo = "liberar_reprogramadas";

/** Dos instantes distintos del MISMO dia CR: la corrida que agendan es la misma. */
const PRIMER_INSTANTE = new Date("2026-08-02T16:00:00.000Z"); // 10:00 CR del 2
const SEGUNDO_INSTANTE = new Date("2026-08-03T02:00:00.000Z"); // 20:00 CR del 2

const describeDb = HAY_BASE_DE_DATOS ? describe : describe.skip;
let prisma: PrismaClient | null = null;

function prismaDeTest(): PrismaClient {
  prisma ??= crearPrismaDeTest();
  return prisma;
}

afterAll(async () => {
  await prisma?.$disconnect();
});

/** Conteo de `jobs` del tipo sembrado, dentro del `tx` del test. */
async function contarJobs(tx: {
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
}): Promise<number> {
  const filas = (await tx.$queryRaw`SELECT count(*)::int AS n FROM "jobs"`) as { n: number }[];
  return filas[0].n;
}

describeDb("313 · la siembra de `liberar_reprogramadas` no duplica", () => {
  it("dos siembras del mismo dia CR dejan UNA fila, y el reencolado de la recurrencia tampoco anade", async () => {
    const conteos = await enTransaccionRevertida(prismaDeTest(), async (tx) => {
      const real = new JobRepository(prismaDeTest());
      // Shim: la siembra recibe un `IJobRepository`; aqui se le ata el `tx` del test.
      const repo = {
        enqueue: (tipo: JobTipo, payload: Record<string, unknown>, opts?: EnqueueOpts) =>
          real.enqueue(tipo, payload, opts, tx as unknown as JobTxClient),
      } as unknown as IJobRepository;

      const antes = await contarJobs(tx);
      const primera = await seedJobLiberarReprogramadas(repo, PRIMER_INSTANTE);
      const trasPrimera = await contarJobs(tx);
      const segunda = await seedJobLiberarReprogramadas(repo, SEGUNDO_INSTANTE);
      const trasSegunda = await contarJobs(tx);

      // Y la via que de verdad discrimina: el REENCOLADO de la recurrencia para esa MISMA
      // corrida. La siembra (que corre en cada despliegue) y la recurrencia (que corre tras
      // cada ocurrencia) son DOS productores del mismo trabajo. Si sus claves no colisionaran,
      // quedarian dos filas liberando el mismo dia — y el despliegue seria quien las creara.
      const { runAfter, dedupeKey } = recurrenciaLiberarReprogramadas.siguiente(PRIMER_INSTANTE);
      const reencolada = await repo.enqueue(VALOR, {}, { runAfter, dedupeKey });
      const trasReencolado = await contarJobs(tx);

      return { antes, trasPrimera, trasSegunda, trasReencolado, primera, segunda, reencolada };
    });

    // Los CONTEOS primero: son la evidencia que importa (filas de verdad en `jobs`).
    expect(conteos.trasPrimera).toBe(conteos.antes + 1);
    expect(conteos.trasSegunda).toBe(conteos.antes + 1);
    expect(conteos.trasReencolado).toBe(conteos.antes + 1);
    expect(conteos.primera?.dedupeKey).toBe("liberar_reprogramadas:2026-08-03");
    expect(conteos.segunda).toBeNull();
    expect(conteos.reencolada).toBeNull();
  });

  it("la fila sembrada queda `pending` y vencida a las 06:00 UTC (00:00 CR)", async () => {
    const fila = await enTransaccionRevertida(prismaDeTest(), async (tx) => {
      const real = new JobRepository(prismaDeTest());
      const repo = {
        enqueue: (tipo: JobTipo, payload: Record<string, unknown>, opts?: EnqueueOpts) =>
          real.enqueue(tipo, payload, opts, tx as unknown as JobTxClient),
      } as unknown as IJobRepository;
      return seedJobLiberarReprogramadas(repo, PRIMER_INSTANTE);
    });

    expect(fila).not.toBeNull();
    expect(fila!.estado).toBe("pending");
    expect(fila!.tipo).toBe(VALOR);
    expect(fila!.runAfter.toISOString()).toBe("2026-08-03T06:00:00.000Z");
    // Payload vacio: el handler deriva la fecha de `now` al ejecutar, y en la cola no viaja PII.
    expect(fila!.payload).toEqual({});
  });
});
