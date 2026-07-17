import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 81 (R23/R24/R25) — cobertura ESTATICA de las migraciones `*_rol_api_key` y
// `*_api_key` (patron cierre-detail-migration: lee migration.sql/down.sql por regex).
// La suite de vitest no levanta Postgres.
//
// El round-trip REAL (up -> down -> up) se ejecuto contra un Postgres 16 real
// (contenedor docker efimero `ordenex-f81-pg`, base desechable `f81_rt`, NUNCA la DB
// compartida): `prisma migrate deploy` -> down.sql de ambas migraciones (orden inverso)
// -> `prisma migrate deploy` de nuevo. Verificado con psql: `relrowsecurity=true` y 0
// policies (R23), los 3 indices, el enum de vuelta a sus 5 valores originales tras el
// DOWN y sin `rol_value_old` huerfano, y un INSERT duplicado rechazado por
// `api_key_key_hash_key` (R25). Evidencia con la salida real en
// `progress/impl_81-api-keys.md`.
//
// Lo que este test protege es que el SQL escrito a mano no se desvie del diseño: la
// RLS sin policies (R23), el UNIQUE de key_hash (R25), el 1:1 de usuario_id [D6], y —
// el punto mas fragil — que el ADD VALUE del enum siga viviendo en una migracion
// SEPARADA del INSERT que lo usa (Postgres 55P04: "unsafe use of new value of enum
// type"). Si alguien los fusiona "para simplificar", la migracion revienta en deploy.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");

/**
 * Busca la carpeta `<timestamp>_<nombre>`. Ojo: el sufijo se ancla al `_` que sigue al
 * timestamp, porque "_rol_api_key" TAMBIEN termina en "_api_key" y un `endsWith` a
 * secas devolveria la migracion equivocada (las dos carpetas colisionarian).
 */
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

/** Las aserciones de AUSENCIA corren sobre el SQL EJECUTABLE, no sobre la prosa: los
 *  comentarios explican justamente lo que NO esta y darian falsos positivos. */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const rolDir = migrationDirFor("rol_api_key");
const apiKeyDir = migrationDirFor("api_key");

