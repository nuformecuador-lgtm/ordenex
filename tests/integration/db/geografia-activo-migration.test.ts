import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// FICHA 374 (R1/R2/R4) — cobertura de `20260906120000_geografia_activo_y_unicidad`.
//
// POR QUE ESTO NO PUEDE SER UN REGEX SOBRE EL SQL. Lo que hay que demostrar son HECHOS DEL MOTOR:
// que las filas que YA EXISTIAN quedan en `true` (y no en NULL, ni con la columna nullable), que
// Postgres NO acepta un NULL en esa columna, que NINGUN indice quedo colgado del booleano, y que
// el `down` deja las tres tablas SIN la columna y CON las mismas filas. Un `toMatch(/activo/)` se
// satisface escribiendo la palabra.
//
// COMO SE MIDE. En un esquema desechable se reconstruyen las tres tablas de la geografia en su
// forma PREVIA a esta ficha (sin `activo` y sin los tres UNIQUE), se siembran filas, y encima se
// aplica el SQL REAL leido de disco, solo cualificado al esquema temporal. Nada se inventa.
//
// ⚠️ NINGUN `if (!fila) return;`: si el corpus no llegara a la base, los casos REVIENTAN con
// mensaje en vez de reportar `passed` por ausencia.

const ROOT = process.cwd();
const MIGRACIONES = path.join(ROOT, "db", "migrations");
const DIR_ESTA = "20260906120000_geografia_activo_y_unicidad";

const upSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"), "utf8");

/** El SQL sin la prosa: lo que Postgres ejecuta de verdad. */
function soloEjecutable(sql: string): string {
  return sql
    .split("\n")
    .filter((linea) => !/^\s*--/.test(linea))
    .join("\n");
}

