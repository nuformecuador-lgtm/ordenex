import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 33 — cobertura ESTATICA de la migracion
// `*_order_status_en_bodega_satelite` (patron order-status-satelite-migration de
// la feature 30): lee migration.sql/down.sql por regex. NO requiere Postgres real
// (la aplicacion contra Postgres queda como DEUDA declarada si no hay DB en el
// entorno; ver progress/impl_33). Cubre R2 (inserta la fila + ADD VALUE), R20 (un
// unico valor nuevo) y R21 (down.sql condicional reversible).

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

const migrationDir = migrationDirFor("_order_status_en_bodega_satelite");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("UP — inserta el estado en_bodega_satelite (R2/R20)", () => {
  it("R2: ALTER TYPE ... ADD VALUE IF NOT EXISTS 'en_bodega_satelite' (idempotente)", () => {
    expect(upSql).toMatch(
      /ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'en_bodega_satelite';/,
    );
  });

  it("R2: inserta la fila de catalogo order_status con ON CONFLICT DO NOTHING", () => {
    expect(upSql).toMatch(/INSERT INTO "order_status"/);
    expect(upSql).toMatch(/'en_bodega_satelite'/);
    expect(upSql).toMatch(/ON CONFLICT \("value"\) DO NOTHING/);
  });

  it("R20: introduce UN solo valor nuevo (no un estado dinamico por zona)", () => {
    const addValues = [...upSql.matchAll(/ADD VALUE IF NOT EXISTS '([^']+)'/g)].map((m) => m[1]);
    expect(addValues).toEqual(["en_bodega_satelite"]);
    // El seed TS tambien lo lleva como valor unico (no por-zona).
    expect(ORDER_STATUS_SEED.filter((v) => v === "en_bodega_satelite")).toHaveLength(1);
  });

  it("no agrega tablas/columnas ni toca RLS (sin superficie nueva)", () => {
    expect(upSql).not.toMatch(/ALTER TABLE/i);
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("DOWN — reversible y condicional (R21)", () => {
  it("R21: elimina la fila SOLO si ninguna orden la referencia", () => {
    expect(downSql).toMatch(/DELETE FROM "order_status" WHERE "value" = 'en_bodega_satelite'/);
    expect(downSql).toMatch(/NOT EXISTS \(SELECT 1 FROM "orden"/);
  });

  it("documenta que el valor del enum Postgres NO se elimina (Postgres no soporta DROP VALUE)", () => {
    // El down.sql NO ejecuta un DROP VALUE (Postgres no lo soporta); solo lo
    // documenta en un comentario. No debe existir una sentencia SQL de DROP VALUE.
    expect(downSql).not.toMatch(/ALTER TYPE[^;]*DROP VALUE/i);
    expect(downSql.toLowerCase()).toMatch(/no soporta drop value|no se elimina/);
  });
});

describe("estructura de la carpeta de migracion (R21)", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la feature 30", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);

    const dirName = path.basename(migrationDir);
    const feature30Dir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_order_status_en_ruta_bodega_satelite"));
    expect(feature30Dir).toBeDefined();
    // El timestamp de esta migracion es posterior al de la feature 30.
    expect(dirName > (feature30Dir as string)).toBe(true);
  });
});
