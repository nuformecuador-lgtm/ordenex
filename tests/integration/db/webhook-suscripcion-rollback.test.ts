import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 99 (R4) — el `down.sql` de las dos migraciones deja el esquema EXACTAMENTE como
// estaba. Cobertura estatica (patron geocodificacion-rollback); el round-trip real
// UP -> DOWN -> RE-UP contra un Postgres desechable se documenta en progress/impl_99.md.

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

function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const dirEnum = migrationDirFor("job_tipo_webhook_estado");
const dirTabla = migrationDirFor("webhook_suscripcion");
const downEnum = sinComentarios(fs.readFileSync(path.join(dirEnum, "down.sql"), "utf8"));
const downTabla = sinComentarios(fs.readFileSync(path.join(dirTabla, "down.sql"), "utf8"));

describe("R4 — el rollback elimina la tabla y el valor del enum sin dejar residuos", () => {
  it("ambas migraciones tienen su down.sql", () => {
    expect(fs.existsSync(path.join(dirEnum, "down.sql"))).toBe(true);
    expect(fs.existsSync(path.join(dirTabla, "down.sql"))).toBe(true);
  });

  it("el down de la tabla borra webhook_suscripcion (arrastra PK, indice unico, FK y RLS)", () => {
    expect(downTabla).toMatch(/DROP TABLE IF EXISTS\s+"webhook_suscripcion"/);
  });

  it("el down del enum RECREA el tipo (Postgres no soporta DROP VALUE) sin webhook_estado", () => {
    expect(downEnum).not.toMatch(/DROP VALUE/i);
    expect(downEnum).toMatch(/ALTER TYPE\s+"job_tipo"\s+RENAME TO\s+"job_tipo_old"/);
    expect(downEnum).toMatch(
      /CREATE TYPE\s+"job_tipo"\s+AS ENUM\s*\(\s*'liberar_reprogramadas',\s*'geocodificacion',\s*'optimizacion_ruta'\s*\)/,
    );
    expect(downEnum).toMatch(
      /ALTER TABLE\s+"jobs"\s+ALTER COLUMN\s+"tipo"\s+TYPE\s+"job_tipo"\s+USING/,
    );
    expect(downEnum).toMatch(/DROP TYPE\s+"job_tipo_old"/);
    // El tipo recreado NO conserva el valor de esta feature.
    const create = downEnum.match(/CREATE TYPE\s+"job_tipo"\s+AS ENUM\s*\(([^)]*)\)/);
    expect(create).not.toBeNull();
    expect(create ? create[1] : "").not.toMatch(/webhook_estado/);
  });

  it("el down del enum borra antes las filas jobs del tipo, o el ALTER fallaria", () => {
    const posDelete = downEnum.indexOf("DELETE FROM");
    const posAlter = downEnum.indexOf('ALTER TYPE "job_tipo" RENAME TO');
    expect(posDelete).toBeGreaterThanOrEqual(0);
    expect(downEnum).toMatch(/DELETE FROM\s+"jobs"\s+WHERE\s+"tipo"\s*=\s*'webhook_estado'/);
    expect(posDelete).toBeLessThan(posAlter);
  });
});
