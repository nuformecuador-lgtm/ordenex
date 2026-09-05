import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// Cobertura de `20260905175156_geografia_dta_2026_distritos_faltantes`: los tres distritos que
// le faltaban a la geografia de Costa Rica frente a la DTA 2026 del IGN (Cabagra / Buenos Aires /
// Puntarenas, Pijije / Bagaces / Guanacaste y Duacari / Guacimo / Limon).
//
// POR QUE ESTO NO PUEDE SER UN REGEX SOBRE EL SQL. Lo que hay que demostrar son HECHOS DEL MOTOR
// sobre datos reales: que la base termina con 494 distritos y no 491; que cada distrito nuevo cae
// bajo SU canton dentro de SU provincia (y no bajo el homonimo de otra provincia); que la zona se
// HEREDA de los hermanos solo cuando convergen en exactamente una; y que correr la migracion dos
// veces no duplica nada. Un `toMatch(/Cabagra/)` se satisface escribiendo la palabra.
//
// COMO SE MIDE. En un esquema desechable se reconstruyen las cinco tablas de la geografia, se
// aplican las migraciones REALES que sembraron el pais (`_seed_geografia_cr` y
// `_seed_zonas_pago_distrito`) y encima la migracion REAL de esta ficha. Nada se inventa: el SQL
// que corre es el que esta en disco, solo cualificado al esquema temporal.

const ROOT = process.cwd();
const MIGRACIONES = path.join(ROOT, "db", "migrations");
const DIR_ESTA = "20260905175156_geografia_dta_2026_distritos_faltantes";
const DIR_GEO = "20260713005000_seed_geografia_cr";
const DIR_ZONAS = "20260713010000_seed_zonas_pago_distrito";

const upSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"), "utf8");

/** El SQL sin la prosa: lo que Postgres ejecuta de verdad. */
function soloEjecutable(sql: string): string {
  return sql
    .split("\n")
    .filter((linea) => !/^\s*--/.test(linea))
    .join("\n");
}

