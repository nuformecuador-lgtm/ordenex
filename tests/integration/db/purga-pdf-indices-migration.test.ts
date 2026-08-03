import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 178 / T2 (R26) — cobertura ESTATICA de la migracion `*_purga_pdf_indices`, con el
// patron de `orden-historial-actor-origen-index-migration.test.ts` y
// `gestion-orden-anulacion-migration.test.ts`: lee `migration.sql` y `down.sql` y verifica su
// contenido por regex. NO requiere Postgres real.
//
// Lo que R26 exige y aqui se fija:
//   1. el UP crea EXACTAMENTE los dos indices esperados, con tabla y columna exactas, y AMBOS
//      son PARCIALES (llevan `WHERE`) — un indice total pasaria una asercion de "existe el
//      indice" y destruiria la razon de ser del cambio (`design.md` §3, Alternativa G);
//   2. el UP no contiene NINGUN DDL sobre datos: ni `ALTER TABLE`, ni `UPDATE`, ni `DELETE`, ni
//      `DROP`, ni `CREATE TABLE`;
//   3. el DOWN suelta esos dos indices y SOLO esos, en ORDEN INVERSO al UP;
//   4. la carpeta contiene los dos archivos y su timestamp alcanza al `db:rollback`.
//
// Las aserciones de AUSENCIA miran el SQL EJECUTABLE, no los comentarios: el encabezado de esta
// migracion explica en prosa por que NO usa `CONCURRENTLY` y por que un `migrate dev` futuro
// podria proponer un `DROP INDEX` fantasma. Si el test mirase el texto crudo, se contradiria solo.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

const SUFIJO = "_purga_pdf_indices";
const TIMESTAMP = "20260803140000";
/** Ultima migracion que existia al escribir esta (feature 177). */
const TIMESTAMP_PREVIO = "20260803120000";

const IDX_CARGA = "carga_purga_pendiente_idx";
const IDX_ORDEN = "orden_purga_pendiente_idx";

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor(SUFIJO);
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

/** El SQL sin comentarios ni lineas en blanco, en una sola cadena. */
function ejecutable(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("--"))
    .join("\n");
}

