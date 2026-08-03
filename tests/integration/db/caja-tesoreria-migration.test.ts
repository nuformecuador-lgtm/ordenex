import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet";

// Feature 173 (T A.1, R49/R50) — cobertura ESTATICA de la migracion `*_caja_tesoreria`
// (patron `incidente-indemnizacion-migration.test.ts` / `wallet-egreso-migration.test.ts`: lee
// migration.sql y down.sql por regex).
//
// El round-trip REAL up -> down -> up contra el Postgres local lo corrio la fase backend y
// esta registrado en `progress/impl_173-caja-tesoreria.md`. Este archivo protege la FORMA de
// los dos .sql para que un cambio posterior no los desalinee en silencio.
//
// R45/R46 (el CHECK categoria↔tipo, T A.2) NO se verifican aqui todavia: esa task esta
// bloqueada tras la medicion de produccion de T A.0 y reabrira esta misma carpeta.

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

/** Valores literales de un `CREATE TYPE ... AS ENUM (...)` del SQL, en orden. */
function valoresDelEnum(sql: string, tipo: string): string[] {
  const match = sql.match(new RegExp(`CREATE TYPE "${tipo}" AS ENUM \\(([\\s\\S]*?)\\);`));
  expect(match, `no hay CREATE TYPE "${tipo}" en el SQL`).not.toBeNull();
  return [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const migrationDir = migrationDirFor("_caja_tesoreria");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

const VALORES_NUEVOS = ["ingreso_cod_recaudado", "ingreso_reverso_pago_tienda"] as const;

describe("el SEED tipado incluye los dos valores nuevos (R49)", () => {
  it("WALLET_MOVIMIENTO_CATEGORIA_SEED gana los dos y conserva las 15 previas", () => {
    for (const valor of VALORES_NUEVOS) {
      expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toContain(valor);
    }
    expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toHaveLength(17);
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
      "egreso_indemnizacion",
    ]) {
      expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toContain(previa);
    }
  });

  it("`egreso_pago_tienda` YA existia: la 173 le da emisor, no lo crea", () => {
    expect(WALLET_MOVIMIENTO_CATEGORIA_SEED).toContain("egreso_pago_tienda");
    expect(upSql).not.toMatch(/ADD VALUE[^\n]*'egreso_pago_tienda'/);
  });
});

