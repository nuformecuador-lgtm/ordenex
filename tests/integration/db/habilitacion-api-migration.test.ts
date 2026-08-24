import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";
import { quitarComentariosSql } from "@/tests/fixtures/sin-comentarios";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

// Feature 266 (T1.1 + T1.2) — cobertura de LAS DOS migraciones de la ficha:
//
//   20260823120000_orden_historial_origen_habilitacion_api  -> el valor de enum `habilitacion_api`
//   20260823130000_orden_habilitacion_api                   -> la tabla bitacora
//
// Cubre R21/R23/R24 (la forma append-only de la bitacora y su paridad con `schema.prisma`),
// R29 (RLS habilitada SIN policies) y R30 (el down del enum ABORTA ruidosamente en vez de
// tragarse filas en silencio).
//
// POR QUE ESTE ARCHIVO NO SE CONFORMA CON REGEX SOBRE EL SQL. Un `expect(sql).toMatch(...)`
// demuestra que alguien ESCRIBIO una linea, no que Postgres la haya entendido como se pretendia.
// `ENABLE ROW LEVEL SECURITY`, `ON DELETE CASCADE`/`RESTRICT` y los indices son HECHOS DEL MOTOR:
// o los verifica el motor, o no estan verificados. (La feature 212 fue RECHAZADA justamente por un
// test de migracion que solo miraba el texto.) Por eso la mitad de la TABLA se EJECUTA de verdad,
// con el molde literal de `tests/integration/db/orden-nota-migration.test.ts`: dentro de una
// transaccion que SIEMPRE se revierte, se crea un ESQUEMA temporal, se ejecuta ahi el
// `migration.sql` REAL sentencia a sentencia, se leen los CATALOGOS (`information_schema.columns`,
// `pg_constraint`, `pg_indexes`, `pg_class.relrowsecurity`, `pg_policies`), se insertan filas
// PROPIAS, se ejercita el borrado y al final se corre el `down.sql` REAL. `public` sigue en el
// `search_path` porque las dos FK apuntan a las tablas `orden` y `usuario` REALES: contra tablas de
// juguete, el CASCADE y el RESTRICT medidos serian de mentira. No sobrevive nada, y
// `_prisma_migrations` no se toca.
//
// POR QUE LA MITAD DEL ENUM ES ESTATICA, Y NO ES UNA CONCESION. `ALTER TYPE ... ADD VALUE` opera
// sobre un tipo GLOBAL al esquema (aqui, el `orden_historial_origen_tipo` REAL de `public`, que ni
// se puede ni se debe tocar desde un test) y Postgres lo restringe dentro de una transaccion.
// Ejecutarlo en el esquema temporal no mediria nada real. Lo que SI se puede afirmar sin motor —y
// es lo que R30 exige— es la FORMA del `down.sql`: su lista de valores comparada CONTRA EL SEED de
// TypeScript, y la ausencia de cualquier valvula de escape en el `USING`. Mismo enfoque, y misma
// justificacion, que `tests/integration/db/rechazo-tienda-migration.test.ts` (240).
//
// POR QUE NO PUEDE QUEDAR VERDE POR VACIO: el bloque del motor no consulta ni una fila
// preexistente de negocio; crea su propia orden y sus propias filas de bitacora. Lo unico que lo
// salta es la ausencia de `DATABASE_URL` (entonces vitest lo marca SKIPPED, nunca passed); y si la
// base no tuviera catalogos sembrados, FALLA con el motivo escrito en vez de abstenerse.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

const DIR_ENUM = "20260823120000_orden_historial_origen_habilitacion_api";
const DIR_TABLA = "20260823130000_orden_habilitacion_api";
const FAMILIA = "habilitacion_api";
const TABLA = "orden_habilitacion_api";

function leer(dir: string, archivo: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, dir, archivo), "utf8");
}

const enumUp = leer(DIR_ENUM, "migration.sql");
const enumDown = leer(DIR_ENUM, "down.sql");
const tablaUp = leer(DIR_TABLA, "migration.sql");
const tablaDown = leer(DIR_TABLA, "down.sql");

/**
 * El SQL EJECUTABLE, sin lineas de comentario: la prosa de estos archivos nombra a proposito las
 * palabras que el propio test parte por `;` —y las que censa—, y sin limpiar primero se
 * ejecutarian trozos de documentacion o se afirmarian frases de la explicacion.
 */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith("--"))
    .join("\n");
}

