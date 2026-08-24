import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  crearPrismaDeTestEnEsquema,
} from "./_postgres-real";

// Cobertura de `20260824140000_tarifa_zona_is_default`. La migracion hace CUATRO cosas y las
// cuatro se ejercen aqui:
//   1. `zona_id` OPCIONAL vuelve a `tarifas` (la `20260712100000` la habia soltado).
//   2. `is_default` nace con DEFAULT false pero TODAS las filas existentes se backfillean a true.
//   3. `tienda_id` pasa a OPCIONAL y el borrado de la tabla pasa a ser FISICO (`deleted_at` se va,
//      y con ella las filas que estaban borradas en logico).
//   4. Nace el unico `(zona_id, tienda_id)` con NULLS NOT DISTINCT.
//
// POR QUE ESTE ARCHIVO NO SE CONFORMA CON REGEX SOBRE EL SQL. Un `expect(sql).toMatch(/UPDATE/)`
// demuestra que alguien ESCRIBIO la linea del backfill, no que una fila que ya existia acabe en
// `true` mientras una insertada DESPUES acaba en `false`. Lo mismo vale, y mas fuerte, para
// `NULLS NOT DISTINCT`: la clausula es de las que se copian sin entender, y sin ella el unico
// pasa igual de verde en una regex mientras deja entrar dos "tarifas generales de la tienda X".
// Todo eso se ejerce contra Postgres de verdad, en un esquema desechable.

const DIR = path.join(process.cwd(), "db", "migrations", "20260824140000_tarifa_zona_is_default");

