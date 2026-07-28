import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGEN_TIPOS_CON_GESTION,
} from "@/lib/types/orden-historial";

// Feature 149 (T0.1/T0.2/T0.3, R25/R26) — cobertura ESTATICA de la migracion
// `*_orden_historial_origen_deshacer_asignacion` (patron EXACTO de la 106
// `*_cancelacion_api_por_key`, la 138 y la 139: los tres precedentes de `ADD VALUE` de este mismo
// enum). Lee migration.sql/down.sql/schema.prisma por regex; NO requiere Postgres real.
//
// El round-trip REAL (deploy -> rollback -> deploy) se ejecuto contra la DB local durante la
// implementacion y quedo registrado en `progress/impl_149.md`; este test es la red que impide que
// el par up/down se degrade despues sin que nadie lo note (hallazgo N3 del review: la 149 era la
// unica de la serie sin test propio de su migracion).

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

const migrationDir = migrationDirFor("_orden_historial_origen_deshacer_asignacion");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

const NUEVO = "deshacer_asignacion";

describe("Feature 149 · SEED del enum — deshacer_asignacion (T0.3, R25)", () => {
  it("esta en ORDEN_HISTORIAL_ORIGEN_TIPO_SEED (catalogo sembrado, `satisfies` frente a Prisma)", () => {
    expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toContain(NUEVO);
    // El SEED lleva `satisfies readonly PrismaOrdenHistorialOrigenTipo[]` + `_EnsureExhaustive`:
    // si el valor no estuviera en el enum Prisma —o si el enum ganara un valor que el SEED no
    // lista— el build romperia. Su presencia aqui = ambos lados alineados.
  });

  it("R26: NO entra en ORIGEN_TIPOS_CON_GESTION (nunca enlaza gestion; destino != devuelta)", () => {
    expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain(NUEVO);
    expect([...ORIGEN_TIPOS_CON_GESTION]).toEqual(["gestion", "deshacer_gestion"]);
  });
});

describe("Feature 149 · UP — ADD VALUE aditivo del origen_tipo (T0.1, R25)", () => {
  it("añade `deshacer_asignacion` con IF NOT EXISTS (idempotente)", () => {
    expect(upSql).toMatch(
      new RegExp(`ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS '${NUEVO}';`),
    );
  });

  it("VA SOLA: una unica sentencia DDL (Postgres 55P04)", () => {
    // `ALTER TYPE ... ADD VALUE` no puede compartir transaccion con el USO del valor nuevo, y
    // Prisma Migrate corre cada migration.sql en UNA transaccion. La migracion contiene esa
    // sentencia y nada mas: cualquier DDL adicional aqui seria un fallo 55P04 en despliegue.
    const sentencias = upSql
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("--"));
    expect(sentencias).toHaveLength(1);
    expect(sentencias[0]).toMatch(/^ALTER TYPE "orden_historial_origen_tipo" ADD VALUE/);
  });

  it("es ADITIVA: no altera tablas, no borra y no toca RLS ni el catalogo de estatus", () => {
    expect(upSql).not.toMatch(/DROP COLUMN/i);
    expect(upSql).not.toMatch(/ALTER COLUMN/i);
    expect(upSql).not.toMatch(/ALTER TABLE/i);
    expect(upSql).not.toMatch(/DELETE FROM/i);
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upSql).not.toMatch(/order_status/i); // no toca el enum/catalogo de estatus
    // Sin tablas nuevas => sin RLS nueva: `orden_historial_estado` conserva la suya (feature 49).
  });

  it("documenta POR QUE va sola (55P04) para que nadie le apile DDL despues", () => {
    expect(upSql).toMatch(/55P04/);
    expect(upSql).toMatch(/VA SOLA/i);
  });
});

describe("Feature 149 · DOWN — reversible (OBLIGATORIO, docs/architecture.md)", () => {
  it("recrea el enum SIN deshacer_asignacion, con los 22 previos", () => {
    expect(downSql).toMatch(
      /ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";/,
    );
    const match = downSql.match(/CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toHaveLength(22);
    expect(valores).not.toContain(NUEVO);
    // Los 22 previos = el SEED actual menos los valores AÑADIDOS EN O DESPUES de la feature 149.
    // Hoy el unico es el propio `deshacer_asignacion` (es el ultimo del enum); cuando una feature
    // futura añada otro valor, DEBE apendirlo a este set —igual que la 149 hizo con los downs del
    // 67/99/100/106/138—, porque este down recrea el enum a su estado PRE-149 (fijo, historico).
    const AÑADIDOS_EN_O_DESPUES_DEL_149 = new Set([NUEVO]);
    expect(new Set(valores)).toEqual(
      new Set(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.filter((v) => !AÑADIDOS_EN_O_DESPUES_DEL_149.has(v))),
    );
  });

  it("el orden de los 22 valores del down coincide con el del SEED (sin reordenar el enum)", () => {
    const match = downSql.match(/CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/);
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toEqual(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.filter((v) => v !== NUEVO));
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
    // El fallo RUIDOSO del USING ante filas existentes es el comportamiento CORRECTO: revertir
    // borrando rastro de auditoria de reversiones ya ejecutadas no es seguro.
    expect(downSql).toMatch(/orden_historial_estado/);
  });

  it("el down tampoco toca policies RLS ni ninguna otra tabla", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(downSql).not.toMatch(/DROP TABLE/i);
    expect(downSql).not.toMatch(/gestion_orden/i);
    expect(downSql).not.toMatch(/order_status/i);
    // La UNICA tabla mencionada es la dueña de la columna del enum.
    const tablas = [...downSql.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]);
    expect([...new Set(tablas)]).toEqual(["orden_historial_estado"]);
  });
});

describe("Feature 149 · schema.prisma refleja la migracion (sin drift)", () => {
  it("el enum Prisma OrdenHistorialOrigenTipo tiene deshacer_asignacion", () => {
    const bloque = schemaPrisma.match(/enum OrdenHistorialOrigenTipo \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    expect((bloque as RegExpMatchArray)[1]).toMatch(new RegExp(`\\b${NUEVO}\\b`));
  });

  it("no hay tabla ni columna nueva en el schema por esta feature (R: sin RLS nueva)", () => {
    // La 149 reutiliza `orden` y `orden_historial_estado`; si alguien añadiera una tabla para
    // esta feature, tendria que traer su propia RLS y este test es el recordatorio.
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(downSql).not.toMatch(/CREATE TABLE/i);
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
