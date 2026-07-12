import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { CIERRE_ESTADO_SEED, CIERRE_DESTINO_TIPO_SEED } from "@/lib/types/cierre";

// Feature 37 — cobertura ESTATICA de la migracion `*_cierre_dia` (patron
// gestion-orden-migration/zonas-migration): lee migration.sql/down.sql por regex.
// NO requiere Postgres real (la aplicacion contra Postgres queda como round-trip
// manual, verificado por el implementer). Cubre R13-R16 (tabla + FKs + destino +
// snapshot), R19 (RLS habilitada) y R20 (down.sql reversible en orden inverso).

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

const migrationDir = migrationDirFor("_cierre_dia");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("UP — enums cierre_estado / cierre_destino_tipo (R13/R15/R18)", () => {
  it("crea el enum cierre_estado con solicitado/aprobado/rechazado (SEED)", () => {
    const match = upSql.match(/CREATE TYPE "cierre_estado" AS ENUM \(([^)]*)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(valores)).toEqual(new Set(CIERRE_ESTADO_SEED));
  });

  it("crea el enum cierre_destino_tipo con bodega_central/bodega_satelite (SEED)", () => {
    const match = upSql.match(/CREATE TYPE "cierre_destino_tipo" AS ENUM \(([^)]*)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(valores)).toEqual(new Set(CIERRE_DESTINO_TIPO_SEED));
  });
});

describe("UP — tabla cierre_dia (R13-R16/R19)", () => {
  it("R13/R14: tabla con destino derivado + totales snapshot DECIMAL(12,2) NOT NULL DEFAULT 0", () => {
    expect(upSql).toMatch(/CREATE TABLE "cierre_dia"/);
    expect(upSql).toContain('"mensajero_id" TEXT NOT NULL');
    expect(upSql).toContain('"estado" "cierre_estado" NOT NULL DEFAULT \'solicitado\'');
    expect(upSql).toContain('"destino_tipo" "cierre_destino_tipo" NOT NULL');
    expect(upSql).toContain('"destino_zona_id" TEXT NOT NULL');
    expect(upSql).toContain('"total_efectivo" DECIMAL(12,2) NOT NULL DEFAULT 0');
    expect(upSql).toContain('"total_simpe" DECIMAL(12,2) NOT NULL DEFAULT 0');
    expect(upSql).toContain('"total_transferencia" DECIMAL(12,2) NOT NULL DEFAULT 0');
    expect(upSql).toContain('"total_general" DECIMAL(12,2) NOT NULL DEFAULT 0');
  });

  it("R15/R16: FKs a usuario (mensajero) y a zona (destino)", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "cierre_dia_mensajero_id_fkey"\s+FOREIGN KEY \("mensajero_id"\) REFERENCES "usuario"\("id"\)/,
    );
    expect(upSql).toMatch(
      /ADD CONSTRAINT "cierre_dia_destino_zona_id_fkey"\s+FOREIGN KEY \("destino_zona_id"\) REFERENCES "zona"\("id"\)/,
    );
  });

  it("indices por mensajero, por destino (rol+zona, feature 38) y por estado", () => {
    expect(upSql).toMatch(/CREATE INDEX "cierre_dia_mensajero_id_idx" ON "cierre_dia"\("mensajero_id"\);/);
    expect(upSql).toMatch(
      /CREATE INDEX "cierre_dia_destino_tipo_destino_zona_id_idx" ON "cierre_dia"\("destino_tipo","destino_zona_id"\);/,
    );
    expect(upSql).toMatch(/CREATE INDEX "cierre_dia_estado_idx" ON "cierre_dia"\("estado"\);/);
  });

  it("R19: RLS habilitada sin policies (solo service role)", () => {
    expect(upSql).toContain('ALTER TABLE "cierre_dia" ENABLE ROW LEVEL SECURITY;');
    expect(upSql).not.toMatch(/CREATE POLICY/i);
  });
});

describe("UP — FK nullable cierre_id en gestion_orden (R13/R3)", () => {
  it("agrega gestion_orden.cierre_id (TEXT nullable) con FK ON DELETE SET NULL + indice", () => {
    expect(upSql).toMatch(/ALTER TABLE "gestion_orden" ADD COLUMN "cierre_id" TEXT;/);
    expect(upSql).not.toMatch(/ADD COLUMN "cierre_id" TEXT NOT NULL/);
    expect(upSql).toMatch(
      /ADD CONSTRAINT "gestion_orden_cierre_id_fkey"\s+FOREIGN KEY \("cierre_id"\) REFERENCES "cierre_dia"\("id"\) ON DELETE SET NULL/,
    );
    expect(upSql).toMatch(/CREATE INDEX "gestion_orden_cierre_id_idx" ON "gestion_orden"\("cierre_id"\);/);
  });
});

describe("DOWN — reversible en orden inverso (R20)", () => {
  it("quita cierre_id de gestion_orden (FK + indice + columna) ANTES de dropear cierre_dia", () => {
    expect(downSql).toMatch(/DROP CONSTRAINT IF EXISTS "gestion_orden_cierre_id_fkey";/);
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "gestion_orden_cierre_id_idx";/);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS "cierre_id";/);
    // orden inverso: la columna en gestion_orden se suelta antes que la tabla cierre_dia.
    const idxCol = downSql.indexOf('DROP COLUMN IF EXISTS "cierre_id"');
    const idxTable = downSql.indexOf('DROP TABLE IF EXISTS "cierre_dia"');
    expect(idxCol).toBeGreaterThanOrEqual(0);
    expect(idxTable).toBeGreaterThan(idxCol);
  });

  it("dropea la tabla cierre_dia y sus dos enums", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "cierre_dia";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "cierre_destino_tipo";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "cierre_estado";/);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la feature 54", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const feature54Dir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_zona_es_central_rename"));
    expect(feature54Dir).toBeDefined();
    expect(dirName > (feature54Dir as string)).toBe(true);
  });
});
