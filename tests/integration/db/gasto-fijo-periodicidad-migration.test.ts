import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 84 — cobertura ESTATICA de la migracion `*_gasto_fijo_periodicidad` (patron
// gasto-fijo-plantilla-migration: lee migration.sql/down.sql por regex). El round-trip real
// up->down->up contra Postgres lo verifica el implementer (pnpm db:migrate / db:rollback).
//
// Ademas — INVARIANTE ESTRUCTURAL "un variable no puede ser periodico": la periodicidad vive
// SOLO en `gasto_fijo_plantilla` (que alimenta `egreso_gasto_fijo`); `egreso_gasto_variable` es
// un movimiento suelto sin plantilla ni forma de asociarle un ciclo.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor("_gasto_fijo_periodicidad");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("UP — periodicidad de gasto_fijo_plantilla (feature 84)", () => {
  it("crea el enum PeriodicidadUnidad con dias/semanas/meses", () => {
    expect(upSql).toMatch(
      /CREATE TYPE "PeriodicidadUnidad" AS ENUM \('dias', 'semanas', 'meses'\);/,
    );
  });

  it("agrega periodicidad_unidad (default meses) y periodicidad_cantidad (default 1)", () => {
    expect(upSql).toMatch(
      /ADD COLUMN "periodicidad_unidad" "PeriodicidadUnidad" NOT NULL DEFAULT 'meses'/,
    );
    expect(upSql).toMatch(/ADD COLUMN "periodicidad_cantidad" INTEGER NOT NULL DEFAULT 1/);
  });

  it("agrega fecha_cobro DATE y la deja NOT NULL despues del backfill", () => {
    expect(upSql).toMatch(/ADD COLUMN "fecha_cobro" DATE/);
    expect(upSql).toMatch(/ALTER COLUMN "fecha_cobro" SET NOT NULL/);
  });

  it("BACKFILL: fecha_cobro = date_trunc('month', created_at)::date (mensual dia 1, sin cambio de comportamiento)", () => {
    expect(upSql).toMatch(
      /SET "fecha_cobro" = date_trunc\('month', "created_at"\)::date/,
    );
  });

  it("agrega el CHECK periodicidad_cantidad >= 1", () => {
    expect(upSql).toMatch(
      /CHECK \("periodicidad_cantidad" >= 1\)/,
    );
  });

  it("es ADITIVA: solo toca gasto_fijo_plantilla, no wallet_movimiento", () => {
    expect(upSql).not.toMatch(/ALTER TABLE "wallet_movimiento"/);
    // No crea/borra la tabla: es un ALTER, no un CREATE TABLE de gasto_fijo_plantilla.
    expect(upSql).not.toMatch(/CREATE TABLE "gasto_fijo_plantilla"/);
  });

  it("NO toca la RLS de la tabla (ya estaba habilitada sin policies)", () => {
    expect(upSql).not.toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(upSql).not.toMatch(/CREATE POLICY/i);
  });
});

describe("DOWN — revierte exactamente (feature 84)", () => {
  it("dropea el CHECK, las 3 columnas y el enum (orden inverso)", () => {
    expect(downSql).toMatch(/DROP CONSTRAINT IF EXISTS "gasto_fijo_plantilla_periodicidad_cantidad_check"/);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS "fecha_cobro"/);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS "periodicidad_cantidad"/);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS "periodicidad_unidad"/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "PeriodicidadUnidad"/);
  });

  it("no dropea la tabla ni toca otras tablas", () => {
    expect(downSql).not.toMatch(/DROP TABLE/);
    expect(downSql).not.toMatch(/wallet_movimiento/);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });
});

describe("INVARIANTE ESTRUCTURAL — un variable no puede ser periodico (feature 84)", () => {
  const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");
  // Aisla el bloque `model GastoFijoPlantilla { ... }`.
  const plantillaBlock = schema.slice(
    schema.indexOf("model GastoFijoPlantilla"),
    schema.indexOf("}", schema.indexOf("model GastoFijoPlantilla")) + 1,
  );

  it("los campos de periodicidad se DEFINEN solo en GastoFijoPlantilla (y ningun otro model los declara)", () => {
    for (const campo of ["periodicidadUnidad", "periodicidadCantidad", "fechaCobro"]) {
      expect(plantillaBlock).toContain(campo);
      // El campo se declara con `@map(...)` (columna) exactamente una vez en TODO el schema: esa
      // unica declaracion es la de la plantilla. Asi ningun otro model puede tener periodicidad
      // (los comentarios que mencionan el nombre no cuentan: no llevan `@map`).
      const declaraciones = schema.split("\n").filter((l) => {
        const t = l.trimStart();
        return t.startsWith(`${campo} `) && t.includes("@map(");
      });
      expect(declaraciones, `${campo} deberia declararse (con @map) solo en GastoFijoPlantilla`).toHaveLength(1);
    }
  });

  it("no existe un modelo/tabla de 'gasto variable' con periodicidad: el variable es solo la categoria egreso_gasto_variable en wallet_movimiento", () => {
    // `egreso_gasto_variable` es un valor de enum de categoria, NO un modelo con columnas de ciclo.
    expect(schema).not.toMatch(/model\s+GastoVariable/);
    expect(schema).toMatch(/egreso_gasto_variable/); // existe como categoria del libro
    // El libro wallet_movimiento no tiene columnas de periodicidad.
    const walletBlock = schema.slice(
      schema.indexOf("model WalletMovimiento"),
      schema.indexOf("@@map(\"wallet_movimiento\")"),
    );
    expect(walletBlock).not.toMatch(/periodicidad/i);
    expect(walletBlock).not.toMatch(/fecha_cobro|fechaCobro/);
  });
});
