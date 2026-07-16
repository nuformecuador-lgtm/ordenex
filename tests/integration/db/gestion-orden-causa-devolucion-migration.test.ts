import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { CAUSA_DEVOLUCION_SEED } from "@/lib/types/causa-devolucion";

// Feature 73 (R11/R14/R15/R16, F1.4-a + F1.4-b + F1.4-d) — cobertura ESTATICA de la migracion
// `*_gestion_orden_causa_devolucion` (patron gestion-orden-anulacion-migration.test.ts, la
// hermana literal sobre la MISMA tabla): lee migration.sql / down.sql por regex. La aplicacion
// REAL contra Postgres + el round-trip (deploy -> verificar -> down -> verificar -> deploy) los
// ejecuta el implementer y quedan en la bitacora `progress/impl_73-causa-devolucion.md`.

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

/**
 * Quita los comentarios `--` para que las aserciones NEGATIVAS ("no hay CHECK", "no hay DROP
 * COLUMN") miren SENTENCIAS y no prosa: los comentarios de estas migraciones citan justamente
 * las palabras prohibidas al explicar por que NO se usan (F1.4-b), y sin esto un `not.toMatch`
 * daria un falso positivo.
 */
function soloSentencias(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

const migrationDir = migrationDirFor("_gestion_orden_causa_devolucion");
const upSql = soloSentencias(fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8"));
const downSqlRaw = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const downSql = soloSentencias(downSqlRaw);
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

describe("Feature 73 · UP — enum nuevo + columna nullable (R1/R11/R15/R16)", () => {
  it("R1/F1.4-d: crea el enum con EXACTAMENTE las 3 causas, en el orden del SEED", () => {
    const match = upSql.match(/CREATE TYPE "gestion_causa_devolucion" AS ENUM \(([\s\S]*?)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toEqual([...CAUSA_DEVOLUCION_SEED]);
    expect(valores).toHaveLength(3);
    // Sin "Otro" ni valores reservados para el futuro (F1.4-d).
    expect(valores).not.toContain("otro");
  });

  it("R11: añade `causa_devolucion` a gestion_orden con el tipo del enum", () => {
    expect(upSql).toMatch(
      /ALTER TABLE "gestion_orden" ADD COLUMN "causa_devolucion" "gestion_causa_devolucion";/,
    );
  });

  it("R16/F1.4-a: la columna es NULLABLE y SIN default -> el historico no necesita backfill", () => {
    expect(upSql).not.toMatch(/"causa_devolucion"[^;]*NOT NULL/);
    expect(upSql).not.toMatch(/"causa_devolucion"[^;]*DEFAULT/);
    // No se inventa una causa para las devoluciones ya existentes (CLAUDE.md §6 "No inventes").
    expect(upSql).not.toMatch(/UPDATE "gestion_orden"/i);
    expect(upSql).not.toMatch(/INSERT INTO/i);
  });

  it("F1.4-b: SIN CHECK constraint — la obligatoriedad vive en el borde (zod), no en la base", () => {
    expect(upSql).not.toMatch(/CHECK/i);
    expect(upSql).not.toMatch(/ADD CONSTRAINT/i);
  });

  it("R15: es ADITIVA — no altera ni borra columnas, datos ni indices preexistentes", () => {
    expect(upSql).not.toMatch(/DROP COLUMN/i);
    expect(upSql).not.toMatch(/ALTER COLUMN/i);
    expect(upSql).not.toMatch(/DROP TABLE/i);
    expect(upSql).not.toMatch(/DELETE FROM/i);
    expect(upSql).not.toMatch(/DROP INDEX/i);
    // R12: el texto libre compartido por reprogramar/devolucion/rechazo NO se toca.
    expect(upSql).not.toMatch(/ALTER TABLE "gestion_orden"[^;]*"motivo"/i);
  });

  it("R15: NO toca RLS — sin tabla nueva, `gestion_orden` conserva la suya (habilitada, sin policies)", () => {
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/DROP POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("R20: no añade order_status, ni valores al enum de origen del historial, ni contador", () => {
    expect(upSql).not.toMatch(/orden_historial_origen_tipo/i);
    expect(upSql).not.toMatch(/order_status/i);
    expect(upSql).not.toMatch(/intentos/i);
  });
});

describe("Feature 73 · DOWN — reversible (OBLIGATORIO, docs/architecture.md)", () => {
  it("R14: suelta la columna y DESPUES el tipo, en orden INVERSO al UP", () => {
    // El DROP TYPE solo puede correr cuando ya no queda columna usuaria del tipo.
    const idxCol = downSql.search(
      /ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "causa_devolucion";/,
    );
    const idxTipo = downSql.search(/DROP TYPE IF EXISTS "gestion_causa_devolucion";/);
    expect(idxCol).toBeGreaterThan(-1);
    expect(idxTipo).toBeGreaterThan(-1);
    expect(idxTipo).toBeGreaterThan(idxCol);
  });

  it("R14: revierte EXACTAMENTE las 2 sentencias del UP, ni una mas", () => {
    const sentencias = downSql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--") && l.trim() !== "");
    expect(sentencias).toHaveLength(2);
  });

  it("enum NUEVO -> basta DROP TYPE: no necesita el rodeo RENAME+CREATE+USING de la 67", () => {
    // Postgres no soporta DROP VALUE, pero aqui se va el tipo ENTERO junto con su unica
    // columna usuaria -> no hay que recrearlo (a diferencia del down de la 67, que añadia un
    // valor a un enum PREEXISTENTE).
    expect(downSql).not.toMatch(/RENAME TO/i);
    expect(downSql).not.toMatch(/USING \(/i);
  });

  it("el down tampoco toca policies RLS ni el `motivo`", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(downSql).not.toMatch(/DROP COLUMN IF EXISTS "motivo"/i);
  });
});

describe("Feature 73 · schema.prisma refleja la migracion (sin drift)", () => {
  it("R11/R16: GestionOrden declara causaDevolucion OPCIONAL mapeada a la columna", () => {
    expect(schemaPrisma).toMatch(
      /causaDevolucion\s+GestionCausaDevolucion\?\s+@map\("causa_devolucion"\)/,
    );
  });

  it("R1: el enum Prisma tiene exactamente las 3 causas y el @@map del tipo Postgres", () => {
    const bloque = schemaPrisma.match(/enum GestionCausaDevolucion \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    const cuerpo = (bloque as RegExpMatchArray)[1];
    for (const valor of CAUSA_DEVOLUCION_SEED) {
      expect(cuerpo).toMatch(new RegExp(`\\b${valor}\\b`));
    }
    expect(cuerpo).toMatch(/@@map\("gestion_causa_devolucion"\)/);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("R14: contiene migration.sql y down.sql, con timestamp posterior a la ultima previa", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const previa = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((name) => name.endsWith("_cierre_detail"));
    expect(previa).toBeDefined();
    expect(dirName > (previa as string)).toBe(true);
  });
});
