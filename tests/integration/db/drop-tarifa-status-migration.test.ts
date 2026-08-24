import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// Cobertura de `20260825120000_drop_tarifa_status` (feature 274, R9/R10). La migracion hace
// DOS cosas y las dos se ejercen aqui:
//   1. UP: `tarifas` pierde la columna `status` y el tipo enum que la respaldaba desaparece.
//   2. DOWN: el tipo y la columna vuelven, NOT NULL DEFAULT 'activo' — pero NO los valores.
//
// POR QUE ESTE ARCHIVO NO SE CONFORMA CON REGEX SOBRE EL SQL. Un `expect(sql).toMatch(/DROP
// COLUMN/)` demuestra que alguien ESCRIBIO la linea, no que la columna se vaya. Y en esta
// migracion concreta hay dos hechos que solo el motor puede confirmar:
//   - El ORDEN importa de verdad. Mientras la columna exista, el enum esta EN USO y Postgres
//     rechaza el `DROP TYPE`. Una regex ve las dos sentencias presentes y da verde aunque
//     esten invertidas; aqui, invertirlas revienta la aplicacion del SQL.
//   - La PERDIDA DE DATO del `down` es el nucleo de la decision, no un detalle. Que una fila
//     que estaba en `inactivo` vuelva como `activo` no se lee en el SQL: se lee consultando
//     esa fila despues de revertir. Hay un test dedicado a afirmarlo, para que quede escrito
//     como comportamiento comprobado y no como advertencia en un comentario.
// Todo corre contra Postgres de verdad, en un esquema desechable: ni se aplica a `public` ni
// se toca `_prisma_migrations`.

const DIR = path.join(process.cwd(), "db", "migrations", "20260825120000_drop_tarifa_status");

/**
 * Parte el SQL en sentencias. `split(";")` a secas NO sirve: el `down` de esta migracion es un
 * bloque `DO $$ ... $$` cuyo CUERPO lleva punto y coma, y partir por ahi lo hace pedazos que no
 * son SQL valido. Se lleva un interruptor de "dentro de $$" y solo se corta fuera. Los
 * comentarios se quitan ANTES de partir: la prosa de estas migraciones tambien tiene `;`.
 * (Mismo partidor que `tarifa-zona-is-default-migration.test.ts`, por la misma razon.)
 */
function sentenciasDe(sql: string): string[] {
  const cuerpo = sql
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

  const out: string[] = [];
  let actual = "";
  let dentroDeDolar = false;
  for (let i = 0; i < cuerpo.length; i++) {
    if (cuerpo.startsWith("$$", i)) {
      dentroDeDolar = !dentroDeDolar;
      actual += "$$";
      i++;
      continue;
    }
    const c = cuerpo[i];
    if (c === ";" && !dentroDeDolar) {
      if (actual.trim()) out.push(actual.trim());
      actual = "";
      continue;
    }
    actual += c;
  }
  if (actual.trim()) out.push(actual.trim());
  return out;
}

/**
 * Cualifica el SQL al esquema desechable. Se reescriben SOLO los identificadores de la tabla y
 * del TIPO (un enum tambien vive en un esquema); el resto del SQL se ejecuta tal cual.
 * NO se usa `search_path`: el pool puede servir cada sentencia por una conexion distinta y el
 * ajuste no viaja con ella.
 */
function cualificar(sql: string, esquema: string): string {
  return sql
    .replace(/"tarifas"/g, `"${esquema}"."tarifas"`)
    .replace(/"estado_tarifa"/g, `"${esquema}"."estado_tarifa"`);
}

const UP = fs.readFileSync(path.join(DIR, "migration.sql"), "utf8");
const DOWN = fs.readFileSync(path.join(DIR, "down.sql"), "utf8");

