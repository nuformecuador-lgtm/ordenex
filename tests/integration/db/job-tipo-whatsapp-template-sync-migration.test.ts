import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Integracion WhatsApp — cobertura ESTATICA de la migracion `*_job_tipo_whatsapp_template_sync`
// (patron geocodificacion-rollback / webhook-suscripcion-rollback: lee migration.sql y down.sql por
// regex). La suite NO levanta Postgres; el round-trip real up -> down -> up queda documentado como
// deuda, igual que en las migraciones hermanas del enum `job_tipo` (91/92/99).
//
// Su `down.sql` se escribio a POSTERIORI (deuda que `./init.sh` avisaba como "migraciones sin
// down.sql"), asi que aqui NO se toma la lista de valores del enum recreado como dato dado: se
// RECONSTRUYE leyendo el historial de migraciones ANTERIORES a esta carpeta (el `CREATE TYPE` de la
// 90 mas cada `ADD VALUE` posterior) y se compara con la que el down.sql declara. Un valor de mas
// (p. ej. `whatsapp_chat_envio`, que anade una migracion POSTERIOR) o de menos rompe el test.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function migrationDirFor(nombre: string): string {
  const dirs = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => new RegExp(`^\\d+_${nombre}$`).test(name));
  if (dirs.length !== 1) throw new Error(`Carpeta de migracion ambigua o ausente: ${nombre}`);
  return path.join(MIGRATIONS_DIR, dirs[0]);
}

/** Las aserciones de AUSENCIA corren sobre el SQL EJECUTABLE, no sobre la prosa. */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

/** Valores de un `CREATE TYPE "<tipo>" AS ENUM (...)`, en orden de declaracion. */
function valoresDelCreateType(sql: string, tipo: string): string[] {
  const m = sql.match(new RegExp(`CREATE TYPE\\s+"${tipo}"\\s+AS ENUM\\s*\\(([^)]*)\\)`));
  if (!m) throw new Error(`No hay CREATE TYPE de "${tipo}" en el SQL dado`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1]);
}

const NUEVO = "whatsapp_template_sync";
const dir = migrationDirFor("job_tipo_whatsapp_template_sync");
const dirName = path.basename(dir);
const upExec = sinComentarios(fs.readFileSync(path.join(dir, "migration.sql"), "utf8"));
const downExec = sinComentarios(fs.readFileSync(path.join(dir, "down.sql"), "utf8"));
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

/**
 * Reconstruye el enum `job_tipo` tal como estaba JUSTO ANTES de la migracion `hasta`, replicando
 * lo que Postgres tendria aplicado en ese punto de la historia: el `CREATE TYPE` inicial mas cada
 * `ALTER TYPE ... ADD VALUE` de las carpetas ANTERIORES (orden lexicografico = orden de aplicacion).
 */
function enumJobTipoAntesDe(hasta: string): string[] {
  const valores: string[] = [];
  const previas = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => n < hasta)
    .sort();
  for (const nombre of previas) {
    const sql = sinComentarios(
      fs.readFileSync(path.join(MIGRATIONS_DIR, nombre, "migration.sql"), "utf8"),
    );
    if (/CREATE TYPE\s+"job_tipo"\s+AS ENUM/.test(sql)) {
      valores.push(...valoresDelCreateType(sql, "job_tipo"));
    }
    for (const m of sql.matchAll(
      /ALTER TYPE\s+"job_tipo"\s+ADD VALUE(?:\s+IF NOT EXISTS)?\s+'([^']+)'/g,
    )) {
      if (!valores.includes(m[1])) valores.push(m[1]);
    }
  }
  return valores;
}

