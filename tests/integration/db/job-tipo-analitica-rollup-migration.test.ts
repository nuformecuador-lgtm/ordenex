import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
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
import { seedJobAnaliticaRollupDiario } from "@/scripts/seed-jobs-analitica-rollup-diario";
import { recurrenciaAnaliticaRollupDiario } from "@/lib/services/jobs/analitica-rollup-diario-handler";

// Feature 124 / T4.1 + T4.5 — la migracion del `job_tipo` nuevo y la siembra.
//
// Dos mitades deliberadamente distintas:
//  - ESTATICA (sin Postgres): la FORMA del DDL, el `down.sql` y el datamodel.
//  - CONTRA LA BASE (se SALTA si no hay `DATABASE_URL`): que el valor exista de verdad en el
//    enum y que dos siembras del mismo objetivo dejen UNA fila en `jobs` (R36).

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const SUFIJO = "_job_tipo_analitica_rollup_diario";
const VALOR = "analitica_rollup_diario";

/**
 * La carpeta se localiza por SUFIJO, no por nombre completo (patron del test de la 123). Sigue
 * siendo lo correcto aunque la asercion de «es la ultima por nombre» ya no exista: el prefijo
 * de timestamp no es informacion de esta feature, y buscar por nombre exacto ataria el archivo
 * a un dato que puede cambiar, fallando con un ENOENT en el import —que no demuestra nada— en
 * lugar de en una asercion.
 */
function carpetaDeLaMigracion(): string {
  const nombre = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((n) => n.endsWith(SUFIJO));
  if (nombre === undefined) throw new Error(`No se encontro la carpeta de migracion ${SUFIJO}`);
  return nombre;
}

const CARPETA = carpetaDeLaMigracion();

// Aqui vivia `ultimaCarpetaDeMigracionSegunRollback()`, la reproduccion literal del criterio de
// `scripts/db-rollback.ts`. Se va con la unica asercion que la usaba (ver mas abajo, en el
// `describe` de T4.1); dejarla suelta solo deja codigo muerto.

