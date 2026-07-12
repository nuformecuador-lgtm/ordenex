import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 27: cobertura ESTATICA de la migracion `*_usuario_fulfillment` (R1/R2).
// Patron postulacion-mensajero-migration: NO requiere Postgres real, lee
// migration.sql/down.sql y hace asserts por regex/toContain. La aplicacion real
// contra Postgres (db:migrate / db:rollback) queda DIFERIDA (la aplica el humano).

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

const migrationDir = migrationDirFor("_usuario_fulfillment");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

describe("usuario_fulfillment migration.sql (UP) — columna fulfillment (R1)", () => {
  it("agrega usuario.fulfillment BOOLEAN NOT NULL DEFAULT false", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "usuario" ADD COLUMN "fulfillment" BOOLEAN NOT NULL DEFAULT false;/,
    );
  });

  it("no crea tablas nuevas ni toca otras tablas (cambio aditivo minimo)", () => {
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/ALTER TABLE "orden"/);
    expect(upSql).not.toMatch(/DROP/i);
  });
});

describe("usuario_fulfillment down.sql (DOWN) — revierte exactamente (R2)", () => {
  it("dropea la columna fulfillment de usuario", () => {
    expect(downSql).toMatch(/ALTER TABLE "usuario" DROP COLUMN IF EXISTS "fulfillment";/);
  });

  it("no dropea la tabla usuario ni ninguna otra", () => {
    expect(downSql).not.toMatch(/DROP TABLE/i);
  });
});

describe("estructura up/down y orden temporal (R2, convencion del repo)", () => {
  it("la carpeta contiene tanto migration.sql como down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("tiene timestamp posterior a toda migracion previa", () => {
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const fulfillmentDir = dirs.find((d) => d.endsWith("_usuario_fulfillment"))!;
    const previos = dirs.filter(
      (d) =>
        !d.endsWith("_usuario_fulfillment") &&
        !d.endsWith("_rename_cobro_tarifas") && // feature 24: apendida despues con timestamp posterior
        !d.endsWith("_seed_roles_catalogo") && // seed roles: apendida despues
        !d.endsWith("_tarifa_zona_mensajero_zona_vehiculo_unique") && // feature 24: apendida despues
        !d.endsWith("_provincia_zona_id_nullable") && // geografia sin zona: apendida despues
        !d.endsWith("_zona_distrito_nm"), // feature 24 N:M: apendida despues
    );
    const maxPrevio = previos[previos.length - 1];
    expect(fulfillmentDir > maxPrevio).toBe(true);
  });
});