describe("UP — anade whatsapp_template_sync al enum job_tipo (aditiva)", () => {
  it("es un ADD VALUE idempotente y NADA mas", () => {
    expect(upExec).toMatch(
      new RegExp(`ALTER TYPE\\s+"job_tipo"\\s+ADD VALUE IF NOT EXISTS\\s+'${NUEVO}';`),
    );
  });

  it("no altera ninguna tabla ni crea/borra objetos (va sola por el 55P04 de Postgres)", () => {
    expect(upExec).not.toMatch(/CREATE TABLE/i);
    expect(upExec).not.toMatch(/ALTER TABLE/i);
    expect(upExec).not.toMatch(/DROP/i);
    expect(upExec).not.toMatch(/DELETE FROM/i);
    expect(upExec).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("DOWN — revierte exactamente el UP (reversibilidad obligatoria)", () => {
  it("existe el down.sql de la migracion", () => {
    expect(fs.existsSync(path.join(dir, "down.sql"))).toBe(true);
  });

  it("RECREA el tipo (Postgres no soporta DROP VALUE) y migra la columna con USING", () => {
    expect(downExec).not.toMatch(/DROP VALUE/i);
    expect(downExec).toMatch(/ALTER TYPE\s+"job_tipo"\s+RENAME TO\s+"job_tipo_old"/);
    expect(downExec).toMatch(
      /ALTER TABLE\s+"jobs"\s+ALTER COLUMN\s+"tipo"\s+TYPE\s+"job_tipo"\s+USING\s+\("tipo"::text::"job_tipo"\)/,
    );
    expect(downExec).toMatch(/DROP TYPE\s+"job_tipo_old"/);
  });

  it("el tipo recreado NO conserva el valor que anadio esta migracion", () => {
    expect(valoresDelCreateType(downExec, "job_tipo")).not.toContain(NUEVO);
  });

  it("la lista recreada es EXACTAMENTE el enum vigente justo antes de esta migracion", () => {
    // Reconstruido desde el historial, no hardcodeado: liberar_reprogramadas (90),
    // geocodificacion (91), optimizacion_ruta (92), webhook_estado (99). `whatsapp_chat_envio`
    // lo anade una migracion POSTERIOR (20260723140100), que en un rollback ordenado ya se
    // revirtio: si se colara aqui, este test lo caza.
    const previos = enumJobTipoAntesDe(dirName);
    expect(previos).toEqual([
      "liberar_reprogramadas",
      "geocodificacion",
      "optimizacion_ruta",
      "webhook_estado",
    ]);
    expect(valoresDelCreateType(downExec, "job_tipo")).toEqual(previos);
  });

  it("borra ANTES del ALTER las filas jobs del tipo, o el USING abortaria el rollback", () => {
    expect(downExec).toMatch(new RegExp(`DELETE FROM\\s+"jobs"\\s+WHERE\\s+"tipo"\\s*=\\s*'${NUEVO}'`));
    const posDelete = downExec.indexOf("DELETE FROM");
    const posAlter = downExec.indexOf('ALTER TYPE "job_tipo" RENAME TO');
    expect(posDelete).toBeGreaterThanOrEqual(0);
    expect(posDelete).toBeLessThan(posAlter);
  });

  it("no toca nada mas: ni tablas ajenas, ni RLS, ni el enum job_estado", () => {
    expect(downExec).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(downExec).not.toMatch(/"job_estado"/);
    expect(downExec).not.toMatch(/DROP TABLE/i);
  });
});

describe("down.sql de la migracion POSTERIOR del mismo enum (rollback ordenado)", () => {
  it("el down de `whatsapp_chat_envio` SI conserva whatsapp_template_sync (se revierte antes)", () => {
    // Invariante de la cadena: revertir en orden inverso deja el enum consistente en cada paso.
    const posterior = migrationDirFor("job_tipo_whatsapp_chat_envio");
    const downPosterior = sinComentarios(fs.readFileSync(path.join(posterior, "down.sql"), "utf8"));
    expect(valoresDelCreateType(downPosterior, "job_tipo")).toEqual([
      ...valoresDelCreateType(downExec, "job_tipo"),
      NUEVO,
    ]);
  });
});

describe("schema.prisma refleja la migracion (sin drift)", () => {
  it("el enum Prisma JobTipo tiene whatsapp_template_sync", () => {
    const bloque = schemaPrisma.match(/enum JobTipo \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    expect((bloque as RegExpMatchArray)[1]).toMatch(new RegExp(`\\b${NUEVO}\\b`));
  });
});