/** Forma PREVIA de la tabla, reducida a lo que esta migracion toca, con dos filas sembradas. */
async function sembrarFormaPrevia(admin: PrismaClient, esquema: string): Promise<void> {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
  await admin.$executeRawUnsafe(
    `CREATE TYPE "${esquema}"."estado_tarifa" AS ENUM ('activo', 'inactivo')`,
  );
  await admin.$executeRawUnsafe(`
    CREATE TABLE "${esquema}"."tarifas" (
      "id" TEXT PRIMARY KEY,
      "tienda_id" TEXT,
      "zona_id" TEXT,
      "valor_flete" DECIMAL(12, 2) NOT NULL DEFAULT 0,
      "status" "${esquema}"."estado_tarifa" NOT NULL DEFAULT 'activo'
    )
  `);
  // Dos filas historicas: una `activo` y una `inactivo`. La segunda es la que hace visible la
  // perdida de dato del `down`.
  await admin.$executeRawUnsafe(`
    INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id", "zona_id", "status")
    VALUES ('viva-activa', 't1', NULL, 'activo'), ('viva-inactiva', 't2', NULL, 'inactivo')
  `);
}

async function aplicar(admin: PrismaClient, sql: string, esquema: string): Promise<void> {
  for (const stmt of sentenciasDe(cualificar(sql, esquema))) {
    await admin.$executeRawUnsafe(stmt);
  }
}

