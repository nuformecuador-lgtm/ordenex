import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { WALLET_ORIGEN_TIPO_SEED } from "@/lib/types/wallet";
import { CAUSA_INCIDENTE_SEED } from "@/lib/types/causa-incidente";
import { CIERRE_ESTADO_SEED } from "@/lib/types/cierre";

// Feature 158 (T1.22, R37/R39/R40) — cobertura ESTATICA de la migracion `*_orden_incidente`
// (camino del ADMIN), patron `incidente-indemnizacion-migration.test.ts` de la fase anterior.
//
// El round-trip REAL up -> down -> up contra el Postgres local lo corrio la fase backend F1B y
// esta registrado en `progress/impl_158b_backend.md`, incluida la verificacion POR MUTACION de
// la precondicion del down: con una fila `origen_tipo = 'orden_incidente'` en CUALQUIERA de las
// TRES tablas que usan el enum, el `USING` cast ABORTA — y aborta exactamente en el `ALTER
// COLUMN` de esa tabla. Este archivo protege la FORMA de los dos .sql para que un cambio
// posterior no los desalinee en silencio.

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");
const CARPETA = "20260730130000_orden_incidente";

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor("_orden_incidente");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

/** Valores literales de un `CREATE TYPE ... AS ENUM (...)` del SQL, en orden. */
function valoresDelEnum(sql: string, tipo: string): string[] {
  const match = sql.match(new RegExp(`CREATE TYPE "${tipo}" AS ENUM \\(([\\s\\S]*?)\\);`));
  expect(match, `no hay CREATE TYPE "${tipo}" en el SQL`).not.toBeNull();
  return [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

// Las TRES tablas que usan `wallet_origen_tipo` (42/43/44). El design §12.2 avisa: olvidar una
// deja el tipo `_old` con una columna dependiente y el down falla a mitad.
const TABLAS_CON_ORIGEN_TIPO = [
  "wallet_movimiento",
  "wallet_tienda_movimiento",
  "pago_mensajero_movimiento",
] as const;

// Los SEIS indices que referencian `origen_tipo` (dos por tabla; el segundo de cada par es el
// UNICO PARCIAL que da la idempotencia del egreso).
const INDICES_CON_ORIGEN_TIPO = [
  "wallet_movimiento_origen_tipo_origen_id_idx",
  "wallet_movimiento_origen_categoria_uq",
  "wallet_tienda_movimiento_origen_tipo_origen_id_idx",
  "wallet_tienda_movimiento_origen_uq",
  "pago_mensajero_movimiento_origen_tipo_origen_id_idx",
  "pago_mensajero_movimiento_origen_uq",
] as const;

describe("R37 — el SEED tipado incluye el origen nuevo", () => {
  it("WALLET_ORIGEN_TIPO_SEED contiene orden_incidente y conserva los 6 previos, en orden", () => {
    expect([...WALLET_ORIGEN_TIPO_SEED]).toEqual([
      "cierre_dia",
      "gestion_orden",
      "manual",
      "pago_tienda",
      "pago_mensajero",
      "gasto",
      "orden_incidente",
    ]);
    // R37: ninguno de los 6 previos se retiro, se renombro ni se reordeno.
    expect(WALLET_ORIGEN_TIPO_SEED).toHaveLength(7);
  });

  it("§9.12: el origen del incidente es un valor PROPIO, no el reservado `gestion_orden`", () => {
    // `gestion_orden` sigue existiendo (reservado y sin uso desde la 42), pero el egreso del
    // admin NO lo reusa: el `origen_id` mentiria y el indice (origen_tipo, origen_id) devolveria
    // basura. Si alguien "ahorrara" el valor nuevo, este caso se pone rojo.
    expect(WALLET_ORIGEN_TIPO_SEED).toContain("gestion_orden");
    expect(WALLET_ORIGEN_TIPO_SEED).toContain("orden_incidente");
    expect(upSql).toMatch(
      /ALTER TYPE "wallet_origen_tipo" ADD VALUE IF NOT EXISTS 'orden_incidente';/,
    );
  });
});

describe("UP — aditivo: un value de enum y DOS tablas nuevas (R37/R38/R39)", () => {
  it("R37: el UP NO recrea el enum ni toca sus valores previos (solo ADD VALUE)", () => {
    expect(upSql).not.toMatch(/CREATE TYPE "wallet_origen_tipo"/);
    expect(upSql).not.toMatch(/RENAME/i);
    expect(upSql).not.toMatch(/DROP TYPE/i);
  });

  it("R38/R39: crea `orden_incidente` con sus 12 columnas y los tipos exactos", () => {
    expect(upSql).toMatch(/CREATE TABLE "orden_incidente" \(/);
    // R39: los datos que el requisito exige persistir, uno a uno.
    for (const [col, decl] of [
      ["orden_id", '"orden_id" TEXT NOT NULL'],
      ["causa", '"causa" "gestion_causa_incidente" NOT NULL'],
      ["motivo", '"motivo" TEXT NOT NULL'],
      ["estado", `"estado" "cierre_estado" NOT NULL DEFAULT 'solicitado'`],
      ["indemnizacion", '"indemnizacion" DECIMAL(12,2)'],
      ["reportado_por", '"reportado_por" TEXT NOT NULL'],
      ["resuelto_por", '"resuelto_por" TEXT,'],
      ["resuelto_at", '"resuelto_at" TIMESTAMP(3),'],
      ["motivo_rechazo", '"motivo_rechazo" TEXT,'],
    ] as const) {
      expect(upSql, `falta la columna ${col}`).toContain(decl);
    }
  });

  it("R43/R50: `estado` nace `solicitado` y el monto nace NULL (money-safe, sin default)", () => {
    expect(upSql).toMatch(/"estado" "cierre_estado" NOT NULL DEFAULT 'solicitado'/);
    // El monto NO es NOT NULL y NO tiene default: se escribe al APROBAR (R52).
    expect(upSql).not.toMatch(/"indemnizacion"[^,\n]*NOT NULL/);
    expect(upSql).not.toMatch(/"indemnizacion"[^,\n]*DEFAULT/);
    expect(upSql).not.toMatch(/DOUBLE PRECISION|FLOAT|REAL/i);
  });

  it("reusa los enums existentes: NO crea ninguno propio", () => {
    // `gestion_causa_incidente` (158/PR1) y `cierre_estado` (37) se REUSAN. Un enum nuevo aqui
    // costaria migracion + SEED + doble candado + tests para expresar lo mismo (design §12.1).
    expect(upSql).not.toMatch(/CREATE TYPE/);
    expect([...CAUSA_INCIDENTE_SEED]).toEqual(["danado", "perdido", "robado"]);
    expect([...CIERRE_ESTADO_SEED]).toContain("solicitado");
    expect([...CIERRE_ESTADO_SEED]).toContain("aprobado");
    expect([...CIERRE_ESTADO_SEED]).toContain("rechazado");
  });

  it("R39: las tres FKs, con su politica de borrado", () => {
    expect(upSql).toMatch(
      /"orden_incidente_orden_id_fkey"\s*\n?\s*FOREIGN KEY \("orden_id"\) REFERENCES "orden"\("id"\) ON DELETE RESTRICT/,
    );
    expect(upSql).toMatch(
      /"orden_incidente_reportado_por_fkey"\s*\n?\s*FOREIGN KEY \("reportado_por"\) REFERENCES "usuario"\("id"\) ON DELETE RESTRICT/,
    );
    expect(upSql).toMatch(
      /"orden_incidente_resuelto_por_fkey"\s*\n?\s*FOREIGN KEY \("resuelto_por"\) REFERENCES "usuario"\("id"\) ON DELETE SET NULL/,
    );
  });

  it("R47: el indice UNICO PARCIAL `(orden_id) WHERE estado <> 'rechazado'` esta presente", () => {
    // Es la mitad de R47 que NO se puede saltar en una carrera. Su predicado importa: si fuera
    // `= 'solicitado'` dejaria pasar un 2.º reporte sobre una orden con incidente APROBADO.
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "orden_incidente_orden_vivo_uq"\s*\n?\s*ON "orden_incidente"\("orden_id"\) WHERE "estado" <> 'rechazado';/,
    );
  });

  it("R49: indices de las dos colas y de los dos actores", () => {
    for (const idx of [
      "orden_incidente_orden_id_idx",
      "orden_incidente_estado_idx",
      "orden_incidente_reportado_por_idx",
      "orden_incidente_resuelto_por_idx",
    ]) {
      expect(upSql, `falta el indice ${idx}`).toContain(idx);
    }
  });

  it("R46: crea `orden_incidente_evidencia` con FK CASCADE y unique (incidente_id, indice)", () => {
    expect(upSql).toMatch(/CREATE TABLE "orden_incidente_evidencia" \(/);
    expect(upSql).toMatch(
      /"orden_incidente_evidencia_incidente_id_fkey"\s*\n?\s*FOREIGN KEY \("incidente_id"\) REFERENCES "orden_incidente"\("id"\) ON DELETE CASCADE/,
    );
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX "orden_incidente_evidencia_incidente_id_indice_key"\s*\n?\s*ON "orden_incidente_evidencia"\("incidente_id", "indice"\);/,
    );
    // `storage_path`, NO una URL: la evidencia se sirve firmada (R46).
    expect(upSql).toMatch(/"storage_path" TEXT NOT NULL/);
    expect(upSql).not.toMatch(/"url"/i);
  });

  it("R38: LAS DOS tablas nuevas nacen con RLS habilitada y SIN policies", () => {
    expect(upSql).toMatch(/ALTER TABLE "orden_incidente" ENABLE ROW LEVEL SECURITY;/);
    expect(upSql).toMatch(/ALTER TABLE "orden_incidente_evidencia" ENABLE ROW LEVEL SECURITY;/);
    expect(upSql).not.toMatch(/CREATE POLICY/i);
  });

  it("R64: la migracion NO mueve datos ni altera ninguna tabla existente", () => {
    expect(upSql).not.toMatch(/INSERT INTO/i);
    expect(upSql).not.toMatch(/\bUPDATE\s+"/i);
    expect(upSql).not.toMatch(/DELETE FROM/i);
    // Las unicas tablas que ALTERA son las dos que acaba de crear.
    const alteradas = [...upSql.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]);
    expect([...new Set(alteradas)].sort()).toEqual([
      "orden_incidente",
      "orden_incidente_evidencia",
    ]);
  });

  it("§9.7: el comentario deja escrito POR QUE no es una fila de `gestion_orden`", () => {
    // La alternativa mas tentadora, con su evidencia. Sin esta nota alguien la "simplifica"
    // dentro de seis meses y le devuelve al admin un cierre vencido bloqueante.
    expect(upSql).toMatch(/CorteDiarioRepository/);
    expect(upSql).toMatch(/gestion_orden/);
  });
});

describe("DOWN — deja la base como estaba (R40)", () => {
  it("R40: recrea `wallet_origen_tipo` con los SEIS valores previos, sin el nuevo", () => {
    const valores = valoresDelEnum(downSql, "wallet_origen_tipo");
    expect(valores).not.toContain("orden_incidente");
    expect(valores).toHaveLength(6);
    // Cuadra EXACTAMENTE con el SEED vigente menos el valor que esta migracion anade.
    expect(valores).toEqual(WALLET_ORIGEN_TIPO_SEED.filter((v) => v !== "orden_incidente"));
    expect(downSql).toMatch(/ALTER TYPE "wallet_origen_tipo" RENAME TO "wallet_origen_tipo_old";/);
    expect(downSql).toMatch(/DROP TYPE "wallet_origen_tipo_old";/);
  });

  it("R40: migra `origen_tipo` con USING en LAS TRES tablas que usan el enum", () => {
    // El fallo que este caso caza esta medido: olvidar una deja el `_old` con una columna
    // dependiente y el `DROP TYPE` aborta el rollback a mitad.
    for (const tabla of TABLAS_CON_ORIGEN_TIPO) {
      expect(
        downSql,
        `falta el ALTER COLUMN de ${tabla}: el DROP TYPE "..._old" fallaria`,
      ).toMatch(
        new RegExp(
          `ALTER TABLE "${tabla}" ALTER COLUMN "origen_tipo"\\s*\\n?\\s*TYPE "wallet_origen_tipo" USING \\("origen_tipo"::text::"wallet_origen_tipo"\\);`,
        ),
      );
    }
    // Y son exactamente TRES, ni una de mas.
    expect([...downSql.matchAll(/ALTER COLUMN "origen_tipo"/g)]).toHaveLength(3);
  });

  it("R40: suelta y recrea los SEIS indices que referencian origen_tipo, con su forma", () => {
    for (const idx of INDICES_CON_ORIGEN_TIPO) {
      expect(downSql, `no suelta ${idx}`).toContain(`DROP INDEX IF EXISTS "${idx}"`);
      expect(downSql.split(`"${idx}"`).length - 1, `no recrea ${idx}`).toBeGreaterThanOrEqual(2);
    }
    // Los tres parciales vuelven CON su predicado (sin el, la idempotencia del egreso muere).
    expect([...downSql.matchAll(/WHERE "origen_id" IS NOT NULL;/g)]).toHaveLength(3);
  });

  it("R40: suelta las dos tablas, la hija ANTES que la madre", () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "orden_incidente_evidencia";/);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS "orden_incidente";/);
    expect(downSql.indexOf('DROP TABLE IF EXISTS "orden_incidente_evidencia"')).toBeLessThan(
      downSql.indexOf('DROP TABLE IF EXISTS "orden_incidente";'),
    );
  });

  it("R40: NO toca los enums de otras features (`gestion_causa_incidente`, `cierre_estado`)", () => {
    // El down solo revierte SU migracion: los dos enums que reusa son de la 158/PR1 y de la 37.
    expect(downSql).not.toMatch(/DROP TYPE[^;]*"gestion_causa_incidente"/);
    expect(downSql).not.toMatch(/DROP TYPE[^;]*"cierre_estado"/);
    expect(downSql).not.toMatch(/CREATE TYPE "cierre_estado"/);
  });

  it("R40: documenta la PRECONDICION (aborta si alguna fila usa el valor nuevo)", () => {
    expect(downSql).toMatch(/PRECONDICION/i);
    expect(downSql).toMatch(/ABORTA/i);
    // Y nombra las TRES tablas en la precondicion, no solo la de la caja principal.
    for (const tabla of TABLAS_CON_ORIGEN_TIPO) expect(downSql).toContain(tabla);
  });

  it("el down tampoco crea policies (las tablas se van enteras con su RLS)", () => {
    expect(downSql).not.toMatch(/CREATE POLICY/i);
    expect(downSql).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });
});

