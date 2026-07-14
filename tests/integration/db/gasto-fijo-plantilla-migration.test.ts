import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 45 (R20/R33) — cobertura ESTATICA de la migracion `*_gasto_fijo_plantilla` (patron
// wallet-tienda-movimiento-migration: lee migration.sql/down.sql por regex). El round-trip real
// up->down->up contra Postgres lo verifica el implementer (pnpm db:migrate / db:rollback).
// Migracion ADITIVA: tabla nueva + indice por activa + RLS habilitada SIN policies; el down la
// elimina exactamente (DROP TABLE).

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor("_gasto_fijo_plantilla");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("UP — tabla gasto_fijo_plantilla (R33)", () => {
  it("R33: crea la tabla con concepto TEXT NOT NULL y monto DECIMAL(12,2) NOT NULL", () => {
    expect(upSql).toMatch(/CREATE TABLE "gasto_fijo_plantilla"/);
    expect(upSql).toMatch(/"concepto" TEXT NOT NULL/);
    expect(upSql).toMatch(/"monto" DECIMAL\(12,2\) NOT NULL/);
  });

  it("activa BOOLEAN NOT NULL DEFAULT true + created_at/updated_at + pkey", () => {
    expect(upSql).toMatch(/"activa" BOOLEAN NOT NULL DEFAULT true/);
    expect(upSql).toMatch(/"created_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(upSql).toMatch(/"updated_at" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(upSql).toMatch(/CONSTRAINT "gasto_fijo_plantilla_pkey" PRIMARY KEY \("id"\)/);
  });

  it("crea el indice por activa (cron: WHERE activa = true)", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "gasto_fijo_plantilla_activa_idx" ON "gasto_fijo_plantilla"\("activa"\);/,
    );
  });

  it("R20: habilita RLS SIN policies (solo service role)", () => {
    expect(upSql).toMatch(/ALTER TABLE "gasto_fijo_plantilla" ENABLE ROW LEVEL SECURITY;/);
    expect(upSql).not.toMatch(/CREATE POLICY/i);
  });

  it("es ADITIVA: no altera tablas existentes ni crea enums", () => {
    expect(upSql).not.toMatch(/ALTER TABLE "wallet_movimiento"/);
    expect(upSql).not.toMatch(/CREATE TYPE/i);
  });
});

describe("DOWN — elimina exactamente la tabla (R33)", () => {
  it("DROP TABLE IF EXISTS gasto_fijo_plantilla (arrastra indice y RLS)", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "gasto_fijo_plantilla";/);
  });

  it("no toca otras tablas ni policies", () => {
    expect(downSql).not.toMatch(/wallet_movimiento/);
    expect(downSql).not.toMatch(/CREATE POLICY/i);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });
});
