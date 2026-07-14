import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet";

// Feature 45 (R21) — cobertura ESTATICA de la migracion `*_wallet_egreso_gasto_fijo_variable`
// (patron cierre-estado-vencido-migration: lee migration.sql/down.sql por regex). El round-trip
// real up->down->up contra Postgres lo verifica el implementer (pnpm db:migrate / db:rollback).
// El enum se extiende de forma ADITIVA con egreso_gasto_fijo/egreso_gasto_variable; el down
// recrea el tipo SIN ellos (drop/recreate de los 2 indices que referencian categoria), sin
// tocar la RLS.

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

const migrationDir = migrationDirFor("_wallet_egreso_gasto_fijo_variable");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("R21 — el SEED incluye los dos nuevos valores de categoria", () => {
  it("WALLET_MOVIMIENTO_CATEGORIA_SEED contiene egreso_gasto_fijo y egreso_gasto_variable", () => {
    expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toContain("egreso_gasto_fijo");
    expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toContain("egreso_gasto_variable");
    // egreso_sueldo YA existia (se reutiliza para sueldos).
    expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toContain("egreso_sueldo");
  });
});

describe("UP — extiende el enum de forma ADITIVA (R21)", () => {
  it("R21: ALTER TYPE ADD VALUE IF NOT EXISTS para los dos valores (fuera de tx)", () => {
    expect(upSql).toMatch(
      /ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_gasto_fijo';/,
    );
    expect(upSql).toMatch(
      /ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_gasto_variable';/,
    );
  });

  it("R20: la migracion NO toca RLS ni policies", () => {
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("no usa los valores nuevos en la misma migracion (seguro fuera de tx)", () => {
    // ADD VALUE no puede coexistir con un USE del valor en la misma tx: aqui solo se anaden.
    expect(upSql).not.toMatch(/INSERT INTO/i);
    expect(upSql).not.toMatch(/UPDATE /i);
  });
});

describe("DOWN — recrea el enum sin los dos valores (R21)", () => {
  it("dropea los 2 indices que referencian categoria antes del cambio de tipo", () => {
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "wallet_movimiento_tipo_categoria_idx";/);
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "wallet_movimiento_origen_categoria_uq";/);
  });

  it("recrea el enum con los 12 valores originales (sin egreso_gasto_fijo/variable)", () => {
    const match = downSql.match(/CREATE TYPE "wallet_movimiento_categoria" AS ENUM \(([\s\S]*?)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).not.toContain("egreso_gasto_fijo");
    expect(valores).not.toContain("egreso_gasto_variable");
    expect(valores).toContain("egreso_sueldo"); // preexistente, se conserva
    expect(valores).toHaveLength(12);
  });

  it("migra la columna con USING cast (precondicion: sin filas con los valores nuevos)", () => {
    expect(downSql).toMatch(
      /ALTER TABLE "wallet_movimiento" ALTER COLUMN "categoria"\s+TYPE "wallet_movimiento_categoria" USING/,
    );
  });

  it("recrea los 2 indices (incl. el unico parcial WHERE origen_id IS NOT NULL)", () => {
    expect(downSql).toMatch(
      /CREATE INDEX "wallet_movimiento_tipo_categoria_idx" ON "wallet_movimiento"\("tipo", "categoria"\);/,
    );
    expect(downSql).toMatch(
      /CREATE UNIQUE INDEX "wallet_movimiento_origen_categoria_uq"[\s\S]*WHERE "origen_id" IS NOT NULL;/,
    );
  });

  it("R20: el down tampoco toca RLS ni policies", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });
});
