import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGEN_TIPOS_CON_GESTION,
} from "@/lib/types/orden-historial";

// Feature 67 (R11/R12/R20, F1.4-b + F1.4-d) — cobertura ESTATICA de la migracion
// `*_gestion_orden_anulacion` (patron cierre-estado-vencido-migration.test.ts): lee
// migration.sql / down.sql por regex. La aplicacion REAL contra Postgres + el round-trip
// (deploy -> verificar -> down -> verificar -> deploy) los ejecuta el implementer y quedan en
// la bitacora `progress/impl_67-deshacer-gestion.md`.

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

const migrationDir = migrationDirFor("_gestion_orden_anulacion");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

describe("Feature 67 · SEED del enum — `deshacer_gestion` es el 12.º valor (F1.4-b)", () => {
  it("ORDEN_HISTORIAL_ORIGEN_TIPO_SEED incluye deshacer_gestion y cierra en 12", () => {
    expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toContain("deshacer_gestion");
    expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toHaveLength(12);
  });

  it("ORIGEN_TIPOS_CON_GESTION = las 2 familias que enlazan una gestion (design §4.2)", () => {
    // Fuente unica del predicado que desambigua la nulidad del enlace (R25/R26).
    expect([...ORIGEN_TIPOS_CON_GESTION]).toEqual(["gestion", "deshacer_gestion"]);
  });
});

