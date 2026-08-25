import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// Cobertura de `20260825130000_tarifas_reconciliar_par_zona_tienda`.
//
// QUE REPARA Y POR QUE EXISTE. El `.sql` de la `20260824140000_tarifa_zona_is_default` se EDITO
// despues de haberse aplicado: la base local lo corrio con una version corta (solo `ADD COLUMN
// zona_id` + `is_default`) y el commit b7bd887a le anadio la segunda mitad. Prisma registra las
// migraciones POR NOMBRE, asi que el archivo ya no se volvio a ejecutar y la base quedo sin
// `tienda_id` OPCIONAL, sin el borrado fisico y sin el unico `(zona_id, tienda_id)`. Ni
// `migrate status` ni `migrate deploy` lo denuncian: los dos responden que todo esta al dia.
//
// LO QUE ESTE ARCHIVO TIENE QUE DEMOSTRAR son las DOS caras de la migracion, porque no se sabe
// en que estado esta cada base:
//   (a) REPARA: sobre una base a medias, deja las tres cosas como la migracion original decia.
//   (b) NO HACE NADA: sobre una base ya correcta no ejecuta un solo DDL ni falla.
// La (b) no es un detalle de estilo: es la propiedad que permite desplegarla a ciegas.
//
// Se ejerce contra Postgres de verdad, en un esquema desechable, por la misma razon que el test
// de la migracion original: `NULLS NOT DISTINCT` es de las clausulas que se copian sin entender,
// y una regex sobre el SQL la da por buena mientras el indice deja entrar dos «tarifas generales
// de la tienda X».

const DIR = path.join(
  process.cwd(),
  "db",
  "migrations",
  "20260825130000_tarifas_reconciliar_par_zona_tienda",
);

/**
 * Parte el SQL en sentencias. `split(";")` a secas NO sirve: los bloques `DO $$ ... $$` llevan
 * punto y coma en el cuerpo y partir por ahi los hace pedazos que no son SQL valido. Mismo
 * criterio (y misma razon) que en `tarifa-zona-is-default-migration.test.ts`.
 */
/** El SQL sin la prosa: solo lo que Postgres va a ejecutar. */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
}

