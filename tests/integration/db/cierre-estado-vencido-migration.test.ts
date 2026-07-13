import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { CIERRE_ESTADO_SEED } from "@/lib/types/cierre";

// Feature 41 (R2/R3/R12/R23) — cobertura ESTATICA de la migracion
// `*_cierre_estado_vencido` (patron gestion-orden/cierre-dia migration): lee
// migration.sql / down.sql por regex. La aplicacion real contra Postgres + el round-trip
// (pnpm db:migrate + pnpm db:rollback) los verifica el implementer.

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

const migrationDir = migrationDirFor("_cierre_estado_vencido");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("R2 — el SEED incluye vencido como cuarto estado", () => {
  it("CIERRE_ESTADO_SEED tiene los 4 valores, con vencido al final", () => {
    expect(CIERRE_ESTADO_SEED).toContain("vencido");
    expect(new Set(CIERRE_ESTADO_SEED)).toEqual(
      new Set(["solicitado", "aprobado", "rechazado", "vencido"]),
    );
  });
});

describe("UP — añade vencido al enum + indice del bloqueo derivado (R2/R12/R23)", () => {
  it("R2: ALTER TYPE ADD VALUE 'vencido' (aditivo, fuera de tx via IF NOT EXISTS)", () => {
    expect(upSql).toMatch(/ALTER TYPE "cierre_estado" ADD VALUE IF NOT EXISTS 'vencido';/);
  });

  it("R12/R23: crea el indice compuesto (mensajero_id, estado)", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "cierre_dia_mensajero_id_estado_idx" ON "cierre_dia"\("mensajero_id","estado"\);/,
    );
  });

  it("R3: la migracion NO toca policies RLS", () => {
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("DOWN — reversible sin vencido (R3)", () => {
  it("dropea el indice del bloqueo derivado", () => {
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "cierre_dia_mensajero_id_estado_idx";/);
  });

  it("recrea el enum cierre_estado con los 3 valores originales (sin vencido)", () => {
    const match = downSql.match(/CREATE TYPE "cierre_estado" AS ENUM \(([^)]*)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(valores)).toEqual(new Set(["solicitado", "aprobado", "rechazado"]));
    expect(valores).not.toContain("vencido");
  });

  it("migra las dos columnas que comparten el enum (cierre_dia + cierre_bodega) con USING", () => {
    expect(downSql).toMatch(
      /ALTER TABLE "cierre_dia" ALTER COLUMN "estado" TYPE "cierre_estado" USING/,
    );
    expect(downSql).toMatch(
      /ALTER TABLE "cierre_bodega" ALTER COLUMN "estado" TYPE "cierre_estado" USING/,
    );
  });

  it("suelta y recrea el indice unico parcial de la feature 40 alrededor del cambio de tipo", () => {
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "cierre_bodega_zona_solicitado_uq";/);
    expect(downSql).toMatch(
      /CREATE UNIQUE INDEX "cierre_bodega_zona_solicitado_uq"[\s\S]*WHERE "estado" = 'solicitado';/,
    );
  });

  it("R3: el down tampoco toca policies RLS", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la feature 56", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const feature56Dir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_ingreso_bodega_rechazos"));
    expect(feature56Dir).toBeDefined();
    expect(dirName > (feature56Dir as string)).toBe(true);
  });
});
