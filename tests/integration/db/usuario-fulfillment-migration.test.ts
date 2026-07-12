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

  // Invariante: cada migracion conserva su orden relativo respecto de sus
  // predecesoras; nuevas migraciones apendidas despues NO la afectan. Comparamos
  // contra el predecesor inmediato conocido (postulacion_mensajero), no contra el
  // maximo del repo (que crece con features futuras). Falla si alguien re-fechara
  // fulfillment antes de su predecesor.
  it("se ordena despues de su predecesor inmediato (postulacion_mensajero)", () => {
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const fulfillmentDir = dirs.find((d) => d.endsWith("_usuario_fulfillment"));
    const postulacionDir = dirs.find((d) => d.endsWith("_postulacion_mensajero"));
    expect(fulfillmentDir).toBeDefined();
    expect(postulacionDir).toBeDefined();
    expect(fulfillmentDir! > postulacionDir!).toBe(true);
  });
});
