import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 128 / T6.1 — R24. La migracion del 8.º valor de `job_tipo`.
//
// A DIFERENCIA de la de la 124, aqui solo esta la mitad ESTATICA (la FORMA del DDL, el
// `down.sql` y el datamodel). La mitad contra Postgres esta PENDIENTE y se explica al final
// del archivo.
//
// ⚠ ESTA MIGRACION NO SE HA APLICADO NI REVERTIDO DESDE EL WORKTREE. La base local
// `localhost:5432/ordenex` la comparten varias sesiones y su historial local ya esta
// desalineado con el remoto. La reversibilidad esta verificada POR TEXTO —que es lo que este
// archivo hace— y NO por ejecucion; se declara asi en `progress/impl_128.md`.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const SUFIJO = "_job_tipo_analitica_invalidacion_cache";
const VALOR = "analitica_invalidacion_cache";

/** Por SUFIJO y no por nombre completo: el prefijo de timestamp no es informacion. */
function carpetaDeLaMigracion(): string {
  const nombre = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((n) => n.endsWith(SUFIJO));
  if (nombre === undefined) throw new Error(`No se encontro la carpeta de migracion ${SUFIJO}`);
  return nombre;
}

const dir = path.join(MIGRATIONS_DIR, carpetaDeLaMigracion());
const upSql = fs.readFileSync(path.join(dir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(dir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

/** SQL sin comentarios: las aserciones NEGATIVAS van sobre esto, no sobre el texto crudo. */
const upDdl = upSql.replace(/^\s*--.*$/gm, "");
const downDdl = downSql.replace(/^\s*--.*$/gm, "");

const sentenciasUp = upDdl
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/** El enum ANTES de esta migracion: los SIETE valores previos, en su orden exacto. */
const VALORES_PREVIOS = [
  "liberar_reprogramadas",
  "geocodificacion",
  "optimizacion_ruta",
  "webhook_estado",
  "whatsapp_template_sync",
  "whatsapp_chat_envio",
  "analitica_rollup_diario",
];

describe("R24 · la migracion anade solo el valor del enum", () => {
  it("con `ADD VALUE IF NOT EXISTS`", () => {
    expect(upDdl).toMatch(
      new RegExp(`ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS '${VALOR}'`, "i"),
    );
  });

  it("va SOLA en su carpeta: una unica sentencia (Postgres 55P04)", () => {
    // Postgres no permite USAR un valor de enum en la misma transaccion que lo anadio, y
    // Prisma corre cada `migration.sql` en una transaccion. Cualquier DDL de mas aqui revienta
    // en el `deploy`, no en el review.
    expect(sentenciasUp).toHaveLength(1);
    expect(upDdl).not.toMatch(/CREATE TABLE|ALTER TABLE|INSERT INTO|CREATE INDEX/i);
  });

  it("la carpeta trae su `down.sql` (chequeo §6 de `init.sh`)", () => {
    expect(fs.existsSync(path.join(dir, "down.sql"))).toBe(true);
  });
});

describe("R24 · el `down.sql` lo retira recreando el tipo con los 7 valores previos en orden", () => {
  it("borra antes las filas de `jobs` de ese tipo (si no, el ALTER ... USING falla)", () => {
    const borrado = downDdl.indexOf(`DELETE FROM "jobs" WHERE "tipo" = '${VALOR}'`);
    const alter = downDdl.indexOf('ALTER TYPE "job_tipo" RENAME TO');
    expect(borrado).toBeGreaterThanOrEqual(0);
    expect(alter).toBeGreaterThan(borrado);
  });

  it("recrea el tipo con los SIETE valores previos, en orden, y sin el nuevo", () => {
    const create = /CREATE TYPE "job_tipo" AS ENUM \(([^)]*)\);/.exec(downDdl);
    expect(create).not.toBeNull();
    const valores = create![1].split(",").map((v) => v.trim().replace(/'/g, ""));
    // El ORDEN importa: recrear el tipo con otro orden cambiaria el orden de comparacion.
    expect(valores).toEqual(VALORES_PREVIOS);
    expect(valores).not.toContain(VALOR);
  });

  it("reapunta la columna y tira el tipo viejo (patron `job_tipo_*`, sin inventar otro)", () => {
    expect(downDdl).toMatch(
      /ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING \("tipo"::text::"job_tipo"\)/,
    );
    expect(downDdl).toMatch(/DROP TYPE "job_tipo_old"/);
  });
});

describe("R24 · el datamodel declara el valor", () => {
  it("`enum JobTipo` de `db/schema.prisma` lo lleva, con su comentario", () => {
    const bloque = /enum JobTipo \{[\s\S]*?\n\}/.exec(schemaPrisma);
    expect(bloque).not.toBeNull();
    expect(bloque![0]).toMatch(new RegExp(`^\\s*${VALOR}\\s*//`, "m"));
  });

  it("el datamodel y el `down.sql` no divergen: los ocho valores, en orden, y luego este", () => {
    const bloque = /enum JobTipo \{([\s\S]*?)\n\}/.exec(schemaPrisma)![1];
    const valores = bloque
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"))
      .map((l) => l.split(/\s|\/\//)[0]);
    // PREFIJO, no igualdad. Aqui vivia `toEqual([...VALORES_PREVIOS, VALOR])`, que en realidad
    // afirmaba «y este es el ULTIMO valor del enum». Era cierto al escribirla y caduca sola con
    // el siguiente tipo de job que entre (entro `whatsapp_bienvenida`). Lo que esta migracion
    // tiene que garantizar —y eso no caduca— es que su `down.sql` deja EXACTAMENTE el enum que
    // habia antes de ella: sus ocho valores, en su orden, seguidos del suyo. Lo que venga
    // despues no es asunto de esta migracion.
    expect(valores.slice(0, VALORES_PREVIOS.length + 1)).toEqual([...VALORES_PREVIOS, VALOR]);
  });
});

// --- Contra la base local: PENDIENTE, y se dice con todas las letras -------------------------
//
// La mitad de la 124 que consultaba `pg_enum` NO se replica aqui todavia, y no por descuido:
// la migracion de esta feature **no se ha aplicado** a `localhost:5432/ordenex`. Esa base la
// comparten varios worktrees y su historial local ya esta desalineado con el remoto, asi que
// aplicar o revertir desde aqui es una decision del leader, no del implementer
// (`tasks.md > T6.1`). Escribir la asercion antes de aplicar dejaria un rojo permanente que no
// dice nada sobre la correccion de esta migracion.
//
// LO QUE HAY QUE ANADIR AQUI EN CUANTO LA MIGRACION SE APLIQUE (copiar de
// `job-tipo-analitica-rollup-migration.test.ts`, mismo patron, cambiando el valor):
//
//   const describeDb = HAY_BASE_DE_DATOS ? describe : describe.skip;
//   describeDb("R24 contra Postgres — el valor existe en el enum", () => {
//     it("`analitica_invalidacion_cache` es un valor de `job_tipo` en la base", async () => {
//       const filas = await prisma.$queryRaw<{ enumlabel: string }[]>`
//         SELECT e."enumlabel" FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
//          WHERE t.typname = 'job_tipo' ORDER BY e.enumsortorder`;
//       expect(filas.map((f) => f.enumlabel)).toContain(VALOR);
//     });
//   });
//
// La reversibilidad del `down.sql` queda verificada POR TEXTO (los tres `it` de arriba) y
// **NO por ejecucion**. Se declara asi, sin maquillaje, en `progress/impl_128.md`.
