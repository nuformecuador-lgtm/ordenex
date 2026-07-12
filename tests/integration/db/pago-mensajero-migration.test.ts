import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 39 — cobertura ESTATICA de la migracion `*_pago_mensajero_cierre` (patron
// cierre-dia-migration/cierre-bodega-migration: lee migration.sql/down.sql por regex; NO
// requiere Postgres real; la aplicacion up->down->up contra Postgres queda como round-trip
// manual, verificado por el implementer). Cubre R22 (migracion ADITIVA de 3 columnas:
// gestion_orden.pago_mensajero NULL, cierre_dia/cierre_bodega.total_pago_mensajero NOT NULL
// DEFAULT 0 -> cierres previos leen 0.00) y la reversibilidad del down.sql en orden inverso.

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

const migrationDir = migrationDirFor("_pago_mensajero_cierre");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("UP — columnas de snapshot del pago al mensajero (R22)", () => {
  it("R22: gestion_orden.pago_mensajero DECIMAL(12,2) NULLABLE (gestion sin cerrar)", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "gestion_orden"\s+ADD COLUMN "pago_mensajero" DECIMAL\(12,2\);/,
    );
    // NULLABLE: no lleva NOT NULL.
    expect(upSql).not.toMatch(/ADD COLUMN "pago_mensajero" DECIMAL\(12,2\) NOT NULL/);
  });

  it("R22: cierre_dia.total_pago_mensajero DECIMAL(12,2) NOT NULL DEFAULT 0 (cierres previos = 0.00)", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "cierre_dia"\s+ADD COLUMN "total_pago_mensajero" DECIMAL\(12,2\) NOT NULL DEFAULT 0;/,
    );
  });

  it("R22: cierre_bodega.total_pago_mensajero DECIMAL(12,2) NOT NULL DEFAULT 0 (cierres previos = 0.00)", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "cierre_bodega"\s+ADD COLUMN "total_pago_mensajero" DECIMAL\(12,2\) NOT NULL DEFAULT 0;/,
    );
  });

  it("R22: migracion ADITIVA — sin tablas nuevas, sin tocar RLS ni enums", () => {
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/DROP TABLE/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/CREATE TYPE|ALTER TYPE|DROP TYPE/i);
  });
});

describe("DOWN — reversible en orden inverso (R22)", () => {
  it("suelta las 3 columnas con IF EXISTS, en orden inverso al UP", () => {
    expect(downSql).toMatch(/ALTER TABLE "cierre_bodega" DROP COLUMN IF EXISTS "total_pago_mensajero";/);
    expect(downSql).toMatch(/ALTER TABLE "cierre_dia" DROP COLUMN IF EXISTS "total_pago_mensajero";/);
    expect(downSql).toMatch(/ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "pago_mensajero";/);

    // orden inverso: cierre_bodega -> cierre_dia -> gestion_orden.
    const iBodega = downSql.indexOf('"cierre_bodega" DROP COLUMN IF EXISTS "total_pago_mensajero"');
    const iDia = downSql.indexOf('"cierre_dia" DROP COLUMN IF EXISTS "total_pago_mensajero"');
    const iGestion = downSql.indexOf('"gestion_orden" DROP COLUMN IF EXISTS "pago_mensajero"');
    expect(iBodega).toBeGreaterThanOrEqual(0);
    expect(iDia).toBeGreaterThan(iBodega);
    expect(iGestion).toBeGreaterThan(iDia);
  });

  it("el down NO dropea tablas ni toca RLS/enums (solo revierte las columnas del UP)", () => {
    expect(downSql).not.toMatch(/DROP TABLE/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(downSql).not.toMatch(/DROP TYPE|CREATE TYPE/i);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la feature 40 (cierre_bodega)", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const cierreBodegaDir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_cierre_bodega"));
    expect(cierreBodegaDir).toBeDefined();
    expect(dirName > (cierreBodegaDir as string)).toBe(true);
  });
});
