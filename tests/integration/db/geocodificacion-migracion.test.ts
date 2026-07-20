import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 91 (R1-R4) — cobertura ESTATICA de las dos migraciones de la feature
// (`*_job_tipo_geocodificacion` y `*_orden_geocode`), patron jobs-cola-migration /
// api-key-migration: se lee el SQL por regex. La suite de vitest NO levanta Postgres; el
// round-trip REAL (UP -> DOWN -> RE-UP) contra un Postgres desechable en docker se
// documenta en progress/impl_91.md. Este test protege que el SQL escrito a mano no se
// desvie del diseno.

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

/** Las aserciones de AUSENCIA corren sobre el SQL EJECUTABLE, no sobre la prosa. */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const dirEnum = migrationDirFor("job_tipo_geocodificacion");
const dirDatos = migrationDirFor("orden_geocode");
const upEnum = sinComentarios(fs.readFileSync(path.join(dirEnum, "migration.sql"), "utf8"));
const upDatos = sinComentarios(fs.readFileSync(path.join(dirDatos, "migration.sql"), "utf8"));

const SCHEMA = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

describe("R1 — columnas de geocodificacion en la orden", () => {
  it("la tabla orden expone latitud/longitud/geocoded_at/geocode_precision/geocode_status nullables", () => {
    // Nullables = sin `NOT NULL` en la definicion de la columna (todas van en un solo
    // ALTER TABLE aditivo).
    expect(upDatos).toMatch(/ALTER TABLE\s+"orden"/);
    expect(upDatos).toMatch(/ADD COLUMN\s+"latitud"\s+DECIMAL\(10,7\)\s*,/);
    expect(upDatos).toMatch(/ADD COLUMN\s+"longitud"\s+DECIMAL\(10,7\)\s*,/);
    expect(upDatos).toMatch(/ADD COLUMN\s+"geocoded_at"\s+TIMESTAMP\(3\)\s*,/);
    expect(upDatos).toMatch(/ADD COLUMN\s+"geocode_precision"\s+TEXT\s*,/);
    expect(upDatos).toMatch(/ADD COLUMN\s+"geocode_status"\s+TEXT\s*;/);
    // Ninguna de las cinco es NOT NULL ni trae DEFAULT: una orden sin geocodificar las
    // tiene vacias y la migracion no reescribe filas existentes.
    const bloque = upDatos.slice(upDatos.indexOf('ALTER TABLE "orden"'));
    const alter = bloque.slice(0, bloque.indexOf(";") + 1);
    expect(alter).not.toMatch(/NOT NULL/i);
    expect(alter).not.toMatch(/DEFAULT/i);
  });

  it("el schema Prisma declara las cinco columnas opcionales con su @map snake_case", () => {
    expect(SCHEMA).toMatch(/latitud\s+Decimal\?\s+@db\.Decimal\(10, 7\)/);
    expect(SCHEMA).toMatch(/longitud\s+Decimal\?\s+@db\.Decimal\(10, 7\)/);
    expect(SCHEMA).toMatch(/geocodedAt\s+DateTime\?\s+@map\("geocoded_at"\)/);
    expect(SCHEMA).toMatch(/geocodePrecision\s+String\?\s+@map\("geocode_precision"\)/);
    expect(SCHEMA).toMatch(/geocodeStatus\s+String\?\s+@map\("geocode_status"\)/);
  });
});

describe("R2 — almacen de coordenadas resueltas", () => {
  it("geocode_cache tiene direccion_hash con indice unico", () => {
    expect(upDatos).toMatch(/CREATE TABLE\s+"geocode_cache"/);
    expect(upDatos).toMatch(/"direccion_hash"\s+TEXT\s+NOT NULL/);
    expect(upDatos).toMatch(
      /CREATE UNIQUE INDEX\s+"geocode_cache_direccion_hash_key"\s+ON\s+"geocode_cache"\s*\(\s*"direccion_hash"\s*\)/,
    );
  });

  it("guarda coordenadas, precision y el payload crudo, pero NUNCA la direccion en claro", () => {
    expect(upDatos).toMatch(/"latitud"\s+DECIMAL\(10,7\)\s+NOT NULL/);
    expect(upDatos).toMatch(/"longitud"\s+DECIMAL\(10,7\)\s+NOT NULL/);
    expect(upDatos).toMatch(/"precision"\s+TEXT\s+NOT NULL/);
    expect(upDatos).toMatch(/"payload_crudo"\s+JSONB/);
    // PII: la tabla NO tiene columna de direccion legible, solo su huella.
    const tabla = upDatos.slice(
      upDatos.indexOf('CREATE TABLE "geocode_cache"'),
      upDatos.indexOf('CREATE UNIQUE INDEX "geocode_cache_direccion_hash_key"'),
    );
    expect(tabla).not.toMatch(/"direccion"\s/);
  });
});

describe("R3 — RLS del almacen", () => {
  it("geocode_cache tiene RLS habilitada y cero policies", () => {
    expect(upDatos).toMatch(/ALTER TABLE\s+"geocode_cache"\s+ENABLE ROW LEVEL SECURITY/);
    expect(upDatos).not.toMatch(/CREATE POLICY/i);
  });
});

describe("R4 — catalogo de tipos de job", () => {
  it("job_tipo acepta el valor geocodificacion", () => {
    expect(upEnum).toMatch(
      /ALTER TYPE\s+"job_tipo"\s+ADD VALUE IF NOT EXISTS\s+'geocodificacion'/,
    );
    expect(SCHEMA).toMatch(/enum JobTipo \{[^}]*geocodificacion/);
  });

  it("el ADD VALUE va SOLO en su migracion: nada consume el valor nuevo (error 55P04)", () => {
    // Postgres no permite USAR un valor de enum en la misma transaccion que lo anadio, y
    // Prisma corre cada migration.sql en una transaccion.
    const sentencias = upEnum
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(sentencias).toHaveLength(1);
    // Y la migracion de datos, que SI corre despues, no toca el enum.
    expect(upDatos).not.toMatch(/job_tipo/);
  });
});
