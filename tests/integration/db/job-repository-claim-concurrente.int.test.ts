import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient, JobTipo } from "@prisma/client";

import { JobRepository } from "@/lib/repositories/JobRepository";
import type { ClaimOpts, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, type TxDeTest } from "./_postgres-real";

/**
 * ⭑⭑ FEATURE 402 (R5) — DOS CLAIMS A LA VEZ SOBRE TIPOS MIXTOS NO SE REPARTEN LA MISMA FILA.
 *
 * QUE INVARIANTE SE MIDE. El de la feature 90 (R10/R11): `FOR UPDATE ... SKIP LOCKED`, dos
 * workers nunca toman la misma fila y el segundo NO SE QUEDA ESPERANDO al primero. La 402
 * reescribio la sentencia del claim (el bloqueo pasó a una CTE aparte, porque Postgres prohibe
 * `FOR UPDATE` junto a funciones de ventana), asi que ese invariante hay que RE-MEDIRLO, y con
 * varios tipos en juego.
 *
 * POR QUE ESTE ARCHIVO NO USA `enTransaccionRevertida` COMO SUS HERMANOS. Dos claims
 * concurrentes de verdad necesitan DOS CONEXIONES que vean las mismas filas; filas dentro de
 * una transaccion sin commitear son invisibles para la otra conexion, y dos consultas sobre la
 * MISMA transaccion se serializan en su unica conexion (no habria concurrencia que medir: el
 * `SKIP LOCKED` no llegaria a ejercitarse ni una vez).
 *
 * COMO SE AISLA ENTONCES. El corpus se commitea en un ESQUEMA DESECHABLE que este archivo crea
 * y suelta (`DROP SCHEMA ... CASCADE`), con una tabla `jobs` clonada de la real
 * (`LIKE public.jobs INCLUDING ALL`: mismos tipos enum, mismos indices, mismos defaults). El
 * repositorio nombra la tabla SIN cualificar (`FROM "jobs"`), asi que un `search_path` por
 * transaccion la resuelve ahi. Ni una fila entra en `public.jobs`, y aunque el proceso muriera
 * a mitad, lo que quedaria es un esquema huerfano que ningun cron mira — nunca un job fantasma
 * en la cola real.
 *
 * SIN BASE ALCANZABLE se SALTA ENTERO y con su nombre en el reporte.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Reloj INYECTADO en el año 2000 (mismo motivo que en el archivo hermano del reparto). */
const NOW = new Date("2000-01-01T00:00:00.000Z");
const CUTOFF = new Date("1999-12-31T23:59:00.000Z");
const OPTS: ClaimOpts = { now: NOW, visibilityCutoff: CUTOFF };

const BASE_RUN_AFTER = Date.parse("1999-06-01T00:00:00.000Z");

