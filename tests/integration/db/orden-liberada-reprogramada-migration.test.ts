import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 46 — cobertura ESTATICA de la migracion `*_orden_liberada_reprogramada_at`
// (ESPEJO del test de la 42 `wallet-migration`: lee migration.sql/down.sql por regex; NO
// requiere Postgres real; el round-trip up->down->up contra Postgres LOCAL queda como
// verificacion manual del implementer). Cubre R18: ADD COLUMN nullable + indice PARCIAL
// (WHERE ... IS NOT NULL) en el UP; DROP INDEX + DROP COLUMN (orden inverso, IF EXISTS)
// en el down.

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

const migrationDir = migrationDirFor("_orden_liberada_reprogramada_at");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("UP — columna liberada_reprogramada_at + indice parcial (R18)", () => {
  it("ADD COLUMN liberada_reprogramada_at nullable (TIMESTAMP, sin NOT NULL)", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "orden" ADD COLUMN "liberada_reprogramada_at" TIMESTAMP\(3\);/,
    );
    // nullable: la sentencia ADD COLUMN no lleva NOT NULL (el "IS NOT NULL" del
    // indice parcial es aparte y no debe confundirse).
    expect(upSql).not.toMatch(/ADD COLUMN "liberada_reprogramada_at"[^;]*NOT NULL/);
  });

  it("crea el indice PARCIAL WHERE liberada_reprogramada_at IS NOT NULL", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "orden_liberada_reprogramada_at_idx"\s+ON "orden" \("liberada_reprogramada_at"\)\s+WHERE "liberada_reprogramada_at" IS NOT NULL;/,
    );
  });

  it("no crea tabla nueva ni toca RLS (migracion aditiva de una columna)", () => {
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upSql).not.toMatch(/CREATE POLICY/i);
  });
});

describe("DOWN — reversible en orden inverso (R18)", () => {
  it("suelta el indice y luego la columna, ambos con IF EXISTS", () => {
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "orden_liberada_reprogramada_at_idx";/);
    expect(downSql).toMatch(
      /ALTER TABLE "orden" DROP COLUMN IF EXISTS "liberada_reprogramada_at";/,
    );
    // orden inverso al UP: primero el indice, luego la columna.
    const iIndex = downSql.indexOf('DROP INDEX IF EXISTS "orden_liberada_reprogramada_at_idx"');
    const iCol = downSql.indexOf('DROP COLUMN IF EXISTS "liberada_reprogramada_at"');
    expect(iIndex).toBeGreaterThanOrEqual(0);
    expect(iCol).toBeGreaterThan(iIndex);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a wallet_movimiento (feature 42)", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const walletDir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_wallet_movimiento"));
    expect(walletDir).toBeDefined();
    expect(dirName > (walletDir as string)).toBe(true);
  });
});