describe("UP — aditivo, sin datos y sin RLS (R49)", () => {
  it("R49: ALTER TYPE ADD VALUE IF NOT EXISTS para los DOS valores nuevos", () => {
    for (const valor of VALORES_NUEVOS) {
      expect(upSql).toMatch(
        new RegExp(
          `ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS '${valor}';`,
        ),
      );
    }
  });

  it("R49: no renombra, no reordena y no retira ningun valor previo del enum", () => {
    expect(upSql).not.toMatch(/RENAME/i);
    expect(upSql).not.toMatch(/DROP TYPE/i);
    expect(upSql).not.toMatch(/CREATE TYPE/i);
  });

  it("R49: no mueve datos (sin INSERT/UPDATE/DELETE) — seguro con ADD VALUE fuera de tx", () => {
    // `ALTER TYPE ... ADD VALUE` no puede coexistir con un USO del valor en la misma
    // transaccion; aqui solo se anaden, que es el patron de las features 41/45/67/158.
    expect(upSql).not.toMatch(/INSERT INTO/i);
    expect(upSql).not.toMatch(/\bUPDATE\s+"/i);
    expect(upSql).not.toMatch(/DELETE FROM/i);
  });

  it("R49: NO toca RLS ni policies (no hay tabla nueva)", () => {
    expect(upSql).not.toMatch(/CREATE POLICY/i);
    expect(upSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("R49: NO toca indices en el UP", () => {
    expect(upSql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(upSql).not.toMatch(/DROP INDEX/i);
  });
});

describe("DOWN — recrea el enum sin los dos valores nuevos (R49)", () => {
  it("R49: el enum vuelve a sus 15 valores previos, en el mismo orden y sin los nuevos", () => {
    const valores = valoresDelEnum(downSql, "wallet_movimiento_categoria");
    for (const valor of VALORES_NUEVOS) {
      expect(valores).not.toContain(valor);
    }
    expect(valores).toHaveLength(15);
    // El que cuadra con el SEED VIGENTE menos los dos valores que esta migracion anade es ESTE
    // (los `down.sql` previos listan 12 y 14: son su estado punto-en-el-tiempo, R50).
    expect(valores).toEqual(
      WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
        (c) => !(VALORES_NUEVOS as readonly string[]).includes(c),
      ),
    );
  });

  it("R49: suelta y recrea los 2 indices que referencian `categoria`, alrededor del cast", () => {
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "wallet_movimiento_tipo_categoria_idx";/);
    expect(downSql).toMatch(/DROP INDEX IF EXISTS "wallet_movimiento_origen_categoria_uq";/);
    expect(downSql).toMatch(
      /CREATE INDEX "wallet_movimiento_tipo_categoria_idx" ON "wallet_movimiento"\("tipo", "categoria"\);/,
    );
    expect(downSql).toMatch(
      /CREATE UNIQUE INDEX "wallet_movimiento_origen_categoria_uq"[\s\S]*WHERE "origen_id" IS NOT NULL;/,
    );
    // Los DROP van ANTES del cambio de tipo y los CREATE despues: al reves, los literales de
    // los indices quedarian ligados al tipo VIEJO durante el ALTER COLUMN.
    const cast = downSql.indexOf('ALTER TABLE "wallet_movimiento" ALTER COLUMN "categoria"');
    expect(downSql.indexOf('DROP INDEX IF EXISTS "wallet_movimiento_tipo_categoria_idx"')).toBeLessThan(cast);
    expect(downSql.indexOf('CREATE INDEX "wallet_movimiento_tipo_categoria_idx"')).toBeGreaterThan(cast);
  });

  it("R49: migra la columna con USING cast y no deja ningun tipo `_old` colgando", () => {
    expect(downSql).toMatch(
      /ALTER TYPE "wallet_movimiento_categoria" RENAME TO "wallet_movimiento_categoria_old";/,
    );
    expect(downSql).toMatch(
      /ALTER TABLE "wallet_movimiento" ALTER COLUMN "categoria"\s+TYPE "wallet_movimiento_categoria" USING/,
    );
    expect(downSql).toMatch(/DROP TYPE "wallet_movimiento_categoria_old";/);
  });

  it("R49: documenta la PRECONDICION (el down ABORTA si alguna fila usa los valores nuevos)", () => {
    expect(downSql).toMatch(/PRECONDICION/i);
    expect(downSql).toMatch(/ABORTA/i);
  });

  it("R49: el down tampoco toca RLS ni policies", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("R49: el down no borra ni una fila del libro (append-only, tambien al revertir)", () => {
    expect(downSql).not.toMatch(/DELETE FROM/i);
    expect(downSql).not.toMatch(/TRUNCATE/i);
  });
});

describe("R50 — esta migracion NO reescribe ningun down.sql previo", () => {
  it("R50: el down de la 45 sigue listando sus 12 valores punto-en-el-tiempo", () => {
    const prev = fs.readFileSync(
      path.join(migrationDirFor("_wallet_egreso_gasto_fijo_variable"), "down.sql"),
      "utf8",
    );
    expect(valoresDelEnum(prev, "wallet_movimiento_categoria")).toHaveLength(12);
    for (const valor of VALORES_NUEVOS) {
      expect(prev).not.toContain(valor);
    }
  });

  it("R50: el down de la 158 sigue listando sus 14 valores punto-en-el-tiempo", () => {
    const prev = fs.readFileSync(
      path.join(migrationDirFor("_incidente_indemnizacion"), "down.sql"),
      "utf8",
    );
    expect(valoresDelEnum(prev, "wallet_movimiento_categoria")).toHaveLength(14);
    for (const valor of VALORES_NUEVOS) {
      expect(prev).not.toContain(valor);
    }
  });

  it("R50: NINGUN down.sql anterior a esta carpeta nombra los dos valores nuevos", () => {
    const carpeta = path.basename(migrationDir);
    const previos = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => name < carpeta);

    const contaminados = previos.filter((name) => {
      const file = path.join(MIGRATIONS_DIR, name, "down.sql");
      if (!fs.existsSync(file)) return false;
      const sql = fs.readFileSync(file, "utf8");
      return VALORES_NUEVOS.some((valor) => sql.includes(valor));
    });
    expect(contaminados).toEqual([]);
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
    const BASELINE = "20260803090000";
    expect(path.basename(migrationDir)).toBe("20260803120000_caja_tesoreria");
    expect(path.basename(migrationDir).slice(0, 14) > BASELINE).toBe(true);
  });
});
