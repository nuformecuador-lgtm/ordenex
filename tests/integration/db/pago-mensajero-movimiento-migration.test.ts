import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 44/T3 — cobertura ESTATICA de la migracion `*_pago_mensajero_movimiento` (ESPEJO
// del test de la 43 `wallet-tienda-migration`: lee migration.sql/down.sql por regex; NO
// requiere Postgres real; el round-trip up->down->up contra Postgres queda como verificacion
// manual del leader). El nombre del archivo lleva el sufijo `-movimiento-` porque la 39 ya
// ocupa `pago-mensajero-migration.test.ts` (migracion `_pago_mensajero_cierre`). Cubre R24
// (RLS habilitada sin policies anon/authenticated), R25 (down reversible en orden inverso, sin
// tocar el enum wallet_origen_tipo de la 42), R26 (indices + unique parcial de idempotencia
// (origen_tipo,origen_id,mensajero_id,categoria) WHERE origen_id IS NOT NULL), R17/R23
// (egreso_pago_mensajero de la 42 + categoria liquidacion + origen pago_mensajero reservados).

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

const migrationDir = migrationDirFor("_pago_mensajero_movimiento");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("UP — enums + tabla pago_mensajero_movimiento", () => {
  it("crea los 2 enums nativos propios (tipo devengo/pago + categoria)", () => {
    expect(upSql).toMatch(
      /CREATE TYPE "pago_mensajero_movimiento_tipo" AS ENUM \('devengo', 'pago'\);/,
    );
    expect(upSql).toMatch(/CREATE TYPE "pago_mensajero_movimiento_categoria" AS ENUM/);
    // las 2 categorias que emite el feed (R10).
    for (const cat of ["pago_devengado", "pago_efectivo"]) {
      expect(upSql).toContain(`'${cat}'`);
    }
    // R23: liquidacion + ajustes reservados en el enum (sin migracion adicional).
    for (const cat of ["liquidacion", "ajuste_devengo", "ajuste_pago"]) {
      expect(upSql).toContain(`'${cat}'`);
    }
  });

  it("NO crea un enum de origen nuevo: reutiliza wallet_origen_tipo de la 42", () => {
    expect(upSql).not.toMatch(/CREATE TYPE "wallet_origen_tipo"/);
    // la columna origen_tipo usa el enum existente de la 42.
    expect(upSql).toMatch(/"origen_tipo" "wallet_origen_tipo" NOT NULL/);
  });

  it("crea la tabla con monto DECIMAL(12,2) y SIN updated_at/deleted_at (R1/R3 inmutable)", () => {
    expect(upSql).toMatch(/CREATE TABLE "pago_mensajero_movimiento"/);
    expect(upSql).toMatch(/"monto" DECIMAL\(12,2\) NOT NULL/);
    expect(upSql).toMatch(/"mensajero_id" TEXT NOT NULL/);
    expect(upSql).not.toMatch(/"updated_at"/);
    expect(upSql).not.toMatch(/"deleted_at"/);
  });

  it("FK mensajero_id -> usuario ON DELETE RESTRICT; registrado_por -> usuario ON DELETE SET NULL", () => {
    expect(upSql).toMatch(
      /FOREIGN KEY \("mensajero_id"\) REFERENCES "usuario"\("id"\) ON DELETE RESTRICT/,
    );
    expect(upSql).toMatch(
      /FOREIGN KEY \("registrado_por"\) REFERENCES "usuario"\("id"\) ON DELETE SET NULL/,
    );
  });
});

describe("R24 — RLS habilitada SIN policies anon/authenticated", () => {
  it("ENABLE ROW LEVEL SECURITY sobre pago_mensajero_movimiento, sin CREATE POLICY", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "pago_mensajero_movimiento" ENABLE ROW LEVEL SECURITY;/,
    );
    expect(upSql).not.toMatch(/CREATE POLICY/i);
  });
});

describe("R26 — indices del libro + unique parcial de idempotencia", () => {
  it("crea los 2 indices normales (mensajero+fecha, origen)", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "pago_mensajero_movimiento_mensajero_id_fecha_movimiento_idx" ON "pago_mensajero_movimiento"\("mensajero_id", "fecha_movimiento"\);/,
    );
    expect(upSql).toMatch(
      /CREATE INDEX "pago_mensajero_movimiento_origen_tipo_origen_id_idx" ON "pago_mensajero_movimiento"\("origen_tipo", "origen_id"\);/,
    );
  });

  it("R6/R12/R26: indice UNICO PARCIAL de idempotencia con dimension mensajero_id, WHERE origen_id IS NOT NULL", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "pago_mensajero_movimiento_origen_uq"\s+ON "pago_mensajero_movimiento"\("origen_tipo", "origen_id", "mensajero_id", "categoria"\)\s+WHERE "origen_id" IS NOT NULL;/,
    );
  });
});

describe("R25 — DOWN reversible en orden inverso", () => {
  it("suelta la tabla, luego los 2 enums propios; NO toca wallet_origen_tipo (de la 42)", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "pago_mensajero_movimiento";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "pago_mensajero_movimiento_categoria";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "pago_mensajero_movimiento_tipo";/);
    // NO borra el enum de origen de la 42.
    expect(downSql).not.toMatch(/DROP TYPE IF EXISTS "wallet_origen_tipo"/);

    // orden inverso: tabla -> categoria -> tipo.
    const iTable = downSql.indexOf('DROP TABLE IF EXISTS "pago_mensajero_movimiento"');
    const iCat = downSql.indexOf('DROP TYPE IF EXISTS "pago_mensajero_movimiento_categoria"');
    const iTipo = downSql.indexOf('DROP TYPE IF EXISTS "pago_mensajero_movimiento_tipo"');
    expect(iTable).toBeGreaterThanOrEqual(0);
    expect(iCat).toBeGreaterThan(iTable);
    expect(iTipo).toBeGreaterThan(iCat);
  });
});

describe("R17/R23 — egreso caja 42 + liquidacion RESERVADOS sin migracion adicional", () => {
  it("los enums de la 42 (egreso_pago_mensajero + origen pago_mensajero) siguen reservados (migracion 42)", () => {
    const wallet42Dir = migrationDirFor("_wallet_movimiento");
    const up42 = fs.readFileSync(path.join(wallet42Dir, "migration.sql"), "utf8");
    // R17 (Qa=SI): el enganche inserta un EGRESO egreso_pago_mensajero en la caja 42; el valor
    // ya existe en el enum de la 42 -> no requiere nueva migracion de esquema.
    expect(up42).toContain("'egreso_pago_mensajero'");
    // R23 (Qf=follow-up): origen_tipo pago_mensajero reservado en la 42 para la liquidacion.
    expect(up42).toContain("'pago_mensajero'");
  });

  it("R23: la categoria liquidacion del libro por mensajero queda reservada en el enum (UP)", () => {
    expect(upSql).toContain("'liquidacion'");
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior al de la 43 (wallet_tienda_movimiento)", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const tiendaDir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_wallet_tienda_movimiento"));
    expect(tiendaDir).toBeDefined();
    expect(dirName > (tiendaDir as string)).toBe(true);
  });
});
