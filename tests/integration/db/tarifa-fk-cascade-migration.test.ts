import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// Cobertura de `20260826160000_tarifa_fk_cascade`: las dos FKs de `tarifas` (a `zona` y a
// `usuario`) pasan de ON DELETE RESTRICT a ON DELETE CASCADE.
//
// POR QUE ESTO NO SE PUEDE PROBAR CON UNA REGEX SOBRE EL SQL. `toMatch(/ON DELETE CASCADE/)`
// demuestra que alguien escribio la clausula, no que borrar una zona con tarifas FUNCIONE —que
// es justo lo que no funcionaba— ni, sobre todo, que la traza de auditoria siga protegida. Lo
// segundo es lo delicado: `cierre_detail.tarifa_id` sigue siendo RESTRICT a proposito, asi que
// una tarifa YA LIQUIDADA tiene que BLOQUEAR la cascada entera. Ese comportamiento es del motor
// (una cascada que choca con un restrict aguas abajo aborta la sentencia completa) y solo se
// comprueba ejecutandolo.

const DIR = path.join(process.cwd(), "db", "migrations", "20260826160000_tarifa_fk_cascade");

/**
 * Trocea el SQL en sentencias. Los comentarios se quitan ANTES de partir: la prosa de estas
 * migraciones tambien lleva punto y coma. No hace falta el interruptor de `$$` del resto de
 * tests de migracion: aqui no hay bloques `DO`.
 */