function sentenciasDe(ddl: string): string[] {
  return ddl
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const tablaUpDdl = sinComentarios(tablaUp);
const tablaDownDdl = sinComentarios(tablaDown);

/* ================================================================================================
 * ASERTO 3 y 4 — las dos migraciones, su orden y sus dos `down.sql`
 * ============================================================================================= */

describe("266 / migraciones — dos carpetas SEPARADAS, en el orden que Postgres obliga", () => {
  // ASERTO 3.
  it("el enum y la tabla van en migraciones DISTINTAS, y la del enum es ANTERIOR por timestamp", () => {
    // POR QUE NO PUEDEN IR JUNTAS: Prisma Migrate corre cada `migration.sql` en UNA transaccion, y
    // Postgres no permite USAR un valor de enum recien anadido dentro de la misma transaccion que
    // lo anadio (55P04). Fundirlas dejaria la migracion sin aplicar en cuanto alguien anadiera un
    // `INSERT` o un `DEFAULT` que nombrase la familia. Y el orden importa en la direccion que
    // esta: el valor tiene que existir ANTES de que nada lo use.
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(dirs).toContain(DIR_ENUM);
    expect(dirs).toContain(DIR_TABLA);
    expect(dirs.indexOf(DIR_ENUM)).toBeLessThan(dirs.indexOf(DIR_TABLA));
    expect(DIR_ENUM < DIR_TABLA).toBe(true);

    // Y son de verdad DOS: la del enum no crea la tabla, y la de la tabla no toca el enum.
    const sqlEnum = quitarComentariosSql(enumUp);
    const sqlTabla = quitarComentariosSql(tablaUp);
    expect(sqlEnum).not.toMatch(/CREATE TABLE/i);
    expect(sqlEnum.match(/ALTER TYPE/g) ?? []).toHaveLength(1);
    expect(sqlTabla).not.toMatch(/ALTER TYPE/i);
    expect(sqlTabla).not.toMatch(/CREATE TYPE/i);
    // La de la tabla tampoco USA el valor nuevo (seria el 55P04 por la puerta de atras).
    expect(sqlTabla).not.toContain(`'${FAMILIA}'`);
  });

  // ASERTO 4.
  it("las DOS traen `down.sql`, y el de la tabla NO lleva `DROP TYPE`", () => {
    for (const dir of [DIR_ENUM, DIR_TABLA]) {
      expect(fs.existsSync(path.join(MIGRATIONS_DIR, dir, "migration.sql")), dir).toBe(true);
      expect(fs.existsSync(path.join(MIGRATIONS_DIR, dir, "down.sql")), dir).toBe(true);
    }
    // Cada down revierte EXACTAMENTE lo que su up hizo, ni un objeto mas. El enum no es suyo: lo
    // crea —y lo retira— la migracion anterior con su propio down. Un `DROP TYPE` aqui tumbaria un
    // tipo que `orden_historial_estado` sigue usando.
    const sqlTablaDown = quitarComentariosSql(tablaDown);
    expect(sqlTablaDown).not.toMatch(/DROP TYPE/i);
    expect(sqlTablaDown).toMatch(new RegExp(`DROP TABLE IF EXISTS "${TABLA}"`));
    // Y al reves: el down del enum no tira la tabla de la otra migracion.
    expect(quitarComentariosSql(enumDown)).not.toMatch(/DROP TABLE/i);
  });

  it("ninguna cadena del SQL contiene `;` — lo que hace valido partir el DDL por `;`", () => {
    // El bloque de Postgres real ejecuta el `migration.sql` REAL partiendolo por `;`. Si algun dia
    // un literal llevara un `;` dentro, ese split partiria una sentencia por la mitad y el bloque
    // fallaria por un motivo que no es el suyo.
    for (const literal of [
      ...(tablaUp.match(/'[^']*'/g) ?? []),
      ...(tablaDown.match(/'[^']*'/g) ?? []),
    ]) {
      expect(literal, `este literal del .sql contiene un ';': ${literal}`).not.toContain(";");
    }
  });
});

/* ================================================================================================
 * ASERTO 2 — el `down.sql` del enum: la lista exacta, y el aborto ruidoso (R30)
 * ============================================================================================= */

describe("266 / enum — el DOWN recrea el tipo SIN la familia y aborta si alguien la usa (R30)", () => {
  it("el UP anade el valor con `IF NOT EXISTS` y la familia esta en el SEED de TS", () => {
    expect(quitarComentariosSql(enumUp)).toMatch(
      new RegExp(
        `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS '${FAMILIA}';`,
      ),
    );
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain(FAMILIA);
  });

  // ASERTO 2 (primera mitad).
  it("la lista del DOWN es EXACTAMENTE el SEED menos `habilitacion_api`, y son 31 valores", () => {
    expect(enumDown).toMatch(
      /ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";/,
    );
    const match = enumDown.match(
      /CREATE TYPE "orden_historial_origen_tipo" AS ENUM \(([\s\S]*?)\);/,
    );
    expect(match, "el down no recrea el tipo").not.toBeNull();
    const valores = [...(match as RegExpMatchArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

    expect(valores).toHaveLength(31);
    expect(valores).not.toContain(FAMILIA);
    // No se compara contra una lista copiada a mano —eso solo probaria que dos ficheros dicen lo
    // mismo— sino CONTRA EL SEED que el codigo usa en runtime. Si el enum de la base y el de TS se
    // separasen, aqui se veria.
    //
    // ⏳ 2026-08-24 (merge de la 276) — EL DIA LLEGO, y se resuelve como dice la nota del final de
    // este caso: `rechazo_tope_intentos` (0824, POSTERIOR a esta migracion) entra en POSTERIORES y
    // la foto historica de la 266 no se toca ni una linea.
    const POSTERIORES = ["rechazo_tope_intentos"]; // feature 276 (2026-08-24)
    expect(new Set(valores)).toEqual(
      new Set(
        (ORDEN_HISTORIAL_ORIGEN_TIPO_SEED as readonly string[]).filter(
          (v) => v !== FAMILIA && !POSTERIORES.includes(v),
        ),
      ),
    );
    // Sin duplicados: `CREATE TYPE` con un valor repetido no llega ni a aplicarse.
    expect(new Set(valores).size).toBe(valores.length);

    // ⏳ El dia que otra ficha anada un valor mas al enum, este caso se pone rojo. Lo que hay que
    // hacer NO es editar este `down.sql` —es una foto historica del estado previo a la 266— sino
    // nombrar el valor nuevo en una lista de POSTERIORES aqui, como la 240 hizo con esta familia.
  });

  // ASERTO 2 (segunda mitad) — R30.
  it("el `USING` no lleva ELSE, NULLIF ni CASE: ABORTA en vez de tragarse filas en silencio", () => {
    const sql = quitarComentariosSql(enumDown);
    expect(sql).toMatch(
      /ALTER TABLE "orden_historial_estado"\s+ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"\s+USING \("origen_tipo"::text::"orden_historial_origen_tipo"\);/,
    );
    // EL ABORTO ES EL COMPORTAMIENTO EXIGIDO POR R30, no un defecto que suavizar. Un `USING` con
    // `CASE ... ELSE 'ajuste_estado'` o con `NULLIF` haria pasar el rollback COLAPSANDO las filas
    // de la familia a otra cosa: esas filas son la UNICA evidencia de que la orden volvio a
    // `en_reparto` porque LO PIDIO EL INTEGRADOR por la API key, y `actor_usuario_id` no las
    // distingue (el usuario dedicado de la key ES la tienda). Reetiquetarlas en silencio durante un
    // rollback es perder la evidencia sin que nadie se entere; abortar obliga a mirarlas a mano.
    // Se censa sobre el SQL EJECUTABLE porque la prosa del propio down NOMBRA `USING ... ELSE`
    // para explicar por que NO lo usa.
    expect(sql).not.toMatch(/\bELSE\b/i);
    expect(sql).not.toMatch(/\bNULLIF\b/i);
    expect(sql).not.toMatch(/\bCASE\b/i);
    expect(sql).not.toMatch(/\bCOALESCE\b/i);
    // Tampoco se limpia el terreno por su cuenta: ni borrar ni reescribir filas de historial.
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/UPDATE\s+"orden_historial_estado"/i);
    // Y suelta el tipo viejo, para no dejar un huerfano en el catalogo.
    expect(sql).toMatch(/DROP TYPE "orden_historial_origen_tipo_old";/);
  });

  it("el DOWN deja escrita la precondicion y que el fallo es RUIDOSO", () => {
    // La prosa importa aqui —al contrario que arriba—: quien corra este rollback a las 3 de la
    // manana tiene que leer POR QUE aborto antes de "arreglarlo".
    expect(enumDown).toMatch(/Precondicion/i);
    expect(enumDown).toContain(FAMILIA);
    expect(enumDown).toMatch(/RUIDOSAMENTE/i);
  });
});

/* ================================================================================================
 * ASERTO 5 — paridad entre el `CREATE TABLE` y `schema.prisma`
 * ============================================================================================= */

/** Las columnas del `CREATE TABLE` del `migration.sql`, en orden y sin las lineas de CONSTRAINT. */
function columnasDelSql(): string[] {
  const cuerpo = tablaUpDdl.match(new RegExp(`CREATE TABLE "${TABLA}" \\(([\\s\\S]*?)\\n\\);`));
  if (!cuerpo) throw new Error(`no se pudo leer el cuerpo del CREATE TABLE de ${TABLA}`);
  return cuerpo[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !/^CONSTRAINT/i.test(l))
    .map((l) => l.match(/^"(\w+)"\s+\S/)?.[1])
    .filter((n): n is string => Boolean(n));
}

/** Las columnas del modelo `OrdenHabilitacionApi` de `schema.prisma` (el `@map`, o el nombre). */
function columnasDelPrisma(): string[] {
  const schema = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");
  const modelo = schema.match(/model OrdenHabilitacionApi \{([\s\S]*?)\n\}/);
  if (!modelo) throw new Error("no se encontro `model OrdenHabilitacionApi` en db/schema.prisma");
  const ESCALARES = /^(String|Boolean|DateTime|Int|BigInt|Float|Decimal|Json|Bytes)\??$/;
  return modelo[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"))
    .map((l) => {
      const [campo, tipo] = l.split(/\s+/);
      if (!tipo || !ESCALARES.test(tipo)) return undefined; // relaciones fuera
      return l.match(/@map\("(\w+)"\)/)?.[1] ?? campo;
    })
    .filter((n): n is string => Boolean(n));
}

describe("266 / paridad — el SQL y `schema.prisma` describen la MISMA tabla (R24)", () => {
  // ASERTO 5.
  it("las columnas del CREATE TABLE y las del modelo Prisma coinciden, una a una", () => {
    // El drift entre los dos ficheros no lo detecta el typecheck: el cliente de Prisma se genera
    // del `schema.prisma`, no de la migracion, asi que una columna que solo existiera en uno de los
    // dos compilaria igual y reventaria en runtime contra la base real.
    const sql = columnasDelSql();
    const prisma = columnasDelPrisma();
    expect(sql.length, "el parser del CREATE TABLE no leyo ninguna columna").toBeGreaterThan(0);
    expect([...sql].sort()).toEqual([
      "actor_usuario_id",
      "cambio_de_estado",
      "created_at",
      "estado_resultante",
      "id",
      "nota",
      "orden_id",
    ]);
    expect([...prisma].sort()).toEqual([...sql].sort());
  });

  // ASERTO 5 (la parte que de verdad se puede romper por descuido).
  it("R24: NI `updated_at` NI `deleted_at`, en ninguno de los dos — la bitacora es append-only", () => {
    // No es un olvido y por eso se afirma su AUSENCIA: una segunda habilitacion de la misma orden
    // con otra nota es un HECHO NUEVO, no una correccion del anterior. Anadir `updated_at` invita a
    // sobrescribir la fila; anadir `deleted_at` invita a ocultarla. Mismo criterio que
    // `orden_historial_estado`.
    for (const columna of ["updated_at", "deleted_at"]) {
      expect(columnasDelSql(), columna).not.toContain(columna);
      expect(columnasDelPrisma(), columna).not.toContain(columna);
    }
    // Y el UP no es una migracion disfrazada de otra cosa: no lee, no copia y no mueve nada.
    for (const sentencia of sentenciasDe(tablaUpDdl)) {
      expect(sentencia, sentencia).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|SELECT)\b/i);
    }
  });
});

/* ================================================================================================
 * ASERTO 1 (y los hechos del motor que salen gratis) — el DDL de la TABLA, EJECUTADO
 * ============================================================================================= */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

interface ColumnaReal {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
}

interface RestriccionReal {
  conname: string;
  contype: string;
  columnas: string[];
  tabla_referenciada: string | null;
  /** `a` no action, `r` restrict, `c` cascade, `n` set null, `d` set default. */
  confdeltype: string | null;
}

interface Medicion {
  columnas: ColumnaReal[];
  restricciones: RestriccionReal[];
  indices: { indexname: string; indexdef: string }[];
  rls: { relname: string; relrowsecurity: boolean }[];
  policies: number;
  filasAntesDeBorrarLaOrden: number;
  filasTrasBorrarLaOrden: number;
  huerfanas: number;
  errores: Record<string, string>;
  tablasTrasElDown: string[];
}

describeSiHayBase("266 / tabla — el DDL REAL contra Postgres (R21/R23/R29)", () => {
  let prisma: PrismaClient;
  let medicion: Medicion;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    medicion = await enTransaccionRevertida(prisma, async (tx) => medir(tx));
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function medir(tx: Tx): Promise<Medicion> {
    // PRIMERA sentencia de la transaccion, antes de tocar nada: este archivo escribe en
    // `public."usuario"` y `public."orden"` y crea FK contra ellas, igual que otros tests que
    // corren en paralelo. Sin serializar, todos toman los mismos locks en distinto orden y
    // Postgres mata a uno con `40P01`, dejando sus casos en SKIPPED en vez de ejecutarse.
    await serializarEscriturasReales(tx);

    const esquema = `t266_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
    // `public` se queda en el search_path: las dos FK se resuelven contra las tablas REALES.
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${esquema}", public`);

    for (const sentencia of sentenciasDe(tablaUpDdl)) {
      await tx.$executeRawUnsafe(sentencia);
    }

    const columnas = await tx.$queryRawUnsafe<ColumnaReal[]>(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      esquema,
      TABLA,
    );

    const restricciones = await tx.$queryRawUnsafe<RestriccionReal[]>(
      `SELECT c.conname,
              c.contype::text AS contype,
              ARRAY(
                SELECT a.attname::text
                  FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                 ORDER BY k.ord
              ) AS columnas,
              CASE WHEN c.contype = 'f' THEN rel.relname::text ELSE NULL END AS tabla_referenciada,
              CASE WHEN c.contype = 'f' THEN c.confdeltype::text ELSE NULL END AS confdeltype
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         LEFT JOIN pg_class rel ON rel.oid = c.confrelid
        WHERE n.nspname = $1 AND t.relname = $2
        ORDER BY c.conname`,
      esquema,
      TABLA,
    );

    const indices = await tx.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = $1 AND tablename = $2
        ORDER BY indexname`,
      esquema,
      TABLA,
    );

    const rls = await tx.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind = 'r'
        ORDER BY c.relname`,
      esquema,
    );

    const [{ n: policies }] = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = $1 AND tablename = $2`,
      esquema,
      TABLA,
    );

    // --- datos PROPIOS del test (nada preexistente) -------------------------------------------
    const tienda = await crearUsuario(tx);
    const mensajero = await crearUsuario(tx);
    // El actor de la bitacora es un usuario que NO aparece en ninguna columna de `orden`: asi, si
    // borrarlo falla, el unico culpable posible es NUESTRA FK y no otra.
    const actor = await crearUsuario(tx);
    const ordenId = await crearOrden(tx, tienda.id, mensajero.id);

    // Rama A (la orden volvio a `en_reparto`) y rama B (solo log): las dos filas que el service
    // puede escribir, para que el CASCADE se mida sobre las dos.
    await tx.$executeRawUnsafe(
      `INSERT INTO "${TABLA}" ("id","orden_id","actor_usuario_id","nota","cambio_de_estado","estado_resultante")
       VALUES ($1, $2, $3, 'el cliente pidio reintento', true, 'en_reparto')`,
      randomUUID(),
      ordenId,
      actor.id,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "${TABLA}" ("id","orden_id","actor_usuario_id","nota","cambio_de_estado","estado_resultante")
       VALUES ($1, $2, $3, 'el paquete ya volvio a bodega', false, 'devuelta')`,
      randomUUID(),
      ordenId,
      actor.id,
    );

    const errores: Record<string, string> = {
      // La nota es OBLIGATORIA: en la rama B el log es lo UNICO que queda del caso.
      nota_nula: await resultadoDe(
        tx,
        `INSERT INTO "${TABLA}" ("id","orden_id","actor_usuario_id","nota","cambio_de_estado","estado_resultante")
         VALUES ('${randomUUID()}', '${ordenId}', '${actor.id}', NULL, true, 'en_reparto')`,
      ),
      // `cambio_de_estado` es ESCRITO, no derivado, y no admite el hueco.
      cambio_nulo: await resultadoDe(
        tx,
        `INSERT INTO "${TABLA}" ("id","orden_id","actor_usuario_id","nota","cambio_de_estado","estado_resultante")
         VALUES ('${randomUUID()}', '${ordenId}', '${actor.id}', 'x', NULL, 'en_reparto')`,
      ),
      // Una bitacora sobre una orden inexistente no puede nacer.
      orden_inexistente: await resultadoDe(
        tx,
        `INSERT INTO "${TABLA}" ("id","orden_id","actor_usuario_id","nota","cambio_de_estado","estado_resultante")
         VALUES ('${randomUUID()}', '${randomUUID()}', '${actor.id}', 'x', false, 'devuelta')`,
      ),
      // RESTRICT: la autoria es evidencia y no se pierde al dar de baja al usuario de la key.
      borrar_actor_con_filas: await resultadoDe(
        tx,
        `DELETE FROM public."usuario" WHERE "id" = '${actor.id}'`,
      ),
    };

    const [{ n: antes }] = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "${TABLA}" WHERE "orden_id" = $1`,
      ordenId,
    );

    // El CASCADE, ejercitado: se borra la ORDEN y se cuenta lo que queda.
    await tx.$executeRawUnsafe(`DELETE FROM public."orden" WHERE "id" = $1`, ordenId);
    const [{ n: despues }] = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "${TABLA}" WHERE "orden_id" = $1`,
      ordenId,
    );
    const [{ n: huerfanas }] = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n
         FROM "${TABLA}" h
        WHERE NOT EXISTS (SELECT 1 FROM public."orden" o WHERE o."id" = h."orden_id")`,
    );

    // El `down.sql` REAL deja el esquema como estaba.
    for (const sentencia of sentenciasDe(tablaDownDdl)) await tx.$executeRawUnsafe(sentencia);
    const tablasTrasElDown = (
      await tx.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
        esquema,
      )
    ).map((r) => r.table_name);

    return {
      columnas,
      restricciones,
      indices,
      rls,
      policies: Number(policies),
      filasAntesDeBorrarLaOrden: Number(antes),
      filasTrasBorrarLaOrden: Number(despues),
      huerfanas: Number(huerfanas),
      errores,
      tablasTrasElDown,
    };
  }

  /**
   * Ejecuta `sql` dentro de un SAVEPOINT y devuelve el MENSAJE de error, o `""` si paso. Sin el
   * savepoint, la primera violacion esperada abortaria la transaccion entera y mataria el resto de
   * las mediciones.
   */
  async function resultadoDe(tx: Tx, sql: string): Promise<string> {
    await tx.$executeRawUnsafe("SAVEPOINT s266");
    try {
      await tx.$executeRawUnsafe(sql);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s266");
      return "";
    } catch (error) {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s266");
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Un usuario NUEVO, creado por el test. Si faltaran los catalogos, FALLA con el motivo escrito
   * en vez de saltarse: un test que se abstiene porque la base esta vacia es exactamente el
   * verde-en-falso que este archivo existe para evitar.
   */
  async function crearUsuario(tx: Tx): Promise<{ id: string }> {
    const [rol] = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM public."rol" LIMIT 1`);
    const [tipo] = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM public."tipo_identificacion" LIMIT 1`,
    );
    if (!rol || !tipo) {
      throw new Error(
        "La base de pruebas no tiene catalogos `rol`/`tipo_identificacion` sembrados: sin " +
          "ellos no se puede crear el usuario propio del test. Corre `pnpm db:seed`. Este " +
          "test NO se salta en ese caso a proposito.",
      );
    }
    const id = randomUUID();
    const sufijo = id.slice(0, 8);
    await tx.$executeRawUnsafe(
      `INSERT INTO public."usuario"
         ("id","nombre","email","telefono","password_hash","cedula","tipo_identificacion_id","rol_id","updated_at")
       VALUES ($1, $2, $3, '00000000', 'x', $4, $5, $6, now())`,
      id,
      `Usuario ${sufijo}`,
      `t266-${sufijo}@example.test`,
      `t266${sufijo}`,
      tipo.id,
      rol.id,
    );
    return { id };
  }

  /** Una orden NUEVA del test, con las FK obligatorias tomadas de los catalogos. */
  async function crearOrden(tx: Tx, tiendaId: string, mensajeroId: string): Promise<string> {
    const [geo] = await tx.$queryRawUnsafe<
      { zona_id: string; provincia_id: string; canton_id: string }[]
    >(
      `SELECT z."id" AS zona_id, p."id" AS provincia_id, c."id" AS canton_id
         FROM public."zona" z, public."provincia" p, public."canton" c
        WHERE c."provincia_id" = p."id"
        LIMIT 1`,
    );
    const [estatus] = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM public."order_status" LIMIT 1`,
    );
    if (!geo || !estatus) {
      throw new Error(
        "La base de pruebas no tiene catalogos de geografia/estatus sembrados: sin ellos no se " +
          "puede crear la orden propia del test (y sin orden, el CASCADE no se puede ejercitar). " +
          "Corre `pnpm db:seed`. Este test NO se salta en ese caso a proposito.",
      );
    }
    const id = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO public."orden"
         ("id","num_remision","estatus_id","destinatario","telefono_dest","tienda_id","zona_id",
          "provincia_id","canton_id","producto","mensajero_asignado_id","updated_at")
       VALUES ($1, $2, $3, 'Destinatario de prueba', '00000000', $4, $5, $6, $7, 'Producto', $8, now())`,
      id,
      `t266-${id.slice(0, 8)}`,
      estatus.id,
      tiendaId,
      geo.zona_id,
      geo.provincia_id,
      geo.canton_id,
      mensajeroId,
    );
    return id;
  }

  it("la tabla existe con las SIETE columnas del design y sus tipos", () => {
    const porNombre = Object.fromEntries(medicion.columnas.map((c) => [c.column_name, c]));
    expect(Object.keys(porNombre).sort()).toEqual([
      "actor_usuario_id",
      "cambio_de_estado",
      "created_at",
      "estado_resultante",
      "id",
      "nota",
      "orden_id",
    ]);
    expect(porNombre.id.data_type).toBe("text");
    expect(porNombre.orden_id.data_type).toBe("text");
    expect(porNombre.actor_usuario_id.data_type).toBe("text");
    expect(porNombre.nota.data_type).toBe("text");
    expect(porNombre.cambio_de_estado.data_type).toBe("boolean");
    // SNAPSHOT y no referencia viva: `text`, NO una FK a `order_status` ni un enum.
    expect(porNombre.estado_resultante.data_type).toBe("text");
    expect(porNombre.estado_resultante.udt_name).toBe("text");
    expect(porNombre.created_at.data_type).toBe("timestamp without time zone");
    expect(porNombre.created_at.column_default).toBe("CURRENT_TIMESTAMP");
  });

  // ASERTO 5, ahora medido por el MOTOR y no por el parser del .sql.
  it("R24: NINGUNA columna admite NULL, y el motor no conoce `updated_at` ni `deleted_at`", () => {
    const porNombre = Object.fromEntries(medicion.columnas.map((c) => [c.column_name, c]));
    for (const c of medicion.columnas) expect(c.is_nullable, c.column_name).toBe("NO");
    expect(porNombre.updated_at).toBeUndefined();
    expect(porNombre.deleted_at).toBeUndefined();
  });

  it("la PK es `id`, y son exactamente DOS FK", () => {
    const pk = medicion.restricciones.filter((r) => r.contype === "p");
    expect(pk).toHaveLength(1);
    expect(pk[0].conname).toBe(`${TABLA}_pkey`);
    expect(pk[0].columnas).toEqual(["id"]);
    expect(medicion.restricciones.filter((r) => r.contype === "f")).toHaveLength(2);
  });

  it("la FK a `orden` es ON DELETE CASCADE, leida de pg_constraint", () => {
    const fk = medicion.restricciones.find((r) => r.conname === `${TABLA}_orden_id_fkey`);
    expect(fk).toBeDefined();
    expect(fk!.contype).toBe("f");
    expect(fk!.columnas).toEqual(["orden_id"]);
    expect(fk!.tabla_referenciada).toBe("orden");
    expect(fk!.confdeltype).toBe("c"); // c = CASCADE
  });

  it("la FK a `usuario` es ON DELETE RESTRICT: la autoria no se pierde", () => {
    const fk = medicion.restricciones.find((r) => r.conname === `${TABLA}_actor_usuario_id_fkey`);
    expect(fk).toBeDefined();
    expect(fk!.contype).toBe("f");
    expect(fk!.columnas).toEqual(["actor_usuario_id"]);
    expect(fk!.tabla_referenciada).toBe("usuario");
    expect(fk!.confdeltype).toBe("r"); // r = RESTRICT
  });

  it("borrar al ACTOR de una habilitacion FALLA (el RESTRICT, ejercitado)", () => {
    expect(medicion.errores.borrar_actor_con_filas).toMatch(
      new RegExp(`${TABLA}_actor_usuario_id_fkey`),
    );
  });

  it("borrar la orden ARRASTRA sus filas y no deja ni una huerfana (el CASCADE, ejercitado)", () => {
    // El `2` de antes es la mitad del test: sin el, un `0` despues podria significar que las filas
    // nunca llegaron a existir. Y se van las DOS ramas, la que cambio el estado y la que no.
    expect(medicion.filasAntesDeBorrarLaOrden).toBe(2);
    expect(medicion.filasTrasBorrarLaOrden).toBe(0);
    expect(medicion.huerfanas).toBe(0);
  });

  it("existe el indice (orden_id, created_at) EN ESE ORDEN, y el de la segunda FK", () => {
    const porNombre = Object.fromEntries(medicion.indices.map((i) => [i.indexname, i.indexdef]));
    expect(Object.keys(porNombre).sort()).toEqual([
      `${TABLA}_actor_usuario_id_idx`,
      `${TABLA}_orden_id_created_at_idx`,
      `${TABLA}_pkey`,
    ]);
    // El orden de las columnas NO es cosmetico: un indice (created_at, orden_id) no sirve para
    // «todas las habilitaciones de ESTA orden, ordenadas», que es la lectura que la tabla existe
    // para soportar el dia que alguien la exponga.
    expect(porNombre[`${TABLA}_orden_id_created_at_idx`]).toMatch(/\(orden_id, created_at\)\s*$/);
    expect(porNombre[`${TABLA}_actor_usuario_id_idx`]).toMatch(/\(actor_usuario_id\)\s*$/);
  });

  // ASERTO 1 — leido de `pg_class`, no del `.sql`.
  it("R29: relrowsecurity es true en `orden_habilitacion_api`", () => {
    expect(medicion.rls).toEqual([{ relname: TABLA, relrowsecurity: true }]);
  });

  // ASERTO 1 (segunda mitad) — leido de `pg_policies`.
  it("R29: CERO policies — solo el service role entra; la autorizacion vive en el service", () => {
    // Con RLS encendida y sin ninguna policy, cualquier rol que no sea el service role (ni el
    // dueno de la tabla) lee CERO filas y no puede escribir. Es el patron de `orden_nota` /
    // `orden_historial_estado` / `gestion_orden`: la unica regla de negocio —la orden tiene que ser
    // del owner de la key— vive en el service, no duplicada en SQL donde se desincronizaria.
    expect(medicion.policies).toBe(0);
  });

  it("la base rechaza una nota NULL, un `cambio_de_estado` NULL y una orden inexistente", () => {
    expect(medicion.errores.nota_nula).toMatch(/nota/);
    expect(medicion.errores.cambio_nulo).toMatch(/cambio_de_estado/);
    expect(medicion.errores.orden_inexistente).toMatch(new RegExp(`${TABLA}_orden_id_fkey`));
  });

  it("el down.sql REAL deja el esquema sin rastro de la tabla", () => {
    expect(medicion.tablasTrasElDown).toEqual([]);
  });
});
