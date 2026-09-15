import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { quitarComentariosSql } from "../../fixtures/sin-comentarios";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

/**
 * FICHA 425 (B2, R3/R21) — la migracion `*_cierre_rechazo_tienda`, en DOS niveles.
 *
 * 1. EL SQL ESCRITO (corre siempre, sin base): que el UP haga exactamente lo del diseño y nada mas, y
 *    que el DOWN sea el `DROP TABLE` y nada mas. Se afirma sobre el SQL EJECUTABLE: los comentarios de
 *    la migracion EXPLICAN lo que no esta («ni DECIMAL, ni NUMERIC…») y buscarlo en el texto crudo
 *    daria falsos positivos.
 *
 * 2. LA TABLA APLICADA, leida del catalogo REAL de Postgres (se SALTA sin base): indices, FKs con su
 *    accion, RLS y policies, y —R21— los TIPOS de las columnas desde `information_schema.columns`,
 *    no desde una lista escrita a mano. Una regex sobre el SQL dice lo que alguien escribio; el
 *    catalogo dice lo que Postgres creo.
 *
 * Los catalogos de Postgres son GLOBALES A LA BASE (ficha 421): toda consulta filtra `public`.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "db", "migrations");
const TABLA = "cierre_rechazo_tienda";

function carpetasDeMigracion(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

const encontrada = carpetasDeMigracion().find((d) => d.endsWith(`_${TABLA}`));
if (encontrada === undefined) throw new Error(`no existe la carpeta de migracion *_${TABLA}`);
const carpeta: string = encontrada;
const upSql = fs.readFileSync(path.join(MIGRATIONS_DIR, carpeta, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(MIGRATIONS_DIR, carpeta, "down.sql"), "utf8");
const upExec = quitarComentariosSql(upSql);
const downExec = quitarComentariosSql(downSql);

/** Las sentencias ejecutables, con los espacios normalizados. */
function sentencias(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

describe("425/B2 — la migracion escrita (SQL ejecutable)", () => {
  it("vive en su carpeta con UP y DOWN, y nace DESPUES de la ultima migracion que existia", () => {
    expect(fs.existsSync(path.join(MIGRATIONS_DIR, carpeta, "down.sql"))).toBe(true);
    const previa = carpetasDeMigracion().find((d) => d.endsWith("_notificacion_evento_traspaso"));
    expect(previa).toBeDefined();
    expect(carpeta > (previa as string)).toBe(true);
  });

  it("es ADITIVA: crea UNA tabla, solo altera ESA tabla, sin enums y sin backfill", () => {
    expect(upExec.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(upExec).toMatch(/CREATE TABLE "cierre_rechazo_tienda" \(/);
    const alteradas = [...new Set(upExec.match(/ALTER TABLE "[a-z_]+"/g) ?? [])];
    expect(alteradas).toEqual(['ALTER TABLE "cierre_rechazo_tienda"']);
    expect(upExec).not.toMatch(/CREATE TYPE|ALTER TYPE/i);
    // Sin backfill (design §4.2): ningun cierre existente se llevo un rechazo.
    expect(upExec).not.toMatch(/INSERT INTO|UPDATE "|DELETE FROM/i);
  });

  it("R3: el UNIQUE es sobre `gestion_id` SOLO — el par (cierre, gestion) dejaria que dos cierres se la llevaran", () => {
    const unicos = upExec.match(/CREATE UNIQUE INDEX [^;]+;/g) ?? [];
    expect(unicos).toEqual([
      'CREATE UNIQUE INDEX "cierre_rechazo_tienda_gestion_id_key" ON "cierre_rechazo_tienda"("gestion_id");',
    ]);
  });

  it("R21: ni DECIMAL, ni NUMERIC, ni MONEY en el SQL ejecutable", () => {
    expect(upExec).not.toMatch(/DECIMAL|NUMERIC|MONEY|DOUBLE PRECISION|\bREAL\b/i);
  });

  it("R21: habilita RLS y no crea ninguna policy", () => {
    expect(upExec).toMatch(/ALTER TABLE "cierre_rechazo_tienda" ENABLE ROW LEVEL SECURITY;/);
    expect(upExec).not.toMatch(/CREATE POLICY/i);
  });

  it("DOWN: su UNICA sentencia es el DROP TABLE de la tabla nueva (no toca nada preexistente)", () => {
    expect(sentencias(downExec)).toEqual(['DROP TABLE IF EXISTS "cierre_rechazo_tienda"']);
  });
});

describeSiHayBase("425/B2 — la tabla aplicada, leida del catalogo de Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("la migracion consta como APLICADA y no revertida en `_prisma_migrations`", async () => {
    const filas = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "_prisma_migrations"
        WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      carpeta,
    );
    expect(filas[0].n).toBe(1);
  });

  it("R3: sus indices son EXACTAMENTE pkey(id), UNIQUE(gestion_id), (cierre_id) y (orden_id)", async () => {
    const filas = await prisma.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname::text, indexdef::text FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1 ORDER BY indexname`,
      TABLA,
    );
    const porNombre = Object.fromEntries(
      filas.map((f) => [f.indexname, f.indexdef.replace(/^.* USING btree /, "")]),
    );
    expect(porNombre).toEqual({
      cierre_rechazo_tienda_cierre_id_idx: "(cierre_id)",
      cierre_rechazo_tienda_gestion_id_key: "(gestion_id)",
      cierre_rechazo_tienda_orden_id_idx: "(orden_id)",
      cierre_rechazo_tienda_pkey: "(id)",
    });
    const unicos = filas
      .filter((f) => /UNIQUE/.test(f.indexdef))
      .map((f) => f.indexname)
      .sort();
    expect(unicos).toEqual(["cierre_rechazo_tienda_gestion_id_key", "cierre_rechazo_tienda_pkey"]);
  });

  it("las 3 FKs apuntan a su tabla con ON DELETE RESTRICT y ON UPDATE CASCADE", async () => {
    const filas = await prisma.$queryRawUnsafe<
      { columna: string; referida: string; al_borrar: string; al_actualizar: string }[]
    >(
      `SELECT a.attname::text AS columna, rt.relname::text AS referida,
              c.confdeltype::text AS al_borrar, c.confupdtype::text AS al_actualizar
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace ns ON ns.oid = t.relnamespace
         JOIN pg_class rt ON rt.oid = c.confrelid
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND t.relname = $1 AND ns.nspname = 'public'
        ORDER BY a.attname`,
      TABLA,
    );
    // `r` = RESTRICT y `c` = CASCADE, los codigos de `pg_constraint`.
    expect(filas).toEqual([
      { columna: "cierre_id", referida: "cierre_dia", al_borrar: "r", al_actualizar: "c" },
      { columna: "gestion_id", referida: "gestion_orden", al_borrar: "r", al_actualizar: "c" },
      { columna: "orden_id", referida: "orden", al_borrar: "r", al_actualizar: "c" },
    ]);
  });

  it("R21: RLS habilitada y CERO policies", async () => {
    const rls = await prisma.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(
      `SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE c.relname = $1 AND ns.nspname = 'public'`,
      TABLA,
    );
    expect(rls).toEqual([{ relrowsecurity: true }]);
    const policies = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
      TABLA,
    );
    expect(policies[0].n).toBe(0);
  });

  it("R21: ninguna columna guarda un importe — tipos y nombres leidos de information_schema", async () => {
    const columnas = await prisma.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
      `SELECT column_name::text, data_type::text FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      TABLA,
    );
    // La consulta mide algo: sin la tabla, las ausencias de abajo serian verdes por vacio.
    expect(columnas.length).toBeGreaterThanOrEqual(10);
    const tiposDeImporte = ["numeric", "money", "real", "double precision"];
    expect(columnas.filter((c) => tiposDeImporte.includes(c.data_type))).toEqual([]);
    // El UNICO entero es la copia de la guia: identidad, no importe.
    const enteros = columnas
      .filter((c) => ["integer", "bigint", "smallint"].includes(c.data_type))
      .map((c) => c.column_name);
    expect(enteros).toEqual(["num_guia"]);
    const vocabularioDeDinero = [
      "monto",
      "pago",
      "cobro",
      "ingreso",
      "tarifa",
      "comision",
      "flete",
      "total",
      "precio",
      "saldo",
      "importe",
      "indemnizacion",
      "recaudo",
    ];
    const conNombreDeDinero = columnas
      .map((c) => c.column_name)
      .filter((nombre) => vocabularioDeDinero.some((v) => nombre.includes(v)));
    expect(conNombreDeDinero).toEqual([]);
  });
});