/** Esquema desechable. Solo `[a-z0-9_]`: se interpola en DDL, no puede llevar sorpresas. */
const ESQUEMA = `t402_concurrencia_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

/** El corpus: tres tipos, cantidades desiguales, `run_after` controlados. */
const SEMILLAS: { clave: string; tipo: JobTipo; offsetMin: number }[] = [
  ...Array.from({ length: 6 }, (_, i) => ({
    clave: `webhook-${i + 1}`,
    tipo: "webhook_estado" as JobTipo,
    offsetMin: i,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    clave: `geo-${i + 1}`,
    tipo: "geocodificacion" as JobTipo,
    offsetMin: 10 + i,
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    clave: `whatsapp-${i + 1}`,
    tipo: "whatsapp_bienvenida" as JobTipo,
    offsetMin: 20 + i,
  })),
];

/** Portador del valor: se lanza para forzar el ROLLBACK sin perder lo calculado. */
class Revertir extends Error {
  constructor(readonly valor: unknown) {
    super("rollback deliberado del test");
    this.name = "Revertir";
  }
}

describeSiHayBase("402/R5 — dos `claimBatch` a la vez sobre tipos mixtos (Postgres real)", () => {
  let prismaA: PrismaClient;
  let prismaB: PrismaClient;
  const idPorClave = new Map<string, string>();
  const clavePorId = new Map<string, string>();

  beforeAll(async () => {
    prismaA = crearPrismaDeTest();
    prismaB = crearPrismaDeTest();
    await prismaA.$executeRawUnsafe(`CREATE SCHEMA "${ESQUEMA}"`);
    // Clon estructural EXACTO de la tabla real: los enums, el default de `payload`, los
    // indices y las restricciones son los de produccion, no una aproximacion escrita a mano.
    await prismaA.$executeRawUnsafe(
      `CREATE TABLE "${ESQUEMA}"."jobs" (LIKE "public"."jobs" INCLUDING ALL)`,
    );
    for (const s of SEMILLAS) {
      const filas = await prismaA.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO "${ESQUEMA}"."jobs" (
           "id", "tipo", "payload", "estado", "intentos", "max_intentos",
           "run_after", "locked_at", "created_at", "updated_at"
         )
         VALUES (gen_random_uuid(), $1::"public"."job_tipo", '{}'::jsonb, 'pending', 0, 8, $2, NULL, $3, $3)
         RETURNING "id"`,
        s.tipo,
        new Date(BASE_RUN_AFTER + s.offsetMin * 60_000),
        NOW,
      );
      idPorClave.set(s.clave, filas[0].id);
      clavePorId.set(filas[0].id, s.clave);
    }
  });

  afterAll(async () => {
    await prismaA.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${ESQUEMA}" CASCADE`);
    await prismaA.$disconnect();
    await prismaB.$disconnect();
  });

  /** Apunta la tx al esquema desechable. Sin esto, el claim iria a `public.jobs`. */
  async function apuntarAlEsquema(tx: TxDeTest, statementTimeoutMs?: number): Promise<void> {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${ESQUEMA}", public`);
    if (statementTimeoutMs !== undefined) {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);
    }
  }

  function claves(jobs: JobDTO[]): string[] {
    return jobs
      .map((j) => clavePorId.get(j.id) ?? `AJENO:${j.id}`)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }

  it("⭑ R5: el segundo claim NO espera al primero y NO repite ni una fila", async () => {
    // Sincronizacion explicita: A reclama y SE QUEDA con la transaccion abierta (sus filas
    // bloqueadas) hasta que B termine. Es la unica forma de tener los dos claims solapados.
    let avisarQueAReclamo!: () => void;
    const aYaReclamo = new Promise<void>((r) => (avisarQueAReclamo = r));
    let soltarA!: () => void;
    const aPuedeSoltar = new Promise<void>((r) => (soltarA = r));

    let jobsA: JobDTO[] = [];
    const trabajoA = prismaA
      .$transaction(
        async (tx) => {
          await apuntarAlEsquema(tx);
          const repo = new JobRepository(tx as unknown as PrismaClient);
          jobsA = await repo.claimBatch(2, OPTS);
          avisarQueAReclamo();
          await aPuedeSoltar; // mantiene VIVOS los locks mientras B lo intenta
          throw new Revertir(null);
        },
        { timeout: 60_000, maxWait: 20_000 },
      )
      .catch((e: unknown) => {
        if (!(e instanceof Revertir)) throw e;
      });

    await aYaReclamo;

    // B corre con `statement_timeout`: si el claim se quedara ESPERANDO el lock de A —lo que
    // pasa en cuanto se cae el `SKIP LOCKED`— Postgres lo mata con 57014 y esto queda rojo.
    let jobsB: JobDTO[] = [];
    let errorB: unknown;
    try {
      await prismaB.$transaction(
        async (tx) => {
          await apuntarAlEsquema(tx, 3_000);
          const repo = new JobRepository(tx as unknown as PrismaClient);
          jobsB = await repo.claimBatch(6, OPTS);
          throw new Revertir(null);
        },
        { timeout: 60_000, maxWait: 20_000 },
      );
    } catch (e: unknown) {
      if (!(e instanceof Revertir)) errorB = e;
    } finally {
      soltarA();
      await trabajoA;
    }

    expect(
      errorB,
      "el segundo claim no llego a devolver nada: si es un statement_timeout (57014), es que " +
        "se quedo ESPERANDO el lock del primero — o sea, el claim perdio el `SKIP LOCKED`",
    ).toBeUndefined();

    // El primero se lleva su lote entero (turno 1 de los dos tipos mas antiguos).
    expect(claves(jobsA)).toEqual(["webhook-1", "geo-1"].sort((a, b) => a.localeCompare(b)));
    // El segundo NO se queda vacio ni se lleva nada del primero: salta las filas bloqueadas y
    // completa con las siguientes por turno. Un lote vacio dejaria la disyuncion cierta por
    // vacio, que no demuestra nada.
    expect(jobsB.length).toBeGreaterThan(0);
    expect(claves(jobsB)).toEqual(["geo-2", "webhook-2", "whatsapp-1", "whatsapp-2"]);

    // R5, la afirmacion de la ficha: la union de lo reclamado por los dos es DISJUNTA.
    const idsA = new Set(jobsA.map((j) => j.id));
    const repetidos = jobsB.filter((j) => idsA.has(j.id));
    expect(repetidos, "una fila fue entregada a los DOS workers").toEqual([]);
    expect(new Set([...idsA, ...jobsB.map((j) => j.id)]).size).toBe(jobsA.length + jobsB.length);
  });

  it("R5: tras el rollback de ambos, ninguna fila del corpus quedo reclamada", async () => {
    const filas = await prismaA.$queryRawUnsafe<{ estado: string; intentos: number }[]>(
      `SELECT "estado", "intentos" FROM "${ESQUEMA}"."jobs"`,
    );
    expect(filas).toHaveLength(SEMILLAS.length);
    expect(filas.every((f) => f.estado === "pending" && Number(f.intentos) === 0)).toBe(true);
  });
});