function sentenciasDe(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("migracion tarifa_fk_cascade — forma en disco", () => {
  it("trae migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(DIR, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(DIR, "down.sql"))).toBe(true);
  });

  it("el down devuelve LAS DOS FKs a RESTRICT", () => {
    const down = fs.readFileSync(path.join(DIR, "down.sql"), "utf8");
    expect(down).toMatch(
      /"tarifas_zona_id_fkey"[\s\S]*?REFERENCES "zona"\("id"\) ON DELETE RESTRICT/,
    );
    expect(down).toMatch(
      /"tarifas_tienda_id_fkey"[\s\S]*?REFERENCES "usuario"\("id"\) ON DELETE RESTRICT/,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Contra Postgres real: se levanta en un esquema desechable la forma PREVIA (ambas FKs RESTRICT),
// se comprueba que el borrado FALLA, se aplica el SQL del `up` tal cual y se comprueba que el
// mismo borrado ahora pasa y arrastra sus tarifas.
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)("migracion tarifa_fk_cascade — contra Postgres", () => {
  const esquema = `t_tarifa_cascade_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;

  /** Reinicia los datos: dos zonas, dos tiendas, una tarifa por par y `cierre_detail` vacia. */
  async function sembrar(): Promise<void> {
    await admin.$executeRawUnsafe(`DELETE FROM "${esquema}"."cierre_detail"`);
    await admin.$executeRawUnsafe(`DELETE FROM "${esquema}"."tarifas"`);
    await admin.$executeRawUnsafe(`DELETE FROM "${esquema}"."zona"`);
    await admin.$executeRawUnsafe(`DELETE FROM "${esquema}"."usuario"`);
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."zona" ("id") VALUES ('zona-1'), ('zona-2')`,
    );
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."usuario" ("id") VALUES ('tienda-1'), ('tienda-2')`,
    );
    await admin.$executeRawUnsafe(`
      INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id", "zona_id") VALUES
        ('t-z1', 'tienda-1', 'zona-1'),
        ('t-z2', 'tienda-2', 'zona-2')
    `);
  }

  async function idsDeTarifas(): Promise<string[]> {
    const filas = await admin.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "${esquema}"."tarifas" ORDER BY "id"`,
    );
    return filas.map((f) => f.id);
  }

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
    await admin.$executeRawUnsafe(`CREATE TABLE "${esquema}"."zona" ("id" TEXT PRIMARY KEY)`);
    await admin.$executeRawUnsafe(`CREATE TABLE "${esquema}"."usuario" ("id" TEXT PRIMARY KEY)`);
    await admin.$executeRawUnsafe(`
      CREATE TABLE "${esquema}"."tarifas" (
        "id" TEXT PRIMARY KEY,
        "tienda_id" TEXT,
        "zona_id" TEXT
      )
    `);
    // Forma PREVIA de las FKs: RESTRICT en las dos.
    await admin.$executeRawUnsafe(`
      ALTER TABLE "${esquema}"."tarifas" ADD CONSTRAINT "tarifas_zona_id_fkey"
        FOREIGN KEY ("zona_id") REFERENCES "${esquema}"."zona"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await admin.$executeRawUnsafe(`
      ALTER TABLE "${esquema}"."tarifas" ADD CONSTRAINT "tarifas_tienda_id_fkey"
        FOREIGN KEY ("tienda_id") REFERENCES "${esquema}"."usuario"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    // `cierre_detail` con su FK RESTRICT a `tarifas`: la traza de auditoria que la cascada NO
    // debe poder atropellar (feature 69/R8).
    await admin.$executeRawUnsafe(`
      CREATE TABLE "${esquema}"."cierre_detail" (
        "id" TEXT PRIMARY KEY,
        "tarifa_id" TEXT REFERENCES "${esquema}"."tarifas"("id") ON DELETE RESTRICT
      )
    `);
    await sembrar();
  }, 60_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  // El bug que se esta arreglando, medido ANTES de aplicar la migracion. Sin este test, los de
  // abajo demostrarian que CASCADE funciona pero no que hubiera nada que arreglar.
  it("ANTES: borrar una zona con tarifas es rechazado por la FK", async () => {
    await expect(
      admin.$executeRawUnsafe(`DELETE FROM "${esquema}"."zona" WHERE "id" = 'zona-1'`),
    ).rejects.toThrow();
    expect(await idsDeTarifas()).toEqual(["t-z1", "t-z2"]);
  });

  it("aplica el SQL real del up y deja las dos FKs en CASCADE", async () => {
    const up = fs
      .readFileSync(path.join(DIR, "migration.sql"), "utf8")
      .replace(/"tarifas"/g, `"${esquema}"."tarifas"`)
      .replace(/REFERENCES "zona"/g, `REFERENCES "${esquema}"."zona"`)
      .replace(/REFERENCES "usuario"/g, `REFERENCES "${esquema}"."usuario"`);
    for (const stmt of sentenciasDe(up)) {
      await admin.$executeRawUnsafe(stmt);
    }

    // `confdeltype` = 'c' es CASCADE, 'r' es RESTRICT (pg_constraint).
    const fks = await admin.$queryRawUnsafe<Array<{ conname: string; del: string }>>(
      `SELECT conname, confdeltype::text AS del FROM pg_constraint
       WHERE conrelid = '${esquema}.tarifas'::regclass AND contype = 'f' ORDER BY conname`,
    );
    expect(fks).toEqual([
      { conname: "tarifas_tienda_id_fkey", del: "c" },
      { conname: "tarifas_zona_id_fkey", del: "c" },
    ]);
  });

  it("DESPUES: borrar la zona se lleva SUS tarifas y no toca las de otra zona", async () => {
    await sembrar();
    await admin.$executeRawUnsafe(`DELETE FROM "${esquema}"."zona" WHERE "id" = 'zona-1'`);
    expect(await idsDeTarifas()).toEqual(["t-z2"]);
  });

  it("DESPUES: borrar la tienda se lleva SUS tarifas", async () => {
    await sembrar();
    await admin.$executeRawUnsafe(`DELETE FROM "${esquema}"."usuario" WHERE "id" = 'tienda-1'`);
    expect(await idsDeTarifas()).toEqual(["t-z2"]);
  });

  // La razon por la que este CASCADE no borra auditoria: si la tarifa ya se liquido, el RESTRICT
  // de `cierre_detail` aborta la sentencia ENTERA. La zona sigue viva y la tarifa tambien.
  it("una tarifa ya liquidada BLOQUEA la cascada: no se borra ni la zona ni la tarifa", async () => {
    await sembrar();
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."cierre_detail" ("id", "tarifa_id") VALUES ('cd-1', 't-z1')`,
    );

    await expect(
      admin.$executeRawUnsafe(`DELETE FROM "${esquema}"."zona" WHERE "id" = 'zona-1'`),
    ).rejects.toThrow();

    expect(await idsDeTarifas()).toEqual(["t-z1", "t-z2"]);
    const zonas = await admin.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "${esquema}"."zona" WHERE "id" = 'zona-1'`,
    );
    expect(zonas).toHaveLength(1);
  });

  it("el down.sql devuelve las FKs a RESTRICT y el borrado vuelve a fallar", async () => {
    await admin.$executeRawUnsafe(`DELETE FROM "${esquema}"."cierre_detail"`);
    await sembrar();
    const down = fs
      .readFileSync(path.join(DIR, "down.sql"), "utf8")
      .replace(/"tarifas"/g, `"${esquema}"."tarifas"`)
      .replace(/REFERENCES "zona"/g, `REFERENCES "${esquema}"."zona"`)
      .replace(/REFERENCES "usuario"/g, `REFERENCES "${esquema}"."usuario"`);
    for (const stmt of sentenciasDe(down)) {
      await admin.$executeRawUnsafe(stmt);
    }

    await expect(
      admin.$executeRawUnsafe(`DELETE FROM "${esquema}"."zona" WHERE "id" = 'zona-1'`),
    ).rejects.toThrow();
  });
});
