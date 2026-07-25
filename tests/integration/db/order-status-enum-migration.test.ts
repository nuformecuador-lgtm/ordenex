import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 28: cobertura ESTATICA de la migracion del enum Postgres
// `order_status_value` (standalone). Patron carga-masiva-schema.test.ts: NO
// requiere Postgres real, lee migration.sql/down.sql y hace asserts (R9, R10).
//
// Feature 135/R10: este test lee SQL HISTORICO e inmutable, por lo que afirma los 8
// literales ORIGINALES del enum (los que la migracion `_order_status_value_enum`
// realmente creo), DESACOPLADO de ORDER_STATUS_SEED. Tres de esos 8 originales
// (`en_bodega`, `en_ruta_bodega_principal`, `devuelta_origen`) fueron RENOMBRADOS en
// el seed vigente por feature 135; si el test siguiera derivando el set esperado del
// seed, la comparacion romperia. Los literales viejos que aparecen aqui son
// HISTORICOS por diseno (allowlist del guard de censo R13).

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

// Los 8 valores ORIGINALES del enum standalone, tal cual los creo la migracion
// historica (antes de los ADD VALUE posteriores de features 17/30/36/33/PR#75/109 y
// del rename de feature 135). Fijos: NO se derivan del seed vigente (R10).
const HISTORICAL_ENUM_VALUES = [
  "entregada",
  "devuelta",
  "devuelta_origen",
  "reprogramada",
  "en_fulfillment",
  "en_ruta_bodega_principal",
  "en_bodega",
  "en_preparacion",
];

function enumMigrationDir(): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith("_order_status_value_enum"));
  if (!dir) {
    throw new Error("No se encontro la carpeta de migracion *_order_status_value_enum");
  }
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = enumMigrationDir();
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

function extractEnumValues(sql: string): string[] {
  const match = sql.match(/CREATE TYPE "order_status_value" AS ENUM \(([\s\S]*?)\);/);
  if (!match) throw new Error("No se encontro CREATE TYPE \"order_status_value\" AS ENUM (...)");
  const body = match[1];
  const literals = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return literals;
}

describe("order_status_value migration.sql (UP) — enum standalone (R9)", () => {
  it("crea el tipo CREATE TYPE order_status_value AS ENUM", () => {
    expect(upSql).toMatch(/CREATE TYPE "order_status_value" AS ENUM/);
  });

  it("no retipa la columna (standalone, sin ALTER TABLE)", () => {
    expect(upSql).not.toMatch(/ALTER TABLE/i);
  });

  it("tiene exactamente los 8 valores HISTORICOS originales del enum (R10, desacoplado del seed)", () => {
    // La migracion es historica e inmutable: sigue creando el tipo con sus 8 valores
    // originales. Feature 135 renombro 3 de ellos en el seed vigente, pero este SQL
    // NO cambia: se afirman los literales HISTORICOS fijos, no los del seed.
    const enumValues = extractEnumValues(upSql);
    expect(enumValues).toHaveLength(8);
    expect(new Set(enumValues)).toEqual(new Set(HISTORICAL_ENUM_VALUES));
  });
});

describe("order_status_value down.sql (DOWN) — elimina el tipo (R9)", () => {
  it("hace DROP TYPE IF EXISTS order_status_value", () => {
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "order_status_value";/);
  });
});
