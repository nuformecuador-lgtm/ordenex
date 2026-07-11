import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { METODO_PAGO_SEED } from "@/lib/types/metodo-pago";

// Feature 36 — cobertura ESTATICA de la migracion
// `*_gestion_orden_estados_metodo_pago` (patron postulacion/satelite/enum):
// lee migration.sql/down.sql por regex. NO requiere Postgres real (la aplicacion
// contra Postgres queda como DEUDA declarada). Cubre R2/R3 (estados nuevos), R5
// (enum metodo de pago), R6 (tabla + FKs + campos), R7 (RLS + indices + down),
// R19-R21 (puntero de bloqueo).

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

const migrationDir = migrationDirFor("_gestion_orden_estados_metodo_pago");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("UP — estados nuevos de catalogo (R2/R3)", () => {
  it("R2/R3: ADD VALUE IF NOT EXISTS en_reparto y rechazada (idempotente)", () => {
    expect(upSql).toMatch(/ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'en_reparto';/);
    expect(upSql).toMatch(/ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'rechazada';/);
  });

  it("R2/R3: inserta las filas de catalogo con ON CONFLICT DO NOTHING", () => {
    expect(upSql).toMatch(/INSERT INTO "order_status"/);
    expect(upSql).toMatch(/'en_reparto'/);
    expect(upSql).toMatch(/'rechazada'/);
    expect(upSql).toMatch(/ON CONFLICT \("value"\) DO NOTHING/);
  });

  it("NO usa el estado provisional 'aceptada' (mapeo de terminologia F1.4)", () => {
    expect(upSql).not.toMatch(/'aceptada'/);
  });
});

describe("UP — enum metodo de pago (R5)", () => {
  it("crea el enum metodo_pago_value con efectivo/SIMPE/transferencia (SIMPE mayus, F1.4-c)", () => {
    const match = upSql.match(/CREATE TYPE "metodo_pago_value" AS ENUM \(([^)]*)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(valores)).toEqual(new Set(METODO_PAGO_SEED));
    expect(valores).toContain("SIMPE");
  });
});

describe("UP — tabla gestion_orden (R6/R7)", () => {
  it("crea el enum gestion_resultado con los 4 resultados", () => {
    const match = upSql.match(/CREATE TYPE "gestion_resultado" AS ENUM \(([^)]*)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(valores)).toEqual(new Set(["entregada", "reprogramada", "devuelta", "rechazada"]));
  });

  it("R6: tabla gestion_orden con discriminador resultado + campos nullable + created_at", () => {
    expect(upSql).toMatch(/CREATE TABLE "gestion_orden"/);
    expect(upSql).toContain('"resultado" "gestion_resultado" NOT NULL');
    expect(upSql).toContain('"monto_recibido" DECIMAL(12,2)');
    expect(upSql).toContain('"metodo_pago" "metodo_pago_value"');
    expect(upSql).toContain('"evidencia_storage_path" TEXT');
    expect(upSql).toContain('"evidencia_content_type" TEXT');
    expect(upSql).toContain('"motivo" TEXT');
    expect(upSql).toContain('"fecha_reprogramacion" DATE');
    // nullables: no llevan NOT NULL
    expect(upSql).not.toMatch(/"monto_recibido" DECIMAL\(12,2\) NOT NULL/);
  });

  it("R6: FKs a orden y a usuario", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "gestion_orden_orden_id_fkey"\s+FOREIGN KEY \("orden_id"\) REFERENCES "orden"\("id"\)/,
    );
    expect(upSql).toMatch(
      /ADD CONSTRAINT "gestion_orden_mensajero_id_fkey"\s+FOREIGN KEY \("mensajero_id"\) REFERENCES "usuario"\("id"\)/,
    );
  });

  it("R7: indices por orden_id y por mensajero_id", () => {
    expect(upSql).toMatch(/CREATE INDEX "gestion_orden_orden_id_idx" ON "gestion_orden"\("orden_id"\);/);
    expect(upSql).toMatch(
      /CREATE INDEX "gestion_orden_mensajero_id_idx" ON "gestion_orden"\("mensajero_id"\);/,
    );
  });

  it("R7: RLS habilitada sin policies (solo service role)", () => {
    expect(upSql).toContain('ALTER TABLE "gestion_orden" ENABLE ROW LEVEL SECURITY;');
    expect(upSql).not.toMatch(/CREATE POLICY/i);
  });
});

describe("UP — puntero de bloqueo 1-a-1 (R19-R21)", () => {
  it("agrega usuario.orden_en_gestion_id (TEXT nullable) con FK ON DELETE SET NULL + indice", () => {
    expect(upSql).toMatch(/ALTER TABLE "usuario" ADD COLUMN "orden_en_gestion_id" TEXT;/);
    expect(upSql).not.toMatch(/ADD COLUMN "orden_en_gestion_id" TEXT NOT NULL/);
    expect(upSql).toMatch(
      /ADD CONSTRAINT "usuario_orden_en_gestion_id_fkey"\s+FOREIGN KEY \("orden_en_gestion_id"\) REFERENCES "orden"\("id"\) ON DELETE SET NULL/,
    );
    expect(upSql).toMatch(
      /CREATE INDEX "usuario_orden_en_gestion_id_idx" ON "usuario"\("orden_en_gestion_id"\);/,
    );
  });
});

describe("DOWN — reversible (R7)", () => {
  it("dropea gestion_orden y sus enums, y quita la columna puntero", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "gestion_orden";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "gestion_resultado";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "metodo_pago_value";/);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS "orden_en_gestion_id";/);
    expect(downSql).toMatch(/DROP CONSTRAINT IF EXISTS "usuario_orden_en_gestion_id_fkey";/);
  });

  it("R2/R3: elimina las filas de catalogo SOLO si ninguna orden las referencia", () => {
    expect(downSql).toMatch(/DELETE FROM "order_status" WHERE "value" IN \('en_reparto','rechazada'\)/);
    expect(downSql).toMatch(/NOT EXISTS \(SELECT 1 FROM "orden"/);
  });

  it("documenta que los valores del enum order_status_value NO se eliminan (sin DROP VALUE)", () => {
    expect(downSql).not.toMatch(/ALTER TYPE[^;]*DROP VALUE/i);
    expect(downSql.toLowerCase()).toMatch(/no soporta drop value|no se eliminan/);
  });
});

describe("estructura de la carpeta de migracion", () => {
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
    expect(dirName > (feature30Dir as string)).toBe(true);
  });
});