function sentenciasDe(sql: string): string[] {
  const cuerpo = sinComentarios(sql);

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

describe("migracion tarifas_reconciliar_par_zona_tienda — forma en disco", () => {
  it("trae migration.sql y down.sql, y es POSTERIOR a la migracion que repara", () => {
    expect(fs.existsSync(path.join(DIR, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(DIR, "down.sql"))).toBe(true);
    expect(path.basename(DIR) > "20260824140000_tarifa_zona_is_default").toBe(true);
  });

  // El `regclass` no es una preferencia de estilo: con `current_schema()` las guardas mirarian
  // `public` mientras el DDL toca el esquema temporal, y TODO el bloque contra Postgres de mas
  // abajo pasaria en verde sin haber ejercido nada. Si alguien lo cambia, este test lo dice.
  it("detecta el estado por regclass, no por current_schema()", () => {
    const ejecutable = fs
      .readFileSync(path.join(DIR, "migration.sql"), "utf8")
      .split("\n")
      .filter((l) => !/^\s*--/.test(l))
      .join("\n");
    expect(ejecutable).toMatch(/'"tarifas"'::regclass/);
    expect(ejecutable).not.toMatch(/current_schema\(\)/);
  });

  // Reponer `tienda_id` NOT NULL en el `down` seria un fallo, no un olvido: desde la feature 274
  // pueden existir filas con `tienda_id` NULL (nivel 3 de la cascada) y el `SET NOT NULL`
  // abortaria a mitad del rollback.
  it("el down suelta el unico y repone deleted_at, y NO vuelve a apretar tienda_id", () => {
    const down = fs.readFileSync(path.join(DIR, "down.sql"), "utf8");
    expect(down).toMatch(/DROP INDEX IF EXISTS "tarifas_zona_id_tienda_id_key"/);
    expect(down).toMatch(/ADD COLUMN IF NOT EXISTS "deleted_at"/);
    // Sobre el SQL EJECUTABLE, no sobre el archivo: la prosa del `down` menciona el
    // `SET NOT NULL` justamente para explicar por que NO lo hace, y un `toMatch` contra el
    // texto entero se lo comeria como si fuera codigo.
    expect(sinComentarios(down)).not.toMatch(/SET NOT NULL/);
  });
});

// ---------------------------------------------------------------------------------------------
// Contra Postgres real. Se reconstruye `tarifas` con la forma A MEDIAS -la que dejo la version
// corta- y se aplica el SQL del `up` tal cual, reescribiendo SOLO los identificadores de tabla
// para dirigirlo al esquema desechable. NO se usa `search_path`: el pool puede servir cada
// sentencia por una conexion distinta y el ajuste no viaja con ella (comprobado: el DDL se fue
// a `public`).
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)(
  "migracion tarifas_reconciliar_par_zona_tienda — contra Postgres",
  () => {
    const esquema = `t_reconc_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    let admin: PrismaClient;

    function upEnEsquema(): string {
      return fs
        .readFileSync(path.join(DIR, "migration.sql"), "utf8")
        .replace(/"tarifas"/g, `"${esquema}"."tarifas"`)
        .replace(/"cierre_detail"/g, `"${esquema}"."cierre_detail"`);
    }

    async function aplicarUp(): Promise<void> {
      for (const stmt of sentenciasDe(upEnEsquema())) {
        await admin.$executeRawUnsafe(stmt);
      }
    }

    beforeAll(async () => {
      admin = crearPrismaDeTest();
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
      // Forma A MEDIAS: `zona_id`/`is_default` ya estan (los trajo la version corta), pero
      // `tienda_id` sigue NOT NULL, `deleted_at` sigue viva y no hay unico.
      await admin.$executeRawUnsafe(`
        CREATE TABLE "${esquema}"."tarifas" (
          "id" TEXT PRIMARY KEY,
          "tienda_id" TEXT NOT NULL,
          "zona_id" TEXT,
          "is_default" BOOLEAN NOT NULL DEFAULT false,
          "deleted_at" TIMESTAMP(3)
        )
      `);
      // El preflight de la purga la consulta: es la FK RESTRICT que puede impedir el borrado
      // fisico. VACIA, que es el caso en que la migracion debe poder seguir adelante.
      await admin.$executeRawUnsafe(
        `CREATE TABLE "${esquema}"."cierre_detail" ("id" TEXT PRIMARY KEY, "tarifa_id" TEXT)`,
      );
      await admin.$executeRawUnsafe(`
        INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id", "zona_id", "deleted_at")
        VALUES ('viva', 't1', NULL, NULL), ('borrada', 't1', 'z1', NOW())
      `);

      await aplicarUp();
    }, 60_000);

    afterAll(async () => {
      await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
      await admin?.$disconnect();
    });

    it("`tienda_id` queda OPCIONAL", async () => {
      const [col] = await admin.$queryRawUnsafe<Array<{ is_nullable: string }>>(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = '${esquema}' AND table_name = 'tarifas' AND column_name = 'tienda_id'`,
      );
      expect(col.is_nullable).toBe("YES");
    });

    // El caso que producia el 500 en `crearTarifa`: una tarifa de zona sin tienda (nivel 3).
    it("admite una tarifa de zona SIN tienda", async () => {
      await admin.$executeRawUnsafe(
        `INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id", "zona_id")
         VALUES ('zona-sin-tienda', NULL, 'z9')`,
      );
      const [fila] = await admin.$queryRawUnsafe<Array<{ tienda_id: string | null }>>(
        `SELECT "tienda_id" FROM "${esquema}"."tarifas" WHERE "id" = 'zona-sin-tienda'`,
      );
      expect(fila.tienda_id).toBeNull();
    });

    it("la fila borrada en logico se fue, y la columna tambien", async () => {
      const filas = await admin.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "${esquema}"."tarifas" WHERE "id" = 'borrada'`,
      );
      expect(filas).toHaveLength(0);

      const cols = await admin.$queryRawUnsafe<Array<{ column_name: string }>>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = '${esquema}' AND table_name = 'tarifas'`,
      );
      expect(cols.map((c) => c.column_name)).not.toContain("deleted_at");
    });

    // Que el indice EXISTA no basta: sin `NULLS NOT DISTINCT` pasa igual de verde y deja entrar
    // dos tarifas globales o dos generales de la misma tienda. Se ejerce el rechazo de verdad.
    it("el unico trata dos NULL como el MISMO par", async () => {
      const [idx] = await admin.$queryRawUnsafe<Array<{ indexdef: string }>>(
        `SELECT indexdef FROM pg_indexes
         WHERE schemaname = '${esquema}' AND tablename = 'tarifas'
           AND indexname = 'tarifas_zona_id_tienda_id_key'`,
      );
      expect(idx.indexdef).toMatch(/NULLS NOT DISTINCT/);

      await expect(
        admin.$executeRawUnsafe(
          `INSERT INTO "${esquema}"."tarifas" ("id", "tienda_id", "zona_id")
           VALUES ('dup', NULL, 'z9')`,
        ),
      ).rejects.toThrow();
    });

    // La propiedad que permite desplegarla a ciegas: sobre una base YA correcta no hace nada.
    // Si alguna guarda se rompiera, la segunda corrida fallaria (un `CREATE UNIQUE INDEX` sin
    // condicionar choca contra el indice existente) o volveria a purgar.
    it("una SEGUNDA corrida sobre la base ya sana no falla ni cambia nada", async () => {
      const antes = await admin.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "${esquema}"."tarifas" ORDER BY "id"`,
      );

      await expect(aplicarUp()).resolves.not.toThrow();

      const despues = await admin.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "${esquema}"."tarifas" ORDER BY "id"`,
      );
      expect(despues).toEqual(antes);
    });
  },
);
