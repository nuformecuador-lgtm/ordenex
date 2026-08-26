import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// MENSAJE DE BIENVENIDA — cobertura ESTATICA de la migracion `*_job_tipo_whatsapp_bienvenida`.
// Clon del molde de `job-tipo-analitica-invalidacion-migration.test.ts`: lee migration.sql,
// down.sql y schema.prisma por regex, sin Postgres real.
//
// Los cuatro invariantes que fija no son cosmeticos: un `ALTER TYPE ... ADD VALUE` acompanado
// de otra sentencia revienta con el 55P04 de Postgres al aplicarse, y un `down.sql` que
// recree el enum con los valores en otro orden cambia el orden de comparacion del tipo.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");
const SUFIJO = "_job_tipo_whatsapp_bienvenida";
const VALOR = "whatsapp_bienvenida";

/** Los OCHO valores que el enum tenia antes de esta migracion, en su orden exacto. */
const VALORES_PREVIOS = [
  "liberar_reprogramadas",
  "geocodificacion",
  "optimizacion_ruta",
  "webhook_estado",
  "whatsapp_template_sync",
  "whatsapp_chat_envio",
  "analitica_rollup_diario",
  "analitica_invalidacion_cache",
];

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor(SUFIJO);
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

/** Sentencias reales del SQL: sin comentarios `--` ni lineas en blanco. */
function sentencias(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

describe("UP — anade el valor al enum job_tipo", () => {
  it("usa `ADD VALUE IF NOT EXISTS` (idempotente ante una re-aplicacion)", () => {
    expect(upSql).toMatch(
      new RegExp(`ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS '${VALOR}';`),
    );
  });

  it("va SOLA: una unica sentencia en el archivo (GOTCHA 55P04)", () => {
    // Postgres no permite USAR un valor de enum en la misma transaccion que lo anadio, y
    // Prisma corre cada migration.sql dentro de una transaccion.
    expect(sentencias(upSql)).toHaveLength(1);
    expect(upSql).toMatch(/55P04/);
  });

  it("es ADITIVA: no altera ninguna tabla", () => {
    expect(upSql).not.toMatch(/ALTER TABLE/i);
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/DROP/i);
  });
});

describe("DOWN — recrea el enum sin el valor", () => {
  it("borra las filas de `jobs` de ese tipo ANTES del ALTER, o el rollback aborta", () => {
    const soloSql = sentencias(downSql);
    const iDelete = soloSql.findIndex((s) => /DELETE FROM "jobs"/i.test(s));
    const iRename = soloSql.findIndex((s) => /ALTER TYPE "job_tipo" RENAME TO/i.test(s));
    expect(iDelete).toBeGreaterThanOrEqual(0);
    expect(iRename).toBeGreaterThanOrEqual(0);
    expect(iDelete).toBeLessThan(iRename);
    expect(downSql).toMatch(new RegExp(`DELETE FROM "jobs" WHERE "tipo" = '${VALOR}';`));
  });

  it("recrea el tipo con los ocho valores previos EN SU ORDEN (cambia la comparacion)", () => {
    const match = downSql.match(/CREATE TYPE "job_tipo" AS ENUM \(([\s\S]*?)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toEqual(VALORES_PREVIOS);
    expect(valores).not.toContain(VALOR);
  });

  it("recastea la columna y suelta el tipo viejo", () => {
    expect(downSql).toMatch(
      /ALTER TABLE "jobs" ALTER COLUMN "tipo" TYPE "job_tipo" USING \("tipo"::text::"job_tipo"\);/,
    );
    expect(downSql).toMatch(/DROP TYPE "job_tipo_old";/);
  });

  it("declara que borrar un job pendiente pierde una bienvenida", () => {
    expect(downSql).toMatch(/LO QUE SE PIERDE/i);
  });
});

describe("schema.prisma refleja la migracion (sin drift)", () => {
  it("el enum JobTipo trae los nueve valores, con el nuevo al final", () => {
    const bloque = schemaPrisma.match(/enum JobTipo \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    const valores = (bloque as RegExpMatchArray)[1]
      .split("\n")
      .map((l) => l.trim().split(/\s|\/\//)[0])
      .filter((l) => l.length > 0 && !l.startsWith("@@"));
    expect(valores).toEqual([...VALORES_PREVIOS, VALOR]);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la carpeta previa", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const previa = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => n < dirName)
      .sort()
      .pop();
    expect(previa).toBeDefined();
    expect(dirName > (previa as string)).toBe(true);
  });
});
