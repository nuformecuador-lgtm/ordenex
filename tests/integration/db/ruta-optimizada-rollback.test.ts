import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 92 (R39/R40) — cobertura ESTATICA de los `down.sql`. Patron
// `geocodificacion-rollback.test.ts`. Un `down.sql` que no revierta EXACTAMENTE lo que
// hace su `migration.sql` deja residuos que rompen la siguiente re-aplicacion, y eso solo
// se descubre en el peor momento posible: durante un rollback en produccion.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

function migrationDirFor(nombre: string): string {
  const dirs = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => new RegExp(`^\\d+_${nombre}$`).test(name));
  if (dirs.length !== 1) throw new Error(`Se esperaba UNA carpeta para ${nombre}`);
  return path.join(MIGRATIONS_DIR, dirs[0]);
}

function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const dirEnum = migrationDirFor("job_tipo_optimizacion_ruta");
const dirDatos = migrationDirFor("ruta_optimizada");
const downEnum = sinComentarios(fs.readFileSync(path.join(dirEnum, "down.sql"), "utf8"));
const downDatos = sinComentarios(fs.readFileSync(path.join(dirDatos, "down.sql"), "utf8"));

describe("R39 — ambas migraciones tienen su down.sql", () => {
  it.each([
    ["job_tipo_optimizacion_ruta", dirEnum],
    ["ruta_optimizada", dirDatos],
  ])("%s trae down.sql no vacio", (_nombre, dir) => {
    const p = path.join(dir, "down.sql");
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, "utf8").trim().length).toBeGreaterThan(0);
  });
});

describe("R40 — el down del enum RECREA el tipo (Postgres no soporta DROP VALUE)", () => {
  it("renombra el tipo, lo recrea sin el valor nuevo, migra la columna y borra el viejo", () => {
    expect(downEnum).toMatch(/ALTER TYPE\s+"job_tipo"\s+RENAME TO\s+"job_tipo_old"/);
    expect(downEnum).toMatch(
      /CREATE TYPE\s+"job_tipo"\s+AS ENUM\s*\(\s*'liberar_reprogramadas',\s*'geocodificacion'\s*\)/,
    );
    expect(downEnum).toMatch(
      /ALTER TABLE\s+"jobs"\s+ALTER COLUMN\s+"tipo"\s+TYPE\s+"job_tipo"\s+USING/,
    );
    expect(downEnum).toMatch(/DROP TYPE\s+"job_tipo_old"/);
  });

  it("el tipo recreado conserva EXACTAMENTE los valores previos a esta feature", () => {
    // Ni uno mas (quedaria el valor que se esta revirtiendo) ni uno menos (romperia las
    // features 46/90 y 91, ambas en produccion).
    const match = downEnum.match(/CREATE TYPE\s+"job_tipo"\s+AS ENUM\s*\(([^)]*)\)/);
    expect(match).not.toBeNull();
    const valores = (match as RegExpMatchArray)[1]
      .split(",")
      .map((v) => v.trim().replace(/'/g, ""));
    expect(valores).toEqual(["liberar_reprogramadas", "geocodificacion"]);
    expect(valores).not.toContain("optimizacion_ruta");
  });

  it("borra ANTES las filas del tipo que se revierte (si no, el USING falla ruidosamente)", () => {
    const delete_ = downEnum.indexOf('DELETE FROM "jobs"');
    const rename = downEnum.indexOf("RENAME TO");
    expect(delete_).toBeGreaterThanOrEqual(0);
    expect(delete_).toBeLessThan(rename);
    expect(downEnum).toMatch(/DELETE FROM\s+"jobs"\s+WHERE\s+"tipo"\s*=\s*'optimizacion_ruta'/);
  });
});

describe("R39 — el down de las tablas revierte EXACTAMENTE la migracion", () => {
  it("borra el detalle ANTES que la cabecera (respeta la FK)", () => {
    const parada = downDatos.indexOf('DROP TABLE IF EXISTS "ruta_optimizada_parada"');
    const cabecera = downDatos.indexOf('DROP TABLE IF EXISTS "ruta_optimizada"');
    expect(parada).toBeGreaterThanOrEqual(0);
    expect(cabecera).toBeGreaterThan(parada);
  });

  it("borra el tipo ruta_estado DESPUES de las tablas que lo usan", () => {
    const cabecera = downDatos.indexOf('DROP TABLE IF EXISTS "ruta_optimizada"');
    const tipo = downDatos.indexOf('DROP TYPE IF EXISTS "ruta_estado"');
    expect(tipo).toBeGreaterThan(cabecera);
  });

  it("todo lo creado por el UP queda revertido: dos tablas y un tipo", () => {
    // Los `DROP TABLE` arrastran PKs, los tres indices, las tres FKs y la config de RLS.
    expect(downDatos).toMatch(/DROP TABLE IF EXISTS "ruta_optimizada_parada"/);
    expect(downDatos).toMatch(/DROP TABLE IF EXISTS "ruta_optimizada"/);
    expect(downDatos).toMatch(/DROP TYPE IF EXISTS "ruta_estado"/);
  });

  it("NO toca ninguna tabla ajena a la feature (la migracion era aditiva)", () => {
    for (const ajena of ["orden", "usuario", "jobs", "geocode_cache"]) {
      expect(downDatos).not.toMatch(new RegExp(`(DROP|ALTER) TABLE[^;]*"${ajena}"`, "i"));
    }
  });
});
