import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 56 — cobertura ESTATICA de la migracion `*_ingreso_bodega_rechazos` (ESPEJO del
// test de la 39 `pago-mensajero-migration`: lee migration.sql/down.sql por regex; NO requiere
// Postgres real; la aplicacion up->down->up contra Postgres queda como round-trip manual,
// verificado por el implementer). Cubre R21 (migracion ADITIVA de 3 columnas:
// gestion_orden.ingreso_bodega_rechazo NULL, cierre_dia/cierre_bodega.total_ingreso_bodega_rechazos
// NOT NULL DEFAULT 0 -> cierres previos leen 0.00) y la reversibilidad del down.sql en orden inverso.

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

const migrationDir = migrationDirFor("_ingreso_bodega_rechazos");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("UP — columnas de snapshot del ingreso de bodega por rechazos (R21)", () => {
  it("R21: gestion_orden.ingreso_bodega_rechazo DECIMAL(12,2) NULLABLE (gestion sin cerrar)", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "gestion_orden"\s+ADD COLUMN "ingreso_bodega_rechazo" DECIMAL\(12,2\);/,
    );
    // NULLABLE: no lleva NOT NULL.
    expect(upSql).not.toMatch(/ADD COLUMN "ingreso_bodega_rechazo" DECIMAL\(12,2\) NOT NULL/);
  });

  it("R21: cierre_dia.total_ingreso_bodega_rechazos DECIMAL(12,2) NOT NULL DEFAULT 0 (cierres previos = 0.00)", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "cierre_dia"\s+ADD COLUMN "total_ingreso_bodega_rechazos" DECIMAL\(12,2\) NOT NULL DEFAULT 0;/,
    );
  });

  it("R21: cierre_bodega.total_ingreso_bodega_rechazos DECIMAL(12,2) NOT NULL DEFAULT 0 (cierres previos = 0.00)", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "cierre_bodega"\s+ADD COLUMN "total_ingreso_bodega_rechazos" DECIMAL\(12,2\) NOT NULL DEFAULT 0;/,
    );
  });

  it("R21: migracion ADITIVA — sin tablas nuevas, sin tocar RLS ni enums", () => {
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/DROP TABLE/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/CREATE TYPE|ALTER TYPE|DROP TYPE/i);
  });
});

describe("DOWN — reversible en orden inverso (R21)", () => {
  it("suelta las 3 columnas con IF EXISTS, en orden inverso al UP", () => {
    expect(downSql).toMatch(/ALTER TABLE "cierre_bodega" DROP COLUMN IF EXISTS "total_ingreso_bodega_rechazos";/);
    expect(downSql).toMatch(/ALTER TABLE "cierre_dia" DROP COLUMN IF EXISTS "total_ingreso_bodega_rechazos";/);
    expect(downSql).toMatch(/ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "ingreso_bodega_rechazo";/);

    // orden inverso: cierre_bodega -> cierre_dia -> gestion_orden.
    const iBodega = downSql.indexOf('"cierre_bodega" DROP COLUMN IF EXISTS "total_ingreso_bodega_rechazos"');
    const iDia = downSql.indexOf('"cierre_dia" DROP COLUMN IF EXISTS "total_ingreso_bodega_rechazos"');
    const iGestion = downSql.indexOf('"gestion_orden" DROP COLUMN IF EXISTS "ingreso_bodega_rechazo"');
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
  it("contiene migration.sql y down.sql, con timestamp posterior a la feature 39 (pago_mensajero_cierre)", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    // R21: la 56 se aplica DESPUES de la 39 (que introdujo total_pago_mensajero).
    const pagoMensajeroDir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_pago_mensajero_cierre"));
    expect(pagoMensajeroDir).toBeDefined();
    expect(dirName > (pagoMensajeroDir as string)).toBe(true);
    // ...y tambien posterior a la feature 40 (cierre_bodega), como el test de la 39.
    const cierreBodegaDir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_cierre_bodega"));
    expect(cierreBodegaDir).toBeDefined();
    expect(dirName > (cierreBodegaDir as string)).toBe(true);
  });
});
