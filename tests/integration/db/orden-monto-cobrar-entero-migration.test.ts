import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

/**
 * FICHA 305 — `orden.monto_cobrar` NO ADMITE CENTIMOS, Y LO DICE LA BASE.
 *
 * POR QUE ESTE ARCHIVO EXISTE Y POR QUE CONTRA POSTGRES DE VERDAD. Lo que esta ficha añade no
 * es codigo: es una restriccion de la tabla. Un test con dobles —o un repositorio mockeado— NO
 * la ve, porque el mock no tiene constraints; y una regex sobre el SQL solo demuestra que
 * alguien escribio la palabra `CHECK`, no que un `UPDATE` con centimos REBOTE. El defecto que
 * se cierra entro exactamente por ahi: el 2026-08-27 hubo que redondear 14 ordenes A MANO en la
 * base porque con centimos la orden no se puede entregar nunca (el desglose de pago solo admite
 * enteros), y la guardia de la 299 declara ella misma que un `UPDATE` crudo se le escapa.
 *
 * QUE SE MIDE, y todo ejecutando el SQL REAL de los dos archivos de la migracion:
 *   1. FORMA EN DISCO: el up añade la constraint SIN `NOT VALID` y sin backfill; el down la
 *      suelta y no hace nada mas.
 *   2. COMPORTAMIENTO: entero y `NULL` pasan; centimos rebotan, tanto por INSERT como por el
 *      `UPDATE` a mano que es el camino que motiva la ficha.
 *   3. ALCANCE: la restriccion alcanza TAMBIEN a las ordenes BORRADAS (`deleted_at` no nulo).
 *      Es una decision, no un descuido, y se mide para que quede fijada.
 *   4. AL REVES (subir, bajar, volver a subir): tras el down los centimos vuelven a entrar —lo
 *      que prueba que era la constraint y no otra cosa la que rechazaba— y el segundo up ABORTA
 *      mientras esa fila sucia siga ahi, que es la señal correcta y no un fallo del rollback.
 *
 * DONDE CORRE. En un esquema DESECHABLE, nunca sobre `public`. La base local es COMPARTIDA por
 * varios arboles de trabajo: aplicarle una migracion desde un test pondria rojo el gate de otra
 * feature. La fidelidad de lo que se mide no sufre, y se demuestra en vez de suponerse: el tipo
 * de la columna de la replica se LEE de `public.orden` y se afirma.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), que se VE en la salida.
 */

const DIR = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "db",
  "migrations",
  "20260828140000_orden_monto_cobrar_entero",
);

const RAIZ = path.join(__dirname, "..", "..", "..");
const CONSTRAINT = "orden_monto_cobrar_entero_check";

/** El SQL EJECUTABLE, sin la prosa: las aserciones de ausencia no deben leer los comentarios. */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

const upExec = sinComentarios(fs.readFileSync(path.join(DIR, "migration.sql"), "utf8"));
const downExec = sinComentarios(fs.readFileSync(path.join(DIR, "down.sql"), "utf8"));

