import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Ciclo de vida de API keys (R5) — cobertura ESTATICA de la migracion `*_api_key_estado`
// (mismo patron que api-key-migration.test.ts: lee migration.sql/down.sql por regex; la
// suite de vitest no levanta Postgres).
//
// Lo que protege: que el SQL escrito a mano no se desvie del diseño. El enum
// `estado_api_key`, la columna `estado` con DEFAULT 'activa' NOT NULL (backfill implicito
// de las filas existentes), que sea ADITIVA (no toca otras tablas) y que el DOWN revierta
// EXACTAMENTE (drop de la columna y luego del tipo, en ese orden por la dependencia).

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function migrationDirFor(nombre: string): string {
  const dirs = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => new RegExp(`^\\d+_${nombre}$`).test(name));
  if (dirs.length === 0) throw new Error(`No se encontro la carpeta de migracion ${nombre}`);
  if (dirs.length > 1) throw new Error(`Varias carpetas para ${nombre}: ${dirs.join(", ")}`);
  return path.join(MIGRATIONS_DIR, dirs[0]);
}

/** Las aserciones de ausencia corren sobre el SQL EJECUTABLE, no sobre los comentarios. */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const dir = migrationDirFor("api_key_estado");
const upExec = sinComentarios(fs.readFileSync(path.join(dir, "migration.sql"), "utf8"));
const downExec = sinComentarios(fs.readFileSync(path.join(dir, "down.sql"), "utf8"));

describe("orden de la migracion — posterior a la tabla api_key", () => {
  it("R5: el timestamp es posterior al de la creacion de la tabla api_key", () => {
    const estadoDir = path.basename(dir);
    const tablaDir = path.basename(migrationDirFor("api_key"));
    expect(estadoDir > tablaDir).toBe(true);
  });
});

describe("UP — enum y columna estado (R5)", () => {
  it("R5: crea el enum nativo estado_api_key con los valores activa/inactiva", () => {
    expect(upExec).toMatch(
      /CREATE TYPE\s+"estado_api_key"\s+AS ENUM\s*\(\s*'activa'\s*,\s*'inactiva'\s*\)/,
    );
  });

  it("R5: agrega la columna estado con DEFAULT 'activa' y NOT NULL (filas existentes -> activa)", () => {
    expect(upExec).toMatch(
      /ALTER TABLE\s+"api_key"[\s\S]*?ADD COLUMN\s+"estado"\s+"estado_api_key"\s+NOT NULL\s+DEFAULT\s+'activa'/,
    );
  });

  it("R5: es ADITIVA — no altera ni borra otras tablas ni columnas", () => {
    expect(upExec).not.toMatch(/DROP TABLE/i);
    expect(upExec).not.toMatch(/DROP COLUMN/i);
    expect(upExec).not.toMatch(/ALTER TABLE\s+"usuario"/i);
  });
});

describe("DOWN — revierte exactamente el UP (R5)", () => {
  it("R5: elimina la columna estado", () => {
    expect(downExec).toMatch(/ALTER TABLE\s+"api_key"\s+DROP COLUMN IF EXISTS\s+"estado"/);
  });

  it("R5: elimina el enum estado_api_key", () => {
    expect(downExec).toMatch(/DROP TYPE IF EXISTS\s+"estado_api_key"/);
  });

  it("R5: primero la columna, luego el tipo (la columna depende del tipo)", () => {
    const idxCol = downExec.search(/DROP COLUMN IF EXISTS\s+"estado"/);
    const idxTipo = downExec.search(/DROP TYPE IF EXISTS\s+"estado_api_key"/);
    expect(idxCol).toBeGreaterThanOrEqual(0);
    expect(idxTipo).toBeGreaterThan(idxCol);
  });
});
