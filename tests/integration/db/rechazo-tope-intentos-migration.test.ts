import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGEN_TIPOS_CON_GESTION,
  ORIGEN_TIPOS_VISITA_REAL,
} from "@/lib/types/orden-historial";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";

/**
 * Feature 276 (T2/T16, R22/R35/R36) — LA MIGRACION DEL VALOR DE ENUM `rechazo_tope_intentos`.
 *
 * Molde: `anclaje-devolucion-migration.test.ts` para el bloque estatico, y
 * `gestion-orden-pago-migration.test.ts` para el bloque que EJECUTA el DDL real en un esquema
 * desechable. Los dos hacen falta y no se sustituyen:
 *
 *   · el ESTATICO fija la FORMA (idempotencia, aditividad, que el down recrea con la lista) y
 *     corre en cualquier maquina, con o sin base;
 *   · el de POSTGRES REAL demuestra que el `down.sql` que escribimos EJECUTA —que el `USING` casa,
 *     que el `DROP TYPE` del viejo no choca con nada— y que aplicar y revertir NO cambia el
 *     `estatus_id` de ninguna orden (R35/T16). Una regex no puede demostrar ninguna de las dos.
 *
 * SIN BASE ALCANZABLE el bloque real se SALTA (`describe.skip`), que se VE en la salida; jamas un
 * `return` dentro del caso, que se leeria como `passed` sin haber comprobado nada.
 */

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const enumDir = migrationDirFor("_orden_historial_origen_rechazo_tope_intentos");
const enumUp = fs.readFileSync(path.join(enumDir, "migration.sql"), "utf8");
const enumDown = fs.readFileSync(path.join(enumDir, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

const FAMILIA = "rechazo_tope_intentos";

/** Quita los comentarios `--` para poder partir el DDL por `;` sin arrastrar prosa. */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
    .join("\n");
}

function sentenciasDe(ddl: string): string[] {
  return ddl
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/* -------------------------------------------------------------------------- */
/* 1. La FORMA del up y del down (estatico, sin base)                          */
/* -------------------------------------------------------------------------- */

describe("276/T2 · enum — la forma de `rechazo_tope_intentos` (R22/R36)", () => {
  it("el UP anade el valor con `IF NOT EXISTS` (aplicarlo dos veces no duplica)", () => {
    expect(enumUp).toMatch(
      new RegExp(`ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS '${FAMILIA}';`),
    );
  });

  it("R35 — el UP es ADITIVO: ni tablas, ni columnas, ni RLS, ni movimientos de orden", () => {
    const up = sinComentarios(enumUp);
    expect(up).not.toMatch(/CREATE TABLE/i);
    expect(up).not.toMatch(/ALTER COLUMN/i);
    expect(up).not.toMatch(/DROP COLUMN/i);
    expect(up).not.toMatch(/CREATE POLICY/i);
    expect(up).not.toMatch(/ROW LEVEL SECURITY/i);
    // R35: ninguna orden cambia de estado desde SQL de migracion. Y sin backfill (decision del
    // humano del 2026-08-24, medida contra produccion).
    expect(up).not.toMatch(/UPDATE\s+"?orden"?/i);
    expect(up).not.toMatch(/INSERT\s+INTO\s+"?orden"?/i);
    expect(up).not.toMatch(/DELETE\s+FROM\s+"?orden"?/i);
    expect(up).not.toMatch(/estatus_id/i);
  });

  it("no USA el valor nuevo en la misma transaccion que lo anade (Postgres 55P04)", () => {
    const up = sinComentarios(enumUp);
    expect(up).not.toMatch(new RegExp(`'${FAMILIA}'::orden_historial_origen_tipo`));
    expect(up).not.toMatch(/INSERT INTO "orden_historial_estado"/i);
    // Una sola sentencia: el `ADD VALUE` y nada mas.
    expect(sentenciasDe(up)).toHaveLength(1);
  });

  it("R36 — el DOWN RECREA el tipo con los 32 valores previos, SIN el nuevo", () => {
    // La forma se copio del down del PROPIO enum en la 239 y la 237 (las dos RECREAN con la lista,
    // no eliminan), que es lo que la task exige mirar antes de escribir este fichero.
    expect(enumDown).toMatch(
      /ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";/,
    );
    const match = enumDown.match(
      /CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/,
    );
    expect(match).not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    // ⏳ 2026-08-24 (merge de la 266): 31 -> 32. La 266 lleva timestamp ANTERIOR (0823) a esta
    // (0824), asi que se aplica PRIMERO y `habilitacion_api` YA esta en el enum cuando corre este
    // up. Aqui NO valia la salida habitual de «anadir el valor nuevo a POSTERIORES»: eso sirve
    // para migraciones que van DESPUES: esta va antes, y dejar su down en 31 lo haria borrar un
    // valor que su up jamas anadio. Por eso se corrige el `down.sql`, y esta es la asercion que
    // lo obliga.
    expect(valores).toHaveLength(32);
    expect(valores).not.toContain(FAMILIA);
    // La lista del down es EXACTAMENTE el SEED de hoy menos el valor que esta migracion anade. Si
    // manana llega una familia nueva, este `down.sql` NO se toca (es una foto historica): lo que se
    // amplia es el conjunto que se le descuenta al SEED vigente, como hicieron las cuatro fichas
    // anteriores con el down de la 239.
    const POSTERIORES = new Set<string>([FAMILIA]);
    expect(new Set(valores)).toEqual(
      new Set(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.filter((v) => !POSTERIORES.has(v))),
    );
  });

  it("R36 — el DOWN migra la columna con USING y suelta el tipo viejo", () => {
    expect(enumDown).toMatch(
      /ALTER TABLE "orden_historial_estado"\s+ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"\s+USING \("origen_tipo"::text::"orden_historial_origen_tipo"\);/,
    );
    expect(enumDown).toMatch(/DROP TYPE "orden_historial_origen_tipo_old";/);
  });

  it("R35 — el DOWN tampoco mueve ordenes ni toca RLS", () => {
    const down = sinComentarios(enumDown);
    expect(down).not.toMatch(/UPDATE\s+"?orden"?\b/i);
    expect(down).not.toMatch(/DELETE\s+FROM\s+"?orden"?\b/i);
    expect(down).not.toMatch(/estatus_id/i);
    expect(down).not.toMatch(/CREATE POLICY/i);
    expect(down).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("el DOWN documenta la precondicion (0 filas con la familia nueva) y el rollback encadenado", () => {
    expect(enumDown).toMatch(/Precondicion/i);
    expect(enumDown).toContain(FAMILIA);
    expect(enumDown).toMatch(/ROLLBACK ENCADENADO/i);
  });

  it("el DOWN no tiene que rehacer indices a mano: no hay ninguno PARCIAL sobre `origen_tipo`", () => {
    // Censo RE-DERIVADO del arbol de migraciones, no citado de la 240: `ALTER COLUMN ... TYPE`
    // reconstruye solo los indices que dependen de la columna, pero un indice PARCIAL cuyo `WHERE`
    // comparase `origen_tipo` con un literal del tipo viejo seria el caso que rompe.
    const indices = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((e) => {
        const file = path.join(MIGRATIONS_DIR, e.name, "migration.sql");
        if (!fs.existsSync(file)) return [];
        return fs
          .readFileSync(file, "utf8")
          .split(/;\s*\n/)
          .filter((stmt) => /CREATE\s+(UNIQUE\s+)?INDEX/i.test(stmt))
          .filter((stmt) => /"orden_historial_estado"/.test(stmt));
      });
    expect(indices.length).toBeGreaterThan(0); // el censo mira algo de verdad
    for (const stmt of indices) expect(stmt).not.toMatch(/\bWHERE\b/i);
  });

  it("los `down.sql` de las migraciones ANTERIORES de este enum NO se tocaron", () => {
    // Son fotos historicas. Cada una recrea el tipo con la lista de SU momento, y el recuento de
    // esa lista es la huella: si alguien "actualizara" una para meterle el valor nuevo, este caso
    // se pone rojo. Es la trampa que ya mordio en este repo.
    const huellas: [string, number][] = [
      ["_orden_historial_origen_anclaje_devolucion", 26],
      ["_orden_historial_origen_ayuda_tienda", 27],
      ["_orden_historial_origen_gestion_tienda_ayuda", 29],
      ["_orden_historial_origen_rechazo_tienda", 30],
      // ⏳ 2026-08-24 (merge de la 266): la 0823 tambien es ANTERIOR a esta y por tanto entra en el
      // censo. Su down recrea con los 31 valores previos a `habilitacion_api`, y sigue intacto.
      ["_orden_historial_origen_habilitacion_api", 31],
    ];
    for (const [sufijo, cuantos] of huellas) {
      const down = fs.readFileSync(path.join(migrationDirFor(sufijo), "down.sql"), "utf8");
      const m = down.match(/CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/);
      expect(m, `${sufijo}: el down deberia recrear el tipo`).not.toBeNull();
      const valores = [...(m as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
      expect(valores, `${sufijo}: foto historica alterada`).toHaveLength(cuantos);
      expect(valores, `${sufijo}: foto historica alterada`).not.toContain(FAMILIA);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 2. El codigo y la base dicen lo mismo (sin drift)                           */
/* -------------------------------------------------------------------------- */

describe("276/T2 · sin drift entre el codigo y la migracion", () => {
  it("el enum Prisma tiene `rechazo_tope_intentos` y el SEED de TS tambien", () => {
    expect(schemaPrisma).toMatch(/enum OrdenHistorialOrigenTipo[\s\S]*?rechazo_tope_intentos/);
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain(FAMILIA);
  });

  // ⭑ EL CASO QUE PROTEGE EL DINERO (Q5, firmada). Si esta familia entrara en la lista de visita
  // real, cada rechazo por tope sumaria un intento a su propia orden, adelantaria el escalado del
  // cron SLA (99) y dispararia el `cobroRechazado` (56) antes de tiempo.
  it("`rechazo_tope_intentos` NO esta en `ORIGEN_TIPOS_VISITA_REAL`", () => {
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain(FAMILIA);
    // El literal se conserva COMO literal: es el contrato, no una copia de su propia fuente.
    expect([...ORIGEN_TIPOS_VISITA_REAL]).toEqual(["gestion", "gestion_tienda_ayuda"]);
  });

  it("`rechazo_tope_intentos` NO esta en `ORIGEN_TIPOS_CON_GESTION`", () => {
    // Su fila NACE con `gestion_orden_id` poblado (la gestion sintetica de R23) y aun asi queda
    // fuera: esa lista solo desambigua la NULIDAD del enlace. Mismo caso que `escalado_devuelta_sla`.
    expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain(FAMILIA);
    expect([...ORIGEN_TIPOS_CON_GESTION]).toEqual(["gestion", "deshacer_gestion"]);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. El DDL, EJECUTADO contra Postgres real                                   */
/* -------------------------------------------------------------------------- */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

interface MedicionDdl {
  /** Labels del enum del esquema temporal ANTES del up. */
  antesDelUp: string[];
  /** ... DESPUES del up. */
  despuesDelUp: string[];
  /** ... DESPUES del down. */
  despuesDelDown: string[];
  /** Las filas de historial sembradas, leidas DESPUES del down (R36: la base sigue legible). */
  historialTrasElDown: { id: string; origen_tipo: string }[];
  /** `(id, estatus_id)` de las ordenes sembradas, antes del up y despues del down (R35/T16). */
  ordenesAntes: { id: string; estatus_id: string }[];
  ordenesDespues: { id: string; estatus_id: string }[];
}

describeSiHayBase("276/T2 · el DDL corre de verdad (Postgres real)", () => {
  let prisma: PrismaClient;
  let medicion: MedicionDdl;
  let enumDePublic: string[];

  beforeAll(async () => {
    prisma = crearPrismaDeTest();

    // (a) El enum REAL de `public`: la migracion aplicada a esta base tiene el valor.
    enumDePublic = (
      await prisma.$queryRawUnsafe<{ label: string }[]>(
        `SELECT e.enumlabel AS label
           FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typname = 'orden_historial_origen_tipo'
          ORDER BY e.enumsortorder`,
      )
    ).map((r) => r.label);

    // (b) El up y el down REALES, en un esquema desechable dentro de una tx que se revierte.
    medicion = await enTransaccionRevertida(prisma, async (tx) => {
      const esquema = `t273_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${esquema}", public`);

      // El enum ANTES de esta migracion = exactamente la lista que el `down.sql` recrea. Se toma
      // DEL PROPIO down para no escribir una tercera copia de los 31 valores.
      const listaPrevia = (
        enumDown.match(
          /CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/,
        ) as RegExpMatchArray
      )[1];
      await tx.$executeRawUnsafe(
        `CREATE TYPE "${esquema}"."orden_historial_origen_tipo" AS ENUM (${listaPrevia})`,
      );
      // Tabla minima con la MISMA columna que la migracion toca. No se clona `public` entera: lo
      // que el down manipula es esta columna y su tipo.
      await tx.$executeRawUnsafe(
        `CREATE TABLE "${esquema}"."orden_historial_estado" (
           "id" uuid PRIMARY KEY,
           "orden_id" uuid NOT NULL,
           "origen_tipo" "${esquema}"."orden_historial_origen_tipo" NOT NULL
         )`,
      );
      // Y la tabla de ordenes, para poder afirmar que NINGUN `estatus_id` se mueve (R35/T16).
      await tx.$executeRawUnsafe(
        `CREATE TABLE "${esquema}"."orden" ("id" uuid PRIMARY KEY, "estatus_id" uuid NOT NULL)`,
      );

      const filas = [
        { id: randomUUID(), origen: "gestion" },
        { id: randomUUID(), origen: "liberacion_sin_gestionar" },
        { id: randomUUID(), origen: "rechazo_tienda" },
      ];
      for (const f of filas) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "${esquema}"."orden_historial_estado" ("id","orden_id","origen_tipo")
             VALUES ('${f.id}', '${randomUUID()}', '${f.origen}')`,
        );
      }
      const ordenes = [
        { id: randomUUID(), estatus: randomUUID() },
        { id: randomUUID(), estatus: randomUUID() },
      ];
      for (const o of ordenes) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "${esquema}"."orden" ("id","estatus_id") VALUES ('${o.id}','${o.estatus}')`,
        );
      }

      const labels = async () =>
        (
          await tx.$queryRawUnsafe<{ label: string }[]>(
            `SELECT e.enumlabel AS label
               FROM pg_enum e
               JOIN pg_type t ON t.oid = e.enumtypid
               JOIN pg_namespace n ON n.oid = t.typnamespace
              WHERE n.nspname = $1 AND t.typname = 'orden_historial_origen_tipo'
              ORDER BY e.enumsortorder`,
            esquema,
          )
        ).map((r) => r.label);
      const leerOrdenes = async () =>
        tx.$queryRawUnsafe<{ id: string; estatus_id: string }[]>(
          `SELECT "id"::text, "estatus_id"::text FROM "${esquema}"."orden" ORDER BY "id"`,
        );

      const antesDelUp = await labels();
      const ordenesAntes = await leerOrdenes();

      // EL UP REAL, sentencia a sentencia.
      for (const s of sentenciasDe(sinComentarios(enumUp))) await tx.$executeRawUnsafe(s);
      const despuesDelUp = await labels();

      // EL DOWN REAL. Si el `USING` no casara, o el `DROP TYPE` chocara, esto REVIENTA aqui — que
      // es exactamente lo que una regex sobre el fichero no puede decir.
      for (const s of sentenciasDe(sinComentarios(enumDown))) await tx.$executeRawUnsafe(s);
      const despuesDelDown = await labels();

      // R36: la base sigue LEGIBLE por el codigo anterior — las filas siguen ahi, con su valor.
      const historialTrasElDown = await tx.$queryRawUnsafe<
        { id: string; origen_tipo: string }[]
      >(
        `SELECT "id"::text, "origen_tipo"::text AS origen_tipo
           FROM "${esquema}"."orden_historial_estado" ORDER BY "origen_tipo"`,
      );
      const ordenesDespues = await leerOrdenes();

      await tx.$executeRawUnsafe(`DROP SCHEMA "${esquema}" CASCADE`);
      return {
        antesDelUp,
        despuesDelUp,
        despuesDelDown,
        historialTrasElDown,
        ordenesAntes,
        ordenesDespues,
      };
    });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("R22 — el valor EXISTE en el enum de la base a la que apunta esta suite", () => {
    // No es una lectura del fichero: es `pg_enum`. Si la migracion no se hubiera aplicado a esta
    // base, este caso cae — y entonces el resto de la suite de la 276 estaria midiendo un esquema
    // que no es el que el codigo espera.
    expect(enumDePublic).toContain(FAMILIA);
    // Y el enum de la base coincide EXACTAMENTE con el SEED de TypeScript (sin drift en ninguna
    // direccion: ni un valor en la base que el codigo ignore, ni al reves).
    expect(new Set(enumDePublic)).toEqual(new Set(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED));
  });

  it("el UP anade el valor: 32 labels antes, 33 despues, y el nuevo es el ultimo", () => {
    // ⏳ 2026-08-24 (merge de la 266): 31 -> 32 antes y 32 -> 33 despues. La 266 (0823) se aplica
    // ANTES que esta (0824), asi que su valor ya esta en el enum cuando corre este up.
    expect(medicion.antesDelUp).toHaveLength(32);
    expect(medicion.antesDelUp).not.toContain(FAMILIA);
    expect(medicion.despuesDelUp).toHaveLength(33);
    expect(medicion.despuesDelUp).toContain(FAMILIA);
    expect(medicion.despuesDelUp[32]).toBe(FAMILIA); // ultimo de 33 (indice 32 tras el merge de la 266)
  });

  it("R36 — el DOWN EJECUTA y deja el enum EXACTAMENTE como estaba antes del UP", () => {
    // Igualdad de lista Y de orden: recrear el tipo con las etiquetas desordenadas cambiaria el
    // `ORDER BY origen_tipo` de cualquier consulta que ordene por el enum.
    expect(medicion.despuesDelDown).toEqual(medicion.antesDelUp);
    expect(medicion.despuesDelDown).not.toContain(FAMILIA);
  });

  it("R36 — tras el DOWN la base sigue legible: las filas sembradas conservan su familia", () => {
    expect(medicion.historialTrasElDown.map((f) => f.origen_tipo)).toEqual([
      "gestion",
      "liberacion_sin_gestionar",
      "rechazo_tienda",
    ]);
  });

  it("R35/T16 — aplicar y revertir NO cambia el `estatus_id` de ninguna orden sembrada", () => {
    expect(medicion.ordenesAntes).toHaveLength(2);
    expect(medicion.ordenesDespues).toEqual(medicion.ordenesAntes);
  });
});
