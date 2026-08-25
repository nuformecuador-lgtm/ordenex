import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// Cobertura de `20260824180000_distrito_zona_especial`: nace `distrito.zona_especial`, BOOLEAN
// OPCIONAL con DEFAULT false.
//
// LO QUE ESTE ARCHIVO TIENE QUE DEMOSTRAR, Y QUE UN REGEX SOBRE EL SQL NO DEMUESTRA: que las tres
// situaciones que la columna admite se comportan distinto de verdad —una fila que ya existia queda
// en `false` (el DEFAULT rellena hacia atras, NO deja NULL), una insertada despues sin decir nada
// tambien cae en `false`, y `NULL` solo aparece si alguien lo escribe a proposito—. Un
// `toMatch(/DEFAULT false/)` se satisface reescribiendo la linea; esto no.

const DIR = path.join(process.cwd(), "db", "migrations", "20260824180000_distrito_zona_especial");

describe("migracion distrito_zona_especial — forma en disco", () => {
  it("trae migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(DIR, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(DIR, "down.sql"))).toBe(true);
  });

  it("el down suelta la columna y es idempotente", () => {
    const down = fs.readFileSync(path.join(DIR, "down.sql"), "utf8");
    expect(down).toMatch(/DROP COLUMN IF EXISTS "zona_especial"/);
  });

  it("el schema de Prisma declara el campo opcional, mapeado y con default false", () => {
    const schema = fs.readFileSync(path.join(process.cwd(), "db", "schema.prisma"), "utf8");
    // `Boolean?` (opcional) + `@default(false)` + el `@map` a snake_case de la columna real.
    expect(schema).toMatch(
      /zonaEspecial\s+Boolean\?\s+@default\(false\)\s+@map\("zona_especial"\)/,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Contra Postgres real: se reconstruye `distrito` en un esquema desechable con la forma PREVIA a
// esta migracion, se siembra una fila (la "historica"), se aplica el SQL del `up` y se comprueba
// el comportamiento de los tres casos.
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)("migracion distrito_zona_especial — contra Postgres", () => {
  const esquema = `t_distrito_esp_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
    // Forma PREVIA de la tabla, reducida a lo que esta migracion necesita tocar.
    await admin.$executeRawUnsafe(`
      CREATE TABLE "${esquema}"."distrito" (
        "id" TEXT PRIMARY KEY,
        "nombre" TEXT NOT NULL,
        "canton_id" TEXT NOT NULL
      )
    `);
    await admin.$executeRawUnsafe(`
      INSERT INTO "${esquema}"."distrito" ("id", "nombre", "canton_id")
      VALUES ('viejo', 'Distrito historico', 'c1')
    `);

    // El SQL REAL de la migracion, cualificado al esquema temporal. NO se usa `search_path`: el
    // pool puede servir cada sentencia por una conexion distinta y el ajuste no viaja con ella.
    // Los comentarios se quitan ANTES de partir por `;` porque la prosa contiene puntos y coma.
    const up = fs
      .readFileSync(path.join(DIR, "migration.sql"), "utf8")
      .replace(/"distrito"/g, `"${esquema}"."distrito"`);
    const sentencias = up
      .split("\n")
      .filter((l) => !/^\s*--/.test(l))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of sentencias) {
      await admin.$executeRawUnsafe(stmt);
    }
  }, 60_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  // La fila que ya existia NO queda en NULL: `ADD COLUMN ... DEFAULT false` rellena hacia atras.
  it("la fila historica queda en false, no en NULL", async () => {
    const [fila] = await admin.$queryRawUnsafe<Array<{ zona_especial: boolean | null }>>(
      `SELECT "zona_especial" FROM "${esquema}"."distrito" WHERE "id" = 'viejo'`,
    );
    expect(fila.zona_especial).toBe(false);
  });

  it("una fila insertada DESPUES sin decir nada cae en false por el DEFAULT", async () => {
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."distrito" ("id", "nombre", "canton_id") VALUES ('nuevo', 'N', 'c1')`,
    );
    const [fila] = await admin.$queryRawUnsafe<Array<{ zona_especial: boolean | null }>>(
      `SELECT "zona_especial" FROM "${esquema}"."distrito" WHERE "id" = 'nuevo'`,
    );
    expect(fila.zona_especial).toBe(false);
  });

  // Es OPCIONAL: NULL es un valor legal, pero solo llega si alguien lo escribe.
  it("la columna admite NULL explicito y tambien true", async () => {
    await admin.$executeRawUnsafe(`
      INSERT INTO "${esquema}"."distrito" ("id", "nombre", "canton_id", "zona_especial")
      VALUES ('sin-decidir', 'S', 'c1', NULL), ('especial', 'E', 'c1', true)
    `);
    const filas = await admin.$queryRawUnsafe<
      Array<{ id: string; zona_especial: boolean | null }>
    >(
      `SELECT "id", "zona_especial" FROM "${esquema}"."distrito" WHERE "id" IN ('sin-decidir', 'especial') ORDER BY "id"`,
    );
    expect(filas).toEqual([
      { id: "especial", zona_especial: true },
      { id: "sin-decidir", zona_especial: null },
    ]);
  });

  // La consecuencia de que sea nullable, escrita como assert para que nadie la olvide: `NOT` sobre
  // un NULL no es `true`, asi que "los no especiales" hay que preguntarlos con IS NOT TRUE.
  it("`NOT zona_especial` NO cuenta las filas sin decidir; `IS NOT TRUE` si", async () => {
    const [conNot] = await admin.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM "${esquema}"."distrito" WHERE NOT "zona_especial"`,
    );
    const [conIsNotTrue] = await admin.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM "${esquema}"."distrito" WHERE "zona_especial" IS NOT TRUE`,
    );
    // viejo + nuevo = 2 en false; sin-decidir = NULL; especial = true.
    expect(Number(conNot.n)).toBe(2);
    expect(Number(conIsNotTrue.n)).toBe(3);
  });
});
