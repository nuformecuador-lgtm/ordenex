import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 118 — cobertura ESTATICA de la migracion nueva
// `*_metodo_pago_rename_simpe_to_sinpe` (mismo patron que
// `gestion-orden-migration.test.ts`): lee migration.sql/down.sql por regex. NO
// requiere Postgres real (la aplicacion contra Postgres queda como DEUDA declarada,
// verificada a mano en local por T4). Cubre R2 (UP RENAME VALUE), R3 (DOWN inverso)
// y R4 (preservacion de filas: el UP usa RENAME VALUE y NO reescribe filas).

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

const migrationDir = migrationDirFor("_metodo_pago_rename_simpe_to_sinpe");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

// Quita los comentarios SQL (`-- ...`) para que las aserciones NEGATIVAS miren solo
// las sentencias ejecutables, no la prosa explicativa (que menciona ADD VALUE, etc).
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const upStatements = stripComments(upSql);
const downStatements = stripComments(downSql);

describe("UP — rename del valor del enum (R2)", () => {
  it("R2: ALTER TYPE metodo_pago_value RENAME VALUE 'SIMPE' TO 'SINPE'", () => {
    expect(upSql).toMatch(
      /ALTER TYPE "metodo_pago_value" RENAME VALUE 'SIMPE' TO 'SINPE';/,
    );
  });

  it("R4: NO reescribe filas ni recrea el tipo (sin UPDATE, sin ADD VALUE, sin CREATE/DROP TYPE)", () => {
    // RENAME VALUE preserva el OID del valor -> las filas ya almacenadas no se tocan
    // (mismo conteo, sin perdida). Un UPDATE/ADD VALUE/RECREATE romperia esa garantia.
    expect(upStatements).not.toMatch(/UPDATE\s/i);
    expect(upStatements).not.toMatch(/ADD VALUE/i);
    expect(upStatements).not.toMatch(/CREATE TYPE/i);
    expect(upStatements).not.toMatch(/DROP TYPE/i);
  });
});

describe("DOWN — inverso exacto (R3)", () => {
  it("R3: ALTER TYPE metodo_pago_value RENAME VALUE 'SINPE' TO 'SIMPE'", () => {
    expect(downSql).toMatch(
      /ALTER TYPE "metodo_pago_value" RENAME VALUE 'SINPE' TO 'SIMPE';/,
    );
  });

  it("R3: el DOWN es simetrico al UP (mismo tipo, valores invertidos)", () => {
    expect(downStatements).not.toMatch(/UPDATE\s/i);
    expect(downStatements).not.toMatch(/CREATE TYPE/i);
    expect(downStatements).not.toMatch(/DROP TYPE/i);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la migracion historica del enum", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const historicaDir = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_gestion_orden_estados_metodo_pago"));
    expect(historicaDir).toBeDefined();
    expect(dirName > (historicaDir as string)).toBe(true);
  });
});
