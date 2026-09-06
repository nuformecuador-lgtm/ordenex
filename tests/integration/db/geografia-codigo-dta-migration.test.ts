import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// FICHA 375 — cobertura de `20260907120000_geografia_codigo_dta`.
//
// POR QUE ESTO NO PUEDE SER UN REGEX SOBRE EL SQL. Lo que hay que demostrar son HECHOS DEL MOTOR:
// que el backfill pone EL codigo que toca en CADA fila —incluidos los tres cantones donde la
// numeracion oficial SALTA un codigo—, que una fila que el .xlsx no nombra se queda en NULL (y no
// con un codigo inventado), que el indice unico rechaza el repetido PERO admite tantos NULL como
// haga falta, y que el `down` suelta columnas e indices sin borrar ni tocar una sola fila.
// Un `toMatch(/codigo_dta/)` se satisface escribiendo la palabra.
//
// COMO SE MIDE. En un esquema desechable se reconstruyen las tres tablas en su forma PREVIA a esta
// ficha (con `activo` y los tres UNIQUE de nombre, sin `codigo_dta`), se siembran ternas REALES de
// la DTA —elegidas por ser las dificiles: las tres de los huecos y las tres que la 374 añadio— y
// encima se aplica el SQL REAL leido de disco, solo cualificado al esquema temporal.
//
// ⚠️ NINGUN `if (!fila) return;`: si el corpus no llegara a la base, los casos REVIENTAN con
// mensaje en vez de reportar `passed` por ausencia. Hay un caso de ANTI-VACUIDAD explicito.

const ROOT = process.cwd();
const MIGRACIONES = path.join(ROOT, "db", "migrations");
const DIR_ESTA = "20260907120000_geografia_codigo_dta";

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
  "provincia_codigo_dta_key",
  "canton_codigo_dta_key",
  "distrito_codigo_dta_key",
] as const;

/**
 * Cualifica al esquema desechable las TABLAS y —solo en el `DROP`— los INDICES.
 *
 * ⚠️ LA ASIMETRIA NO ES UN DESCUIDO (misma razon que en `geografia-activo-migration`):
 * `CREATE INDEX` NO admite un nombre cualificado, mientras que `DROP INDEX` sin cualificar
 * buscaria por el `search_path` — o sea, en `public`, donde estos tres indices EXISTEN DE VERDAD.
 * Un test que soltara los indices reales seria mucho peor que un test rojo.
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

/** Solo los tres `UPDATE` del backfill: sirven para probar que re-aplicarlos no pisa nada. */
function soloBackfill(sql: string, esquema: string): string[] {
  return sentencias(cualificar(sql, esquema)).filter((s) => /^UPDATE\b/i.test(s));
}

/** La forma PREVIA a la ficha 375: con `activo` y los UNIQUE de nombre, SIN `codigo_dta`. */
async function crearEsquemaPrevio(admin: PrismaClient, esquema: string): Promise<void> {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
  const ddl = [
    `CREATE TABLE "${esquema}"."provincia" (
       "id" TEXT PRIMARY KEY,
       "nombre" TEXT NOT NULL,
       "activo" BOOLEAN NOT NULL DEFAULT true)`,
    `CREATE UNIQUE INDEX "provincia_nombre_key" ON "${esquema}"."provincia" ("nombre")`,
    `CREATE TABLE "${esquema}"."canton" (
       "id" TEXT PRIMARY KEY,
       "provincia_id" TEXT NOT NULL REFERENCES "${esquema}"."provincia"("id"),
       "nombre" TEXT NOT NULL,
       "activo" BOOLEAN NOT NULL DEFAULT true)`,
    `CREATE UNIQUE INDEX "canton_provincia_id_nombre_key" ON "${esquema}"."canton" ("provincia_id","nombre")`,
    `CREATE TABLE "${esquema}"."distrito" (
       "id" TEXT PRIMARY KEY,
       "canton_id" TEXT NOT NULL REFERENCES "${esquema}"."canton"("id"),
       "nombre" TEXT NOT NULL,
       "zona_especial" BOOLEAN DEFAULT false,
       "activo" BOOLEAN NOT NULL DEFAULT true)`,
    `CREATE UNIQUE INDEX "distrito_canton_id_nombre_key" ON "${esquema}"."distrito" ("canton_id","nombre")`,
  ];
  for (const stmt of ddl) await admin.$executeRawUnsafe(stmt);
}

