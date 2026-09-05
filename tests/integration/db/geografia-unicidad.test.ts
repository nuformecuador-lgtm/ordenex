import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// FICHA 374 (R3/R19) — LOS TRES UNIQUE, contra Postgres.
//
// QUE SE MIDE Y POR QUE NO VALE UN DOBLE. Que la BASE rechaza el duplicado es un hecho del motor:
// es la ultima palabra ante una carrera (R18), y ningun doble puede demostrarlo. Y su otra mitad
// —que el mismo nombre bajo OTRO padre entra— es igual de importante: un UNIQUE global sobre
// `nombre` habria roto la DTA, donde «Buenos Aires» es canton de Puntarenas Y distrito de Palmares
// (Alajuela), y donde hay cantones homonimos en provincias distintas.
//
// ⚠️ EL ORDEN DE LOS CASOS ES DELIBERADO: la mitad «ENTRA» va ANTES que la mitad «FALLA». Si el
// corpus no llegara a la base, la mitad «falla» seguiria en verde por ausencia (no hay con que
// chocar) mientras la mitad «entra» se pondria roja y lo diria. Un test que reporta `passed` sin
// datos es el fallo mudo que este repo ya ha pagado.

const ROOT = process.cwd();
const MIGRACIONES = path.join(ROOT, "db", "migrations");
const DIR_ESTA = "20260906120000_geografia_activo_y_unicidad";
const upSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"), "utf8");

function sentencias(sql: string): string[] {
  return sql
    .split("\n")
    .filter((linea) => !/^\s*--/.test(linea))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const TABLAS = ["provincia", "canton", "distrito"] as const;

function cualificar(sql: string, esquema: string): string {
  let salida = sql;
  for (const tabla of TABLAS) salida = salida.replaceAll(`"${tabla}"`, `"${esquema}"."${tabla}"`);
  return salida;
}

describe.skipIf(!HAY_BASE_DE_DATOS)("374/R3/R19 — unicidad POR PADRE", () => {
  const esquema = `t_374_uniq_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
    await admin.$executeRawUnsafe(
      `CREATE TABLE "${esquema}"."provincia" ("id" TEXT PRIMARY KEY, "nombre" TEXT NOT NULL)`,
    );
    await admin.$executeRawUnsafe(
      `CREATE TABLE "${esquema}"."canton" (
         "id" TEXT PRIMARY KEY,
         "provincia_id" TEXT NOT NULL REFERENCES "${esquema}"."provincia"("id"),
         "nombre" TEXT NOT NULL)`,
    );
    await admin.$executeRawUnsafe(
      `CREATE TABLE "${esquema}"."distrito" (
         "id" TEXT PRIMARY KEY,
         "canton_id" TEXT NOT NULL REFERENCES "${esquema}"."canton"("id"),
         "nombre" TEXT NOT NULL,
         "zona_especial" BOOLEAN DEFAULT false)`,
    );
    for (const stmt of sentencias(cualificar(upSql, esquema))) {
      await admin.$executeRawUnsafe(stmt);
    }
  }, 120_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  // ── PRIMERO: lo que TIENE que entrar ─────────────────────────────────────────────────────────

  it("entran dos provincias con nombres distintos", async () => {
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."provincia" ("id","nombre")
       VALUES ('p1','Puntarenas'),('p2','Alajuela')`,
    );
    const [fila] = await admin.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "${esquema}"."provincia"`,
    );
    expect(fila.n).toBe(2);
  });

  it("R19: DOS cantones homonimos en provincias DISTINTAS entran los dos", async () => {
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."canton" ("id","provincia_id","nombre")
       VALUES ('c1','p1','Buenos Aires'),('c2','p2','Buenos Aires'),('c3','p2','Palmares')`,
    );
    const [fila] = await admin.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "${esquema}"."canton" WHERE "nombre" = 'Buenos Aires'`,
    );
    expect(fila.n).toBe(2);
  });

  it("R19: «Buenos Aires» puede ser CANTON de Puntarenas y DISTRITO de Palmares a la vez", async () => {
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."distrito" ("id","canton_id","nombre")
       VALUES ('d1','c1','Cabagra'),('d2','c3','Buenos Aires'),('d3','c2','Cabagra')`,
    );
    const [fila] = await admin.$queryRawUnsafe<Array<{ cantones: number; distritos: number }>>(
      `SELECT (SELECT COUNT(*)::int FROM "${esquema}"."canton"   WHERE "nombre" = 'Buenos Aires') AS cantones,
              (SELECT COUNT(*)::int FROM "${esquema}"."distrito" WHERE "nombre" = 'Buenos Aires') AS distritos`,
    );
    expect(fila).toEqual({ cantones: 2, distritos: 1 });
  });

  it("R19: dos distritos homonimos bajo cantones DISTINTOS entran los dos", async () => {
    const [fila] = await admin.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "${esquema}"."distrito" WHERE "nombre" = 'Cabagra'`,
    );
    expect(fila.n).toBe(2);
  });

  // ── DESPUES: lo que la base TIENE que rechazar ───────────────────────────────────────────────

  it("R3: una provincia con el nombre repetido viola la unicidad", async () => {
    await expect(
      admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."provincia" ("id","nombre") VALUES ('pX','Puntarenas')`,
      ),
    ).rejects.toThrow(/provincia_nombre_key|unique|duplicad/i);
  });

  it("R3: un canton repetido DENTRO de su provincia viola la unicidad", async () => {
    await expect(
      admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."canton" ("id","provincia_id","nombre")
         VALUES ('cX','p1','Buenos Aires')`,
      ),
    ).rejects.toThrow(/canton_provincia_id_nombre_key|unique|duplicad/i);
  });

  it("R3: un distrito repetido DENTRO de su canton viola la unicidad", async () => {
    await expect(
      admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."distrito" ("id","canton_id","nombre")
         VALUES ('dX','c1','Cabagra')`,
      ),
    ).rejects.toThrow(/distrito_canton_id_nombre_key|unique|duplicad/i);
  });

  // El UNIQUE compara LITERALES, y decirlo aqui es lo que sostiene A7 del design: por eso la regla
  // de R17 (comparar por `normalizeName`) vive en el service y NO se delega a la base.
  it("el UNIQUE de la base compara LITERALES: «CABAGRA» entra junto a «Cabagra»", async () => {
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."distrito" ("id","canton_id","nombre") VALUES ('dY','c1','CABAGRA')`,
    );
    const [fila] = await admin.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "${esquema}"."distrito"
        WHERE "canton_id" = 'c1' AND lower("nombre") = 'cabagra'`,
    );
    expect(fila.n).toBe(2);
  });
});