/** Las sentencias reales, una por elemento, normalizadas a espacios simples. */
function sentencias(sql: string): string[] {
  return ejecutable(sql)
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

const upStmts = sentencias(upSql);
const downStmts = sentencias(downSql);
const upEjecutable = ejecutable(upSql);
const downEjecutable = ejecutable(downSql);

describe("UP — solo los dos indices PARCIALES de la purga (R26)", () => {
  it("hace exactamente DOS cosas, y las dos son CREATE INDEX", () => {
    expect(upStmts).toHaveLength(2);
    for (const stmt of upStmts) expect(stmt).toMatch(/^CREATE INDEX /);
  });

  it(`crea ${IDX_CARGA} sobre carga("created_at") — la columna del corte, no fecha_carga`, () => {
    const stmt = upStmts.find((s) => s.includes(IDX_CARGA));
    expect(stmt, `no se encontro el CREATE INDEX de ${IDX_CARGA}`).toBeDefined();
    expect(stmt!).toMatch(new RegExp(`^CREATE INDEX "${IDX_CARGA}" ON "carga" ?\\("created_at"\\)`));
    // La ventana de retencion se mide sobre `created_at` (decision (a)); `fecha_carga` es otra
    // columna y ya tiene su propio indice: indexarla aqui no serviria al corte de R5.
    expect(stmt!).not.toMatch(/fecha_carga/);
  });

  it(`crea ${IDX_ORDEN} sobre orden("carga_id")`, () => {
    const stmt = upStmts.find((s) => s.includes(IDX_ORDEN));
    expect(stmt, `no se encontro el CREATE INDEX de ${IDX_ORDEN}`).toBeDefined();
    expect(stmt!).toMatch(new RegExp(`^CREATE INDEX "${IDX_ORDEN}" ON "orden" ?\\("carga_id"\\)`));
  });

  it("los DOS son PARCIALES: cada uno lleva su WHERE de 'referencia viva'", () => {
    // Discriminante frente a un indice TOTAL: sin el WHERE el indice cubriria tambien el
    // historico ya purgado y el coste de la purga creceria con el historico (Alternativa G).
    const carga = upStmts.find((s) => s.includes(IDX_CARGA))!;
    const orden = upStmts.find((s) => s.includes(IDX_ORDEN))!;

    expect(carga).toMatch(/ WHERE /);
    expect(carga).toMatch(
      /WHERE "download_storage_path" IS NOT NULL OR "download_url" IS NOT NULL/,
    );

    expect(orden).toMatch(/ WHERE /);
    expect(orden).toMatch(
      /WHERE "carga_id" IS NOT NULL AND \("download_storage_path" IS NOT NULL OR "download_url" IS NOT NULL\)/,
    );
  });

  it("CERO DDL sobre datos: ni ALTER TABLE, ni UPDATE, ni DELETE, ni DROP, ni CREATE TABLE", () => {
    expect(upEjecutable).not.toMatch(/ALTER TABLE/i);
    expect(upEjecutable).not.toMatch(/\bUPDATE\b/i);
    expect(upEjecutable).not.toMatch(/\bDELETE\b/i);
    expect(upEjecutable).not.toMatch(/\bDROP\b/i);
    expect(upEjecutable).not.toMatch(/CREATE TABLE/i);
  });

  it("tampoco toca columnas, constraints, tipos, filas ni RLS", () => {
    expect(upEjecutable).not.toMatch(/ADD COLUMN/i);
    expect(upEjecutable).not.toMatch(/ADD CONSTRAINT/i);
    expect(upEjecutable).not.toMatch(/ALTER TYPE/i);
    expect(upEjecutable).not.toMatch(/\bINSERT\b/i);
    expect(upEjecutable).not.toMatch(/\bTRUNCATE\b/i);
    expect(upEjecutable).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("no usa CONCURRENTLY (Prisma corre cada migracion dentro de una transaccion)", () => {
    expect(upEjecutable).not.toMatch(/CONCURRENTLY/i);
  });
});

describe("DOWN — suelta esos dos indices, en ORDEN INVERSO", () => {
  it("hace exactamente DOS cosas, y las dos son DROP INDEX", () => {
    expect(downStmts).toHaveLength(2);
    for (const stmt of downStmts) expect(stmt).toMatch(/^DROP INDEX /);
  });

  it("primero el de orden y despues el de carga: el inverso exacto del UP", () => {
    expect(downStmts[0]).toMatch(new RegExp(`^DROP INDEX "${IDX_ORDEN}"`));
    expect(downStmts[1]).toMatch(new RegExp(`^DROP INDEX "${IDX_CARGA}"`));

    // Y que ese orden sea REALMENTE el inverso del UP, no una coincidencia de literales.
    const upNombres = upStmts.map((s) => s.match(/CREATE INDEX "([^"]+)"/)![1]);
    const downNombres = downStmts.map((s) => s.match(/DROP INDEX "([^"]+)"/)![1]);
    expect(downNombres).toEqual([...upNombres].reverse());
  });

  it("hay un DROP INDEX por cada CREATE INDEX del UP, y ningun otro DDL", () => {
    const creados = (upEjecutable.match(/CREATE INDEX/g) ?? []).length;
    const borrados = (downEjecutable.match(/DROP INDEX/g) ?? []).length;
    expect(creados).toBe(2);
    expect(borrados).toBe(creados);

    expect(downEjecutable).not.toMatch(/ALTER TABLE/i);
    expect(downEjecutable).not.toMatch(/\bUPDATE\b/i);
    expect(downEjecutable).not.toMatch(/\bDELETE\b/i);
    expect(downEjecutable).not.toMatch(/DROP TABLE/i);
    expect(downEjecutable).not.toMatch(/DROP COLUMN/i);
    expect(downEjecutable).not.toMatch(/CREATE /i);
    expect(downEjecutable).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});

describe("carpeta de la migracion", () => {
  it("contiene migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("su timestamp es POSTERIOR al de la ultima migracion previa, para que db:rollback la alcance", () => {
    // `scripts/db-rollback.ts` ordena las carpetas por nombre y revierte SOLO la ultima: si esta
    // migracion no fuera alfabeticamente posterior a la anterior, `pnpm db:rollback` revertiria
    // otra cosa. BASELINE PINNEADO: comparar contra el arbol vivo daria falsos rojos con cada
    // migracion futura, que son posteriores POR DEFINICION.
    const esta = path.basename(migrationDir).slice(0, 14);
    expect(esta > TIMESTAMP_PREVIO).toBe(true);
    // Y debe seguir siendo EXACTAMENTE la carpeta aplicada: renombrarla descuadra
    // `_prisma_migrations`.
    expect(esta).toBe(TIMESTAMP);
  });
});