/**
 * El corpus: ternas REALES de la DTA, elegidas por ser las que un backfill descuidado se come.
 *
 *   * los TRES huecos documentados en `public/geografia-cr-completa-NOTAS.md` (Grecia salta el
 *     20306, el canton Puntarenas el 60109, Golfito el 60702);
 *   * los TRES distritos que la migracion de la DTA 2026 añadio (Cabagra, Pijije, Duacari), que
 *     son los codigos que el encargo trae verificados;
 *   * y una terna INVENTADA que el .xlsx no nombra, para comprobar que se queda en NULL.
 */
const PROVINCIAS: [string, string][] = [
  ["p_alajuela", "Alajuela"],
  ["p_guanacaste", "Guanacaste"],
  ["p_puntarenas", "Puntarenas"],
  ["p_limon", "Limón"],
  ["p_inventada", "Territorio Inventado"],
];

const CANTONES: [string, string, string][] = [
  ["c_grecia", "p_alajuela", "Grecia"],
  ["c_bagaces", "p_guanacaste", "Bagaces"],
  ["c_puntarenas", "p_puntarenas", "Puntarenas"],
  ["c_buenosaires", "p_puntarenas", "Buenos Aires"],
  ["c_golfito", "p_puntarenas", "Golfito"],
  ["c_guacimo", "p_limon", "Guácimo"],
  ["c_inventado", "p_inventada", "Canton Inventado"],
];

const DISTRITOS: [string, string, string][] = [
  ["d_tacares", "c_grecia", "Tacares"],
  ["d_puente", "c_grecia", "Puente de Piedra"],
  ["d_bolivar", "c_grecia", "Bolívar"],
  ["d_pijije", "c_bagaces", "Pijije"],
  ["d_barranca", "c_puntarenas", "Barranca"],
  ["d_isla", "c_puntarenas", "Isla del Coco"],
  ["d_cabagra", "c_buenosaires", "Cabagra"],
  ["d_golfito", "c_golfito", "Golfito"],
  ["d_guaycara", "c_golfito", "Guaycará"],
  ["d_pavon", "c_golfito", "Pavón"],
  ["d_duacari", "c_guacimo", "Duacarí"],
  ["d_inventado", "c_inventado", "Distrito Inventado"],
];

function valores(filas: string[][]): string {
  return filas.map((f) => `(${f.map((v) => `'${v.replace(/'/g, "''")}'`).join(",")})`).join(",");
}

async function sembrar(admin: PrismaClient, esquema: string): Promise<void> {
  await admin.$executeRawUnsafe(
    `INSERT INTO "${esquema}"."provincia" ("id","nombre") VALUES ${valores(PROVINCIAS.map((p) => [...p]))}`,
  );
  await admin.$executeRawUnsafe(
    `INSERT INTO "${esquema}"."canton" ("id","provincia_id","nombre") VALUES ${valores(
      CANTONES.map((c) => [...c]),
    )}`,
  );
  await admin.$executeRawUnsafe(
    `INSERT INTO "${esquema}"."distrito" ("id","canton_id","nombre") VALUES ${valores(
      DISTRITOS.map((d) => [...d]),
    )}`,
  );
}

async function codigos(
  admin: PrismaClient,
  esquema: string,
  tabla: string,
): Promise<Record<string, string | null>> {
  const filas = await admin.$queryRawUnsafe<{ id: string; codigo_dta: string | null }[]>(
    `SELECT "id", "codigo_dta" FROM "${esquema}"."${tabla}" ORDER BY "id"`,
  );
  return Object.fromEntries(filas.map((f) => [f.id, f.codigo_dta]));
}

async function conteos(
  admin: PrismaClient,
  esquema: string,
): Promise<{ p: number; c: number; d: number }> {
  const [fila] = await admin.$queryRawUnsafe<{ p: number; c: number; d: number }[]>(
    `SELECT (SELECT COUNT(*)::int FROM "${esquema}"."provincia") AS p,
            (SELECT COUNT(*)::int FROM "${esquema}"."canton")    AS c,
            (SELECT COUNT(*)::int FROM "${esquema}"."distrito")  AS d`,
  );
  return fila;
}

// ---------------------------------------------------------------------------------------------
// Estatico: corre SIEMPRE, tambien en un arbol sin `DATABASE_URL`.
// ---------------------------------------------------------------------------------------------

