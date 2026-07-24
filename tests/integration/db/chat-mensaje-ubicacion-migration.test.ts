import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 121 (A2/A3, R7) — cobertura ESTATICA de la migracion `*_chat_mensaje_ubicacion`
// (mismo patron que la 106 `*_cancelacion_api_por_key`): lee migration.sql/down.sql por regex.
// NO requiere Postgres real; `db:migrate` queda como paso de despliegue humano (el `.env`
// apunta a una DB compartida), documentado en `progress/impl_121_backend.md`.

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

const migrationDir = migrationDirFor("_chat_mensaje_ubicacion");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

const NUEVO = "ubicacion";

describe("Feature 121 · UP — enum ubicacion + columnas lat/lng (A2, R7)", () => {
  it("añade el valor `ubicacion` al enum (fuera de tx via IF NOT EXISTS, GOTCHA 55P04)", () => {
    expect(upSql).toMatch(
      /ALTER TYPE "chat_mensaje_tipo" ADD VALUE IF NOT EXISTS 'ubicacion';/,
    );
    expect(upSql).toMatch(/55P04/); // GOTCHA documentado en el .sql
  });

  it("añade las columnas nullable latitud/longitud como DOUBLE PRECISION", () => {
    expect(upSql).toMatch(/ALTER TABLE "chat_mensaje" ADD COLUMN "latitud" DOUBLE PRECISION;/);
    expect(upSql).toMatch(/ALTER TABLE "chat_mensaje" ADD COLUMN "longitud" DOUBLE PRECISION;/);
    // Nullable: sin NOT NULL en el ADD COLUMN.
    expect(upSql).not.toMatch(/ADD COLUMN "latitud" DOUBLE PRECISION NOT NULL/);
  });

  it("es ADITIVA: no toca RLS ni otras tablas", () => {
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upSql).not.toMatch(/DROP COLUMN/i);
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/DELETE FROM/i);
    expect(upSql).not.toMatch(/chat_conversacion/i);
  });
});

describe("Feature 121 · DOWN — revierte columnas y recrea el enum (A3, R7)", () => {
  it("elimina las columnas latitud/longitud", () => {
    expect(downSql).toMatch(/ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "longitud";/);
    expect(downSql).toMatch(/ALTER TABLE "chat_mensaje" DROP COLUMN IF EXISTS "latitud";/);
  });

  it("recrea el enum chat_mensaje_tipo SIN ubicacion (texto/plantilla/otro)", () => {
    expect(downSql).toMatch(
      /ALTER TYPE "chat_mensaje_tipo" RENAME TO "chat_mensaje_tipo_old";/,
    );
    const match = downSql.match(/CREATE TYPE "chat_mensaje_tipo" AS ENUM \(([\s\S]*?)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toEqual(["texto", "plantilla", "otro"]);
    expect(valores).not.toContain(NUEVO);
  });

  it("recastea la columna tipo con USING y suelta el tipo viejo", () => {
    expect(downSql).toMatch(
      /ALTER TABLE "chat_mensaje"\s+ALTER COLUMN "tipo" TYPE "chat_mensaje_tipo"\s+USING \("tipo"::text::"chat_mensaje_tipo"\);/,
    );
    expect(downSql).toMatch(/DROP TYPE "chat_mensaje_tipo_old";/);
  });

  it("documenta la irreversibilidad parcial del ADD VALUE y la precondicion (0 filas ubicacion)", () => {
    expect(downSql).toMatch(/IRREVERSIBILIDAD PARCIAL/i);
    expect(downSql).toMatch(/PRECONDICION/i);
    expect(downSql).toContain(NUEVO);
  });
});

describe("Feature 121 · schema.prisma refleja la migracion (sin drift)", () => {
  it("el enum ChatMensajeTipo tiene ubicacion", () => {
    const bloque = schemaPrisma.match(/enum ChatMensajeTipo \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    expect((bloque as RegExpMatchArray)[1]).toMatch(/\bubicacion\b/);
  });

  it("el modelo ChatMensaje declara latitud/longitud Float? mapeadas", () => {
    const bloque = schemaPrisma.match(/model ChatMensaje \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    const cuerpo = (bloque as RegExpMatchArray)[1];
    expect(cuerpo).toMatch(/latitud\s+Float\?\s+@map\("latitud"\)/);
    expect(cuerpo).toMatch(/longitud\s+Float\?\s+@map\("longitud"\)/);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la carpeta previa", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const previa = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => n < dirName)
      .sort()
      .pop();
    expect(previa).toBeDefined();
    expect(dirName > (previa as string)).toBe(true);
  });
});
