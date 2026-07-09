import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Tests de nivel DB que NO requieren una base real: leen el DDL de la carpeta de
// migracion de login (`*_login_usuario_rba`, editada por role-seed para
// introducir el enum de Postgres `rol_value`) y afirman el contenido y el orden
// de las sentencias. La verificacion en caliente contra Postgres real (aplicar
// migracion + seed) queda DIFERIDA a un entorno con DB, igual que login T004 /
// permissions.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function loginMigrationDir(): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith("_login_usuario_rba"));
  if (!dir)
    throw new Error("No se encontro la carpeta de migracion *_login_usuario_rba");
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = loginMigrationDir();
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("role-seed migration.sql (enum rol_value) (R1, R4, R5)", () => {
  it("crea el enum rol_value con los cuatro labels exactos (R1, R4)", () => {
    expect(upSql).toMatch(
      /CREATE TYPE "rol_value" AS ENUM \('maestro', 'admin', 'mensajero', 'Admin Tienda'\)/
    );
  });

  it("declara el CREATE TYPE del enum ANTES de crear la tabla rol (R4)", () => {
    const idxEnum = upSql.indexOf('CREATE TYPE "rol_value"');
    const idxTabla = upSql.indexOf('CREATE TABLE "rol"');
    expect(idxEnum).toBeGreaterThanOrEqual(0);
    expect(idxTabla).toBeGreaterThanOrEqual(0);
    expect(idxEnum).toBeLessThan(idxTabla);
  });

  it("tipa la columna value de rol con el enum rol_value (R5)", () => {
    expect(upSql).toMatch(/"value" "rol_value" NOT NULL/);
    // Ya no es TEXT: la definicion antigua no debe persistir en la tabla rol.
    expect(upSql).not.toMatch(/CREATE TABLE "rol" \(\s*"id" TEXT NOT NULL,\s*"value" TEXT NOT NULL/);
  });

  it("conserva el indice unico rol_value_key sobre value (R5)", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "rol_value_key" ON "rol"\("value"\)/
    );
  });
});

describe("role-seed down.sql (DROP TYPE rol_value) (R6)", () => {
  it("dropea el tipo rol_value (R6)", () => {
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "rol_value"/);
  });

  it("dropea el enum rol_value DESPUES de eliminar la tabla rol (R6)", () => {
    const idxDropTabla = downSql.indexOf('DROP TABLE IF EXISTS "rol"');
    const idxDropType = downSql.indexOf('DROP TYPE IF EXISTS "rol_value"');
    expect(idxDropTabla).toBeGreaterThanOrEqual(0);
    expect(idxDropType).toBeGreaterThanOrEqual(0);
    expect(idxDropTabla).toBeLessThan(idxDropType);
  });
});
