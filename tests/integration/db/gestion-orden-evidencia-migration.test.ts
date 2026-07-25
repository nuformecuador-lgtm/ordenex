import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 119 — cobertura ESTATICA de la migracion `*_gestion_orden_evidencia` (patron
// gestion-orden-migration.test.ts): lee migration.sql/down.sql por regex, sin Postgres real.
// Cubre R1/R2 (tabla + columnas + FK CASCADE + unique(gestion_id, indice) + index), R3
// (backfill WHERE evidencia_storage_path IS NOT NULL -> indice 0), R4 (RLS sin policy + down
// que suelta la tabla SIN tocar gestion_orden).

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

const migrationDir = migrationDirFor("_gestion_orden_evidencia");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("UP — tabla gestion_orden_evidencia (R1/R2)", () => {
  it("R1: CREATE TABLE con id, gestion_id, storage_path, content_type, indice, created_at (NOT NULL)", () => {
    expect(upSql).toMatch(/CREATE TABLE "gestion_orden_evidencia"/);
    expect(upSql).toContain('"id"           TEXT NOT NULL');
    expect(upSql).toContain('"gestion_id"   TEXT NOT NULL');
    expect(upSql).toContain('"storage_path" TEXT NOT NULL');
    expect(upSql).toContain('"content_type" TEXT NOT NULL');
    expect(upSql).toContain('"indice"       INTEGER NOT NULL');
    expect(upSql).toMatch(/"created_at"\s+TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(upSql).toMatch(/CONSTRAINT "gestion_orden_evidencia_pkey" PRIMARY KEY \("id"\)/);
  });

  it("R1: FK gestion_id -> gestion_orden(id) ON DELETE CASCADE", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "gestion_orden_evidencia_gestion_id_fkey"\s+FOREIGN KEY \("gestion_id"\) REFERENCES "gestion_orden"\("id"\) ON DELETE CASCADE/,
    );
  });

  it("R2: UNIQUE (gestion_id, indice) — no dos filas con el mismo indice por gestion", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "gestion_orden_evidencia_gestion_id_indice_key"\s+ON "gestion_orden_evidencia" \("gestion_id", "indice"\)/,
    );
  });

  it("indice de lectura por gestion_id", () => {
    expect(upSql).toMatch(
      /CREATE INDEX "gestion_orden_evidencia_gestion_id_idx"\s+ON "gestion_orden_evidencia" \("gestion_id"\)/,
    );
  });
});

describe("UP — RLS habilitada sin policies (R4)", () => {
  it("R4: ENABLE ROW LEVEL SECURITY sin CREATE POLICY (solo service role)", () => {
    expect(upSql).toContain('ALTER TABLE "gestion_orden_evidencia" ENABLE ROW LEVEL SECURITY;');
    expect(upSql).not.toMatch(/CREATE POLICY/i);
  });
});

describe("UP — backfill de la portada (R3)", () => {
  it("R3: inserta UNA fila indice 0 por cada gestion con evidencia_storage_path NO nulo", () => {
    expect(upSql).toMatch(/INSERT INTO "gestion_orden_evidencia"/);
    // Selecciona desde gestion_orden solo las que tienen path (las nulas no generan fila).
    expect(upSql).toMatch(/FROM "gestion_orden"/);
    expect(upSql).toMatch(/WHERE "evidencia_storage_path" IS NOT NULL/);
    // indice 0 (portada) y content_type con fallback image/jpeg (Pregunta abierta 4).
    expect(upSql).toMatch(/COALESCE\("evidencia_content_type", 'image\/jpeg'\), 0/);
  });

  it("R3: el backfill NO inventa filas para gestiones sin evidencia (el WHERE las excluye)", () => {
    // No hay INSERT incondicional de gestion_orden hacia la tabla nueva.
    expect(upSql).not.toMatch(/INSERT INTO "gestion_orden_evidencia"[\s\S]*FROM "gestion_orden";/);
  });
});

describe("DOWN — reversible sin tocar gestion_orden (R4)", () => {
  it("R4: DROP TABLE de la tabla nueva (arrastra backfill, FK e indices)", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "gestion_orden_evidencia";/);
  });

  it("R4: el down NO altera ni borra columnas/datos de gestion_orden (portada intacta)", () => {
    expect(downSql).not.toMatch(/ALTER TABLE "gestion_orden"/);
    expect(downSql).not.toMatch(/DROP COLUMN .*evidencia_storage_path/);
    expect(downSql).not.toMatch(/DROP COLUMN .*evidencia_content_type/);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la feature 36", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const feature36Dir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_gestion_orden_estados_metodo_pago"));
    expect(feature36Dir).toBeDefined();
    expect(dirName > (feature36Dir as string)).toBe(true);
  });
});
