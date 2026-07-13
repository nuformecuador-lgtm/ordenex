import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 43/T3 — cobertura ESTATICA de la migracion `*_wallet_tienda_movimiento` (ESPEJO
// del test de la 42 `wallet-migration`: lee migration.sql/down.sql por regex; NO requiere
// Postgres real; el round-trip up->down->up contra Postgres queda como verificacion manual
// del implementer, YA EJECUTADO). Cubre R24 (RLS habilitada sin policies anon/authenticated),
// R25 (down reversible en orden inverso, sin tocar el enum wallet_origen_tipo de la 42),
// R26 (3 indices + unique parcial de idempotencia (origen_tipo,origen_id,tienda_id,categoria)
// WHERE origen_id IS NOT NULL), R17/R23 (categorias pago_tienda + ajuste_* reservadas).

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

const migrationDir = migrationDirFor("_wallet_tienda_movimiento");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("UP — enums + tabla wallet_tienda_movimiento", () => {
  it("crea los 2 enums nativos propios (tipo credito/debito + categoria)", () => {
    expect(upSql).toMatch(
      /CREATE TYPE "wallet_tienda_movimiento_tipo" AS ENUM \('credito', 'debito'\);/,
    );
    expect(upSql).toMatch(/CREATE TYPE "wallet_tienda_movimiento_categoria" AS ENUM/);
    // credito + los 6 debitos espejo 1:1 de la 42 (R8).
    for (const cat of [
      "cod_recaudado",
      "flete",
      "flete_devolucion",
      "comision_cod",
      "iva_flete",
      "iva_flete_devolucion",
      "iva_comision_cod",
    ]) {
      expect(upSql).toContain(`'${cat}'`);
    }
    // R17/R23: pago_tienda + ajustes reservados en el enum (sin migracion adicional).
    for (const cat of ["pago_tienda", "ajuste_credito", "ajuste_debito"]) {
      expect(upSql).toContain(`'${cat}'`);
    }
  });

  it("NO crea un enum de origen nuevo: reutiliza wallet_origen_tipo de la 42", () => {
    expect(upSql).not.toMatch(/CREATE TYPE "wallet_origen_tipo"/);
    // la columna origen_tipo usa el enum existente de la 42.
    expect(upSql).toMatch(/"origen_tipo" "wallet_origen_tipo" NOT NULL/);
  });

  it("crea la tabla con monto DECIMAL(12,2) y SIN updated_at/deleted_at (R1/R3 inmutable)", () => {
    expect(upSql).toMatch(/CREATE TABLE "wallet_tienda_movimiento"/);
    expect(upSql).toMatch(/"monto" DECIMAL\(12,2\) NOT NULL/);
    expect(upSql).toMatch(/"tienda_id" TEXT NOT NULL/);
    expect(upSql).not.toMatch(/"updated_at"/);
    expect(upSql).not.toMatch(/"deleted_at"/);
  });

  it("FK tienda_id -> usuario ON DELETE RESTRICT; registrado_por -> usuario ON DELETE SET NULL", () => {
    expect(upSql).toMatch(
      /FOREIGN KEY \("tienda_id"\) REFERENCES "usuario"\("id"\) ON DELETE RESTRICT/,
    );
    expect(upSql).toMatch(
      /FOREIGN KEY \("registrado_por"\) REFERENCES "usuario"\("id"\) ON DELETE SET NULL/,
    );
  });
});

describe("R24 — RLS habilitada SIN policies anon/authenticated", () => {
  it("ENABLE ROW LEVEL SECURITY sobre wallet_tienda_movimiento, sin CREATE POLICY", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "wallet_tienda_movimiento" ENABLE ROW LEVEL SECURITY;/,
    );
    expect(upSql).not.toMatch(/CREATE POLICY/i);
  });
});

describe("R26 — indices del ledger + unique parcial de idempotencia", () => {
  it("crea los 3 indices normales (tienda+fecha, tienda+categoria, origen)", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "wallet_tienda_movimiento_tienda_id_fecha_movimiento_idx" ON "wallet_tienda_movimiento"\("tienda_id", "fecha_movimiento"\);/,
    );
    expect(upSql).toMatch(
      /CREATE INDEX "wallet_tienda_movimiento_tienda_id_categoria_idx" ON "wallet_tienda_movimiento"\("tienda_id", "categoria"\);/,
    );
    expect(upSql).toMatch(
      /CREATE INDEX "wallet_tienda_movimiento_origen_tipo_origen_id_idx" ON "wallet_tienda_movimiento"\("origen_tipo", "origen_id"\);/,
    );
  });

  it("R6/R13/R26: indice UNICO PARCIAL de idempotencia con dimension tienda_id, WHERE origen_id IS NOT NULL", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "wallet_tienda_movimiento_origen_uq"\s+ON "wallet_tienda_movimiento"\("origen_tipo", "origen_id", "tienda_id", "categoria"\)\s+WHERE "origen_id" IS NOT NULL;/,
    );
  });
});

describe("R25 — DOWN reversible en orden inverso", () => {
  it("suelta la tabla, luego los 2 enums propios; NO toca wallet_origen_tipo (de la 42)", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "wallet_tienda_movimiento";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "wallet_tienda_movimiento_categoria";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "wallet_tienda_movimiento_tipo";/);
    // NO borra el enum de origen de la 42.
    expect(downSql).not.toMatch(/DROP TYPE IF EXISTS "wallet_origen_tipo"/);

    // orden inverso: tabla -> categoria -> tipo.
    const iTable = downSql.indexOf('DROP TABLE IF EXISTS "wallet_tienda_movimiento"');
    const iCat = downSql.indexOf('DROP TYPE IF EXISTS "wallet_tienda_movimiento_categoria"');
    const iTipo = downSql.indexOf('DROP TYPE IF EXISTS "wallet_tienda_movimiento_tipo"');
    expect(iTable).toBeGreaterThanOrEqual(0);
    expect(iCat).toBeGreaterThan(iTable);
    expect(iTipo).toBeGreaterThan(iCat);
  });
});

describe("R17/R23 — pago/liquidacion RESERVADO sin migracion adicional (Q4 = follow-up)", () => {
  it("la categoria pago_tienda del ledger de tienda queda reservada en el enum (UP)", () => {
    expect(upSql).toContain("'pago_tienda'");
  });

  it("los enums de la 42 (egreso_pago_tienda + origen pago_tienda) siguen reservados (migracion 42)", () => {
    const wallet42Dir = migrationDirFor("_wallet_movimiento");
    const up42 = fs.readFileSync(path.join(wallet42Dir, "migration.sql"), "utf8");
    // el follow-up de pago inserta un EGRESO egreso_pago_tienda (42) + un DEBITO pago_tienda
    // (43): ambos valores ya existen en los enums -> no requiere nueva migracion de esquema.
    expect(up42).toContain("'egreso_pago_tienda'");
    // origen_tipo pago_tienda tambien reservado en la 42.
    expect(up42).toContain("'pago_tienda'");
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior al de la 42 (wallet_movimiento)", () => {
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
