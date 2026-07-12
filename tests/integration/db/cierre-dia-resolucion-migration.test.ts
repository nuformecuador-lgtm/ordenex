import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 38 — cobertura ESTATICA de la migracion `*_cierre_dia_resolucion` (patron
// cierre-dia-migration.test.ts): lee migration.sql/down.sql por regex. NO requiere
// Postgres real (la aplicacion contra Postgres queda como round-trip manual,
// verificado por el implementer: up -> down -> up limpio, RLS intacta). Cubre R14
// (columnas de auditoria + FK + indice), R17 (RLS habilitada intacta + down.sql
// reversible en orden inverso).

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

const migrationDir = migrationDirFor("_cierre_dia_resolucion");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("UP — columnas de auditoria/motivo en cierre_dia (R14/R11)", () => {
  it("R14: agrega resuelto_por TEXT, resuelto_at TIMESTAMP(3), motivo_rechazo TEXT (todas nullable)", () => {
    expect(upSql).toMatch(/ALTER TABLE "cierre_dia" ADD COLUMN "resuelto_por" TEXT;/);
    expect(upSql).toMatch(/ALTER TABLE "cierre_dia" ADD COLUMN "resuelto_at" TIMESTAMP\(3\);/);
    expect(upSql).toMatch(/ALTER TABLE "cierre_dia" ADD COLUMN "motivo_rechazo" TEXT;/);
    // aditiva: nunca NOT NULL (NULL mientras el cierre esta `solicitado`).
    expect(upSql).not.toMatch(/ADD COLUMN "resuelto_por" TEXT NOT NULL/);
    expect(upSql).not.toMatch(/ADD COLUMN "motivo_rechazo" TEXT NOT NULL/);
  });

  it("R14: FK resuelto_por -> usuario(id) ON DELETE SET NULL (audit degradado, no roto)", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "cierre_dia_resuelto_por_fkey"\s+FOREIGN KEY \("resuelto_por"\) REFERENCES "usuario"\("id"\) ON UPDATE CASCADE ON DELETE SET NULL;/,
    );
  });

  it("R14: indice por resuelto_por para la auditoria", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "cierre_dia_resuelto_por_idx" ON "cierre_dia"\("resuelto_por"\);/,
    );
  });

  it("R17: NO toca la RLS de cierre_dia (ni ENABLE/DISABLE ni policies)", () => {
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
  });
});

describe("DOWN — reversible en orden inverso (R17)", () => {
  it("suelta indice, FK y las 3 columnas (idempotente con IF EXISTS)", () => {
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "cierre_dia_resuelto_por_idx";/);
    expect(downSql).toMatch(/DROP CONSTRAINT IF EXISTS "cierre_dia_resuelto_por_fkey";/);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS "motivo_rechazo";/);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS "resuelto_at";/);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS "resuelto_por";/);
  });

  it("orden inverso: indice antes que FK, FK antes que las columnas", () => {
    const idxIdx = downSql.indexOf('DROP INDEX IF EXISTS "cierre_dia_resuelto_por_idx"');
    const idxFk = downSql.indexOf('DROP CONSTRAINT IF EXISTS "cierre_dia_resuelto_por_fkey"');
    const idxCol = downSql.indexOf('DROP COLUMN IF EXISTS "resuelto_por"');
    expect(idxIdx).toBeGreaterThanOrEqual(0);
    expect(idxFk).toBeGreaterThan(idxIdx);
    expect(idxCol).toBeGreaterThan(idxFk);
  });

  it("R17: DOWN tampoco toca la RLS de cierre_dia", () => {
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(downSql).not.toMatch(/DROP TABLE/i); // aditiva: nunca dropea la tabla
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la feature 37 (_cierre_dia)", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const feature37Dir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_cierre_dia") && !name.endsWith("_cierre_dia_resolucion"));
    expect(feature37Dir).toBeDefined();
    expect(dirName > (feature37Dir as string)).toBe(true);
  });
});
