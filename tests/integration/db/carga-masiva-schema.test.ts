import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 15: cobertura ESTATICA de la migracion `*_carga_masiva_ordenes`.
// Igual que permissions-migration.test.ts / ordenes-rls.test.ts, NO requiere
// Postgres real: lee migration.sql/down.sql y hace asserts por regex/toContain.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function cargaMasivaMigrationDir(): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith("_carga_masiva_ordenes"));
  if (!dir) throw new Error("No se encontro la carpeta de migracion *_carga_masiva_ordenes");
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = cargaMasivaMigrationDir();
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("carga-masiva migration.sql (UP) — columnas nuevas (R1)", () => {
  it("agrega direccion (TEXT nullable)", () => {
    expect(upSql).toMatch(/ADD COLUMN "direccion" TEXT;/);
  });

  it("agrega monto_cobrar DECIMAL(12,2)", () => {
    expect(upSql).toMatch(/ADD COLUMN "monto_cobrar" DECIMAL\(12,2\);/);
  });

  it("agrega mensajero_sugerido_id (TEXT nullable)", () => {
    expect(upSql).toMatch(/ADD COLUMN "mensajero_sugerido_id" TEXT;/);
  });
});

describe("carga-masiva migration.sql (UP) — peso nullable (R4)", () => {
  it("hace DROP NOT NULL sobre peso", () => {
    expect(upSql).toMatch(/ALTER TABLE "orden" ALTER COLUMN "peso" DROP NOT NULL;/);
  });
});

describe("carga-masiva migration.sql (UP) — FK e indice de mensajero_sugerido_id (R2)", () => {
  it("crea el indice orden_mensajero_sugerido_id_idx", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "orden_mensajero_sugerido_id_idx" ON "orden"\("mensajero_sugerido_id"\);/,
    );
  });

  it("agrega la FK hacia usuario con ON DELETE SET NULL", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "orden_mensajero_sugerido_id_fkey" FOREIGN KEY \("mensajero_sugerido_id"\) REFERENCES "usuario"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE;/,
    );
  });
});

describe("carga-masiva migration.sql (UP) — seed idempotente en_preparacion (R6)", () => {
  it("hace INSERT ... ON CONFLICT (value) DO NOTHING de en_preparacion", () => {
    expect(upSql).toMatch(
      /INSERT INTO "order_status" \("id","value"\) VALUES \(gen_random_uuid\(\)::text,'en_preparacion'\) ON CONFLICT \("value"\) DO NOTHING;/,
    );
  });
});

describe("carga-masiva migration.sql (UP) — RLS conservada, sin policies (R3)", () => {
  it("no vuelve a habilitar RLS ni crea policies en esta migracion", () => {
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("no toca otras tablas/columnas fuera de orden y order_status", () => {
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/ALTER TABLE "usuario"/);
    expect(upSql).not.toMatch(/ALTER TABLE "zona"/);
    expect(upSql).not.toMatch(/ALTER TABLE "provincia"/);
    expect(upSql).not.toMatch(/ALTER TABLE "canton"/);
    expect(upSql).not.toMatch(/ALTER TABLE "distrito"/);
  });
});

describe("carga-masiva down.sql — reversion en orden inverso (R3/R6)", () => {
  it("dropea FK e indice de mensajero_sugerido_id antes que la columna", () => {
    expect(downSql).toMatch(
      /DROP CONSTRAINT IF EXISTS "orden_mensajero_sugerido_id_fkey";/,
    );
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "orden_mensajero_sugerido_id_idx";/);
    const idxFk = downSql.indexOf('DROP CONSTRAINT IF EXISTS "orden_mensajero_sugerido_id_fkey"');
    const idxCol = downSql.indexOf('DROP COLUMN IF EXISTS "mensajero_sugerido_id"');
    expect(idxFk).toBeGreaterThanOrEqual(0);
    expect(idxCol).toBeGreaterThan(idxFk);
  });

  it("dropea las 3 columnas nuevas con IF EXISTS", () => {
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS "mensajero_sugerido_id";/);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS "monto_cobrar";/);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS "direccion";/);
  });

  it("elimina el estatus en_preparacion SOLO si no esta referenciado por ninguna orden", () => {
    expect(downSql).toMatch(
      /DELETE FROM "order_status" WHERE "value" = 'en_preparacion' AND NOT EXISTS \(SELECT 1 FROM "orden" o JOIN "order_status" s ON o\."estatus_id"=s\."id" WHERE s\."value"='en_preparacion'\);/,
    );
  });

  it("intenta reponer peso a NOT NULL", () => {
    expect(downSql).toMatch(/ALTER TABLE "orden" ALTER COLUMN "peso" SET NOT NULL;/);
  });

  it("no crea/dropea tablas ni toca otras columnas preexistentes", () => {
    expect(downSql).not.toMatch(/DROP TABLE/i);
    expect(downSql).not.toMatch(/ALTER TABLE "usuario"/);
  });
});
