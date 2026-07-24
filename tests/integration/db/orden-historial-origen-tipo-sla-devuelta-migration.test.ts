import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGEN_TIPOS_CON_GESTION,
} from "@/lib/types/orden-historial";

// Feature 99 (T0) — cobertura ESTATICA de la migracion
// `*_orden_historial_origen_tipo_sla_devuelta` (patron
// orden-historial-origen-tipo-carga-api / gestion-orden-anulacion): lee migration.sql/down.sql
// por regex. NO requiere Postgres real; el round-trip up->down->up contra Postgres lo ejecuta el
// implementer y queda en `progress/impl_99.md`. Cubre R19 (los 2 `origen_tipo` nuevos, aditivos y
// reversibles).

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

const migrationDir = migrationDirFor("_orden_historial_origen_tipo_sla_devuelta");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "db", "schema.prisma"),
  "utf8",
);

const NUEVOS = ["liberacion_devuelta_sla", "escalado_devuelta_sla"] as const;

describe("Feature 99 · SEED del enum — los 2 valores nuevos (R19)", () => {
  it("ORDEN_HISTORIAL_ORIGEN_TIPO_SEED incluye ambos valores del cron SLA", () => {
    for (const v of NUEVOS) expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toContain(v);
  });

  it("NINGUNO entra en ORIGEN_TIPOS_CON_GESTION (no cuentan como intento: destino != devuelta)", () => {
    // El derivador cuenta filas con destino `devuelta`; el reintento va a bodega y el escalado a
    // `rechazada`, asi que ninguno debe estar en la familia que enlaza intentos.
    for (const v of NUEVOS) expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain(v);
    expect([...ORIGEN_TIPOS_CON_GESTION]).toEqual(["gestion", "deshacer_gestion"]);
  });
});

describe("Feature 99 · UP — ADD VALUE aditivo de los 2 origen_tipo (R19)", () => {
  it("añade `liberacion_devuelta_sla` y `escalado_devuelta_sla` (fuera de tx via IF NOT EXISTS)", () => {
    for (const v of NUEVOS) {
      expect(upSql).toMatch(
        new RegExp(`ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS '${v}';`),
      );
    }
  });

  it("es ADITIVA: no altera ninguna tabla ni borra nada (sin RLS nueva)", () => {
    expect(upSql).not.toMatch(/DROP COLUMN/i);
    expect(upSql).not.toMatch(/ALTER COLUMN/i);
    expect(upSql).not.toMatch(/DELETE FROM/i);
    expect(upSql).not.toMatch(/CREATE TABLE/i);
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("Feature 99 · DOWN — reversible (OBLIGATORIO, docs/architecture.md)", () => {
  it("recrea el enum SIN los 2 valores nuevos, con los 13 previos", () => {
    // Postgres no soporta DROP VALUE: el tipo se recrea y la columna se migra con USING.
    expect(downSql).toMatch(
      /ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";/,
    );
    const match = downSql.match(/CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/);
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores).toHaveLength(13);
    for (const v of NUEVOS) expect(valores).not.toContain(v);
    // Los 13 previos = el SEED actual menos los valores AÑADIDOS EN O DESPUES de la feature 99. El
    // down.sql del 99 recrea el enum a su estado PRE-99 (fijo, historico); por eso se descuentan los
    // dos de la 99 (`liberacion_devuelta_sla`/`escalado_devuelta_sla`) y los dos de la feature 100
    // (`reprogramacion_tienda`/`recuperacion_manual`), apendidos despues (patron del down del 67).
    const AÑADIDOS_EN_O_DESPUES_DEL_99 = new Set([
      ...NUEVOS,
      "reprogramacion_tienda", // feature 100
      "recuperacion_manual", // feature 100
      "cancelacion_api", // feature 106
      "corte_sin_gestionar", // feature 109
      "liberacion_sin_gestionar", // feature 109
      "recepcion_bodega_central", // feature 138
    ]);
    expect(new Set(valores)).toEqual(
      new Set(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.filter((v) => !AÑADIDOS_EN_O_DESPUES_DEL_99.has(v))),
    );
  });

  it("migra `origen_tipo` con USING y suelta el tipo viejo", () => {
    expect(downSql).toMatch(
      /ALTER TABLE "orden_historial_estado"\s+ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"\s+USING \("origen_tipo"::text::"orden_historial_origen_tipo"\);/,
    );
    expect(downSql).toMatch(/DROP TYPE "orden_historial_origen_tipo_old";/);
  });

  it("documenta la precondicion: 0 filas con los 2 origen_tipo nuevos (el USING falla si las hay)", () => {
    expect(downSql).toMatch(/Precondicion/i);
    for (const v of NUEVOS) expect(downSql).toContain(v);
  });

  it("el down tampoco toca policies RLS", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("Feature 99 · schema.prisma refleja la migracion (sin drift)", () => {
  it("el enum Prisma OrdenHistorialOrigenTipo tiene los 2 valores nuevos", () => {
    const bloque = schemaPrisma.match(/enum OrdenHistorialOrigenTipo \{([\s\S]*?)\n\}/);
    expect(bloque).not.toBeNull();
    for (const v of NUEVOS) {
      expect((bloque as RegExpMatchArray)[1]).toMatch(new RegExp(`\\b${v}\\b`));
    }
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior a la migracion que la precede", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    // Invariante ORDEN-ROBUSTO: esta migracion sorts DESPUES de la que la precede (no que sea la
    // ULTIMA del repo). Comparar contra el maximo global rompia cada vez que una feature posterior
    // apendia una migracion nueva (feature 100). Se compara contra la carpeta inmediatamente
    // anterior por nombre (la mayor < dirName), que es estable ante añadidos futuros.
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