describe("375 — migracion geografia_codigo_dta: forma en disco", () => {
  it("trae migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"))).toBe(true);
  });

  it("el backfill trae las 585 filas de la DTA: 7 provincias, 84 cantones y 494 distritos", () => {
    const ejecutable = soloEjecutable(upSql);
    // Las tuplas del `VALUES` por su forma: `('…','…')` de 2, 3 o 4 campos.
    const deProvincia = ejecutable.match(/^\s*\('[^']*', '\d'\),?$/gm) ?? [];
    const deCanton = ejecutable.match(/^\s*\('[^']*', '[^']*', '\d{3}'\),?$/gm) ?? [];
    const deDistrito = ejecutable.match(/^\s*\('[^']*', '[^']*', '[^']*', '\d{5}'\),?$/gm) ?? [];
    expect(deProvincia).toHaveLength(7);
    expect(deCanton).toHaveLength(84);
    expect(deDistrito).toHaveLength(494);
  });

  it("⭑ los TRES huecos de la numeracion oficial estan respetados en el SQL, literalmente", () => {
    // Es la trampa del encargo: una derivacion secuencial saldria mal a partir de cada hueco.
    // Se afirma sobre el texto del `VALUES`, que es el dato que se va a escribir.
    const ejecutable = soloEjecutable(upSql);
    // Grecia salta el 20306 (Rio Cuarto se hizo canton).
    expect(ejecutable).toContain("('Alajuela', 'Grecia', 'Tacares', '20305')");
    expect(ejecutable).toContain("('Alajuela', 'Grecia', 'Puente de Piedra', '20307')");
    expect(ejecutable).not.toContain("'20306'");
    // El canton Puntarenas salta el 60109 (Monteverde se hizo canton).
    expect(ejecutable).toContain("('Puntarenas', 'Puntarenas', 'Barranca', '60108')");
    expect(ejecutable).toContain("('Puntarenas', 'Puntarenas', 'Isla del Coco', '60110')");
    expect(ejecutable).not.toContain("'60109'");
    // Golfito salta el 60702 (Puerto Jimenez se hizo canton).
    expect(ejecutable).toContain("('Puntarenas', 'Golfito', 'Golfito', '60701')");
    expect(ejecutable).toContain("('Puntarenas', 'Golfito', 'Guaycará', '60703')");
    expect(ejecutable).not.toContain("'60702'");
  });

  it("los codigos verificados del encargo estan tal cual", () => {
    const ejecutable = soloEjecutable(upSql);
    expect(ejecutable).toContain("('Puntarenas', 'Buenos Aires', 'Cabagra', '60310')");
    expect(ejecutable).toContain("('Guanacaste', 'Bagaces', 'Pijije', '50405')");
    expect(ejecutable).toContain("('Limón', 'Guácimo', 'Duacarí', '70605')");
    expect(ejecutable).toContain("('Puntarenas', '6')");
    expect(ejecutable).toContain("('Puntarenas', 'Buenos Aires', '603')");
  });

  it("ningun codigo se repite dentro de cada nivel", () => {
    const ejecutable = soloEjecutable(upSql);
    const deDistrito = (ejecutable.match(/'(\d{5})'\)/g) ?? []).map((s) => s.slice(1, 6));
    expect(deDistrito).toHaveLength(494);
    expect(new Set(deDistrito).size).toBe(494);
    const deCanton = (ejecutable.match(/'(\d{3})'\)/g) ?? []).map((s) => s.slice(1, 4));
    expect(new Set(deCanton).size).toBe(deCanton.length);
  });

  it("el up NO borra filas: ni un DELETE, ni un TRUNCATE, ni un DROP TABLE", () => {
    const ejecutable = soloEjecutable(upSql);
    expect(ejecutable).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
  });

  it("el down solo suelta indices y columnas: ni un DELETE, ni un UPDATE, ni un TRUNCATE", () => {
    const ejecutable = soloEjecutable(downSql);
    expect(ejecutable).not.toMatch(/\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b/i);
    expect(ejecutable).toMatch(/DROP COLUMN IF EXISTS "codigo_dta"/);
  });
});