function sentencias(sql: string): string[] {
  return soloEjecutable(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const TABLAS = ["provincia", "canton", "distrito"] as const;

const INDICES = [
  "provincia_nombre_key",
  "canton_provincia_id_nombre_key",
  "distrito_canton_id_nombre_key",
] as const;

/**
 * Cualifica al esquema desechable las TABLAS y —solo en el `DROP`— los INDICES.
 *
 * ⚠️ LA ASIMETRIA NO ES UN DESCUIDO, es como funciona Postgres: `CREATE INDEX` NO admite un nombre
 * cualificado (el indice nace en el esquema de SU tabla, que ya va cualificada), mientras que
 * `DROP INDEX` sin cualificar buscaria por el `search_path` — o sea, en `public`, donde estos tres
 * indices EXISTEN DE VERDAD desde que la migracion se aplico. Un test que soltara los indices
 * reales de la base de desarrollo seria mucho peor que un test rojo.
 */
function cualificar(sql: string, esquema: string): string {
  let salida = sql;
  for (const indice of INDICES) {
    salida = salida.replaceAll(
      `DROP INDEX IF EXISTS "${indice}"`,
      `DROP INDEX IF EXISTS "${esquema}"."${indice}"`,
    );
  }
  for (const tabla of TABLAS) salida = salida.replaceAll(`"${tabla}"`, `"${esquema}"."${tabla}"`);
  return salida;
}

async function aplicar(admin: PrismaClient, sql: string, esquema: string): Promise<void> {
  for (const stmt of sentencias(cualificar(sql, esquema))) {
    await admin.$executeRawUnsafe(stmt);
  }
}

/** La forma PREVIA a la ficha 374: sin `activo` y sin ninguno de los tres UNIQUE. */
async function crearEsquemaPrevio(admin: PrismaClient, esquema: string): Promise<void> {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
  const ddl = [
    `CREATE TABLE "${esquema}"."provincia" ("id" TEXT PRIMARY KEY, "nombre" TEXT NOT NULL)`,
    `CREATE TABLE "${esquema}"."canton" (
       "id" TEXT PRIMARY KEY,
       "provincia_id" TEXT NOT NULL REFERENCES "${esquema}"."provincia"("id"),
       "nombre" TEXT NOT NULL)`,
    `CREATE TABLE "${esquema}"."distrito" (
       "id" TEXT PRIMARY KEY,
       "canton_id" TEXT NOT NULL REFERENCES "${esquema}"."canton"("id"),
       "nombre" TEXT NOT NULL,
       "zona_especial" BOOLEAN DEFAULT false)`,
  ];
  for (const stmt of ddl) await admin.$executeRawUnsafe(stmt);
}

async function sembrar(admin: PrismaClient, esquema: string): Promise<void> {
  await admin.$executeRawUnsafe(
    `INSERT INTO "${esquema}"."provincia" ("id","nombre") VALUES ('p1','Puntarenas'),('p2','Alajuela')`,
  );
  await admin.$executeRawUnsafe(
    `INSERT INTO "${esquema}"."canton" ("id","provincia_id","nombre")
     VALUES ('c1','p1','Buenos Aires'),('c2','p2','Palmares')`,
  );
  await admin.$executeRawUnsafe(
    `INSERT INTO "${esquema}"."distrito" ("id","canton_id","nombre")
     VALUES ('d1','c1','Cabagra'),('d2','c1','Volcán'),('d3','c2','Buenos Aires')`,
  );
}

interface FilaColumna {
  table_name: string;
  is_nullable: string;
  column_default: string | null;
}

async function columnasActivo(admin: PrismaClient, esquema: string): Promise<FilaColumna[]> {
  return admin.$queryRawUnsafe<FilaColumna[]>(
    `SELECT table_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = $1 AND column_name = 'activo'
        AND table_name IN ('provincia','canton','distrito')
      ORDER BY table_name`,
    esquema,
  );
}

async function conteos(
  admin: PrismaClient,
  esquema: string,
): Promise<{ p: number; c: number; d: number }> {
  const [fila] = await admin.$queryRawUnsafe<Array<{ p: number; c: number; d: number }>>(
    `SELECT (SELECT COUNT(*)::int FROM "${esquema}"."provincia") AS p,
            (SELECT COUNT(*)::int FROM "${esquema}"."canton")    AS c,
            (SELECT COUNT(*)::int FROM "${esquema}"."distrito")  AS d`,
  );
  return fila;
}

// ---------------------------------------------------------------------------------------------
// Estatico: corre SIEMPRE, tambien en un arbol sin `DATABASE_URL`.
// ---------------------------------------------------------------------------------------------
describe("374 — migracion geografia_activo_y_unicidad: forma en disco", () => {
  it("trae migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"))).toBe(true);
  });

  // R4 — el argumento esta escrito en la cabecera de la migracion: un booleano casi siempre `true`
  // sobre una tabla de 494 filas que se lee ENTERA no gana nada con un indice.
  it("el SQL ejecutable NO crea ningun indice sobre `activo`", () => {
    const ejecutable = soloEjecutable(upSql);
    expect(ejecutable).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX[^;]*\(\s*"?activo"?\s*\)/i);
  });

  // R2 — el down NO borra ni modifica filas. Es la mitad que un `DELETE` de limpieza romperia.
  it("el down solo suelta indices y columnas: ni un DELETE, ni un UPDATE, ni un TRUNCATE", () => {
    const ejecutable = soloEjecutable(downSql);
    expect(ejecutable).not.toMatch(/\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b/i);
    expect(ejecutable).toMatch(/DROP COLUMN IF EXISTS "activo"/);
  });
});