describe("Feature 67 · UP — columnas de anulacion + FK + indices + enum (R11/R12/R20)", () => {
  it("R11: añade `anulada_at` TIMESTAMP(3) y `anulada_por` TEXT, ambas NULLABLE", () => {
    // NULL = gestion VIGENTE (patron `cierre_id IS NULL` de la 37): sin NOT NULL ni DEFAULT,
    // la migracion es aditiva y no necesita backfill.
    expect(upSql).toMatch(/ALTER TABLE "gestion_orden" ADD COLUMN "anulada_at" TIMESTAMP\(3\);/);
    expect(upSql).toMatch(/ALTER TABLE "gestion_orden" ADD COLUMN "anulada_por" TEXT;/);
    expect(upSql).not.toMatch(/anulada_at"\s+TIMESTAMP\(3\)\s+NOT NULL/);
  });

  it("R11: FK `anulada_por` -> usuario con ON DELETE SET NULL (borrar al usuario no borra el rastro)", () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT "gestion_orden_anulada_por_fkey"\s+FOREIGN KEY \("anulada_por"\) REFERENCES "usuario"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE;/,
    );
    expect(upSql).toMatch(/CREATE INDEX "gestion_orden_anulada_por_idx" ON "gestion_orden"\("anulada_por"\);/);
  });

  it("F1.4-d: indice PARCIAL de la ruta caliente (mensajero_id) WHERE sin cierre y sin anular", () => {
    // Prisma no expresa indices parciales -> va a mano en el SQL (patron
    // orden_liberada_reprogramada_at_idx de la 46). Sirve a /cierre-dia y al cron del corte.
    expect(upSql).toMatch(
      /CREATE INDEX "gestion_orden_mensajero_pendiente_idx"\s+ON "gestion_orden" \("mensajero_id"\)\s+WHERE "cierre_id" IS NULL AND "anulada_at" IS NULL;/,
    );
  });

  it("R20/F1.4-b: añade `deshacer_gestion` al enum (aditivo, fuera de tx via IF NOT EXISTS)", () => {
    expect(upSql).toMatch(
      /ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'deshacer_gestion';/,
    );
  });

  it("es ADITIVA: no altera columnas preexistentes ni borra nada de gestion_orden", () => {
    expect(upSql).not.toMatch(/DROP COLUMN/i);
    expect(upSql).not.toMatch(/ALTER COLUMN/i);
    expect(upSql).not.toMatch(/DELETE FROM/i);
    expect(upSql).not.toMatch(/DROP TABLE/i);
  });

  it("NO toca RLS: sin tabla nueva, `gestion_orden` conserva su RLS (habilitada, sin policies)", () => {
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/DROP POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("Feature 67 · DOWN — reversible (OBLIGATORIO, docs/architecture.md)", () => {
  it("recrea el enum SIN `deshacer_gestion`, con los 11 valores originales", () => {
    // Postgres no soporta DROP VALUE: el tipo se recrea y la columna se migra con USING.
    expect(downSql).toMatch(
      /ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";/,
    );
    const match = downSql.match(/CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toHaveLength(11);
    expect(valores).not.toContain("deshacer_gestion");
    // Los 11 originales = el SEED actual menos el valor de esta feature.
    expect(new Set(valores)).toEqual(
      new Set(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.filter((v) => v !== "deshacer_gestion")),
    );
  });

  it("migra `origen_tipo` con USING y suelta el tipo viejo", () => {
    expect(downSql).toMatch(
      /ALTER TABLE "orden_historial_estado" ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"\s+USING \("origen_tipo"::text::"orden_historial_origen_tipo"\);/,
    );
    expect(downSql).toMatch(/DROP TYPE "orden_historial_origen_tipo_old";/);
  });

  it("documenta la precondicion: 0 filas con origen_tipo='deshacer_gestion' (el USING falla si las hay)", () => {
    // Revertir borrando rastro de auditoria NO es seguro: el cast debe abortar con error claro.
    expect(downSql).toMatch(/Precondicion/i);
    expect(downSql).toMatch(/deshacer_gestion/);
  });

  it("revierte en orden INVERSO: enum -> indice parcial -> indice FK -> constraint -> columnas", () => {
    const orden = [
      /DROP TYPE "orden_historial_origen_tipo_old";/,
      /DROP INDEX IF EXISTS "gestion_orden_mensajero_pendiente_idx";/,
      /DROP INDEX IF EXISTS "gestion_orden_anulada_por_idx";/,
      /ALTER TABLE "gestion_orden" DROP CONSTRAINT IF EXISTS "gestion_orden_anulada_por_fkey";/,
      /ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "anulada_por";/,
      /ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "anulada_at";/,
    ];
    let cursor = -1;
    for (const re of orden) {
      const idx = downSql.search(re);
      expect(idx, `falta o esta fuera de orden: ${re}`).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  it("el down tampoco toca policies RLS", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("Feature 67 · schema.prisma refleja la migracion (sin drift)", () => {
  it("GestionOrden declara anuladaAt/anuladaPor mapeadas a las columnas nuevas", () => {
    expect(schemaPrisma).toMatch(/anuladaAt\s+DateTime\?\s+@map\("anulada_at"\)/);
    expect(schemaPrisma).toMatch(/anuladaPor\s+String\?\s+@map\("anulada_por"\)/);
  });

  it("la relacion del actor de la anulacion es opcional con onDelete: SetNull", () => {
    // `\s+` (como las aserciones de arriba): lo que se afirma es que la relacion es OPCIONAL
    // y con `onDelete: SetNull`, no el ancho de la alineacion. `prisma format` realinea las
    // columnas del bloque cuando cambia el nombre mas largo del modelo (feature 69 lo hizo);
    // un espaciado exacto ataba este invariante al formateo, no al esquema.
    expect(schemaPrisma).toMatch(
      /anuladaPorUsuario\s+Usuario\?\s+@relation\("GestionAnuladaPor", fields: \[anuladaPor\], references: \[id\], onDelete: SetNull\)/,
    );
    expect(schemaPrisma).toMatch(/gestionesAnuladas\s+GestionOrden\[\]\s+@relation\("GestionAnuladaPor"\)/);
  });

  it("el enum Prisma tiene el 12.º valor `deshacer_gestion`", () => {
    const bloque = schemaPrisma.match(/enum OrdenHistorialOrigenTipo \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    expect((bloque as RegExpMatchArray)[1]).toMatch(/\bdeshacer_gestion\b/);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la ultima migracion previa", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const previa = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_seed_order_status_completo"));
    expect(previa).toBeDefined();
    expect(dirName > (previa as string)).toBe(true);
  });
});
