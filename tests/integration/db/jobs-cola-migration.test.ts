import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 90 (R1-R6) — cobertura ESTATICA de la migracion `*_jobs_cola` (patron
// api-key-migration: lee migration.sql/down.sql por regex). La suite de vitest NO levanta
// Postgres; el round-trip REAL (up -> down -> up) contra un Postgres desechable se documenta
// en progress/impl_90.md. Este test protege que el SQL escrito a mano no se desvie del
// diseno: enums nativos, indice PARCIAL de seleccion, unico PARCIAL de dedupe, RLS sin
// policies y un down que revierte exactamente.

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

const dir = migrationDirFor("jobs_cola");
const upExec = sinComentarios(fs.readFileSync(path.join(dir, "migration.sql"), "utf8"));
const downExec = sinComentarios(fs.readFileSync(path.join(dir, "down.sql"), "utf8"));

describe("UP — enums nativos (R2)", () => {
  it("crea job_tipo con el valor liberar_reprogramadas", () => {
    expect(upExec).toMatch(/CREATE TYPE\s+"job_tipo"\s+AS ENUM\s*\(\s*'liberar_reprogramadas'\s*\)/);
  });

  it("crea job_estado con los 4 estados cerrados", () => {
    const m = upExec.match(/CREATE TYPE\s+"job_estado"\s+AS ENUM\s*\(([^)]*)\)/);
    expect(m).not.toBeNull();
    const valores = (m ? m[1] : "")
      .split(",")
      .map((v) => v.trim().replace(/^'|'$/g, ""))
      .filter((v) => v.length > 0);
    expect(valores).toEqual(["pending", "processing", "done", "failed"]);
  });
});

describe("UP — tabla jobs (R1)", () => {
  it("crea la tabla jobs con su PK", () => {
    expect(upExec).toMatch(/CREATE TABLE\s+"jobs"/);
    expect(upExec).toMatch(/CONSTRAINT\s+"jobs_pkey"\s+PRIMARY KEY\s*\(\s*"id"\s*\)/);
  });

  it("R1: columnas con tipos/ defaults esperados", () => {
    expect(upExec).toMatch(/"tipo"\s+"job_tipo"\s+NOT NULL/);
    expect(upExec).toMatch(/"payload"\s+JSONB\s+NOT NULL\s+DEFAULT\s+'\{\}'/);
    expect(upExec).toMatch(/"estado"\s+"job_estado"\s+NOT NULL\s+DEFAULT\s+'pending'/);
    expect(upExec).toMatch(/"intentos"\s+INTEGER\s+NOT NULL\s+DEFAULT\s+0/);
    expect(upExec).toMatch(/"max_intentos"\s+INTEGER\s+NOT NULL/);
    expect(upExec).toMatch(/"run_after"\s+TIMESTAMP\(3\)\s+NOT NULL\s+DEFAULT CURRENT_TIMESTAMP/);
    expect(upExec).toMatch(/"locked_at"\s+TIMESTAMP\(3\)/);
    expect(upExec).toMatch(/"last_error"\s+TEXT/);
    expect(upExec).toMatch(/"dedupe_key"\s+TEXT/);
  });
});

describe("UP — indices parciales (R3/R4)", () => {
  it("R3: indice PARCIAL de seleccion sobre run_after WHERE estado = 'pending'", () => {
    expect(upExec).toMatch(
      /CREATE INDEX\s+"jobs_run_after_pending_idx"\s+ON\s+"jobs"\s*\(\s*"run_after"\s*\)\s+WHERE\s+"estado"\s*=\s*'pending'/,
    );
  });

  it("R4: indice UNICO PARCIAL sobre dedupe_key WHERE dedupe_key IS NOT NULL", () => {
    expect(upExec).toMatch(
      /CREATE UNIQUE INDEX\s+"jobs_dedupe_key_key"\s+ON\s+"jobs"\s*\(\s*"dedupe_key"\s*\)\s+WHERE\s+"dedupe_key"\s+IS NOT NULL/,
    );
  });
});

describe("UP — RLS (R5) y caracter aditivo", () => {
  it("R5: habilita RLS y NO define ninguna policy (solo service role)", () => {
    expect(upExec).toMatch(/ALTER TABLE\s+"jobs"\s+ENABLE ROW LEVEL SECURITY/);
    expect(upExec).not.toMatch(/CREATE POLICY/i);
  });

  it("es aditiva — no altera ni borra tablas existentes", () => {
    expect(upExec).not.toMatch(/DROP TABLE/i);
    expect(upExec).not.toMatch(/ALTER TABLE\s+(?!"jobs")/i);
  });
});

describe("DOWN — revierte exactamente el UP (R6)", () => {
  it("R6: existe down.sql y borra la tabla jobs (arrastra indices, PK y RLS)", () => {
    expect(fs.existsSync(path.join(dir, "down.sql"))).toBe(true);
    expect(downExec).toMatch(/DROP TABLE IF EXISTS\s+"jobs"/);
  });

  it("R6: borra los dos enums nativos", () => {
    expect(downExec).toMatch(/DROP TYPE IF EXISTS\s+"job_estado"/);
    expect(downExec).toMatch(/DROP TYPE IF EXISTS\s+"job_tipo"/);
  });
});