describe("305 · forma en disco de la migracion", () => {
  it("trae migration.sql y down.sql", () => {
    expect(fs.existsSync(path.join(DIR, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(DIR, "down.sql"))).toBe(true);
  });

  it("el UP añade el CHECK sobre `monto_cobrar` y admite la fila sin monto", () => {
    expect(upExec).toMatch(
      new RegExp(`ALTER TABLE\\s+"orden"\\s+ADD CONSTRAINT\\s+"${CONSTRAINT}"`),
    );
    expect(upExec).toMatch(/CHECK\s*\([\s\S]*"monto_cobrar"\s*=\s*trunc\("monto_cobrar"\)/);
    // «sin monto a cobrar» es un caso legitimo del negocio (feature 299): NULL tiene que pasar.
    expect(upExec).toMatch(/"monto_cobrar"\s+IS NULL/);
  });

  it("NO es `NOT VALID`: una restriccion que no vale para lo que ya hay es una que miente", () => {
    expect(upExec).not.toMatch(/NOT VALID/i);
  });

  it("no mueve una sola fila: aqui NO hay backfill", () => {
    // Redondear desde la migracion seria mover dinero de una tienda sin que nadie lo decida.
    expect(upExec).not.toMatch(/^\s*UPDATE\b/im);
    expect(upExec).not.toMatch(/^\s*INSERT\b/im);
    expect(upExec).not.toMatch(/^\s*DELETE\b/im);
  });

  it("no toca RLS ni ninguna otra tabla", () => {
    expect(upExec).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upExec).not.toMatch(/CREATE POLICY/i);
    expect(downExec).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(upExec.match(/ALTER TABLE\s+"(\w+)"/g)).toEqual(['ALTER TABLE "orden"']);
    expect(downExec.match(/ALTER TABLE\s+"(\w+)"/g)).toEqual(['ALTER TABLE "orden"']);
  });

  it("el DOWN suelta EXACTAMENTE esa constraint, es idempotente y no hace nada mas", () => {
    expect(downExec).toMatch(
      new RegExp(`ALTER TABLE\\s+"orden"\\s+DROP CONSTRAINT IF EXISTS\\s+"${CONSTRAINT}"`),
    );
    expect(downExec).not.toMatch(/ADD CONSTRAINT/i);
    expect(downExec).not.toMatch(/^\s*UPDATE\b/im);
    expect(downExec).not.toMatch(/^\s*DELETE\b/im);
  });

  it("el CHECK no vive en `schema.prisma` (Prisma no lo expresa) pero el modelo dice donde vive", () => {
    const modelo = fs.readFileSync(path.join(RAIZ, "db", "schema.prisma"), "utf8");
    const orden = modelo.slice(modelo.indexOf("model Orden {"));
    expect(orden).toContain(CONSTRAINT);
    expect(orden).toContain("20260828140000_orden_monto_cobrar_entero");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Contra Postgres real.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!HAY_BASE_DE_DATOS)("305 · la base rechaza un monto con centimos", () => {
  const esquema = `t_monto_entero_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let db: PrismaClient;

  /** El SQL real del archivo, apuntado al esquema desechable. */
  function sqlDe(archivo: "migration.sql" | "down.sql"): string {
    return sinComentarios(fs.readFileSync(path.join(DIR, archivo), "utf8")).replace(
      /"orden"/g,
      `"${esquema}"."orden"`,
    );
  }

  /** La definicion de la constraint EN LA REPLICA, o `null` si no esta puesta. */
  async function constraintPuesta(): Promise<{ def: string; valida: boolean } | null> {
    const filas = await db.$queryRawUnsafe<Array<{ def: string; valida: boolean }>>(
      `SELECT pg_get_constraintdef(c.oid) AS def, c.convalidated AS valida
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = '${esquema}' AND t.relname = 'orden' AND c.conname = '${CONSTRAINT}'`,
    );
    return filas[0] ?? null;
  }

  function insertar(id: string, monto: string | null, borrada = false): Promise<number> {
    return db.$executeRawUnsafe(
      `INSERT INTO "${esquema}"."orden" ("id", "monto_cobrar", "deleted_at")
       VALUES ('${id}', ${monto === null ? "NULL" : monto}, ${borrada ? "now()" : "NULL"})`,
    );
  }

  /** El nombre de la constraint que rechazo, o `null` si la sentencia paso. */
  async function rechazo(promesa: Promise<unknown>): Promise<string | null> {
    try {
      await promesa;
      return null;
    } catch (error) {
      const texto = error instanceof Error ? error.message : String(error);
      return texto.includes(CONSTRAINT) ? CONSTRAINT : `OTRO ERROR: ${texto}`;
    }
  }

  async function montosGuardados(): Promise<string[]> {
    const filas = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "${esquema}"."orden" ORDER BY "id"`,
    );
    return filas.map((f) => f.id);
  }

  beforeAll(async () => {
    db = crearPrismaDeTest();

    // La replica se construye con el tipo LEIDO de la columna real, no con uno escrito a mano:
    // asi el test no puede estar midiendo una columna distinta de la que protege la migracion.
    const columnas = await db.$queryRawUnsafe<
      Array<{ nombre: string; tipo: string; precision: number | null; escala: number | null }>
    >(
      `SELECT column_name AS nombre, data_type AS tipo,
              numeric_precision AS precision, numeric_scale AS escala
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orden'
          AND column_name IN ('monto_cobrar', 'deleted_at')`,
    );
    const monto = columnas.find((c) => c.nombre === "monto_cobrar");
    if (monto === undefined) throw new Error("`public.orden.monto_cobrar` no existe");
    if (columnas.find((c) => c.nombre === "deleted_at") === undefined) {
      throw new Error("`public.orden.deleted_at` no existe: el alcance de la ficha cambio");
    }
    // Se AFIRMA aqui, fuera de un `it`, porque de este hecho depende la fidelidad de todo lo de
    // abajo: si la columna dejara de ser `numeric(12,2)`, la replica mediria otra cosa.
    if (monto.tipo !== "numeric" || Number(monto.precision) !== 12 || Number(monto.escala) !== 2) {
      throw new Error(
        `monto_cobrar ya no es numeric(12,2) sino ${monto.tipo}(${monto.precision},${monto.escala})`,
      );
    }

    await db.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
    await db.$executeRawUnsafe(`
      CREATE TABLE "${esquema}"."orden" (
        "id" TEXT PRIMARY KEY,
        "monto_cobrar" DECIMAL(12,2),
        "deleted_at" TIMESTAMP(3)
      )
    `);
  }, 60_000);

  afterAll(async () => {
    await db?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
    await db?.$disconnect();
  });

  // El defecto, medido ANTES de aplicar nada. Sin esto, los tests de abajo demostrarian que un
  // CHECK funciona, no que hubiera algo que arreglar.
  it("ANTES del up: un `UPDATE` a mano mete centimos sin que nada lo impida", async () => {
    expect(await constraintPuesta()).toBeNull();
    await insertar("previa", "11899");
    expect(
      await rechazo(
        db.$executeRawUnsafe(
          `UPDATE "${esquema}"."orden" SET "monto_cobrar" = 11898.81 WHERE "id" = 'previa'`,
        ),
      ),
    ).toBeNull();
    const filas = await db.$queryRawUnsafe<Array<{ monto: string }>>(
      `SELECT "monto_cobrar"::text AS monto FROM "${esquema}"."orden" WHERE "id" = 'previa'`,
    );
    expect(filas[0].monto).toBe("11898.81");
    await db.$executeRawUnsafe(`DELETE FROM "${esquema}"."orden"`);
  });

  it("el UP real aplica y deja la constraint VALIDADA (no `NOT VALID`)", async () => {
    await db.$executeRawUnsafe(sqlDe("migration.sql"));
    const puesta = await constraintPuesta();
    expect(puesta).not.toBeNull();
    expect(puesta?.valida, "quedo NOT VALID: no protege lo que ya hay").toBe(true);
    expect(puesta?.def).toMatch(/trunc/);
  });

  it("un monto ENTERO entra, y `NULL` tambien (sin monto a cobrar es legitimo)", async () => {
    expect(await rechazo(insertar("entera", "11899"))).toBeNull();
    expect(await rechazo(insertar("sin-monto", null))).toBeNull();
    expect(await montosGuardados()).toEqual(["entera", "sin-monto"]);
  });

  it("un monto CON CENTIMOS rebota — el caso real `11898.81`", async () => {
    expect(await rechazo(insertar("con-centimos", "11898.81"))).toBe(CONSTRAINT);
    // Y el centimo suelto tambien: la regla es «entero», no «pocos decimales».
    expect(await rechazo(insertar("un-centimo", "0.01"))).toBe(CONSTRAINT);
    expect(await montosGuardados()).toEqual(["entera", "sin-monto"]);
  });

  it("el `UPDATE` A MANO —el camino por el que entraron las 14 ordenes— rebota", async () => {
    expect(
      await rechazo(
        db.$executeRawUnsafe(
          `UPDATE "${esquema}"."orden" SET "monto_cobrar" = 11898.81 WHERE "id" = 'entera'`,
        ),
      ),
    ).toBe(CONSTRAINT);
  });

  it("ALCANCE: la restriccion llega TAMBIEN a las ordenes borradas (decision de la ficha)", async () => {
    // Un `CHECK` no admite predicado, asi que exentar a las borradas exigiria escribirlo. NO se
    // hace: `deleted_at` se pone y se quita con un UPDATE, y una orden borrada con centimos es
    // una orden imposible de entregar esperando a que alguien la restaure.
    expect(await rechazo(insertar("borrada-con-centimos", "11898.81", true))).toBe(CONSTRAINT);
    expect(await rechazo(insertar("borrada-entera", "11899", true))).toBeNull();
    expect(
      await rechazo(
        db.$executeRawUnsafe(
          `UPDATE "${esquema}"."orden" SET "monto_cobrar" = 0.5 WHERE "id" = 'borrada-entera'`,
        ),
      ),
    ).toBe(CONSTRAINT);
  });

  it("AL REVES · el DOWN la suelta y los centimos vuelven a entrar", async () => {
    await db.$executeRawUnsafe(sqlDe("down.sql"));
    expect(await constraintPuesta()).toBeNull();
    // Que ahora SI entre es lo que prueba que era la constraint —y no otra cosa— la que
    // rechazaba arriba.
    expect(await rechazo(insertar("sucia", "11898.81"))).toBeNull();
  });

  it("AL REVES · el DOWN es idempotente: correrlo dos veces no es un error", async () => {
    expect(await rechazo(db.$executeRawUnsafe(sqlDe("down.sql")))).toBeNull();
  });

  it("AL REVES · volver a subir ABORTA mientras la fila sucia siga ahi, y eso es lo correcto", async () => {
    // Es la propiedad que hace util a la migracion: valida lo que YA existe en vez de fiarse.
    // Un `NOT VALID` habria pasado aqui en verde dejando la fila imposible de entregar dentro.
    expect(await rechazo(db.$executeRawUnsafe(sqlDe("migration.sql")))).toBe(CONSTRAINT);
    expect(await constraintPuesta()).toBeNull();
  });

  it("AL REVES · limpiada la fila, el segundo UP entra y vuelve a rechazar los centimos", async () => {
    await db.$executeRawUnsafe(`DELETE FROM "${esquema}"."orden" WHERE "id" = 'sucia'`);
    await db.$executeRawUnsafe(sqlDe("migration.sql"));
    expect((await constraintPuesta())?.valida).toBe(true);
    expect(await rechazo(insertar("otra-con-centimos", "11898.81"))).toBe(CONSTRAINT);
    expect(await rechazo(insertar("otra-entera", "12000"))).toBeNull();
  });
});
