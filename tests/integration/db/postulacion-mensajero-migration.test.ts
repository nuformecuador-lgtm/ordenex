import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { DOCUMENTO_TIPOS } from "@/lib/types/postulacion-mensajero";

// Feature 21: cobertura ESTATICA de la migracion `*_postulacion_mensajero`.
// Patron vehiculos-migration / carga-masiva-schema: NO requiere Postgres real,
// lee migration.sql/down.sql y hace asserts por regex/toContain (R13/R16/R21/R25).
// La aplicacion real contra Postgres queda DIFERIDA (la aplica el humano).

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

const migrationDir = migrationDirFor("_postulacion_mensajero");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

function extractEnumValues(sql: string): string[] {
  const match = sql.match(/CREATE TYPE "mensajero_documento_tipo" AS ENUM \(([\s\S]*?)\);/);
  if (!match) throw new Error("No se encontro CREATE TYPE mensajero_documento_tipo");
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("postulacion migration.sql (UP) — columnas nuevas en usuario (R13)", () => {
  it("agrega primer_apellido, segundo_apellido, vehiculo_id y placa como TEXT nullable", () => {
    expect(upSql).toMatch(/ALTER TABLE "usuario" ADD COLUMN "primer_apellido" TEXT;/);
    expect(upSql).toMatch(/ALTER TABLE "usuario" ADD COLUMN "segundo_apellido" TEXT;/);
    expect(upSql).toMatch(/ALTER TABLE "usuario" ADD COLUMN "vehiculo_id" TEXT;/);
    expect(upSql).toMatch(/ALTER TABLE "usuario" ADD COLUMN "placa" TEXT;/);
    // Nullable: sin NOT NULL para preservar filas existentes de otros roles.
    expect(upSql).not.toMatch(/ADD COLUMN "primer_apellido" TEXT NOT NULL/);
  });

  it("crea el FK usuario.vehiculo_id -> vehiculos(id) con ON DELETE RESTRICT (R13)", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "usuario_vehiculo_id_fkey" FOREIGN KEY \("vehiculo_id"\) REFERENCES "vehiculos"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE;/,
    );
    expect(upSql).toMatch(/CREATE INDEX "usuario_vehiculo_id_idx" ON "usuario"\("vehiculo_id"\);/);
  });
});

describe("postulacion migration.sql (UP) — tabla y enum de documentos (R16)", () => {
  it("crea el enum mensajero_documento_tipo con los 5 tipos de DOCUMENTO_TIPOS", () => {
    const valores = extractEnumValues(upSql);
    expect(valores).toHaveLength(5);
    expect(new Set(valores)).toEqual(new Set(DOCUMENTO_TIPOS));
  });

  it("crea la tabla mensajero_documento con storage_path y content_type NOT NULL", () => {
    expect(upSql).toMatch(/CREATE TABLE "mensajero_documento"/);
    expect(upSql).toContain('"storage_path" TEXT NOT NULL');
    expect(upSql).toContain('"content_type" TEXT NOT NULL');
    expect(upSql).toMatch(/CONSTRAINT "mensajero_documento_pkey" PRIMARY KEY \("id"\)/);
  });

  it("un documento por tipo por usuario: unique (usuario_id, tipo) (R16)", () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "mensajero_documento_usuario_id_tipo_key" ON "mensajero_documento"\("usuario_id", "tipo"\);/,
    );
  });

  it("FK a usuario con ON DELETE CASCADE (base de la limpieza atomica R24)", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "mensajero_documento_usuario_id_fkey" FOREIGN KEY \("usuario_id"\) REFERENCES "usuario"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE;/,
    );
  });
});

describe("postulacion migration.sql (UP) — unicidad y RLS (R21, R25)", () => {
  it("R21: no redefine la unicidad de email/cedula (ya existe en usuario), no la duplica", () => {
    // El constraint unico vive en la migracion de login; no se recrea aqui.
    expect(upSql).not.toMatch(/CREATE UNIQUE INDEX "usuario_email_key"/);
    expect(upSql).not.toMatch(/CREATE UNIQUE INDEX "usuario_cedula_key"/);
  });

  it("R25: habilita RLS en mensajero_documento", () => {
    expect(upSql).toContain('ALTER TABLE "mensajero_documento" ENABLE ROW LEVEL SECURITY;');
  });

  it("R25: no crea policies para anon/authenticated (solo service role)", () => {
    expect(upSql).not.toMatch(/CREATE POLICY/i);
  });

  it("no toca la tabla vehiculos (dependencia preexistente feature 50)", () => {
    expect(upSql).not.toMatch(/CREATE TABLE "vehiculos"/);
    expect(upSql).not.toMatch(/ALTER TABLE "vehiculos"/);
  });
});

describe("postulacion down.sql — revierte exactamente (R4/R5)", () => {
  it("dropea la tabla mensajero_documento y su tipo, tabla antes que tipo", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "mensajero_documento";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "mensajero_documento_tipo";/);
    const idxTabla = downSql.indexOf('DROP TABLE IF EXISTS "mensajero_documento"');
    const idxTipo = downSql.indexOf('DROP TYPE IF EXISTS "mensajero_documento_tipo"');
    expect(idxTipo).toBeGreaterThan(idxTabla);
  });

  it("suelta el FK y el indice de vehiculo_id antes de dropear la columna", () => {
    const idxFk = downSql.indexOf('DROP CONSTRAINT IF EXISTS "usuario_vehiculo_id_fkey"');
    const idxCol = downSql.indexOf('DROP COLUMN IF EXISTS "vehiculo_id"');
    expect(idxFk).toBeGreaterThanOrEqual(0);
    expect(idxCol).toBeGreaterThan(idxFk);
  });

  it("dropea las 4 columnas nuevas de usuario con IF EXISTS", () => {
    for (const col of ["placa", "vehiculo_id", "segundo_apellido", "primer_apellido"]) {
      expect(downSql).toMatch(new RegExp(`DROP COLUMN IF EXISTS "${col}";`));
    }
  });

  it("no dropea la tabla vehiculos ni usuario", () => {
    expect(downSql).not.toMatch(/DROP TABLE IF EXISTS "vehiculos"/);
    expect(downSql).not.toMatch(/DROP TABLE IF EXISTS "usuario"/);
  });
});

describe("no se modifico ninguna migracion previa", () => {
  it("la migracion de postulacion tiene timestamp posterior al ultimo previo", () => {
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const postulacionDir = dirs.find((d) => d.endsWith("_postulacion_mensajero"))!;
    const previos = dirs.filter(
      (d) =>
        !d.endsWith("_postulacion_mensajero") &&
        !d.endsWith("_usuario_fulfillment") && // feature 27: apendida despues con timestamp posterior
        !d.endsWith("_zonas_catalogo_global_pagos") && // feature 24: apendida despues
        !d.endsWith("_orden_num_guia_deferred_mensajero_asignado_espera_aceptacion") && // feature 17: apendida despues
        !d.endsWith("_order_status_en_ruta_bodega_satelite"), // feature 30: apendida despues
    );
    const maxPrevio = previos[previos.length - 1];
    expect(postulacionDir > maxPrevio).toBe(true);
  });
});