/**
 * Parte el SQL en sentencias. `split(";")` a secas NO sirve: los preflight de esta migracion son
 * bloques `DO $$ ... $$` cuyo CUERPO lleva punto y coma, y partir por ahi los hace pedazos que no
 * son SQL valido. Se lleva un interruptor de "dentro de $$" y solo se corta fuera.
 * Los comentarios se quitan ANTES de partir: la prosa de esta migracion tambien tiene `;`.
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

describe("migracion tarifa_zona_is_default — forma en disco", () => {
  it("trae migration.sql y down.sql, y es posterior a la que solto zona_id", () => {
    expect(fs.existsSync(path.join(DIR, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(DIR, "down.sql"))).toBe(true);
    expect(path.basename(DIR) > "20260712100000_tarifa_tienda_status").toBe(true);
  });

  it("el down deshace las cuatro cosas y es idempotente donde puede serlo", () => {
    const down = fs.readFileSync(path.join(DIR, "down.sql"), "utf8");
    expect(down).toMatch(/DROP COLUMN IF EXISTS "zona_id"/);
    expect(down).toMatch(/DROP COLUMN IF EXISTS "is_default"/);
    expect(down).toMatch(/DROP CONSTRAINT IF EXISTS "tarifas_zona_id_fkey"/);
    expect(down).toMatch(/DROP INDEX IF EXISTS "tarifas_zona_id_idx"/);
    expect(down).toMatch(/DROP INDEX IF EXISTS "tarifas_zona_id_tienda_id_key"/);
    expect(down).toMatch(/ADD COLUMN IF NOT EXISTS "deleted_at"/);
    expect(down).toMatch(/ALTER COLUMN "tienda_id" SET NOT NULL/);
  });

  // El `NULLS NOT DISTINCT` se comprueba de verdad contra Postgres mas abajo; aqui solo se fija
  // que el indice NO sea parcial. Un `WHERE deleted_at IS NULL` seria coherente con el soft
  // delete que esta misma migracion RETIRA, asi que dejarlo colado significaria que alguien
  // revirtio media decision.
  it("el unico no es parcial (la tabla ya no borra en logico)", () => {
    const up = fs.readFileSync(path.join(DIR, "migration.sql"), "utf8");
    const creacion = up.slice(up.indexOf('CREATE UNIQUE INDEX "tarifas_zona_id_tienda_id_key"'));
    expect(creacion).toMatch(/NULLS NOT DISTINCT/);
    expect(creacion).not.toMatch(/WHERE/i);
  });
});

// ---------------------------------------------------------------------------------------------
// Contra Postgres real: se reconstruye `tarifas` en un esquema desechable con la forma PREVIA a
// esta migracion, se siembran las filas historicas, se aplica el SQL del `up` tal cual y se
// comprueba el estado resultante.
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)("migracion tarifa_zona_is_default — contra Postgres", () => {
  const esquema = `t_tarifa_zona_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;
  let prisma: PrismaClient;

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
    // Forma PREVIA de la tabla, reducida a lo que esta migracion necesita tocar.
    await admin.$executeRawUnsafe(`
      CREATE TABLE "${esquema}"."tarifas" (
        "id" TEXT PRIMARY KEY,
        "tienda_id" TEXT NOT NULL,
        "deleted_at" TIMESTAMP
      )
    `);
    await admin.$executeRawUnsafe(`CREATE TABLE "${esquema}"."zona" ("id" TEXT PRIMARY KEY)`);
    await admin.$executeRawUnsafe(`INSERT INTO "${esquema}"."zona" ("id") VALUES ('zona-1')`);
    // `cierre_detail` existe porque el preflight de la purga la consulta: es la tabla que puede
    // impedir el borrado fisico (FK RESTRICT sobre `tarifa_id`). Aqui se crea VACIA, que es el
    // caso en que la migracion debe poder seguir adelante.
    await admin.$executeRawUnsafe(
      `CREATE TABLE "${esquema}"."cierre_detail" ("id" TEXT PRIMARY KEY, "tarifa_id" TEXT)`,
    );
    // Dos filas historicas: una viva y una borrada logicamente. La borrada es la que la purga
    // debe hacer desaparecer.
    await admin.$executeRawUnsafe(`
      INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id", "deleted_at")
      VALUES ('vieja-viva', 't1', NULL), ('vieja-borrada', 't1', NOW())
    `);

    // El SQL REAL de la migracion, cualificado al esquema temporal. NO se usa `search_path`: el
    // pool puede servir cada sentencia por una conexion distinta y el ajuste no viaja con ella.
    // Se reescriben SOLO los identificadores de tabla; el resto del SQL (incluidos el backfill,
    // los preflight y el unico) se ejecuta tal cual.
    const up = fs
      .readFileSync(path.join(DIR, "migration.sql"), "utf8")
      .replace(/"tarifas"/g, `"${esquema}"."tarifas"`)
      .replace(/"cierre_detail"/g, `"${esquema}"."cierre_detail"`)
      .replace(/REFERENCES "zona"/g, `REFERENCES "${esquema}"."zona"`);
    for (const stmt of sentenciasDe(up)) {
      await admin.$executeRawUnsafe(stmt);
    }

    prisma = crearPrismaDeTestEnEsquema(esquema);
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("el backfill deja en true la fila que ya existia", async () => {
    const filas = await admin.$queryRawUnsafe<Array<{ id: string; is_default: boolean }>>(
      `SELECT "id", "is_default" FROM "${esquema}"."tarifas" ORDER BY "id"`,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].id).toBe("vieja-viva");
    expect(filas[0].is_default).toBe(true);
  });

  // El corazon del hard delete: la fila borrada en logico NO quedo "marcada", quedo FUERA. Con el
  // conteo de arriba solo, un `deleted_at` que sobreviviera vacio pasaria desapercibido.
  it("la fila que estaba borrada en logico ya no existe, y la columna tampoco", async () => {
    const filas = await admin.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "${esquema}"."tarifas" WHERE "id" = 'vieja-borrada'`,
    );
    expect(filas).toHaveLength(0);

    const cols = await admin.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = '${esquema}' AND table_name = 'tarifas'`,
    );
    expect(cols.map((c) => c.column_name)).not.toContain("deleted_at");
  });

  it("las filas historicas quedan SIN zona (la columna nace vacia, sin backfill)", async () => {
    const filas = await admin.$queryRawUnsafe<Array<{ zona_id: string | null }>>(
      `SELECT "zona_id" FROM "${esquema}"."tarifas"`,
    );
    expect(filas.every((f) => f.zona_id === null)).toBe(true);
  });

  // La diferencia que importa: el DEFAULT es para lo NUEVO, el backfill fue para lo VIEJO.
  // Va con OTRA tienda porque `(NULL, 't1')` ya lo ocupa `vieja-viva` y el unico lo rechazaria.
  it("una fila insertada DESPUES cae en false por el DEFAULT de la columna", async () => {
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id") VALUES ('nueva', 't2')`,
    );
    const [fila] = await admin.$queryRawUnsafe<Array<{ is_default: boolean }>>(
      `SELECT "is_default" FROM "${esquema}"."tarifas" WHERE "id" = 'nueva'`,
    );
    expect(fila.is_default).toBe(false);
  });

  it("`zona_id` admite NULL y tambien una zona real", async () => {
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id", "zona_id") VALUES ('con-zona', 't1', 'zona-1')`,
    );
    const [fila] = await admin.$queryRawUnsafe<Array<{ zona_id: string | null }>>(
      `SELECT "zona_id" FROM "${esquema}"."tarifas" WHERE "id" = 'con-zona'`,
    );
    expect(fila.zona_id).toBe("zona-1");
  });

  // La FK es RESTRICT: no se puede referenciar una zona que no existe.
  it("una zona inexistente es rechazada por la FK", async () => {
    await expect(
      admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id", "zona_id") VALUES ('mala', 't1', 'no-existe')`,
      ),
    ).rejects.toThrow();
  });

  it("el indice `tarifas_zona_id_idx` existe en la tabla", async () => {
    const idx = await admin.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = '${esquema}' AND tablename = 'tarifas'`,
    );
    expect(idx.map((i) => i.indexname)).toContain("tarifas_zona_id_idx");
  });

  it("`tienda_id` admite NULL (tarifa no acotada a ninguna tienda)", async () => {
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."tarifas" ("id", "zona_id") VALUES ('global', NULL)`,
    );
    const [fila] = await admin.$queryRawUnsafe<Array<{ tienda_id: string | null }>>(
      `SELECT "tienda_id" FROM "${esquema}"."tarifas" WHERE "id" = 'global'`,
    );
    expect(fila.tienda_id).toBeNull();
  });

  describe("el unico (zona_id, tienda_id)", () => {
    it("rechaza repetir el par con las dos columnas con valor", async () => {
      // 'con-zona' ya ocupa ('zona-1', 't1').
      await expect(
        admin.$executeRawUnsafe(
          `INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id", "zona_id") VALUES ('choca', 't1', 'zona-1')`,
        ),
      ).rejects.toThrow();
    });

    // ESTE es el test que justifica `NULLS NOT DISTINCT`. Con la semantica por defecto de
    // Postgres (dos NULL son distintos) este INSERT PASARIA, y la tienda 't1' acabaria con dos
    // "tarifas generales" sin forma de saber cual aplica. Si alguien quita la clausula, el
    // unico sigue existiendo, el resto de tests sigue verde y solo cae este.
    it("rechaza dos tarifas generales de la MISMA tienda (zona NULL en ambas)", async () => {
      // 'vieja-viva' ya ocupa (NULL, 't1').
      await expect(
        admin.$executeRawUnsafe(
          `INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id") VALUES ('otra-general', 't1')`,
        ),
      ).rejects.toThrow();
    });

    it("rechaza dos tarifas globales (las DOS columnas NULL)", async () => {
      // 'global' ya ocupa (NULL, NULL).
      await expect(
        admin.$executeRawUnsafe(
          `INSERT INTO "${esquema}"."tarifas" ("id") VALUES ('otra-global')`,
        ),
      ).rejects.toThrow();
    });

    // El unico es TOTAL, no parcial: la contrapartida del borrado fisico es que borrar libera
    // el par de inmediato. Sin hard delete esto seria imposible, y por eso van juntos.
    it("borrar una tarifa LIBERA su par y se puede volver a crear", async () => {
      await admin.$executeRawUnsafe(
        `DELETE FROM "${esquema}"."tarifas" WHERE "id" = 'con-zona'`,
      );
      await admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id", "zona_id") VALUES ('recreada', 't1', 'zona-1')`,
      );
      const filas = await admin.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "${esquema}"."tarifas" WHERE "id" = 'recreada'`,
      );
      expect(filas).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Los preflight. Son la parte de la migracion que solo se ve cuando los datos NO estan limpios, y
// justamente por eso es donde un error se descubre en produccion. Cada uno corre en su propio
// esquema, sembrado a proposito con el dato que debe hacerlo abortar.
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)("tarifa_zona_is_default — los preflight abortan", () => {
  const up = fs.readFileSync(path.join(DIR, "migration.sql"), "utf8");

  async function aplicarEn(
    admin: PrismaClient,
    esquema: string,
    sembrar: (admin: PrismaClient) => Promise<void>,
  ) {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
    await admin.$executeRawUnsafe(`
      CREATE TABLE "${esquema}"."tarifas" (
        "id" TEXT PRIMARY KEY,
        "tienda_id" TEXT NOT NULL,
        "deleted_at" TIMESTAMP
      )
    `);
    await admin.$executeRawUnsafe(`CREATE TABLE "${esquema}"."zona" ("id" TEXT PRIMARY KEY)`);
    await admin.$executeRawUnsafe(
      `CREATE TABLE "${esquema}"."cierre_detail" ("id" TEXT PRIMARY KEY, "tarifa_id" TEXT)`,
    );
    await sembrar(admin);

    const sql = up
      .replace(/"tarifas"/g, `"${esquema}"."tarifas"`)
      .replace(/"cierre_detail"/g, `"${esquema}"."cierre_detail"`)
      .replace(/REFERENCES "zona"/g, `REFERENCES "${esquema}"."zona"`);
    for (const stmt of sentenciasDe(sql)) {
      await admin.$executeRawUnsafe(stmt);
    }
  }

  it("aborta si una tarifa borrada esta congelada en un cierre, y NO la borra", async () => {
    const admin = crearPrismaDeTest();
    const esquema = `t_pf_cierre_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    try {
      await expect(
        aplicarEn(admin, esquema, async (a) => {
          await a.$executeRawUnsafe(`
            INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id", "deleted_at")
            VALUES ('borrada-liquidada', 't1', NOW())
          `);
          await a.$executeRawUnsafe(`
            INSERT INTO "${esquema}"."cierre_detail" ("id", "tarifa_id")
            VALUES ('cd-1', 'borrada-liquidada')
          `);
        }),
      ).rejects.toThrow(/referenciadas por cierre_detail/i);

      // Lo que de verdad importa: aborto sin llevarse el dato por delante.
      const filas = await admin.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "${esquema}"."tarifas"`,
      );
      expect(filas).toHaveLength(1);
    } finally {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
      await admin.$disconnect();
    }
  }, 60_000);

  it("aborta con un mensaje propio si hay pares (zona, tienda) repetidos", async () => {
    const admin = crearPrismaDeTest();
    const esquema = `t_pf_dup_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    try {
      await expect(
        aplicarEn(admin, esquema, async (a) => {
          // Dos tarifas VIVAS de la misma tienda sin zona: hasta hoy legal, con el unico ya no.
          await a.$executeRawUnsafe(`
            INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id", "deleted_at")
            VALUES ('a', 't1', NULL), ('b', 't1', NULL)
          `);
        }),
      ).rejects.toThrow(/repetidos/i);
    } finally {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
      await admin.$disconnect();
    }
  }, 60_000);
});
