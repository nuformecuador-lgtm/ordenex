import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";

// Feature 106 (T3/T4, R27/R28) — cobertura ESTATICA de la migracion
// `*_cancelacion_api_por_key` (patron de la 100 `*_resolver_novedad`): lee migration.sql/down.sql
// por regex. NO requiere Postgres real; `db:migrate` queda como paso de despliegue humano (el
// `.env` apunta a una DB compartida), documentado en `progress/impl_106.md`.

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

const migrationDir = migrationDirFor("_cancelacion_api_por_key");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

const NUEVO = "cancelacion_api";

describe("Feature 106 · SEED del enum — cancelacion_api (T3, R27)", () => {
  it("siembra cancelacion_api idempotente (esta en ORDEN_HISTORIAL_ORIGEN_TIPO_SEED)", () => {
    expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toContain(NUEVO);
    // El SEED itera con `satisfies` frente al enum Prisma: si el valor no estuviera en el enum
    // el build romperia. Su presencia aqui = catalogo sembrado por el seed idempotente.
  });
});

describe("Feature 106 · UP — ADD VALUE aditivo del origen_tipo (T4, R28)", () => {
  it("añade `cancelacion_api` (fuera de tx via IF NOT EXISTS)", () => {
    expect(upSql).toMatch(
      new RegExp(`ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS '${NUEVO}';`),
    );
  });

  it("es ADITIVA: no toca gestion_orden ni el enum de estatus ni ninguna tabla", () => {
    expect(upSql).not.toMatch(/DROP COLUMN/i);
    expect(upSql).not.toMatch(/ALTER COLUMN/i);
    expect(upSql).not.toMatch(/DELETE FROM/i);
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upSql).not.toMatch(/gestion_orden/i); // decision (b): gestion_orden intacta
    expect(upSql).not.toMatch(/order_status/i); // decision (a): sin migrar el enum de estatus
  });
});

describe("Feature 106 · DOWN — reversible con irreversibilidad parcial documentada (T4, R28)", () => {
  it("recrea el enum SIN cancelacion_api, con los 17 previos", () => {
    expect(downSql).toMatch(
      /ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";/,
    );
    const match = downSql.match(/CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toHaveLength(17);
    expect(valores).not.toContain(NUEVO);
    // Los 17 previos = el SEED actual menos los valores AÑADIDOS EN O DESPUES de la feature 106:
    // `cancelacion_api` (106) y los dos de la feature 109 (`corte_sin_gestionar`/
    // `liberacion_sin_gestionar`), apendidos despues (patron del down del 67/99/100). El down.sql
    // del 106 recrea el enum a su estado PRE-106 (fijo, historico).
    const AÑADIDOS_EN_O_DESPUES_DEL_106 = new Set([
      NUEVO,
      "corte_sin_gestionar", // feature 109
      "liberacion_sin_gestionar", // feature 109
      "recepcion_bodega_central", // feature 138
    ]);
    expect(new Set(valores)).toEqual(
      new Set(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.filter((v) => !AÑADIDOS_EN_O_DESPUES_DEL_106.has(v))),
    );
  });

  it("migra `origen_tipo` con USING y suelta el tipo viejo", () => {
    expect(downSql).toMatch(
      /ALTER TABLE "orden_historial_estado"\s+ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"\s+USING \("origen_tipo"::text::"orden_historial_origen_tipo"\);/,
    );
    expect(downSql).toMatch(/DROP TYPE "orden_historial_origen_tipo_old";/);
  });

  it("documenta la irreversibilidad parcial del ADD VALUE y la precondicion (0 filas)", () => {
    expect(downSql).toMatch(/IRREVERSIBILIDAD PARCIAL/i);
    expect(downSql).toMatch(/Precondicion/i);
    expect(downSql).toContain(NUEVO);
  });

  it("el down tampoco toca policies RLS ni gestion_orden", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(downSql).not.toMatch(/gestion_orden/i);
  });
});

describe("Feature 106 · schema.prisma refleja la migracion (sin drift)", () => {
  it("el enum Prisma OrdenHistorialOrigenTipo tiene cancelacion_api", () => {
    const bloque = schemaPrisma.match(/enum OrdenHistorialOrigenTipo \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    expect((bloque as RegExpMatchArray)[1]).toMatch(new RegExp(`\\b${NUEVO}\\b`));
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la carpeta previa", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const previa = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => n < dirName)
      .sort()
      .pop();
    expect(previa).toBeDefined();
    expect(dirName > (previa as string)).toBe(true);
  });
});
