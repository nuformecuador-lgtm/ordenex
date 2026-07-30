import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet";
import { CAUSA_INCIDENTE_SEED } from "@/lib/types/causa-incidente";

// Feature 158 (T1.5, R1/R2/R3/R4/R9) — cobertura ESTATICA de la migracion
// `*_incidente_indemnizacion` (patron `wallet-egreso-migration.test.ts`: lee migration.sql /
// down.sql por regex).
//
// El round-trip REAL up -> down -> up contra el Postgres local lo corrio la fase backend y
// esta registrado en `progress/impl_158_backend.md` (incluida la verificacion POR MUTACION de
// la precondicion del down: con una fila `resultado = 'incidente'` o
// `categoria = 'egreso_indemnizacion'` el `USING` cast ABORTA). Este archivo protege la FORMA
// de los dos .sql para que un cambio posterior no los desalinee en silencio.

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

const migrationDir = migrationDirFor("_incidente_indemnizacion");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

/** Valores literales de un `CREATE TYPE ... AS ENUM (...)` del SQL, en orden. */
function valoresDelEnum(sql: string, tipo: string): string[] {
  const match = sql.match(new RegExp(`CREATE TYPE "${tipo}" AS ENUM \\(([\\s\\S]*?)\\);`));
  expect(match, `no hay CREATE TYPE "${tipo}" en el SQL`).not.toBeNull();
  return [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("R3 — los SEED tipados incluyen los valores nuevos", () => {
  it("R2/R3: WALLET_MOVIMIENTO_CATEGORIA_SEED contiene egreso_indemnizacion y conserva las 14 previas", () => {
    expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toContain("egreso_indemnizacion");
    expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toHaveLength(15);
    // R2: ninguna de las 14 previas se retiro ni se renombro.
    for (const previa of [
      "ingreso_flete",
      "ingreso_flete_devolucion",
      "ingreso_comision_cod",
      "ingreso_iva_flete",
      "ingreso_iva_flete_devolucion",
      "ingreso_iva_comision_cod",
      "ingreso_ajuste",
      "egreso_pago_tienda",
      "egreso_pago_mensajero",
      "egreso_gasto",
      "egreso_sueldo",
      "egreso_ajuste",
      "egreso_gasto_fijo",
      "egreso_gasto_variable",
    ]) {
      expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toContain(previa);
    }
  });

  it("R9 (Q-B): CAUSA_INCIDENTE_SEED es la lista CERRADA de 3 valores EN ESPANOL, sin 'Otro'", () => {
    // Igualdad EXACTA y ordenada: un valor de mas, de menos o traducido al ingles rompe.
    expect([...CAUSA_INCIDENTE_SEED]).toEqual(["danado", "perdido", "robado"]);
    expect(CAUSA_INCIDENTE_SEED).not.toContain("otro");
    // Q-B (design §0.3): NO se castellaniza ni se traduce por "consistencia" con la 73.
    for (const ingles of ["damaged", "lost", "stolen"]) {
      expect(CAUSA_INCIDENTE_SEED as readonly string[]).not.toContain(ingles);
    }
  });

  it("el SEED de causa y el enum del SQL declaran EXACTAMENTE los mismos 3 valores", () => {
    expect(valoresDelEnum(upSql, "gestion_causa_incidente")).toEqual([...CAUSA_INCIDENTE_SEED]);
  });
});

describe("UP — aditivo, sin datos y sin RLS (R1/R2/R9/R35)", () => {
  it("R1: ALTER TYPE ADD VALUE IF NOT EXISTS 'incidente' sobre gestion_resultado", () => {
    expect(upSql).toMatch(
      /ALTER TYPE "gestion_resultado" ADD VALUE IF NOT EXISTS 'incidente';/,
    );
  });

  it("R2: ALTER TYPE ADD VALUE IF NOT EXISTS 'egreso_indemnizacion' sobre la categoria de wallet", () => {
    expect(upSql).toMatch(
      /ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_indemnizacion';/,
    );
  });

  it("R9: crea el enum de la causa y su columna nullable en gestion_orden", () => {
    expect(upSql).toMatch(
      /CREATE TYPE "gestion_causa_incidente" AS ENUM \('danado', 'perdido', 'robado'\);/,
    );
    expect(upSql).toMatch(
      /ALTER TABLE "gestion_orden" ADD COLUMN "causa_incidente" "gestion_causa_incidente";/,
    );
    // NULLABLE y SIN default: la obligatoriedad vive en el borde (zod), no en la base.
    expect(upSql).not.toMatch(/"causa_incidente"[^;]*NOT NULL/);
    expect(upSql).not.toMatch(/"causa_incidente"[^;]*DEFAULT/);
  });

  it("R22/R24: la columna del monto es DECIMAL(12,2) nullable (money-safe, sin default)", () => {
    expect(upSql).toMatch(/ALTER TABLE "gestion_orden" ADD COLUMN "indemnizacion" DECIMAL\(12,2\);/);
    expect(upSql).not.toMatch(/"indemnizacion"[^;]*NOT NULL/);
    expect(upSql).not.toMatch(/"indemnizacion"[^;]*DEFAULT/);
    // Money-safe: nunca un tipo de coma flotante para un monto.
    expect(upSql).not.toMatch(/DOUBLE PRECISION|FLOAT|REAL/i);
  });

  it("R35: la migracion NO mueve datos (sin INSERT/UPDATE/DELETE)", () => {
    // `ALTER TYPE ... ADD VALUE` no puede coexistir con un USO del valor en la misma tx.
    expect(upSql).not.toMatch(/INSERT INTO/i);
    expect(upSql).not.toMatch(/\bUPDATE\s+"/i);
    expect(upSql).not.toMatch(/DELETE FROM/i);
  });

  it("NO toca RLS ni policies (no hay tabla nueva)", () => {
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("NO toca indices (ninguno referencia las columnas nuevas)", () => {
    expect(upSql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(upSql).not.toMatch(/DROP INDEX/i);
  });
});

describe("DOWN — recrea los dos enums sin los valores nuevos (R4)", () => {
  it("R4: gestion_resultado vuelve a los 4 valores previos, con USING cast", () => {
    const valores = valoresDelEnum(downSql, "gestion_resultado");
    expect(valores).toEqual(["entregada", "reprogramada", "devuelta", "rechazada"]);
    expect(valores).not.toContain("incidente");
    expect(downSql).toMatch(
      /ALTER TABLE "gestion_orden" ALTER COLUMN "resultado"\s+TYPE "gestion_resultado" USING/,
    );
    // El tipo viejo se renombra y se suelta: no queda ningun `_old` colgando.
    expect(downSql).toMatch(/ALTER TYPE "gestion_resultado" RENAME TO "gestion_resultado_old";/);
    expect(downSql).toMatch(/DROP TYPE "gestion_resultado_old";/);
  });

  it("R4: wallet_movimiento_categoria vuelve a los 14 valores previos, con USING cast", () => {
    const valores = valoresDelEnum(downSql, "wallet_movimiento_categoria");
    expect(valores).not.toContain("egreso_indemnizacion");
    expect(valores).toHaveLength(14);
    // Q-F: el down de la 45 (12 valores) NO se reescribe; el que cuadra con el SEED VIGENTE
    // menos el valor que esta migracion anade es ESTE.
    expect(valores).toEqual(
      WALLET_MOVIMIENTO_CATEGORIA_SEED.filter((c) => c !== "egreso_indemnizacion"),
    );
    expect(downSql).toMatch(
      /ALTER TABLE "wallet_movimiento" ALTER COLUMN "categoria"\s+TYPE "wallet_movimiento_categoria" USING/,
    );
    expect(downSql).toMatch(/DROP TYPE "wallet_movimiento_categoria_old";/);
  });

  it("R4: suelta y recrea los 2 indices que referencian wallet_movimiento.categoria", () => {
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "wallet_movimiento_tipo_categoria_idx";/);
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "wallet_movimiento_origen_categoria_uq";/);
    expect(downSql).toMatch(
      /CREATE INDEX "wallet_movimiento_tipo_categoria_idx" ON "wallet_movimiento"\("tipo", "categoria"\);/,
    );
    expect(downSql).toMatch(
      /CREATE UNIQUE INDEX "wallet_movimiento_origen_categoria_uq"[\s\S]*WHERE "origen_id" IS NOT NULL;/,
    );
  });

  it("R4: suelta las dos columnas y el enum de la causa, en ese orden", () => {
    expect(downSql).toMatch(/ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "indemnizacion";/);
    expect(downSql).toMatch(/ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "causa_incidente";/);
    expect(downSql).toMatch(/DROP TYPE IF EXISTS "gestion_causa_incidente";/);
    // La columna se suelta ANTES que su tipo: al reves, el DROP TYPE fallaria.
    expect(downSql.indexOf('DROP COLUMN IF EXISTS "causa_incidente"')).toBeLessThan(
      downSql.indexOf('DROP TYPE IF EXISTS "gestion_causa_incidente"'),
    );
  });

  it("R4: documenta la PRECONDICION (el down aborta si alguna fila usa los valores nuevos)", () => {
    expect(downSql).toMatch(/PRECONDICION/i);
    expect(downSql).toMatch(/ABORTA/i);
  });

  it("el down tampoco toca RLS ni policies", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("Q-F — esta migracion NO reescribe ningun down.sql previo", () => {
  it("el down de la 45 sigue listando sus 12 valores punto-en-el-tiempo", () => {
    const prev = fs.readFileSync(
      path.join(migrationDirFor("_wallet_egreso_gasto_fijo_variable"), "down.sql"),
      "utf8",
    );
    expect(valoresDelEnum(prev, "wallet_movimiento_categoria")).toHaveLength(12);
    expect(prev).not.toContain("egreso_indemnizacion");
  });

  it("ningun down.sql previo RECREA gestion_resultado (el unico que lo toca hace DROP TYPE)", () => {
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => name < "20260730120000_incidente_indemnizacion");
    const recrean = dirs.filter((name) => {
      const file = path.join(MIGRATIONS_DIR, name, "down.sql");
      if (!fs.existsSync(file)) return false;
      return /CREATE TYPE "gestion_resultado" AS ENUM/.test(fs.readFileSync(file, "utf8"));
    });
    expect(recrean).toEqual([]);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("el timestamp de la carpeta es POSTERIOR al maximo que existia al escribirla", () => {
    // Baseline PINNEADO (convencion del repo desde el 2026-07-29): el maximo timestamp del
    // arbol cuando esta migracion se escribio. Las posteriores son irrelevantes por
    // definicion; lo que este assert caza es RENOMBRAR esta carpeta ya aplicada, que
    // descuadraria `_prisma_migrations`.
    const BASELINE = "20260729140000";
    expect(path.basename(migrationDir)).toBe("20260730120000_incidente_indemnizacion");
    expect(path.basename(migrationDir).slice(0, 14) > BASELINE).toBe(true);
  });
});
