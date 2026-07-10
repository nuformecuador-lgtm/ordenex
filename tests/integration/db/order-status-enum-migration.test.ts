import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 28: cobertura ESTATICA de la migracion del enum Postgres
// `order_status_value` (standalone). Patron carga-masiva-schema.test.ts: NO
// requiere Postgres real, lee migration.sql/down.sql y hace asserts (R9, R10).

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

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

  it("tiene exactamente 8 valores identicos al conjunto de ORDER_STATUS_SEED (R10)", () => {
    const enumValues = extractEnumValues(upSql);
    expect(enumValues).toHaveLength(8);
    expect(new Set(enumValues)).toEqual(new Set(ORDER_STATUS_SEED));
  });
});

describe("order_status_value down.sql (DOWN) — elimina el tipo (R9)", () => {
  it("hace DROP TYPE IF EXISTS order_status_value", () => {
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "order_status_value";/);
  });
});
