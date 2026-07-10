import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Tests de nivel DB que NO requieren una base real: leen el DDL de la carpeta
// de migracion incremental nueva (`*_rol_admin_satelite`, feature 19) y afirman
// el contenido y el orden de las sentencias. Tambien afirman que la migracion
// de login (`*_login_usuario_rba`, ya aplicada) NO fue editada. La verificacion
// en caliente contra Postgres real (aplicar migracion + seed + rollback) queda
// DIFERIDA a un entorno con DB, igual que login/permissions/role-seed.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function migrationDirNamed(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion *${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const rolAdminSateliteDir = migrationDirNamed("_rol_admin_satelite");
const upSql = fs.readFileSync(path.join(rolAdminSateliteDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(rolAdminSateliteDir, "down.sql"), "utf8");

const loginDir = migrationDirNamed("_login_usuario_rba");
const loginUpSql = fs.readFileSync(path.join(loginDir, "migration.sql"), "utf8");

describe("migracion incremental rol_admin_satelite — migration.sql (R3)", () => {
  it("añade el label 'adminSatelite' con ALTER TYPE ... ADD VALUE IF NOT EXISTS (R3)", () => {
    expect(upSql).toMatch(
      /ALTER TYPE "rol_value" ADD VALUE IF NOT EXISTS 'adminSatelite'/
    );
  });

  it("la migracion de login ya aplicada NO fue editada: sigue con 4 labels, sin 'adminSatelite' (R3)", () => {
    expect(loginUpSql).toMatch(
      /CREATE TYPE "rol_value" AS ENUM \('maestro', 'admin', 'mensajero', 'Admin Tienda'\)/
    );
    expect(loginUpSql).not.toContain("adminSatelite");
  });
});

describe("migracion incremental rol_admin_satelite — down.sql (R4, R5)", () => {
  it("contiene el DELETE de la fila 'adminSatelite' (precondicion R5)", () => {
    expect(downSql).toMatch(/DELETE FROM "rol" WHERE "value" = 'adminSatelite'/);
  });

  it("contiene RENAME TO rol_value_old, CREATE TYPE con los 4 labels existentes, ALTER COLUMN y DROP TYPE viejo (R4)", () => {
    expect(downSql).toMatch(/ALTER TYPE "rol_value" RENAME TO "rol_value_old"/);
    expect(downSql).toMatch(
      /CREATE TYPE "rol_value" AS ENUM \('maestro', 'admin', 'mensajero', 'Admin Tienda'\)/
    );
    expect(downSql).toMatch(
      /ALTER TABLE "rol" ALTER COLUMN "value" TYPE "rol_value" USING \("value"::text::"rol_value"\)/
    );
    expect(downSql).toMatch(/DROP TYPE "rol_value_old"/);
  });

  it("el DELETE ocurre ANTES del ALTER COLUMN (orden, R4/R5)", () => {
    const idxDelete = downSql.indexOf('DELETE FROM "rol" WHERE "value" = \'adminSatelite\'');
    const idxAlterColumn = downSql.indexOf(
      'ALTER TABLE "rol" ALTER COLUMN "value" TYPE'
    );
    expect(idxDelete).toBeGreaterThanOrEqual(0);
    expect(idxAlterColumn).toBeGreaterThanOrEqual(0);
    expect(idxDelete).toBeLessThan(idxAlterColumn);
  });
});
