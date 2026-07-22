import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 99 (R1-R3) — cobertura ESTATICA de las dos migraciones de la feature
// (`*_job_tipo_webhook_estado` y `*_webhook_suscripcion`), patron
// geocodificacion-migracion / jobs-cola-migration: se lee el SQL por regex. La suite de
// vitest NO levanta Postgres; el round-trip REAL (UP -> DOWN -> RE-UP) contra un Postgres
// desechable se documenta en progress/impl_99.md. Este test protege que el SQL escrito a
// mano no se desvie del diseno.

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
const upEnum = sinComentarios(fs.readFileSync(path.join(dirEnum, "migration.sql"), "utf8"));
const upTabla = sinComentarios(fs.readFileSync(path.join(dirTabla, "migration.sql"), "utf8"));

const SCHEMA = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

describe("R1 — tabla webhook_suscripcion", () => {
  it("expone owner_usuario_id unico, url, secret, activa y timestamps", () => {
    expect(upTabla).toMatch(/CREATE TABLE\s+"webhook_suscripcion"/);
    expect(upTabla).toMatch(/"owner_usuario_id"\s+TEXT\s+NOT NULL/);
    expect(upTabla).toMatch(/"url"\s+TEXT\s+NOT NULL/);
    expect(upTabla).toMatch(/"secret"\s+TEXT\s+NOT NULL/);
    expect(upTabla).toMatch(/"activa"\s+BOOLEAN\s+NOT NULL\s+DEFAULT true/);
    expect(upTabla).toMatch(/"created_at"\s+TIMESTAMP\(3\)/);
    expect(upTabla).toMatch(/"updated_at"\s+TIMESTAMP\(3\)/);
    // R1/R6: a lo sumo UNA suscripcion por owner -> indice unico sobre owner_usuario_id.
    expect(upTabla).toMatch(
      /CREATE UNIQUE INDEX\s+"webhook_suscripcion_owner_usuario_id_key"\s+ON\s+"webhook_suscripcion"\s*\(\s*"owner_usuario_id"\s*\)/,
    );
  });

  it("el schema Prisma declara el modelo con @unique y @map snake_case", () => {
    expect(SCHEMA).toMatch(/model WebhookSuscripcion \{/);
    expect(SCHEMA).toMatch(/ownerUsuarioId String\s+@unique @map\("owner_usuario_id"\)/);
    expect(SCHEMA).toMatch(/@@map\("webhook_suscripcion"\)/);
  });
});

describe("R2 — RLS de la tabla", () => {
  it("webhook_suscripcion tiene RLS habilitada y cero policies", () => {
    expect(upTabla).toMatch(
      /ALTER TABLE\s+"webhook_suscripcion"\s+ENABLE ROW LEVEL SECURITY/,
    );
    expect(upTabla).not.toMatch(/CREATE POLICY/i);
  });
});

describe("R3 — catalogo de tipos de job", () => {
  it("job_tipo acepta el valor webhook_estado", () => {
    expect(upEnum).toMatch(
      /ALTER TYPE\s+"job_tipo"\s+ADD VALUE IF NOT EXISTS\s+'webhook_estado'/,
    );
    expect(SCHEMA).toMatch(/\n\s*webhook_estado \/\/ feature 99/);
  });

  it("el ADD VALUE va SOLO en su migracion: nada consume el valor nuevo (error 55P04)", () => {
    const sentencias = upEnum
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(sentencias).toHaveLength(1);
    // La migracion de la tabla, que corre despues, NO consume el enum.
    expect(upTabla).not.toMatch(/webhook_estado/);
    expect(upTabla).not.toMatch(/job_tipo/);
  });
});
