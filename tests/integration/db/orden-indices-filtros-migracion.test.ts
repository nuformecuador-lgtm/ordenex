import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 144/B5 — cobertura ESTATICA de la migracion `*_orden_indices_filtros`
// (patron `zonas-migration` / `geocodificacion-migracion`): lee migration.sql, down.sql y
// schema.prisma y verifica su contenido por regex. NO requiere Postgres real.
//
// La migracion es SOLO de indices: sin tablas nuevas, sin columnas nuevas => sin RLS nueva.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor("_orden_indices_filtros");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

const COLUMNAS = ["zona_id", "provincia_id", "canton_id", "distrito_id"] as const;

describe("UP — cuatro indices sobre `orden`", () => {
  for (const col of COLUMNAS) {
    it(`crea orden_${col}_idx sobre orden(${col})`, () => {
      expect(upSql).toMatch(
        new RegExp(`CREATE INDEX "orden_${col}_idx"\\s+ON "orden"\\("${col}"\\)`),
      );
    });
  }

  it("NO crea tablas, columnas ni constraints (solo indices)", () => {
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/ADD COLUMN/i);
    expect(upSql).not.toMatch(/DROP COLUMN/i);
    expect(upSql).not.toMatch(/ADD CONSTRAINT/i);
    expect(upSql).not.toMatch(/ALTER TYPE/i);
  });

  it("no duplica indices que YA existen (created_at, tienda_id, estatus_id)", () => {
    expect(upSql).not.toMatch(/CREATE INDEX[^\n]*"created_at"/);
    expect(upSql).not.toMatch(/CREATE INDEX[^\n]*"tienda_id"/);
    expect(upSql).not.toMatch(/CREATE INDEX[^\n]*"estatus_id"/);
  });

  it("sin tablas nuevas no hay RLS que declarar, y no se deshabilita ninguna", () => {
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("DOWN — revierte EXACTAMENTE lo del UP", () => {
  for (const col of COLUMNAS) {
    it(`elimina orden_${col}_idx de forma idempotente`, () => {
      expect(downSql).toMatch(new RegExp(`DROP INDEX IF EXISTS "orden_${col}_idx"`));
    });
  }

  it("el DOWN no toca nada mas que esos cuatro indices", () => {
    const sentencias = downSql
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("--"));
    expect(sentencias).toHaveLength(4);
    expect(sentencias.every((s) => s.startsWith("DROP INDEX IF EXISTS"))).toBe(true);
  });

  it("hay un indice DROP por cada CREATE del UP", () => {
    const creados = (upSql.match(/CREATE INDEX/g) ?? []).length;
    const borrados = (downSql.match(/DROP INDEX/g) ?? []).length;
    expect(creados).toBe(4);
    expect(borrados).toBe(creados);
  });
});

describe("carpeta y schema.prisma", () => {
  it("la carpeta contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("su timestamp NO es anterior al de ninguna migracion previa", () => {
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const esta = dirs.find((d) => d.endsWith("_orden_indices_filtros"))!;
    const previas = dirs.filter(
      (d) =>
        d !== esta &&
        !d.endsWith("_order_status_en_reparto") && // feature 153 (rename del value): apendida despues
        !d.endsWith("_drop_orden_mensajero_sugerido"), // feature 159 (retiro de la sugerencia): apendida despues
    );
    expect(esta >= previas[previas.length - 1]).toBe(true);
  });

  it("schema.prisma y SQL no divergen: los cuatro @@index estan declarados", () => {
    const modelo = schema.slice(schema.indexOf("model Orden {"));
    const cuerpo = modelo.slice(0, modelo.indexOf('@@map("orden")'));
    expect(cuerpo).toMatch(/@@index\(\[zonaId\]\)/);
    expect(cuerpo).toMatch(/@@index\(\[provinciaId\]\)/);
    expect(cuerpo).toMatch(/@@index\(\[cantonId\]\)/);
    expect(cuerpo).toMatch(/@@index\(\[distritoId\]\)/);
  });
});
