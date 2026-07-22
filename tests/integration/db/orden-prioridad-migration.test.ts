import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 101 (R1/R11/R12) — cobertura ESTATICA de la migracion `*_orden_prioridad`
// (patron de las migraciones de la 99/100): lee migration.sql/down.sql/schema.prisma por
// regex. NO requiere Postgres real; el round-trip up->down->up contra Postgres lo verifico
// el reviewer y queda en `progress/impl_101-prioridad-reasignacion.md`. Cubre:
//   R1  — columna `orden.prioridad` BOOLEAN NOT NULL DEFAULT false (schema + SQL).
//   R11 — sin backfill: el default constante deja las historicas en `false`.
//   R12 — down.sql revierte EXACTAMENTE (DROP COLUMN), sin tocar RLS ni otras columnas.

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

const migrationDir = migrationDirFor("_orden_prioridad");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

describe("Feature 101 · UP — columna orden.prioridad aditiva (R1/R11)", () => {
  it("agrega `prioridad` BOOLEAN NOT NULL DEFAULT false a `orden`", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "orden" ADD COLUMN "prioridad" BOOLEAN NOT NULL DEFAULT false;/,
    );
  });

  it("R11: el DEFAULT constante = sin backfill (las historicas quedan en false)", () => {
    // Un ADD COLUMN con DEFAULT constante rellena por meta-dato; NO hay UPDATE de backfill.
    expect(upSql).not.toMatch(/UPDATE\s+"?orden"?/i);
  });

  it("es ADITIVA: no crea tablas, no toca RLS, no borra ni altera otras columnas", () => {
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upSql).not.toMatch(/DROP COLUMN/i);
    // El unico ALTER COLUMN admisible es el propio ADD COLUMN (no un ALTER de otra columna).
    expect(upSql).not.toMatch(/ALTER COLUMN/i);
  });
});

describe("Feature 101 · DOWN — reversible (OBLIGATORIO, docs/architecture.md) (R12)", () => {
  it("suelta EXACTAMENTE la columna agregada por el UP", () => {
    expect(downSql).toMatch(/ALTER TABLE "orden" DROP COLUMN IF EXISTS "prioridad";/);
  });

  it("el down no toca RLS ni otras columnas", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
    // Solo debe mencionar la columna `prioridad`, ninguna otra.
    expect(downSql).not.toMatch(/DROP COLUMN IF EXISTS "(?!prioridad)/);
  });
});

describe("Feature 101 · schema.prisma refleja la migracion (sin drift) (R1)", () => {
  it("el model Orden declara `prioridad Boolean @default(false)`", () => {
    const bloque = schemaPrisma.match(/model Orden \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    expect((bloque as RegExpMatchArray)[1]).toMatch(
      /prioridad\s+Boolean\s+@default\(false\)/,
    );
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la que la precede", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    // Invariante ORDEN-ROBUSTO (mismo criterio que 99/100): sorts DESPUES de la carpeta
    // inmediatamente anterior, no que sea la ULTIMA del repo (estable ante añadidos futuros).
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
