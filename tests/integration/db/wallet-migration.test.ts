import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 42 — cobertura ESTATICA de la migracion `*_wallet_movimiento` (ESPEJO del
// test de la 56 `ingreso-bodega-migration`: lee migration.sql/down.sql por regex; NO
// requiere Postgres real; el round-trip up->down->up contra Postgres queda como
// verificacion manual del implementer). Cubre R22 (RLS habilitada sin policies), R23
// (down reversible en orden inverso), R24 (3 indices + unique parcial de idempotencia
// WHERE origen_id IS NOT NULL), R26 (orden.cobra_comision BOOLEAN NOT NULL DEFAULT true
// en el UP; DROP COLUMN en el down).

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

const migrationDir = migrationDirFor("_wallet_movimiento");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("UP — enums + tabla wallet_movimiento", () => {
  it("crea los 3 enums nativos con todas las categorias", () => {
    expect(upSql).toMatch(/CREATE TYPE "wallet_movimiento_tipo" AS ENUM \('ingreso', 'egreso'\);/);
    expect(upSql).toMatch(/CREATE TYPE "wallet_movimiento_categoria" AS ENUM/);
    expect(upSql).toMatch(/CREATE TYPE "wallet_origen_tipo" AS ENUM/);
    // los 6 conceptos de ingreso de Ordenex + ajuste manual.
    for (const cat of [
      "ingreso_flete",
      "ingreso_flete_devolucion",
      "ingreso_comision_cod",
      "ingreso_iva_flete",
      "ingreso_iva_flete_devolucion",
      "ingreso_iva_comision_cod",
      "ingreso_ajuste",
    ]) {
      expect(upSql).toContain(`'${cat}'`);
    }
    // egresos reservados para 43/44/45.
    for (const cat of ["egreso_pago_tienda", "egreso_pago_mensajero", "egreso_gasto", "egreso_sueldo", "egreso_ajuste"]) {
      expect(upSql).toContain(`'${cat}'`);
    }
  });

  it("crea la tabla wallet_movimiento con monto DECIMAL(12,2) y SIN updated_at/deleted_at (R1/R3 inmutable)", () => {
    expect(upSql).toMatch(/CREATE TABLE "wallet_movimiento"/);
    expect(upSql).toMatch(/"monto" DECIMAL\(12,2\) NOT NULL/);
    expect(upSql).not.toMatch(/"updated_at"/);
    expect(upSql).not.toMatch(/"deleted_at"/);
  });

  it("FK registrado_por -> usuario ON DELETE SET NULL (borrar usuario no borra el libro)", () => {
    expect(upSql).toMatch(
      /FOREIGN KEY \("registrado_por"\) REFERENCES "usuario"\("id"\) ON DELETE SET NULL/,
    );
  });
});

describe("R22 — RLS habilitada SIN policies", () => {
  it("ENABLE ROW LEVEL SECURITY sobre wallet_movimiento, sin CREATE POLICY", () => {
    expect(upSql).toMatch(/ALTER TABLE "wallet_movimiento" ENABLE ROW LEVEL SECURITY;/);
    expect(upSql).not.toMatch(/CREATE POLICY/i);
  });
});

describe("R24 — indices del libro + unique parcial de idempotencia", () => {
  it("crea los 3 indices normales (fecha, tipo+categoria, origen)", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "wallet_movimiento_fecha_movimiento_idx" ON "wallet_movimiento"\("fecha_movimiento"\);/,
    );
    expect(upSql).toMatch(
      /CREATE INDEX "wallet_movimiento_tipo_categoria_idx" ON "wallet_movimiento"\("tipo", "categoria"\);/,
    );
    expect(upSql).toMatch(
      /CREATE INDEX "wallet_movimiento_origen_tipo_origen_id_idx" ON "wallet_movimiento"\("origen_tipo", "origen_id"\);/,
    );
  });

  it("R6/R13/R24: indice UNICO PARCIAL de idempotencia WHERE origen_id IS NOT NULL", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "wallet_movimiento_origen_categoria_uq"\s+ON "wallet_movimiento"\("origen_tipo", "origen_id", "categoria"\)\s+WHERE "origen_id" IS NOT NULL;/,
    );
  });
});

describe("R26 — orden.cobra_comision", () => {
  it("ADD COLUMN cobra_comision BOOLEAN NOT NULL DEFAULT true (retro-compatible)", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "orden" ADD COLUMN "cobra_comision" BOOLEAN NOT NULL DEFAULT true;/,
    );
  });
});

describe("R23 — DOWN reversible en orden inverso", () => {
  it("suelta cobra_comision, luego la tabla, luego los 3 enums (orden inverso al UP)", () => {
    expect(downSql).toMatch(/ALTER TABLE "orden" DROP COLUMN IF EXISTS "cobra_comision";/);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "wallet_movimiento";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "wallet_origen_tipo";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "wallet_movimiento_categoria";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "wallet_movimiento_tipo";/);

    // orden inverso: columna orden -> tabla -> enums.
    const iCol = downSql.indexOf('"orden" DROP COLUMN IF EXISTS "cobra_comision"');
    const iTable = downSql.indexOf('DROP TABLE IF EXISTS "wallet_movimiento"');
    const iEnumOrigen = downSql.indexOf('DROP TYPE IF EXISTS "wallet_origen_tipo"');
    const iEnumTipo = downSql.indexOf('DROP TYPE IF EXISTS "wallet_movimiento_tipo"');
    expect(iCol).toBeGreaterThanOrEqual(0);
    expect(iTable).toBeGreaterThan(iCol);
    expect(iEnumOrigen).toBeGreaterThan(iTable);
    expect(iEnumTipo).toBeGreaterThan(iEnumOrigen);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a cierre_estado_vencido (feature 41)", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const vencidoDir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_cierre_estado_vencido"));
    expect(vencidoDir).toBeDefined();
    expect(dirName > (vencidoDir as string)).toBe(true);
  });
});