const dir = path.join(MIGRATIONS_DIR, CARPETA);
const upSql = fs.readFileSync(path.join(dir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(dir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

/** SQL sin comentarios: las aserciones NEGATIVAS van sobre esto, no sobre el texto crudo. */
const upDdl = upSql.replace(/^\s*--.*$/gm, "");
const downDdl = downSql.replace(/^\s*--.*$/gm, "");

/** Sentencias ejecutables del UP (para contar que va SOLA). */
const sentenciasUp = upDdl
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

describe("T4.1 — la migracion del enum `job_tipo`", () => {
  it("anade el valor con `ADD VALUE IF NOT EXISTS`", () => {
    expect(upDdl).toMatch(
      new RegExp(`ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS '${VALOR}'`, "i"),
    );
  });

  it("va SOLA en su carpeta: una unica sentencia (Postgres 55P04)", () => {
    // Postgres no permite USAR un valor de enum en la misma transaccion que lo anadio, y
    // Prisma corre cada `migration.sql` en una transaccion. Meter aqui cualquier DDL que
    // referencie el valor nuevo revienta en el `deploy`, no en el review.
    expect(sentenciasUp).toHaveLength(1);
    expect(upDdl).not.toMatch(/CREATE TABLE|ALTER TABLE|INSERT INTO/i);
  });

  // RETIRADA (2026-08-02): aqui vivia «la carpeta es la ULTIMA por nombre segun el criterio
  // EXACTO de `db-rollback.ts`», que comparaba `CARPETA` contra el ultimo directorio de
  // `db/migrations` ordenado por `localeCompare`. Era un guard DE UN SOLO USO: solo servia para
  // garantizar que, en el momento de correr el round-trip de T8.2, `pnpm db:rollback` revirtiera
  // ESTA migracion y no otra, de modo que la medicion fuera de esta feature. Ese round-trip ya
  // ocurrio y su evidencia esta registrada en `progress/roundtrip_124_job_tipo.md` (UP → DOWN →
  // UP contra `localhost:5432/ordenex`, con la comprobacion de «ultima por nombre» hecha y
  // anotada en su §2). La propiedad que afirmaba es TEMPORAL: dejo de ser cierta en cuanto otra
  // feature anadio una migracion posterior (la 172, `20260802120000_liquidacion_pago`), y
  // mantenerla haria fallar a TODA feature futura que anada una migracion, sin decir nada sobre
  // la correccion de la 124. Se retira; las demas aserciones de este archivo siguen en pie.

  it("la carpeta trae su `down.sql` (chequeo §6 de `init.sh`)", () => {
    expect(fs.existsSync(path.join(dir, "down.sql"))).toBe(true);
  });
});

describe("T4.1 — el `down.sql` revierte EXACTAMENTE lo que el `up` hace", () => {
  it("borra antes las filas de `jobs` de ese tipo (si no, el ALTER ... USING falla)", () => {
    const borrado = downDdl.indexOf(`DELETE FROM "jobs" WHERE "tipo" = '${VALOR}'`);
    const alter = downDdl.indexOf('ALTER TYPE "job_tipo" RENAME TO');
    expect(borrado).toBeGreaterThanOrEqual(0);
    expect(alter).toBeGreaterThan(borrado);
  });

  it("recrea el tipo con los SEIS valores previos y sin el nuevo", () => {
    const create = /CREATE TYPE "job_tipo" AS ENUM \(([^)]*)\);/.exec(downDdl);
    expect(create).not.toBeNull();
    const valores = create![1].split(",").map((v) => v.trim().replace(/'/g, ""));
    expect(valores).toEqual([
      "liberar_reprogramadas",
      "geocodificacion",
      "optimizacion_ruta",
      "webhook_estado",
      "whatsapp_template_sync",
      "whatsapp_chat_envio",
    ]);
    expect(valores).not.toContain(VALOR);
  });

  it("reapunta la columna y tira el tipo viejo (patron `job_tipo_*`, sin inventar otro)", () => {
    expect(downDdl).toMatch(
      /ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING \("tipo"::text::"job_tipo"\)/,
    );
    expect(downDdl).toMatch(/DROP TYPE "job_tipo_old"/);
  });
});

describe("T4.1 — el datamodel declara el valor", () => {
  it("`enum JobTipo` de `db/schema.prisma` lo lleva, con su comentario", () => {
    const bloque = /enum JobTipo \{[\s\S]*?\n\}/.exec(schemaPrisma);
    expect(bloque).not.toBeNull();
    expect(bloque![0]).toMatch(new RegExp(`^\\s*${VALOR}\\s*//`, "m"));
  });

  it("el datamodel y el `down.sql` no divergen: los seis previos y luego el de la 124", () => {
    // ACTUALIZADO POR LA FEATURE 128 (2026-08-03). La asercion original exigia que el enum del
    // datamodel tuviera EXACTAMENTE siete valores, con el de la 124 como ULTIMO. Esa propiedad
    // es TEMPORAL —igual que la de «la carpeta es la ULTIMA por nombre», retirada mas arriba
    // por este mismo motivo—: deja de ser cierta en cuanto otra feature anade un valor al enum,
    // y mantenerla haria fallar a TODA feature futura que lo haga, sin decir nada sobre la
    // correccion de la 124. Lo que SI es de la 124 se conserva intacto: los seis valores
    // previos en su orden exacto y el suyo JUSTO DESPUES, que es lo que su `down.sql` recrea.
    const bloque = /enum JobTipo \{([\s\S]*?)\n\}/.exec(schemaPrisma)![1];
    const valores = bloque
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"))
      .map((l) => l.split(/\s|\/\//)[0]);
    expect(valores.slice(0, 7)).toEqual([
      "liberar_reprogramadas",
      "geocodificacion",
      "optimizacion_ruta",
      "webhook_estado",
      "whatsapp_template_sync",
      "whatsapp_chat_envio",
      VALOR,
    ]);
  });
});

// --- Contra la base local ------------------------------------------------------------------

const describeDb = HAY_BASE_DE_DATOS ? describe : describe.skip;
let prisma: PrismaClient | null = null;

function prismaDeTest(): PrismaClient {
  prisma ??= crearPrismaDeTest();
  return prisma;
}

afterAll(async () => {
  await prisma?.$disconnect();
});

describeDb("T4.1/T4.5 contra Postgres — el valor existe y la siembra es idempotente", () => {
  it("`analitica_rollup_diario` es un valor del enum `job_tipo` en la base", async () => {
    const filas = await prismaDeTest().$queryRaw<{ enumlabel: string }[]>`
      SELECT e."enumlabel"
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'job_tipo'
       ORDER BY e.enumsortorder`;
    expect(filas.map((f) => f.enumlabel)).toContain(VALOR);
  });

  it("R36 — dos siembras del mismo objetivo dejan UNA fila en `jobs`", async () => {
    // Todo dentro de una transaccion que SIEMPRE se revierte: la base local la comparten
    // varias sesiones y este test no puede dejar un job encolado detras.
    const conteos = await enTransaccionRevertida(prismaDeTest(), async (tx) => {
      const real = new JobRepository(prismaDeTest());
      // Shim: la siembra recibe un `IJobRepository`; aqui se le ata el `tx` del test.
      const repo = {
        enqueue: (tipo: JobTipo, payload: Record<string, unknown>, opts?: EnqueueOpts) =>
          real.enqueue(tipo, payload, opts, tx as unknown as JobTxClient),
      } as unknown as IJobRepository;

      const antes = await contarJobs(tx);
      const primera = await seedJobAnaliticaRollupDiario(
        repo,
        new Date("2026-08-02T16:00:00.000Z"),
      );
      const trasPrimera = await contarJobs(tx);
      // Segunda siembra el MISMO dia CR -> mismo objetivo -> misma `dedupe_key`.
      const segunda = await seedJobAnaliticaRollupDiario(
        repo,
        new Date("2026-08-03T02:00:00.000Z"),
      );
      const trasSegunda = await contarJobs(tx);

      // Y ahora la via que de verdad discrimina la eleccion de la clave: el REENCOLADO de la
      // recurrencia para esa MISMA corrida. La siembra y la recurrencia son dos productores
      // distintos del mismo trabajo; si uno usara la fecha de la CORRIDA y el otro la fecha
      // OBJETIVO, sus claves no colisionarian y quedarian DOS filas agregando el mismo dia.
      // (Dos siembras a secas no lo discriminan: la corrida y su objetivo van en biyeccion,
      // asi que cambiar de una a la otra es un desplazamiento constante e invisible.)
      const { runAfter, dedupeKey } = recurrenciaAnaliticaRollupDiario.siguiente(
        new Date("2026-08-02T16:00:00.000Z"),
      );
      const reencolada = await repo.enqueue("analitica_rollup_diario", {}, { runAfter, dedupeKey });
      const trasReencolado = await contarJobs(tx);

      return { antes, trasPrimera, trasSegunda, trasReencolado, primera, segunda, reencolada };
    });

    // Los CONTEOS primero: son la evidencia que importa (filas de verdad en `jobs`), y si una
    // mutacion de la clave los rompe, se quiere ver ese numero y no un string desalineado.
    expect(conteos.trasPrimera).toBe(conteos.antes + 1);
    // La clave es la FECHA OBJETIVO: la segunda siembra colisiona y NO crea fila.
    expect(conteos.trasSegunda).toBe(conteos.antes + 1);
    // El reencolado de la recurrencia para la misma corrida tampoco anade fila.
    expect(conteos.trasReencolado).toBe(conteos.antes + 1);
    expect(conteos.primera?.dedupeKey).toBe("analitica_rollup_diario:2026-08-02");
    expect(conteos.segunda).toBeNull();
    expect(conteos.reencolada).toBeNull();
  });

  it("la fila sembrada queda `pending` y vencida a las 06:30 UTC (00:30 CR)", async () => {
    const fila = await enTransaccionRevertida(prismaDeTest(), async (tx) => {
      const real = new JobRepository(prismaDeTest());
      const repo = {
        enqueue: (tipo: JobTipo, payload: Record<string, unknown>, opts?: EnqueueOpts) =>
          real.enqueue(tipo, payload, opts, tx as unknown as JobTxClient),
      } as unknown as IJobRepository;
      return seedJobAnaliticaRollupDiario(repo, new Date("2026-08-02T16:00:00.000Z"));
    });

    expect(fila).not.toBeNull();
    expect(fila!.estado).toBe("pending");
    expect(fila!.tipo).toBe(VALOR);
    expect(fila!.runAfter.toISOString()).toBe("2026-08-03T06:30:00.000Z");
    expect(fila!.payload).toEqual({});
  });
});

/** Conteo de `jobs` dentro del `tx` del test. */
async function contarJobs(tx: {
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
}): Promise<number> {
  const filas = (await tx.$queryRaw`SELECT count(*)::int AS n FROM "jobs"`) as { n: number }[];
  return filas[0].n;
}
