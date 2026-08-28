import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 302 — cobertura ESTATICA de la migracion `*_api_key_tienda_destino` (mismo patron que
// `api-key-migration.test.ts` y `api-key-estado-migration.test.ts`: se lee el SQL y se afirma por
// regex; la suite de vitest no levanta Postgres).
//
// Lo que protege, y por que cada aserto esta aqui:
//   - la columna es NULLABLE: si naciera `NOT NULL` (con o sin default), el camino existente —una
//     key duena de sus propias ordenes— dejaria de ser representable;
//   - la FK es `ON DELETE RESTRICT` y NO `SET NULL`: `SET NULL` es el default de Prisma para una
//     relacion opcional, y con el, borrar la tienda devolveria en SILENCIO la propiedad de las
//     ordenes futuras a la cuenta dedicada de la key;
//   - la migracion es ADITIVA y no mueve una sola fila (hay cero keys en produccion: no hay
//     backfill que hacer, y uno escrito "por si acaso" seria dato inventado);
//   - el DOWN revierte exactamente, y en el orden inverso.

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

const dir = migrationDirFor("api_key_tienda_destino");
const upExec = sinComentarios(fs.readFileSync(path.join(dir, "migration.sql"), "utf8"));
const downExec = sinComentarios(fs.readFileSync(path.join(dir, "down.sql"), "utf8"));

describe("orden de la migracion — posterior a la tabla api_key", () => {
  it("el timestamp es posterior al de la creacion de la tabla api_key", () => {
    expect(path.basename(dir) > path.basename(migrationDirFor("api_key"))).toBe(true);
  });
});

describe("UP — la columna tienda_destino_id", () => {
  it("agrega la columna como TEXT y NULLABLE (el camino sin tienda destino sigue existiendo)", () => {
    expect(upExec).toMatch(/ALTER TABLE\s+"api_key"\s+ADD COLUMN\s+"tienda_destino_id"\s+TEXT\s*;/);
    // Ni NOT NULL ni DEFAULT: una key sin tienda destino es el caso normal, no una excepcion.
    expect(upExec).not.toMatch(/"tienda_destino_id"[^;]*NOT NULL/i);
    expect(upExec).not.toMatch(/"tienda_destino_id"[^;]*DEFAULT/i);
  });

  it("la FK apunta a `usuario` con ON DELETE RESTRICT, nunca SET NULL", () => {
    expect(upExec).toMatch(
      /ADD CONSTRAINT\s+"api_key_tienda_destino_id_fkey"\s+FOREIGN KEY\s*\(\s*"tienda_destino_id"\s*\)[\s\S]*?REFERENCES\s+"usuario"\s*\(\s*"id"\s*\)\s+ON DELETE RESTRICT/,
    );
    // `SET NULL` cambiaria el dueno de las ordenes futuras sin que nadie lo pida: fallo mudo.
    expect(upExec).not.toMatch(/ON DELETE SET NULL/i);
  });

  it("crea el indice del lookup inverso (que keys cargan a nombre de esta tienda)", () => {
    expect(upExec).toMatch(
      /CREATE INDEX\s+"api_key_tienda_destino_id_idx"\s+ON\s+"api_key"\s*\(\s*"tienda_destino_id"\s*\)/,
    );
  });

  it("es ADITIVA: no altera otras tablas, no borra nada y no mueve una sola fila", () => {
    expect(upExec).not.toMatch(/DROP TABLE/i);
    expect(upExec).not.toMatch(/DROP COLUMN/i);
    expect(upExec).not.toMatch(/ALTER TABLE\s+"usuario"/i);
    expect(upExec).not.toMatch(/ALTER TABLE\s+"orden"/i);
    // Sin backfill: hay cero api keys en produccion, asi que no hay nada que reapuntar. Los
    // regex van anclados a INICIO DE SENTENCIA: `ON DELETE RESTRICT` / `ON UPDATE CASCADE` llevan
    // esas palabras dentro y no son DML.
    expect(upExec).not.toMatch(/^\s*INSERT\b/im);
    expect(upExec).not.toMatch(/^\s*UPDATE\b/im);
    expect(upExec).not.toMatch(/^\s*DELETE\b/im);
  });

  it("no toca RLS: `api_key` ya la tenia habilitada desde su migracion de creacion", () => {
    expect(upExec).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upExec).not.toMatch(/CREATE POLICY/i);
  });
});

describe("DOWN — revierte exactamente el UP", () => {
  it("suelta el indice, la FK y la columna", () => {
    expect(downExec).toMatch(/DROP INDEX IF EXISTS\s+"api_key_tienda_destino_id_idx"/);
    expect(downExec).toMatch(
      /ALTER TABLE\s+"api_key"\s+DROP CONSTRAINT IF EXISTS\s+"api_key_tienda_destino_id_fkey"/,
    );
    expect(downExec).toMatch(
      /ALTER TABLE\s+"api_key"\s+DROP COLUMN IF EXISTS\s+"tienda_destino_id"/,
    );
  });

  it("en el orden inverso al UP: indice, luego FK, luego columna", () => {
    const idxIndice = downExec.search(/DROP INDEX IF EXISTS\s+"api_key_tienda_destino_id_idx"/);
    const idxFk = downExec.search(/DROP CONSTRAINT IF EXISTS\s+"api_key_tienda_destino_id_fkey"/);
    const idxCol = downExec.search(/DROP COLUMN IF EXISTS\s+"tienda_destino_id"/);
    expect(idxIndice).toBeGreaterThanOrEqual(0);
    expect(idxFk).toBeGreaterThan(idxIndice);
    expect(idxCol).toBeGreaterThan(idxFk);
  });

  it("no toca ninguna otra tabla ni mueve filas", () => {
    expect(downExec).not.toMatch(/ALTER TABLE\s+"usuario"/i);
    expect(downExec).not.toMatch(/ALTER TABLE\s+"orden"/i);
    expect(downExec).not.toMatch(/^\s*INSERT\b/im);
    expect(downExec).not.toMatch(/^\s*UPDATE/im);
    expect(downExec).not.toMatch(/^\s*DELETE/im);
  });
});

describe("el modelo de Prisma declara lo mismo que el SQL", () => {
  const schema = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
    "utf8",
  );
  const modeloApiKey = schema.slice(
    schema.indexOf("model ApiKey {"),
    schema.indexOf("}", schema.indexOf("model ApiKey {")),
  );

  it("declara `tiendaDestinoId` OPCIONAL, mapeado a la columna snake_case", () => {
    expect(modeloApiKey).toMatch(/tiendaDestinoId\s+String\?\s+@map\("tienda_destino_id"\)/);
  });

  it("declara la relacion con `onDelete: Restrict` EXPLICITO (el default de Prisma es SetNull)", () => {
    expect(modeloApiKey).toMatch(/tiendaDestino\s+Usuario\?\s+@relation\(/);
    expect(modeloApiKey).toMatch(/"ApiKeyTiendaDestino"[\s\S]*?onDelete:\s*Restrict/);
  });

  it("declara el indice que la migracion crea", () => {
    expect(modeloApiKey).toMatch(/@@index\(\[tiendaDestinoId\]\)/);
  });
});