// ---------------------------------------------------------------------------------------------
// Contra Postgres real: el up sobre filas que YA existian.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("375 — el up del backfill, contra Postgres", () => {
  const esquema = `t_375_up_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;
  let antes = { p: 0, c: 0, d: 0 };

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await crearEsquemaPrevio(admin, esquema);
    await sembrar(admin, esquema);
    antes = await conteos(admin, esquema);
    await aplicar(admin, upSql, esquema);
  }, 180_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("ANTI-VACUIDAD: el corpus llego a la base", () => {
    // Sin esto, todo lo de abajo podria estar verde sobre tablas vacias.
    expect(antes).toEqual({
      p: PROVINCIAS.length,
      c: CANTONES.length,
      d: DISTRITOS.length,
    });
  });

  it("las tres tablas ganan `codigo_dta` NULLABLE, sin default", async () => {
    const filas = await admin.$queryRawUnsafe<
      { table_name: string; is_nullable: string; column_default: string | null }[]
    >(
      `SELECT table_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND column_name = 'codigo_dta'
        ORDER BY table_name`,
      esquema,
    );
    expect(filas.map((f) => f.table_name)).toEqual(["canton", "distrito", "provincia"]);
    for (const fila of filas) {
      // NULLABLE a proposito, al reves que `activo`: un nodo creado a mano no tiene codigo oficial
      // hasta que el IGN se lo asigne, y un NOT NULL obligaria a inventarlo.
      expect(fila.is_nullable, `${fila.table_name}.codigo_dta no es nullable`).toBe("YES");
      expect(fila.column_default, `${fila.table_name}.codigo_dta tiene default`).toBeNull();
    }
  });

  it("las 7 provincias reales quedan con su codigo de un digito", async () => {
    const c = await codigos(admin, esquema, "provincia");
    expect(c["p_alajuela"]).toBe("2");
    expect(c["p_guanacaste"]).toBe("5");
    expect(c["p_puntarenas"]).toBe("6");
    expect(c["p_limon"]).toBe("7");
  });

  it("los cantones quedan con el codigo de su provincia + dos digitos", async () => {
    const c = await codigos(admin, esquema, "canton");
    expect(c["c_grecia"]).toBe("203");
    expect(c["c_bagaces"]).toBe("504");
    expect(c["c_puntarenas"]).toBe("601");
    expect(c["c_buenosaires"]).toBe("603");
    expect(c["c_golfito"]).toBe("607");
    expect(c["c_guacimo"]).toBe("706");
  });

  it("⭑ los distritos de los TRES huecos reciben el codigo SALTADO, no el secuencial", async () => {
    const d = await codigos(admin, esquema, "distrito");
    // Grecia: 20306 no existe (Rio Cuarto se hizo canton).
    expect(d["d_tacares"]).toBe("20305");
    expect(d["d_puente"]).toBe("20307");
    expect(d["d_bolivar"]).toBe("20308");
    // Canton Puntarenas: 60109 no existe (Monteverde se hizo canton).
    expect(d["d_barranca"]).toBe("60108");
    expect(d["d_isla"]).toBe("60110");
    // Golfito: 60702 no existe (Puerto Jimenez se hizo canton).
    expect(d["d_golfito"]).toBe("60701");
    expect(d["d_guaycara"]).toBe("60703");
    expect(d["d_pavon"]).toBe("60704");
  });

  it("los tres distritos que añadio la DTA 2026 reciben el codigo verificado", async () => {
    const d = await codigos(admin, esquema, "distrito");
    expect(d["d_cabagra"]).toBe("60310");
    expect(d["d_pijije"]).toBe("50405");
    expect(d["d_duacari"]).toBe("70605");
  });

  it("⭑ lo que el .xlsx NO nombra se queda en NULL, no con un codigo inventado", async () => {
    expect((await codigos(admin, esquema, "provincia"))["p_inventada"]).toBeNull();
    expect((await codigos(admin, esquema, "canton"))["c_inventado"]).toBeNull();
    expect((await codigos(admin, esquema, "distrito"))["d_inventado"]).toBeNull();
  });

  it("ni una fila se borro ni se creo", async () => {
    expect(await conteos(admin, esquema)).toEqual(antes);
  });

  it("MEDIDO: cero codigos duplicados en las tres tablas (el `GROUP BY … HAVING count(*) > 1`)", async () => {
    for (const tabla of TABLAS) {
      const dup = await admin.$queryRawUnsafe<{ codigo_dta: string }[]>(
        `SELECT "codigo_dta" FROM "${esquema}"."${tabla}"
          WHERE "codigo_dta" IS NOT NULL
          GROUP BY "codigo_dta" HAVING count(*) > 1`,
      );
      expect(dup, `${tabla} tiene codigos repetidos: el CREATE UNIQUE INDEX habria fallado`).toEqual(
        [],
      );
    }
  });

  it("el indice unico RECHAZA un codigo repetido", async () => {
    await expect(
      admin.$executeRawUnsafe(
        `UPDATE "${esquema}"."distrito" SET "codigo_dta" = '60310' WHERE "id" = 'd_pijije'`,
      ),
    ).rejects.toThrow();
  });

  it("⭑ pero ADMITE varios NULL a la vez: los nodos sin codigo oficial conviven", async () => {
    // Es la mitad que un `NOT NULL` habria impedido, y la razon de que la columna sea nullable.
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."distrito" ("id","canton_id","nombre")
       VALUES ('d_sin_1','c_inventado','Sin Codigo Uno'),('d_sin_2','c_inventado','Sin Codigo Dos')`,
    );
    const nulos = await admin.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "${esquema}"."distrito" WHERE "codigo_dta" IS NULL`,
    );
    expect(nulos[0].n).toBeGreaterThanOrEqual(3);
    await admin.$executeRawUnsafe(
      `DELETE FROM "${esquema}"."distrito" WHERE "id" IN ('d_sin_1','d_sin_2')`,
    );
  });

  it("re-aplicar el backfill NO pisa un codigo ya puesto (es idempotente)", async () => {
    await admin.$executeRawUnsafe(
      `UPDATE "${esquema}"."distrito" SET "codigo_dta" = '99999' WHERE "id" = 'd_inventado'`,
    );
    for (const stmt of soloBackfill(upSql, esquema)) await admin.$executeRawUnsafe(stmt);
    const d = await codigos(admin, esquema, "distrito");
    expect(d["d_inventado"], "el backfill piso un codigo puesto a mano").toBe("99999");
    expect(d["d_cabagra"]).toBe("60310");
    await admin.$executeRawUnsafe(
      `UPDATE "${esquema}"."distrito" SET "codigo_dta" = NULL WHERE "id" = 'd_inventado'`,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Contra Postgres real: el down.
// ---------------------------------------------------------------------------------------------

describe.skipIf(!HAY_BASE_DE_DATOS)("375 — el down deja las tres tablas como estaban", () => {
  const esquema = `t_375_down_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;
  let antes = { p: 0, c: 0, d: 0 };
  let nombresAntes: string[] = [];

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await crearEsquemaPrevio(admin, esquema);
    await sembrar(admin, esquema);
    antes = await conteos(admin, esquema);
    nombresAntes = (
      await admin.$queryRawUnsafe<{ nombre: string }[]>(
        `SELECT "nombre" FROM "${esquema}"."distrito" ORDER BY "id"`,
      )
    ).map((f) => f.nombre);
    await aplicar(admin, upSql, esquema);
    await aplicar(admin, downSql, esquema);
  }, 180_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("la columna `codigo_dta` desaparece de las tres tablas", async () => {
    const filas = await admin.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = $1 AND column_name = 'codigo_dta'`,
      esquema,
    );
    expect(filas).toEqual([]);
  });

  it("los tres indices unicos desaparecen", async () => {
    const filas = await admin.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname LIKE '%codigo_dta%'`,
      esquema,
    );
    expect(filas).toEqual([]);
  });

  it("ni una fila se borro, y los nombres siguen exactamente igual", async () => {
    expect(await conteos(admin, esquema)).toEqual(antes);
    const ahora = (
      await admin.$queryRawUnsafe<{ nombre: string }[]>(
        `SELECT "nombre" FROM "${esquema}"."distrito" ORDER BY "id"`,
      )
    ).map((f) => f.nombre);
    expect(ahora).toEqual(nombresAntes);
  });

  it("los UNIQUE de nombre de la ficha 374 siguen en pie: el down no se lleva lo ajeno", async () => {
    const filas = await admin.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname LIKE '%nombre_key'
        ORDER BY indexname`,
      esquema,
    );
    expect(filas.map((f) => f.indexname)).toEqual([
      "canton_provincia_id_nombre_key",
      "distrito_canton_id_nombre_key",
      "provincia_nombre_key",
    ]);
  });

  it("correr el down dos veces es un no-op, no un error", async () => {
    await expect(aplicar(admin, downSql, esquema)).resolves.toBeUndefined();
  });
});
