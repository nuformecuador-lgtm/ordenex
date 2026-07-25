import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Integracion WhatsApp — cobertura ESTATICA de la migracion `*_plantilla_template_id` (patron
// api-key-migration / jobs-cola-migration: lee migration.sql y down.sql por regex). La suite NO
// levanta Postgres; el round-trip real up -> down -> up queda documentado como deuda, igual que en
// el resto de migraciones del repo.
//
// Su `down.sql` se escribio a POSTERIORI (deuda que `./init.sh` avisaba como "migraciones sin
// down.sql"). La UP es ADITIVA (dos columnas nullable), asi que el down correcto es el DROP de
// EXACTAMENTE esas dos columnas — ni una mas (la tabla y el enum los creo `*_plantilla_mensaje`, y
// revertirlos aqui seria destruir lo que esta migracion no creo) ni una menos.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function migrationDirFor(nombre: string): string {
  const dirs = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => new RegExp(`^\\d+_${nombre}$`).test(name));
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

const COLUMNAS = ["template_id", "template_idioma"] as const;
const dir = migrationDirFor("plantilla_template_id");
const upExec = sinComentarios(fs.readFileSync(path.join(dir, "migration.sql"), "utf8"));
const downExec = sinComentarios(fs.readFileSync(path.join(dir, "down.sql"), "utf8"));
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

describe("UP — enlaza plantilla_mensaje con su Message Template de Meta (aditiva)", () => {
  it("anade las dos columnas TEXT NULLABLE (sin NOT NULL ni DEFAULT que exijan backfill)", () => {
    for (const col of COLUMNAS) {
      expect(upExec).toMatch(
        new RegExp(`ALTER TABLE\\s+"plantilla_mensaje"\\s+ADD COLUMN\\s+"${col}"\\s+TEXT;`),
      );
    }
    expect(upExec).not.toMatch(/NOT NULL/i);
    expect(upExec).not.toMatch(/DEFAULT/i);
  });

  it("es ADITIVA: no crea indices/constraints, no borra ni altera datos existentes", () => {
    expect(upExec).not.toMatch(/CREATE (UNIQUE )?INDEX/i);
    expect(upExec).not.toMatch(/CONSTRAINT/i);
    expect(upExec).not.toMatch(/DROP/i);
    expect(upExec).not.toMatch(/UPDATE\s+"plantilla_mensaje"/i);
    expect(upExec).not.toMatch(/CREATE TYPE/i);
    expect(upExec).not.toMatch(/CREATE TABLE/i);
    expect(upExec).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("DOWN — revierte exactamente el UP (reversibilidad obligatoria)", () => {
  it("existe el down.sql de la migracion", () => {
    expect(fs.existsSync(path.join(dir, "down.sql"))).toBe(true);
  });

  it("suelta EXACTAMENTE las dos columnas que anadio la UP", () => {
    for (const col of COLUMNAS) {
      expect(downExec).toMatch(
        new RegExp(`ALTER TABLE\\s+"plantilla_mensaje"\\s+DROP COLUMN\\s+"${col}";`),
      );
    }
    const dropped = [...downExec.matchAll(/DROP COLUMN\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(dropped)).toEqual(new Set(COLUMNAS));
  });

  it("las suelta en orden INVERSO al de la UP (espejo exacto)", () => {
    const addOrder = [...upExec.matchAll(/ADD COLUMN\s+"([^"]+)"/g)].map((m) => m[1]);
    const dropOrder = [...downExec.matchAll(/DROP COLUMN\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(addOrder).toEqual([...dropOrder].reverse());
  });

  it("NO revierte lo que esta migracion no creo: ni la tabla, ni el enum, ni la RLS", () => {
    // `plantilla_mensaje` y `plantilla_estado` los crea `*_plantilla_mensaje` y los revierte SU
    // down.sql; tocarlos aqui destruiria datos ajenos a esta migracion.
    expect(downExec).not.toMatch(/DROP TABLE/i);
    expect(downExec).not.toMatch(/DROP TYPE/i);
    expect(downExec).not.toMatch(/DROP INDEX/i);
    expect(downExec).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("ningun otro objeto del esquema depende de las columnas soltadas (el DROP simple basta)", () => {
    // Verifica la premisa del down: si alguna migracion posterior hubiera creado un indice, FK o
    // constraint sobre estas columnas, el DROP tendria que retirarlo antes y este test lo caza.
    const otras = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => n !== path.basename(dir));
    const referencias = otras.filter((n) => {
      const sql = sinComentarios(
        fs.readFileSync(path.join(MIGRATIONS_DIR, n, "migration.sql"), "utf8"),
      );
      return COLUMNAS.some((col) => sql.includes(`"${col}"`));
    });
    expect(referencias).toEqual([]);
  });
});

describe("schema.prisma refleja la migracion (sin drift)", () => {
  it("PlantillaMensaje declara templateId/templateIdioma OPCIONALES con su @map", () => {
    const bloque = schemaPrisma.match(/model PlantillaMensaje \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    const cuerpo = (bloque as RegExpMatchArray)[1];
    expect(cuerpo).toMatch(/templateId\s+String\?\s+@map\("template_id"\)/);
    expect(cuerpo).toMatch(/templateIdioma\s+String\?\s+@map\("template_idioma"\)/);
  });
});