// ---------------------------------------------------------------------------------------------
// Contra Postgres real: el up sobre filas que YA existian.
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)("374/R1/R4 — el up, contra Postgres", () => {
  const esquema = `t_374_up_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;
  let antes = { p: 0, c: 0, d: 0 };

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await crearEsquemaPrevio(admin, esquema);
    await sembrar(admin, esquema);
    antes = await conteos(admin, esquema);
    await aplicar(admin, upSql, esquema);
  }, 120_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("el corpus llego a la base: 2 provincias, 2 cantones, 3 distritos", () => {
    // ANTI-VACUIDAD. Sin esto, todo lo de abajo podria estar verde sobre tablas vacias.
    expect(antes).toEqual({ p: 2, c: 2, d: 3 });
  });

  it("las tres tablas ganan `activo` NOT NULL con default true", async () => {
    const filas = await columnasActivo(admin, esquema);
    expect(filas.map((f) => f.table_name)).toEqual(["canton", "distrito", "provincia"]);
    for (const fila of filas) {
      expect(fila.is_nullable, `${fila.table_name}.activo es nullable`).toBe("NO");
      expect(fila.column_default, `${fila.table_name}.activo sin default`).toBe("true");
    }
  });

  it("TODAS las filas previas quedan en `true`: ninguna sin valor", async () => {
    const [fila] = await admin.$queryRawUnsafe<Array<{ p: number; c: number; d: number }>>(
      `SELECT (SELECT COUNT(*)::int FROM "${esquema}"."provincia" WHERE "activo" IS TRUE) AS p,
              (SELECT COUNT(*)::int FROM "${esquema}"."canton"    WHERE "activo" IS TRUE) AS c,
              (SELECT COUNT(*)::int FROM "${esquema}"."distrito"  WHERE "activo" IS TRUE) AS d`,
    );
    expect(fila).toEqual(antes);
  });

  it("Postgres RECHAZA un NULL en `activo`: la columna no es tri-valuada como `zona_especial`", async () => {
    await expect(
      admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."provincia" ("id","nombre","activo") VALUES ('pX','Nula',NULL)`,
      ),
    ).rejects.toThrow();
  });

  // R4 — medido sobre `pg_indexes`, que es donde vive la respuesta, y no sobre el texto del SQL.
  it("`pg_indexes` no lista NINGUN indice cuya definicion sea solo `(activo)`", async () => {
    const filas = await admin.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = $1 AND tablename IN ('provincia','canton','distrito')`,
      esquema,
    );
    // ANTI-VACUIDAD: los indices SI se leen (pk + los tres unique nuevos).
    expect(filas.length).toBeGreaterThanOrEqual(6);
    const soloActivo = filas.filter((f) => /\(\s*activo\s*\)\s*$/.test(f.indexdef));
    expect(soloActivo.map((f) => f.indexname)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// R2 — el down: sin la columna, y con EXACTAMENTE las mismas filas.
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)("374/R2 — el down, contra Postgres", () => {
  const esquema = `t_374_down_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;
  let antesDelUp = { p: 0, c: 0, d: 0 };
  let trasElDown = { p: 0, c: 0, d: 0 };
  let columnasTrasDown: FilaColumna[] = [];
  let indicesTrasDown: string[] = [];

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await crearEsquemaPrevio(admin, esquema);
    await sembrar(admin, esquema);
    antesDelUp = await conteos(admin, esquema);
    await aplicar(admin, upSql, esquema);
    // Un nodo RETIRADO antes del down: es el dato que la reversion declara que se pierde, y hay
    // que ejercerlo para que la perdida sea la declarada y no un borrado de filas.
    await admin.$executeRawUnsafe(
      `UPDATE "${esquema}"."distrito" SET "activo" = false WHERE "id" = 'd1'`,
    );
    await aplicar(admin, downSql, esquema);
    trasElDown = await conteos(admin, esquema);
    columnasTrasDown = await columnasActivo(admin, esquema);
    const idx = await admin.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = $1 AND tablename IN ('provincia','canton','distrito')
        ORDER BY indexname`,
      esquema,
    );
    indicesTrasDown = idx.map((f) => f.indexname);
  }, 120_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("el corpus llego a la base antes del up", () => {
    expect(antesDelUp).toEqual({ p: 2, c: 2, d: 3 });
  });

  it("las tres tablas quedan SIN la columna `activo`", () => {
    expect(columnasTrasDown).toEqual([]);
  });

  it("los tres UNIQUE de la ficha desaparecen, y las claves primarias siguen", () => {
    for (const indice of INDICES) expect(indicesTrasDown).not.toContain(indice);
    expect(indicesTrasDown).toEqual(
      expect.arrayContaining(["canton_pkey", "distrito_pkey", "provincia_pkey"]),
    );
  });

  it("NINGUNA fila se borro ni se modifico: los tres conteos son los de antes del up", () => {
    expect(trasElDown).toEqual(antesDelUp);
  });

  it("los nombres siguen siendo los mismos, fila a fila", async () => {
    const filas = await admin.$queryRawUnsafe<Array<{ id: string; nombre: string }>>(
      `SELECT "id", "nombre" FROM "${esquema}"."distrito" ORDER BY "id"`,
    );
    expect(filas).toEqual([
      { id: "d1", nombre: "Cabagra" },
      { id: "d2", nombre: "Volcán" },
      { id: "d3", nombre: "Buenos Aires" },
    ]);
  });

  it("correr el down dos veces es un no-op (IF EXISTS en las seis sentencias)", async () => {
    await aplicar(admin, downSql, esquema);
    expect(await conteos(admin, esquema)).toEqual(antesDelUp);
  });
});