const rolUp = fs.readFileSync(path.join(rolDir, "migration.sql"), "utf8");
const rolDown = fs.readFileSync(path.join(rolDir, "down.sql"), "utf8");
const upSql = fs.readFileSync(path.join(apiKeyDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(apiKeyDir, "down.sql"), "utf8");

const rolUpExec = sinComentarios(rolUp);
const rolDownExec = sinComentarios(rolDown);
const upExec = sinComentarios(upSql);
const downExec = sinComentarios(downSql);

describe("orden de las migraciones — enum vs uso [D1]", () => {
  it("las dos migraciones son carpetas distintas y el enum va ANTES del INSERT", () => {
    expect(path.basename(rolDir) < path.basename(apiKeyDir)).toBe(true);
  });

  it("[D1]: el ADD VALUE del enum vive SOLO en la migracion del rol", () => {
    expect(rolUpExec).toMatch(/ALTER TYPE\s+"rol_value"\s+ADD VALUE\s+IF NOT EXISTS\s+'apiKey'/);
    // Postgres 55P04: usar el valor en la MISMA transaccion que lo añade aborta.
    expect(rolUpExec).not.toMatch(/INSERT\s+INTO\s+"rol"/i);
    expect(rolUpExec).not.toMatch(/CREATE\s+TABLE/i);
  });

  it("[D1]: el INSERT que USA 'apiKey' vive en la migracion siguiente, no junto al ADD VALUE", () => {
    expect(upExec).toMatch(/INSERT\s+INTO\s+"rol"[\s\S]*'apiKey'::rol_value/);
    expect(upExec).not.toMatch(/ALTER TYPE[\s\S]*ADD VALUE/i);
  });

  it("el seed del rol es idempotente (ON CONFLICT), patron seed_roles_catalogo", () => {
    expect(upExec).toMatch(/ON CONFLICT\s*\(\s*"value"\s*\)\s*DO NOTHING/i);
  });
});

describe("UP — tabla api_key (R23/R25/[D6]/R21)", () => {
  it("crea la tabla api_key con su PK", () => {
    expect(upExec).toMatch(/CREATE TABLE\s+"api_key"/);
    expect(upExec).toMatch(/CONSTRAINT\s+"api_key_pkey"\s+PRIMARY KEY\s*\(\s*"id"\s*\)/);
  });

  it("R16/R17: persiste key_hash y key_prefix, ambos NOT NULL", () => {
    expect(upExec).toMatch(/"key_hash"\s+TEXT\s+NOT NULL/);
    expect(upExec).toMatch(/"key_prefix"\s+TEXT\s+NOT NULL/);
  });

  it("R25: UNIQUE sobre key_hash (unicidad + indice del lookup de 81a)", () => {
    expect(upExec).toMatch(/CREATE UNIQUE INDEX\s+"api_key_key_hash_key"\s+ON\s+"api_key"\("key_hash"\)/);
  });

  it("[D6]: UNIQUE sobre usuario_id (1:1 key <-> usuario dedicado)", () => {
    expect(upExec).toMatch(/CREATE UNIQUE INDEX\s+"api_key_usuario_id_key"\s+ON\s+"api_key"\("usuario_id"\)/);
  });

  it("R21: registra usuario_id, created_by_id y created_at, con FKs ON DELETE RESTRICT", () => {
    expect(upExec).toMatch(/"usuario_id"\s+TEXT\s+NOT NULL/);
    expect(upExec).toMatch(/"created_by_id"\s+TEXT\s+NOT NULL/);
    expect(upExec).toMatch(/"created_at"\s+TIMESTAMP\(3\)\s+NOT NULL\s+DEFAULT CURRENT_TIMESTAMP/);
    expect(upExec).toMatch(/"api_key_usuario_id_fkey"[\s\S]*?REFERENCES\s+"usuario"\("id"\)\s+ON DELETE RESTRICT/);
    expect(upExec).toMatch(/"api_key_created_by_id_fkey"[\s\S]*?REFERENCES\s+"usuario"\("id"\)\s+ON DELETE RESTRICT/);
  });

  it("R23: habilita RLS y NO define ninguna policy (solo service role)", () => {
    expect(upExec).toMatch(/ALTER TABLE\s+"api_key"\s+ENABLE ROW LEVEL SECURITY/);
    expect(upExec).not.toMatch(/CREATE POLICY/i);
  });

  it("R16: la migracion NUNCA crea una columna para el secreto en claro", () => {
    expect(upExec).not.toMatch(/"key_plain"|"plain_key"|"secret"/i);
  });

  it("fuera de alcance (81b): sin revoked_at / expires_at / last_used_at", () => {
    expect(upExec).not.toMatch(/revoked_at|expires_at|last_used_at/i);
  });

  it("R24: es aditiva — no altera ni borra tablas existentes", () => {
    expect(upExec).not.toMatch(/DROP TABLE/i);
    expect(upExec).not.toMatch(/ALTER TABLE\s+"usuario"/i);
  });
});

describe("DOWN — revierte exactamente el UP (R24)", () => {
  it("R24: borra la tabla api_key (arrastra indices, FKs y RLS)", () => {
    expect(downExec).toMatch(/DROP TABLE IF EXISTS\s+"api_key"/);
  });

  it("R24: borra la fila del rol sembrada por el UP", () => {
    expect(downExec).toMatch(/DELETE FROM\s+"rol"\s+WHERE\s+"value"\s*=\s*'apiKey'::rol_value/);
  });

  it("[D1]: el down del enum RECREA el tipo (Postgres no soporta DROP VALUE)", () => {
    expect(rolDownExec).not.toMatch(/DROP VALUE/i);
    expect(rolDownExec).toMatch(/ALTER TYPE\s+"rol_value"\s+RENAME TO\s+"rol_value_old"/);
    expect(rolDownExec).toMatch(/CREATE TYPE\s+"rol_value"\s+AS ENUM/);
    expect(rolDownExec).toMatch(/ALTER TABLE\s+"rol"\s+ALTER COLUMN\s+"value"\s+TYPE\s+"rol_value"/);
    expect(rolDownExec).toMatch(/DROP TYPE\s+"rol_value_old"/);
  });

  it("[D1]: el tipo recreado tiene los 5 valores previos y NO 'apiKey'", () => {
    const m = rolDownExec.match(/CREATE TYPE\s+"rol_value"\s+AS ENUM\s*\(([^)]*)\)/);
    expect(m).not.toBeNull();
    const valores = (m ? m[1] : "")
      .split(",")
      .map((v) => v.trim().replace(/^'|'$/g, ""))
      .filter((v) => v.length > 0);
    expect(valores).toEqual(["maestro", "admin", "mensajero", "Admin Tienda", "adminSatelite"]);
    expect(valores).not.toContain("apiKey");
  });
});
