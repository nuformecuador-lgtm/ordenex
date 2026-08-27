import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 282 (T12) — cobertura ESTATICA de la migracion `*_plantilla_variables_nombres`
// (patron `plantilla-template-id-migration`: lee migration.sql y down.sql por regex). La suite
// NO levanta Postgres; el round-trip real up -> down -> up queda como deuda, igual que en el
// resto de migraciones del repo.
//
// Lo que esta migracion promete (design.md §3.2) y este test congela:
//  * UP ADITIVA: una sola columna `variables_nombres JSONB NOT NULL DEFAULT '{}'`.
//  * SIN BACKFILL: rellenar las filas viejas con el catalogo actual falsificaria un snapshot
//    que nunca se tomo y volveria indecidible la distincion de R16.
//  * SIN tabla/enum/indice/RLS nuevos: la columna hereda las politicas de `plantilla_mensaje`.
//  * DOWN: el DROP de EXACTAMENTE esa columna — ni una mas (la tabla y el enum los creo
//    `*_plantilla_mensaje`) ni una menos.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function migrationDirFor(nombre: string): string {
  const dirs = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => new RegExp(String.raw`^\d+_` + nombre + "$").test(name));
  if (dirs.length !== 1) throw new Error(`Carpeta de migracion ambigua o ausente: ${nombre}`);
  return path.join(MIGRATIONS_DIR, dirs[0]);
}

/** Las aserciones de AUSENCIA corren sobre el SQL EJECUTABLE, no sobre la prosa. */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const COLUMNA = "variables_nombres";
const dir = migrationDirFor("plantilla_variables_nombres");
const upExec = sinComentarios(fs.readFileSync(path.join(dir, "migration.sql"), "utf8"));
const downExec = sinComentarios(fs.readFileSync(path.join(dir, "down.sql"), "utf8"));
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

describe("UP — anade el snapshot `clave -> nombre` de las variables (aditiva)", () => {
  it("anade `variables_nombres` como JSONB NOT NULL DEFAULT '{}' (nunca null, sin backfill)", () => {
    expect(upExec).toMatch(
      new RegExp(
        String.raw`ALTER TABLE\s+"plantilla_mensaje"\s+ADD COLUMN\s+"` +
          COLUMNA +
          String.raw`"\s+JSONB\s+NOT NULL\s+DEFAULT\s+'\{\}';`,
      ),
    );
  });

  it("anade UNA sola columna: ninguna otra se cuela en la misma migracion", () => {
    const added = [...upExec.matchAll(/ADD COLUMN\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(added).toEqual([COLUMNA]);
  });

  it("es ADITIVA: no borra, no crea tabla/tipo/indice/constraint y no toca la RLS", () => {
    expect(upExec).not.toMatch(/DROP/i);
    expect(upExec).not.toMatch(/CREATE TABLE/i);
    expect(upExec).not.toMatch(/CREATE TYPE/i);
    expect(upExec).not.toMatch(/CREATE (UNIQUE )?INDEX/i);
    expect(upExec).not.toMatch(/CONSTRAINT/i);
    expect(upExec).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("NO hace backfill: ningun UPDATE rellena las filas anteriores a la feature 282", () => {
    // Deliberado (design.md §3.2): un backfill con el catalogo de hoy fabricaria un snapshot
    // que nadie tomo y borraria la distincion "retirada del catalogo" vs "nunca fue valida".
    expect(upExec).not.toMatch(/UPDATE\s+"plantilla_mensaje"/i);
    expect(upExec).not.toMatch(/\bUPDATE\b/i);
  });
});

describe("DOWN — revierte exactamente el UP (reversibilidad obligatoria)", () => {
  it("existe el down.sql de la migracion", () => {
    expect(fs.existsSync(path.join(dir, "down.sql"))).toBe(true);
  });

  it("suelta EXACTAMENTE la columna que anadio la UP, y solo esa", () => {
    expect(downExec).toMatch(
      new RegExp(
        String.raw`ALTER TABLE\s+"plantilla_mensaje"\s+DROP COLUMN\s+"` + COLUMNA + `";`,
      ),
    );
    const dropped = [...downExec.matchAll(/DROP COLUMN\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(dropped).toEqual([COLUMNA]);
  });

  it("no contiene ninguna otra sentencia ejecutable ademas de ese DROP COLUMN", () => {
    const sentencias = downExec
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(sentencias).toEqual([`ALTER TABLE "plantilla_mensaje" DROP COLUMN "${COLUMNA}"`]);
  });

  it("NO revierte lo que esta migracion no creo: ni la tabla, ni el enum, ni la RLS", () => {
    expect(downExec).not.toMatch(/DROP TABLE/i);
    expect(downExec).not.toMatch(/DROP TYPE/i);
    expect(downExec).not.toMatch(/DROP INDEX/i);
    expect(downExec).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("ningun otro objeto del esquema depende de la columna soltada (el DROP simple basta)", () => {
    // Verifica la premisa del down: si otra migracion hubiera creado un indice, FK o constraint
    // sobre esta columna, el DROP tendria que retirarlo antes y este test lo caza.
    const otras = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => n !== path.basename(dir));
    const referencias = otras.filter((n) => {
      const ruta = path.join(MIGRATIONS_DIR, n, "migration.sql");
      if (!fs.existsSync(ruta)) return false;
      return sinComentarios(fs.readFileSync(ruta, "utf8")).includes(`"${COLUMNA}"`);
    });
    expect(referencias).toEqual([]);
  });
});

describe("schema.prisma refleja la migracion (sin drift)", () => {
  it('PlantillaMensaje declara variablesNombres Json con @default("{}") y su @map', () => {
    const bloque = schemaPrisma.match(/model PlantillaMensaje \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    const cuerpo = (bloque as RegExpMatchArray)[1];
    expect(cuerpo).toMatch(
      /variablesNombres\s+Json\s+@default\("\{\}"\)\s+@map\("variables_nombres"\)/,
    );
    // NUNCA opcional: la columna es NOT NULL y `{}` es su valor de "sin snapshot" (R21).
    expect(cuerpo).not.toMatch(/variablesNombres\s+Json\?/);
  });
});
