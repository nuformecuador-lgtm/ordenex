import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 265 (R34, R35, design §13.2) — cobertura ESTATICA de la migracion que anade
// `ruta_optimizada.secuencia_fuente`. Molde de `ruta-optimizada-migracion.test.ts`: se lee el
// SQL por regex, sin levantar Postgres.
//
// Lo que protege, y no es teorico:
//  · que la columna sea NULLABLE y sin DEFAULT — un DEFAULT reescribiria la tabla y, peor,
//    afirmaria una procedencia para rutas que nadie ordeno;
//  · que NO haya backfill — inventar la procedencia de lo ya persistido es exactamente lo que
//    R45 prohibe (no consta no es «del proveedor»);
//  · que EXISTA su `down.sql` y dropee lo que el `up` anade. `init.sh` solo AVISA cuando falta,
//    y por ese hueco las tres migraciones `ruta_*` del 2026-08-14 se quedaron sin el.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");
const NOMBRE = "ruta_secuencia_fuente";

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

/** Las aserciones de AUSENCIA corren sobre el SQL EJECUTABLE, no sobre la prosa. */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const DIR = migrationDirFor(NOMBRE);
const UP = sinComentarios(fs.readFileSync(path.join(DIR, "migration.sql"), "utf8"));
const DOWN_PATH = path.join(DIR, "down.sql");
const SCHEMA = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

describe("265/R35 — la columna: TEXT, nullable, sin default y sin nada mas", () => {
  it("anade `secuencia_fuente` TEXT a `ruta_optimizada`", () => {
    expect(UP).toMatch(
      /ALTER TABLE\s+"ruta_optimizada"\s+ADD COLUMN\s+"secuencia_fuente"\s+TEXT\s*;/,
    );
  });

  it("NULLABLE y SIN DEFAULT: `null` significa «no consta», no «del proveedor»", () => {
    expect(UP).not.toMatch(/secuencia_fuente[^;]*NOT NULL/i);
    expect(UP).not.toMatch(/secuencia_fuente[^;]*DEFAULT/i);
  });

  it("es ADITIVA: una sola sentencia, sin CHECK, sin indice y sin tocar otra tabla", () => {
    const sentencias = UP.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(sentencias).toHaveLength(1);
    expect(UP).not.toMatch(/CHECK/i);
    expect(UP).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(UP).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    for (const alter of UP.match(/ALTER TABLE\s+"(\w+)"/g) ?? []) {
      expect(alter).toContain('"ruta_optimizada"');
    }
  });

  it("R34 (lo que queda vivo): sin tabla nueva, sin RLS nueva y SIN BACKFILL", () => {
    expect(UP).not.toMatch(/CREATE TABLE/i);
    expect(UP).not.toMatch(/ROW LEVEL SECURITY|CREATE POLICY/i);
    // Un UPDATE aqui seria inventar la procedencia de rutas que nadie sabe quien ordeno.
    expect(UP).not.toMatch(/\bUPDATE\b|\bINSERT\b/i);
  });

  it("el modelo Prisma la declara con su @map snake_case", () => {
    expect(SCHEMA).toMatch(/secuenciaFuente\s+String\?\s+@map\("secuencia_fuente"\)/);
    // Y dentro de `RutaOptimizada`, no colgada de otro modelo.
    expect(SCHEMA).toMatch(
      /model RutaOptimizada \{[\s\S]*?secuenciaFuente[\s\S]*?@@map\("ruta_optimizada"\)/,
    );
  });
});

describe("265 — el `down.sql` existe y revierte EXACTAMENTE el `up`", () => {
  it("hay down.sql", () => {
    expect(
      fs.existsSync(DOWN_PATH),
      "`docs/architecture.md` lo declara OBLIGATORIO; `init.sh` solo avisa, y por ese hueco " +
        "las tres migraciones `ruta_*` del 2026-08-14 se quedaron sin el.",
    ).toBe(true);
  });

  it("dropea la columna que el up anade, y no toca nada mas", () => {
    const down = sinComentarios(fs.readFileSync(DOWN_PATH, "utf8"));
    expect(down).toMatch(
      /ALTER TABLE\s+"ruta_optimizada"\s+DROP COLUMN\s+"secuencia_fuente"\s*;/,
    );
    const sentencias = down
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(sentencias).toHaveLength(1);
    expect(down).not.toMatch(/DROP\s+TABLE|DROP\s+TYPE/i);
  });
});

describe("265 — el nombre del directorio no colisiona con el regex de la 92", () => {
  it("NO contiene `ruta_optimizada`", () => {
    // `ruta-optimizada-migracion.test.ts` resuelve su carpeta con `^\d+_ruta_optimizada$` y
    // LANZA si hay mas de una coincidencia. El regex esta anclado, asi que hoy no chocaria,
    // pero acercarse a el sin necesidad es pedir un rojo raro dentro de un ano.
    expect(path.basename(DIR)).not.toContain("ruta_optimizada");
    expect(path.basename(DIR)).toMatch(/^\d+_ruta_secuencia_fuente$/);
  });
});