describe("Q-F — esta migracion NO reescribe ningun down.sql previo", () => {
  it("NINGUN down.sql previo RECREA `wallet_origen_tipo` (el unico que lo toca hace DROP TYPE)", () => {
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => name < CARPETA);
    const recrean = dirs.filter((name) => {
      const file = path.join(MIGRATIONS_DIR, name, "down.sql");
      if (!fs.existsSync(file)) return false;
      return /CREATE TYPE "wallet_origen_tipo" AS ENUM/.test(fs.readFileSync(file, "utf8"));
    });
    // Barrido REAL del arbol, no una afirmacion de prosa: por eso Q-F no obliga a tocar nada.
    expect(recrean).toEqual([]);
  });

  it("el down de la 42 sigue haciendo DROP TYPE del enum, sin recrearlo", () => {
    const prev = fs.readFileSync(
      path.join(migrationDirFor("_wallet_movimiento"), "down.sql"),
      "utf8",
    );
    expect(prev).toMatch(/DROP TYPE IF EXISTS "wallet_origen_tipo"/);
    expect(prev).not.toMatch(/CREATE TYPE "wallet_origen_tipo"/);
  });
});

describe("estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("es POSTERIOR a la del camino del mensajero (la 158 se aplica en dos pasos, en orden)", () => {
    // Baseline PINNEADO (convencion del repo desde el 2026-07-29): el maximo timestamp del arbol
    // cuando esta migracion se escribio. Lo que caza el assert es RENOMBRAR esta carpeta ya
    // aplicada, que descuadraria `_prisma_migrations`; y que el orden con la del PR 1 se
    // conserve, porque esta REUSA el enum `gestion_causa_incidente` que aquella crea.
    const BASELINE = "20260730120000";
    expect(path.basename(migrationDir)).toBe(CARPETA);
    expect(path.basename(migrationDir).slice(0, 14) > BASELINE).toBe(true);
  });
});