/** Sentencias listas para `$executeRawUnsafe`, una por una. */
function sentencias(sql: string): string[] {
  return soloEjecutable(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

// El orden importa: `zona_distrito` antes que `zona`, porque `"zona"` es prefijo de nada pero
// `"zona_distrito"` contiene la palabra y una sustitucion ingenua al reves la partiria.
const TABLAS = ["provincia", "canton", "distrito", "zona_distrito", "zona"] as const;

function cualificar(sql: string, esquema: string): string {
  let salida = sql;
  for (const tabla of TABLAS) salida = salida.replaceAll(`"${tabla}"`, `"${esquema}"."${tabla}"`);
  return salida;
}

function sqlDe(dir: string): string {
  return fs.readFileSync(path.join(MIGRACIONES, dir, "migration.sql"), "utf8");
}

/** Crea el esquema desechable con la forma real de las cinco tablas de la geografia. */
async function crearEsquemaGeografico(admin: PrismaClient, esquema: string): Promise<void> {
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
    `CREATE TABLE "${esquema}"."zona" ("id" TEXT PRIMARY KEY, "nombre" TEXT NOT NULL UNIQUE)`,
    // El `@@unique([zonaId, distritoId])` del schema: sin el, el `ON CONFLICT` del up no tiene
    // sobre que inferir y la idempotencia que se mide aqui no seria la real.
    `CREATE TABLE "${esquema}"."zona_distrito" (
       "id" TEXT PRIMARY KEY,
       "zona_id" TEXT NOT NULL REFERENCES "${esquema}"."zona"("id") ON DELETE CASCADE,
       "distrito_id" TEXT NOT NULL REFERENCES "${esquema}"."distrito"("id") ON DELETE CASCADE,
       CONSTRAINT "zona_distrito_zona_id_distrito_id_key" UNIQUE ("zona_id", "distrito_id"))`,
  ];
  for (const stmt of ddl) await admin.$executeRawUnsafe(stmt);
}

async function aplicar(admin: PrismaClient, sql: string, esquema: string): Promise<void> {
  for (const stmt of sentencias(cualificar(sql, esquema))) {
    await admin.$executeRawUnsafe(stmt);
  }
}

interface FilaDistrito {
  provincia: string;
  canton: string;
  distrito: string;
  zonas: number;
  filas_zona: number;
  zona: string | null;
}

/**
 * La CADENA ENTERA de un distrito: provincia -> canton -> distrito, mas cuantas zonas DISTINTAS
 * resuelve por `zona_distrito` (lo que `zonaUnicaDeDistrito` colapsa) y cuantas FILAS puente
 * tiene (que es lo que delata una duplicacion).
 */
async function distritosLlamados(
  admin: PrismaClient,
  esquema: string,
  nombre: string,
): Promise<FilaDistrito[]> {
  return admin.$queryRawUnsafe<FilaDistrito[]>(
    `SELECT p."nombre" AS provincia,
            c."nombre" AS canton,
            d."nombre" AS distrito,
            (SELECT COUNT(DISTINCT zd."zona_id")::int
               FROM "${esquema}"."zona_distrito" zd WHERE zd."distrito_id" = d."id") AS zonas,
            (SELECT COUNT(*)::int
               FROM "${esquema}"."zona_distrito" zd WHERE zd."distrito_id" = d."id") AS filas_zona,
            (SELECT MIN(z."nombre")
               FROM "${esquema}"."zona_distrito" zd
               JOIN "${esquema}"."zona" z ON z."id" = zd."zona_id"
              WHERE zd."distrito_id" = d."id") AS zona
       FROM "${esquema}"."distrito" d
       JOIN "${esquema}"."canton" c ON c."id" = d."canton_id"
       JOIN "${esquema}"."provincia" p ON p."id" = c."provincia_id"
      WHERE d."nombre" = $1
      ORDER BY p."nombre", c."nombre"`,
    nombre,
  );
}

async function contar(admin: PrismaClient, sql: string): Promise<number> {
  const [fila] = await admin.$queryRawUnsafe<Array<{ n: number }>>(sql);
  return fila.n;
}

// ---------------------------------------------------------------------------------------------
// Estatico: corre SIEMPRE, tambien en un arbol sin `DATABASE_URL`.
// ---------------------------------------------------------------------------------------------
describe("migracion geografia_dta_2026 — forma en disco", () => {
  it("trae migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(MIGRACIONES, DIR_ESTA, "down.sql"))).toBe(true);
  });

  // EL FALLO MUDO QUE ESTO VIGILA: los nombres de zona NO son estables entre entornos (en
  // produccion el maestro los renombro a mano: "FGAM Zona Sur", "FGAM Guanacaste (Tempisque)").
  // Un literal insertaria CERO filas sin fallar. El invariante fuerte es que el up NI SIQUIERA
  // LEE la tabla `zona`: solo `zona_distrito`, o sea ids, nunca nombres.
  it("el SQL ejecutable no lee la tabla `zona` ni nombra zona alguna: la hereda por id", () => {
    const ejecutable = soloEjecutable(upSql);
    expect(ejecutable).not.toMatch(/(FROM|JOIN|UPDATE|INTO)\s+"zona"/);
    expect(ejecutable).not.toMatch(/'ZONA SUR'|'FGAM|'GAM'|'LIMÓN ABAJO'/i);
    expect(ejecutable).toMatch(/HAVING\s+COUNT\(DISTINCT\s+zd\."zona_id"\)\s*=\s*1/);
  });

  it("el down borra primero los links y luego los distritos", () => {
    const ejecutable = soloEjecutable(downSql);
    expect(ejecutable).toMatch(/DELETE FROM "zona_distrito"/);
    expect(ejecutable).toMatch(/DELETE FROM "distrito"/);
    expect(ejecutable.indexOf('DELETE FROM "zona_distrito"')).toBeLessThan(
      ejecutable.indexOf('DELETE FROM "distrito"'),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Contra Postgres real: el pais entero, sembrado con las migraciones REALES.
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)("geografia DTA 2026 — 494 distritos contra Postgres", () => {
  const esquema = `t_dta2026_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;
  // Fotos del recuento ANTES y DESPUES de la segunda corrida de la migracion: la idempotencia se
  // mide comparandolas, no confiando en que el `ON CONFLICT` este escrito.
  let trasPrimeraCorrida = { distritos: 0, links: 0 };
  let trasSegundaCorrida = { distritos: 0, links: 0 };
  let hermanosDeBagacesConZona = 0;

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await crearEsquemaGeografico(admin, esquema);
    await aplicar(admin, sqlDe(DIR_GEO), esquema); // 491 distritos
    await aplicar(admin, sqlDe(DIR_ZONAS), esquema); // zonas + links zona<->distrito

    // FIXTURE — reproduce el estado de PRODUCCION en Bagaces. La migracion de zonas de este repo
    // no le asigna ninguna (Guanacaste solo cubre Liberia, Nicoya, Santa Cruz, Carrillo, Cañas,
    // Nandayure, La Cruz y Hojancha), pero en produccion el maestro si le dio cobertura. Sin este
    // fixture la rama "hereda" de Pijije no se ejercitaria nunca. Se afirma cuantas filas metio:
    // si metiera 0, el test de Pijije se pondria ROJO, no verde por vacio.
    hermanosDeBagacesConZona = await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."zona_distrito" ("id", "zona_id", "distrito_id")
       SELECT gen_random_uuid()::text, z."id", d."id"
         FROM "${esquema}"."zona" z
         CROSS JOIN "${esquema}"."distrito" d
         JOIN "${esquema}"."canton" c ON c."id" = d."canton_id" AND c."nombre" = 'Bagaces'
         JOIN "${esquema}"."provincia" p
           ON p."id" = c."provincia_id" AND p."nombre" = 'Guanacaste'
        WHERE z."nombre" = 'GUANACASTE'
       ON CONFLICT ("zona_id", "distrito_id") DO NOTHING`,
    );

    await aplicar(admin, upSql, esquema);
    trasPrimeraCorrida = {
      distritos: await contar(admin, `SELECT COUNT(*)::int AS n FROM "${esquema}"."distrito"`),
      links: await contar(admin, `SELECT COUNT(*)::int AS n FROM "${esquema}"."zona_distrito"`),
    };
    await aplicar(admin, upSql, esquema); // segunda corrida: idempotencia
    trasSegundaCorrida = {
      distritos: await contar(admin, `SELECT COUNT(*)::int AS n FROM "${esquema}"."distrito"`),
      links: await contar(admin, `SELECT COUNT(*)::int AS n FROM "${esquema}"."zona_distrito"`),
    };
  }, 180_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("el fixture de Bagaces dejo con zona a los 4 hermanos que existian antes", () => {
    expect(hermanosDeBagacesConZona).toBe(4);
  });

  it("el pais queda con 494 distritos (eran 491)", () => {
    expect(trasPrimeraCorrida.distritos).toBe(494);
  });

  it("el reparto por provincia cuadra con la DTA 2026 del IGN", async () => {
    const filas = await admin.$queryRawUnsafe<Array<{ provincia: string; n: number }>>(
      `SELECT p."nombre" AS provincia, COUNT(d."id")::int AS n
         FROM "${esquema}"."provincia" p
         JOIN "${esquema}"."canton" c ON c."provincia_id" = p."id"
         JOIN "${esquema}"."distrito" d ON d."canton_id" = c."id"
        GROUP BY p."nombre"
        ORDER BY p."nombre"`,
    );
    expect(filas).toEqual([
      { provincia: "Alajuela", n: 116 },
      { provincia: "Cartago", n: 53 },
      { provincia: "Guanacaste", n: 62 },
      { provincia: "Heredia", n: 48 },
      { provincia: "Limón", n: 30 },
      { provincia: "Puntarenas", n: 62 },
      { provincia: "San José", n: 123 },
    ]);
  });

  it("Cabagra existe bajo el canton Buenos Aires de la provincia Puntarenas, y en ningun otro", async () => {
    const filas = await distritosLlamados(admin, esquema, "Cabagra");
    expect(filas).toHaveLength(1);
    expect(filas[0].provincia).toBe("Puntarenas");
    expect(filas[0].canton).toBe("Buenos Aires");
  });

  // La desambiguacion no es teorica: "Buenos Aires" es canton en Puntarenas y DISTRITO de
  // Palmares (Alajuela). Un `WHERE c."nombre" = 'Buenos Aires'` a secas colgaria Cabagra de ahi.
  it("Palmares (Alajuela) conserva sus 7 distritos: no le colgo nada", async () => {
    const n = await contar(
      admin,
      `SELECT COUNT(*)::int AS n
         FROM "${esquema}"."distrito" d
         JOIN "${esquema}"."canton" c ON c."id" = d."canton_id"
         JOIN "${esquema}"."provincia" p ON p."id" = c."provincia_id"
        WHERE p."nombre" = 'Alajuela' AND c."nombre" = 'Palmares'`,
    );
    expect(n).toBe(7);
  });

  it("Pijije existe bajo el canton Bagaces de la provincia Guanacaste", async () => {
    const filas = await distritosLlamados(admin, esquema, "Pijije");
    expect(filas).toHaveLength(1);
    expect(filas[0].provincia).toBe("Guanacaste");
    expect(filas[0].canton).toBe("Bagaces");
  });

  it("Duacarí existe bajo el canton Guácimo de la provincia Limón", async () => {
    const filas = await distritosLlamados(admin, esquema, "Duacarí");
    expect(filas).toHaveLength(1);
    expect(filas[0].provincia).toBe("Limón");
    expect(filas[0].canton).toBe("Guácimo");
  });

  it("Cabagra resuelve a EXACTAMENTE UNA zona, la de sus hermanos de Buenos Aires", async () => {
    const filas = await distritosLlamados(admin, esquema, "Cabagra");
    expect(filas).toHaveLength(1);
    expect(filas[0].zonas).toBe(1);
    const [hermano] = await admin.$queryRawUnsafe<Array<{ zona: string }>>(
      `SELECT MIN(z."nombre") AS zona
         FROM "${esquema}"."distrito" d
         JOIN "${esquema}"."canton" c ON c."id" = d."canton_id"
         JOIN "${esquema}"."provincia" p ON p."id" = c."provincia_id"
         JOIN "${esquema}"."zona_distrito" zd ON zd."distrito_id" = d."id"
         JOIN "${esquema}"."zona" z ON z."id" = zd."zona_id"
        WHERE p."nombre" = 'Puntarenas' AND c."nombre" = 'Buenos Aires'
          AND d."nombre" <> 'Cabagra'`,
    );
    expect(filas[0].zona).toBe(hermano.zona);
  });

  it("Pijije resuelve a EXACTAMENTE UNA zona, la de sus hermanos de Bagaces", async () => {
    const filas = await distritosLlamados(admin, esquema, "Pijije");
    expect(filas).toHaveLength(1);
    expect(filas[0].zonas).toBe(1);
    expect(filas[0].zona).toBe("GUANACASTE");
  });

  // Nace sin zona A PROPOSITO: los 4 hermanos de Guacimo estan todos sin zona (el canton no tiene
  // cobertura comercial). Heredar algo aqui seria inventarselo.
  it("Duacarí nace SIN zona porque ningun hermano de Guácimo tiene una", async () => {
    const filas = await distritosLlamados(admin, esquema, "Duacarí");
    expect(filas).toHaveLength(1);
    expect(filas[0].zonas).toBe(0);
    expect(filas[0].filas_zona).toBe(0);
    const hermanosConZona = await contar(
      admin,
      `SELECT COUNT(*)::int AS n
         FROM "${esquema}"."distrito" d
         JOIN "${esquema}"."canton" c ON c."id" = d."canton_id"
         JOIN "${esquema}"."provincia" p ON p."id" = c."provincia_id"
         JOIN "${esquema}"."zona_distrito" zd ON zd."distrito_id" = d."id"
        WHERE p."nombre" = 'Limón' AND c."nombre" = 'Guácimo'`,
    );
    expect(hermanosConZona).toBe(0);
  });

  it("correr la migracion dos veces no duplica ni distritos ni links de zona", async () => {
    expect(trasSegundaCorrida).toEqual(trasPrimeraCorrida);
    const nuevos = [
      ...(await distritosLlamados(admin, esquema, "Cabagra")),
      ...(await distritosLlamados(admin, esquema, "Pijije")),
      ...(await distritosLlamados(admin, esquema, "Duacarí")),
    ];
    expect(nuevos).toHaveLength(3);
    expect(nuevos.map((f) => f.filas_zona)).toEqual([1, 1, 0]);
  });
});

// ---------------------------------------------------------------------------------------------
// La regla de herencia, en sus dos ramas de rechazo. Esquema minimo: solo hace falta el canton
// que la migracion nombra.
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)("herencia de zona — exige EXACTAMENTE una", () => {
  const esquema = `t_dta_amb_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await crearEsquemaGeografico(admin, esquema);
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."provincia" ("id", "nombre") VALUES ('p1', 'Puntarenas')`,
    );
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."canton" ("id", "provincia_id", "nombre")
       VALUES ('c1', 'p1', 'Buenos Aires')`,
    );
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."distrito" ("id", "canton_id", "nombre")
       VALUES ('d1', 'c1', 'Volcán'), ('d2', 'c1', 'Boruca')`,
    );
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."zona" ("id", "nombre") VALUES ('z1', 'UNA'), ('z2', 'OTRA')`,
    );
    // Los dos hermanos NO convergen: uno en cada zona.
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."zona_distrito" ("id", "zona_id", "distrito_id")
       VALUES ('l1', 'z1', 'd1'), ('l2', 'z2', 'd2')`,
    );
    await aplicar(admin, upSql, esquema);
  }, 60_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  // Si el `HAVING COUNT(DISTINCT ...) = 1` se cayera, `MIN(zona_id)` elegiria una de las dos y el
  // distrito PARECERIA configurado mientras `zonaUnicaDeDistrito` lo colapsa a null igual.
  it("con hermanos en DOS zonas distintas, el distrito nace y NO hereda ninguna", async () => {
    const filas = await distritosLlamados(admin, esquema, "Cabagra");
    expect(filas).toHaveLength(1);
    expect(filas[0].canton).toBe("Buenos Aires");
    expect(filas[0].filas_zona).toBe(0);
  });

  it("no toca los links de los hermanos", async () => {
    const n = await contar(
      admin,
      `SELECT COUNT(*)::int AS n FROM "${esquema}"."zona_distrito"`,
    );
    expect(n).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// El down, contra Postgres. Aqui NO hay ordenes: lo que se mide es que revierte lo que el up
// escribio y que es idempotente. (La perdida de dato por `orden.distrito_id` ON DELETE SET NULL
// esta declarada en el encabezado del down.sql.)
// ---------------------------------------------------------------------------------------------
describe.skipIf(!HAY_BASE_DE_DATOS)("down — revierte los tres distritos y sus links", () => {
  const esquema = `t_dta_down_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: PrismaClient;

  beforeAll(async () => {
    admin = crearPrismaDeTest();
    await crearEsquemaGeografico(admin, esquema);
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."provincia" ("id", "nombre") VALUES ('p1', 'Puntarenas')`,
    );
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."canton" ("id", "provincia_id", "nombre")
       VALUES ('c1', 'p1', 'Buenos Aires')`,
    );
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."distrito" ("id", "canton_id", "nombre") VALUES ('d1', 'c1', 'Volcán')`,
    );
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."zona" ("id", "nombre") VALUES ('z1', 'UNA')`,
    );
    await admin.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."zona_distrito" ("id", "zona_id", "distrito_id") VALUES ('l1', 'z1', 'd1')`,
    );
    await aplicar(admin, upSql, esquema);
  }, 60_000);

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await admin?.$disconnect();
  });

  it("el up dejo Cabagra con la zona heredada del unico hermano", async () => {
    const filas = await distritosLlamados(admin, esquema, "Cabagra");
    expect(filas).toHaveLength(1);
    expect(filas[0].filas_zona).toBe(1);
    expect(filas[0].zona).toBe("UNA");
  });

  it("el down borra el distrito y su link, y correrlo dos veces es un no-op", async () => {
    await aplicar(admin, downSql, esquema);
    expect(await distritosLlamados(admin, esquema, "Cabagra")).toHaveLength(0);
    await aplicar(admin, downSql, esquema); // idempotente
    expect(await distritosLlamados(admin, esquema, "Cabagra")).toHaveLength(0);
    // El hermano y su link siguen intactos: el down solo toca la terna que el up creo.
    const filas = await distritosLlamados(admin, esquema, "Volcán");
    expect(filas).toHaveLength(1);
    expect(filas[0].filas_zona).toBe(1);
  });
});