describe("migracion drop_tarifa_status — forma en disco", () => {
  it("trae migration.sql y down.sql, y es posterior a la ultima migracion en disco", () => {
    expect(fs.existsSync(path.join(DIR, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(DIR, "down.sql"))).toBe(true);
    expect(path.basename(DIR) > "20260824180000_distrito_zona_especial").toBe(true);
  });

  // El unico assert textual sobre el UP que se permite este archivo, y no sustituye a nada: los
  // tests contra Postgres de mas abajo prueban el EFECTO. Esto solo fija que la columna se
  // suelta ANTES que el tipo, porque al reves ni siquiera llegaria a aplicarse.
  it("el up suelta la columna ANTES que el tipo", () => {
    const cuerpo = UP.split("\n")
      .filter((l) => !/^\s*--/.test(l))
      .join("\n");
    const posColumna = cuerpo.indexOf('DROP COLUMN IF EXISTS "status"');
    const posTipo = cuerpo.indexOf('DROP TYPE IF EXISTS "estado_tarifa"');
    expect(posColumna).toBeGreaterThan(-1);
    expect(posTipo).toBeGreaterThan(posColumna);
  });

  // La perdida de dato es una DECISION, no un efecto colateral: si no consta en el archivo que
  // alguien va a leer al revertir, no consta en ningun sitio util.
  it("el down declara por escrito la perdida de dato", () => {
    expect(DOWN).toMatch(/PERDIDA DE DATO/i);
    expect(DOWN).toMatch(/activo/);
  });
});

// ---------------------------------------------------------------------------------------------
// R9 — tras el UP: ni columna ni tipo, y la tabla sigue aceptando tarifas.
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)("drop_tarifa_status — tras el UP (R9)", () => {
  const esquema = `t_drop_status_up_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  let admin: PrismaClient;

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await sembrarFormaPrevia(admin, esquema);
    await aplicar(admin, UP, esquema);
  }, 60_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("`information_schema.columns` ya no lista `tarifas.status`", async () => {
    const cols = await admin.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = '${esquema}' AND table_name = 'tarifas'`,
    );
    const nombres = cols.map((c) => c.column_name);
    expect(nombres).not.toContain("status");
    // Contraprueba: la consulta SI ve la tabla. Sin esto, un esquema mal nombrado daria una
    // lista vacia y el assert de arriba pasaria sin haber comprobado nada.
    expect(nombres).toContain("valor_flete");
  });

  it("`pg_type` ya no lista el enum de estado en ese esquema", async () => {
    const tipos = await admin.$queryRawUnsafe<Array<{ typname: string }>>(
      `SELECT t.typname FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = '${esquema}'`,
    );
    expect(tipos.map((t) => t.typname)).not.toContain("estado_tarifa");
  });

  it("insertar una tarifa SIN status funciona", async () => {
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id", "valor_flete")
       VALUES ('nueva-sin-status', 't3', 4.50)`,
    );
    const [fila] = await admin.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "${esquema}"."tarifas" WHERE "id" = 'nueva-sin-status'`,
    );
    expect(fila.id).toBe("nueva-sin-status");
  });

  // El otro lado del mismo hecho: no es que `status` sea opcional, es que NO EXISTE. Un codigo
  // que se dejara sin limpiar y siguiera escribiendola falla ruidosamente, no en silencio.
  it("insertar una tarifa CON status es rechazado (la columna no existe)", async () => {
    await expect(
      admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id", "status")
         VALUES ('nueva-con-status', 't4', 'activo')`,
      ),
    ).rejects.toThrow();
  });

  it("las filas que ya existian siguen ahi (el up no borra datos)", async () => {
    const filas = await admin.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "${esquema}"."tarifas" WHERE "id" IN ('viva-activa', 'viva-inactiva')`,
    );
    expect(filas).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------
// R10 — tras el DOWN: el tipo y la columna vuelven; los valores NO.
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)("drop_tarifa_status — tras el DOWN (R10)", () => {
  const esquema = `t_drop_status_dn_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  let admin: PrismaClient;

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await sembrarFormaPrevia(admin, esquema);
    await aplicar(admin, UP, esquema);
    await aplicar(admin, DOWN, esquema);
  }, 60_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("el tipo `estado_tarifa` existe otra vez, con sus dos valores", async () => {
    const valores = await admin.$queryRawUnsafe<Array<{ enumlabel: string }>>(
      `SELECT e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = '${esquema}' AND t.typname = 'estado_tarifa'
       ORDER BY e.enumsortorder`,
    );
    expect(valores.map((v) => v.enumlabel)).toEqual(["activo", "inactivo"]);
  });

  it("la columna vuelve NOT NULL con DEFAULT 'activo'", async () => {
    const [col] = await admin.$queryRawUnsafe<
      Array<{ is_nullable: string; column_default: string | null; udt_name: string }>
    >(
      `SELECT is_nullable, column_default, udt_name FROM information_schema.columns
       WHERE table_schema = '${esquema}' AND table_name = 'tarifas' AND column_name = 'status'`,
    );
    expect(col).toBeDefined();
    expect(col.is_nullable).toBe("NO");
    expect(col.column_default).toContain("'activo'");
    expect(col.udt_name).toBe("estado_tarifa");
  });

  it("una fila que ya existia vuelve con status = 'activo'", async () => {
    const [fila] = await admin.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT "status" FROM "${esquema}"."tarifas" WHERE "id" = 'viva-activa'`,
    );
    expect(fila.status).toBe("activo");
  });

  // OJO — PERDIDA DE DATO, AFIRMADA A PROPOSITO. `viva-inactiva` entro al `up` con `inactivo` y
  // sale del `down` con `activo`: el `down` restaura la COLUMNA, no los VALORES, y no hay copia
  // en ninguna otra tabla de donde traerlos. Este test NO describe un bug: si algun dia alguien
  // consigue que vuelva como `inactivo`, habra cambiado la migracion y debe venir a leer aqui
  // (y en `down.sql`) por que se acepto la perdida — `status` nunca entro en el WHERE del camino
  // de liquidacion (deuda (g), feature 69) y la feature 70 midio CERO filas `inactivo` en
  // produccion.
  it("el DOWN NO restaura el valor 'inactivo': esa fila vuelve como 'activo'", async () => {
    const [fila] = await admin.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT "status" FROM "${esquema}"."tarifas" WHERE "id" = 'viva-inactiva'`,
    );
    expect(fila.status).not.toBe("inactivo");
    expect(fila.status).toBe("activo");
  });

  // El bloque `DO ... EXCEPTION WHEN duplicate_object` y el `IF NOT EXISTS` existen para esto:
  // un rollback que se reintenta no puede reventar por lo que ya hizo.
  it("el DOWN es idempotente: correrlo dos veces no falla", async () => {
    await expect(aplicar(admin, DOWN, esquema)).resolves.toBeUndefined();
  });

  // Y el UP, sobre una base a la que ya le falta la columna, tampoco: los `IF EXISTS` no son
  // decoracion, la base de desarrollo tiene drift y esta migracion tiene que poder aplicarse
  // sobre un esquema que ya no la tenga. Va el ULTIMO del archivo: deja el esquema sin columna.
  it("el UP es idempotente: aplicarlo dos veces no falla", async () => {
    await aplicar(admin, UP, esquema);
    await expect(aplicar(admin, UP, esquema)).resolves.toBeUndefined();
  });
});
