import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 92 (R39/R40) — cobertura ESTATICA de las dos migraciones de la feature
// (`*_job_tipo_optimizacion_ruta` y `*_ruta_optimizada`), patron
// `geocodificacion-migracion.test.ts` / `jobs-cola-migration.test.ts`: se lee el SQL por
// regex. La suite de vitest NO levanta Postgres; el round-trip REAL (UP -> DOWN -> RE-UP)
// contra un Postgres desechable se documenta en progress/impl_92.md. Este test protege que
// el SQL escrito a mano no se desvie del diseno.

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

const dirEnum = migrationDirFor("job_tipo_optimizacion_ruta");
const dirDatos = migrationDirFor("ruta_optimizada");
const upEnum = sinComentarios(fs.readFileSync(path.join(dirEnum, "migration.sql"), "utf8"));
const upDatos = sinComentarios(fs.readFileSync(path.join(dirDatos, "migration.sql"), "utf8"));

const SCHEMA = fs.readFileSync(path.join(__dirname, "..", "..", "..", "db", "schema.prisma"), "utf8");

describe("R40 — el ADD VALUE del enum va en su PROPIA migracion", () => {
  it("job_tipo acepta el valor optimizacion_ruta", () => {
    expect(upEnum).toMatch(
      /ALTER TYPE\s+"job_tipo"\s+ADD VALUE IF NOT EXISTS\s+'optimizacion_ruta'/,
    );
    // `[\s\S]*?` y no `[^}]*`: los comentarios del enum contienen llaves
    // (`payload { ordenId }`), que cortarian una clase negada de `}`.
    expect(SCHEMA).toMatch(/enum JobTipo \{[\s\S]*?optimizacion_ruta/);
  });

  it("NADA consume el valor nuevo en esa misma migracion (error 55P04)", () => {
    // Postgres no permite USAR un valor de enum en la misma transaccion que lo anadio, y
    // Prisma corre cada migration.sql en una transaccion. Precedentes: la 81, la 88 y la 91.
    const sentencias = upEnum
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(sentencias).toHaveLength(1);
    // Y la migracion de datos, que corre despues, no toca el enum.
    expect(upDatos).not.toMatch(/job_tipo/);
    expect(upDatos).not.toMatch(/optimizacion_ruta/);
  });

  it("la migracion del enum se aplica ANTES que la de las tablas (orden lexicografico)", () => {
    expect(path.basename(dirEnum) < path.basename(dirDatos)).toBe(true);
  });
});

describe("R26/R39 — tablas de la ruta optimizada", () => {
  it("crea el enum nativo ruta_estado con sus dos valores", () => {
    expect(upDatos).toMatch(/CREATE TYPE\s+"ruta_estado"\s+AS ENUM\s*\(\s*'vigente',\s*'desactualizada'\s*\)/);
    expect(SCHEMA).toMatch(/enum RutaEstado \{[\s\S]*?vigente[\s\S]*?desactualizada[\s\S]*?\}/);
  });

  it("la cabecera tiene UNA ruta por mensajero (indice unico) y su estado por defecto es vigente", () => {
    expect(upDatos).toMatch(/CREATE TABLE\s+"ruta_optimizada"/);
    expect(upDatos).toMatch(/"estado"\s+"ruta_estado"\s+NOT NULL\s+DEFAULT\s+'vigente'/);
    expect(upDatos).toMatch(
      /CREATE UNIQUE INDEX\s+"ruta_optimizada_mensajero_id_key"\s+ON\s+"ruta_optimizada"\s*\(\s*"mensajero_id"\s*\)/,
    );
  });

  it("el origen se guarda con coordenadas DECIMAL(10,7), instante y fuente", () => {
    expect(upDatos).toMatch(/"origen_lat"\s+DECIMAL\(10,7\)/);
    expect(upDatos).toMatch(/"origen_lng"\s+DECIMAL\(10,7\)/);
    expect(upDatos).toMatch(/"origen_at"\s+TIMESTAMP\(3\)/);
    expect(upDatos).toMatch(/"origen_fuente"\s+TEXT/);
    // `calculada_at` NULLABLE: "nunca se calculo" es un estado real, distinto de vigente.
    expect(upDatos).toMatch(/"calculada_at"\s+TIMESTAMP\(3\)\s*,/);
  });

  it("R26: los DOS indices unicos del detalle hacen imposible una secuencia invalida", () => {
    // `(ruta_id, orden_id)`: la misma orden no puede ocupar dos posiciones.
    // `(ruta_id, secuencia)`: dos ordenes no pueden ocupar la misma posicion.
    expect(upDatos).toMatch(
      /CREATE UNIQUE INDEX\s+"ruta_optimizada_parada_ruta_id_orden_id_key"\s+ON\s+"ruta_optimizada_parada"\s*\(\s*"ruta_id",\s*"orden_id"\s*\)/,
    );
    expect(upDatos).toMatch(
      /CREATE UNIQUE INDEX\s+"ruta_optimizada_parada_ruta_id_secuencia_key"\s+ON\s+"ruta_optimizada_parada"\s*\(\s*"ruta_id",\s*"secuencia"\s*\)/,
    );
    // Y el indice de lectura por orden (lo consume "mis asignaciones").
    expect(upDatos).toMatch(
      /CREATE INDEX\s+"ruta_optimizada_parada_orden_id_idx"\s+ON\s+"ruta_optimizada_parada"\s*\(\s*"orden_id"\s*\)/,
    );
  });

  it("las tres FKs son ON DELETE CASCADE", () => {
    expect(upDatos).toMatch(
      /"ruta_optimizada_mensajero_id_fkey"[\s\S]*?REFERENCES\s+"usuario"[\s\S]*?ON DELETE CASCADE/,
    );
    expect(upDatos).toMatch(
      /"ruta_optimizada_parada_ruta_id_fkey"[\s\S]*?REFERENCES\s+"ruta_optimizada"[\s\S]*?ON DELETE CASCADE/,
    );
    expect(upDatos).toMatch(
      /"ruta_optimizada_parada_orden_id_fkey"[\s\S]*?REFERENCES\s+"orden"[\s\S]*?ON DELETE CASCADE/,
    );
  });

  it("es ADITIVA: no altera ninguna tabla existente", () => {
    // Los unicos ALTER TABLE permitidos son los de las FKs y los de RLS, todos sobre las
    // dos tablas NUEVAS. Ninguno toca `orden`, `usuario` ni `jobs`.
    const alters = upDatos.match(/ALTER TABLE\s+"(\w+)"/g) ?? [];
    for (const alter of alters) {
      expect(alter).toMatch(/"ruta_optimizada(_parada)?"/);
    }
    expect(upDatos).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });
});

describe("R39 — RLS habilitada sin policies en AMBAS tablas nuevas", () => {
  it("las dos tablas tienen RLS y cero policies", () => {
    // Guardan geolocalizacion de una persona: no son accesibles desde el cliente.
    expect(upDatos).toMatch(/ALTER TABLE\s+"ruta_optimizada"\s+ENABLE ROW LEVEL SECURITY/);
    expect(upDatos).toMatch(/ALTER TABLE\s+"ruta_optimizada_parada"\s+ENABLE ROW LEVEL SECURITY/);
    expect(upDatos).not.toMatch(/CREATE POLICY/i);
  });
});

describe("modelos Prisma", () => {
  it("RutaOptimizada y RutaOptimizadaParada declaran sus @map snake_case y sus indices", () => {
    expect(SCHEMA).toMatch(/model RutaOptimizada \{[\s\S]*?@@map\("ruta_optimizada"\)/);
    expect(SCHEMA).toMatch(
      /model RutaOptimizadaParada \{[\s\S]*?@@map\("ruta_optimizada_parada"\)/,
    );
    expect(SCHEMA).toMatch(/mensajeroId\s+String\s+@unique @map\("mensajero_id"\)/);
    expect(SCHEMA).toMatch(/@@unique\(\[rutaId, ordenId\]\)/);
    expect(SCHEMA).toMatch(/@@unique\(\[rutaId, secuencia\]\)/);
  });
});
