import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 28: cobertura ESTATICA de la migracion de rename
// `*_rename_order_status_embalaje_en_fulfillment`. Igual que
// carga-masiva-schema.test.ts, NO requiere Postgres real: lee
// migration.sql/down.sql y hace asserts por regex/toContain (R3, R4).

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function renameMigrationDir(): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith("_rename_order_status_embalaje_en_fulfillment"));
  if (!dir) {
    throw new Error(
      "No se encontro la carpeta de migracion *_rename_order_status_embalaje_en_fulfillment",
    );
  }
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = renameMigrationDir();
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("rename order_status migration.sql (UP) — rename in-place (R3)", () => {
  it("hace el UPDATE embalaje -> en_fulfillment", () => {
    expect(upSql).toMatch(
      /UPDATE "order_status" SET "value" = 'en_fulfillment' WHERE "value" = 'embalaje';/,
    );
  });

  it("no crea/borra filas ni toca otras tablas", () => {
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/DROP TABLE/i);
    expect(upSql).not.toMatch(/DELETE/i);
    expect(upSql).not.toMatch(/INSERT/i);
  });
});

describe("rename order_status down.sql (DOWN) — reversion (R4)", () => {
  it("hace el UPDATE inverso en_fulfillment -> embalaje", () => {
    expect(downSql).toMatch(
      /UPDATE "order_status" SET "value" = 'embalaje' WHERE "value" = 'en_fulfillment';/,
    );
  });

  it("no crea/borra filas ni toca otras tablas", () => {
    expect(downSql).not.toMatch(/CREATE TABLE/i);
    expect(downSql).not.toMatch(/DROP TABLE/i);
    expect(downSql).not.toMatch(/DELETE/i);
    expect(downSql).not.toMatch(/INSERT/i);
  });
});
