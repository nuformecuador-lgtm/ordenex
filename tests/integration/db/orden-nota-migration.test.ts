import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";

// Feature 227 (T1.3) — cobertura de la migracion M1 `*_orden_nota`. Cubre R26 (RLS habilitada
// SIN policies), R28 (el indice compuesto que sostiene la lectura del hilo en UNA consulta) y
// R30 (borrar la orden arrastra sus notas, sin huerfanas).
//
// POR QUE ESTE ARCHIVO NO SE CONFORMA CON REGEX SOBRE EL SQL. Un `expect(sql).toMatch(...)`
// demuestra que alguien ESCRIBIO una linea, no que Postgres la haya entendido como se
// pretendia. `ON DELETE CASCADE`, `ON DELETE RESTRICT`, `ENABLE ROW LEVEL SECURITY` y un
// indice compuesto son HECHOS DEL MOTOR: o los verifica el motor, o no estan verificados.
// (La feature 212 fue RECHAZADA justamente por un test de migracion que solo miraba el texto.)
//
// Como se mide sin ensuciar nada: dentro de una transaccion que SIEMPRE se revierte, se crea
// un ESQUEMA temporal, se ejecuta ahi el `migration.sql` REAL —sentencia a sentencia, no una
// parafrasis—, se leen los catalogos (`information_schema`, `pg_constraint`, `pg_indexes`,
// `pg_class`, `pg_policies`), se INSERTAN filas propias y se ejercita el borrado de verdad, y
// al final se corre el `down.sql` REAL. `public` sigue en el `search_path` porque las dos FK
// apuntan a las tablas `orden` y `usuario` REALES: contra tablas de juguete, el CASCADE y el
// RESTRICT medidos serian de mentira. Ni el esquema temporal, ni los usuarios, ni la orden, ni
// las notas sobreviven al test, y `_prisma_migrations` no se toca.
//
// POR QUE NO PUEDE QUEDAR VERDE POR VACIO: no consulta ni una fila preexistente de negocio.
// Crea su propia orden y sus propias notas; si la tabla no se creara, o si una FK o el indice
// faltaran, las sentencias fallarian o las aserciones sobre los catalogos se quedarian sin
// nada que leer. Lo unico que lo salta es la ausencia de `DATABASE_URL` (entonces vitest lo
// marca SKIPPED, nunca passed); y si la base no tuviera catalogos sembrados, FALLA con el
// motivo escrito en vez de abstenerse.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const SUFIJO = "_orden_nota";

const carpeta = fs
  .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()
  .find((n) => n.endsWith(SUFIJO));
if (!carpeta) throw new Error(`No se encontro la carpeta de migracion ${SUFIJO}`);
const migrationDir = path.join(MIGRATIONS_DIR, carpeta);

const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

/**
 * El SQL EJECUTABLE, sin lineas de comentario: la prosa de estos archivos nombra a proposito
 * las palabras que el propio test parte por `;`, y sin limpiar primero se ejecutarian trozos
 * de documentacion.
 */
function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith("--"))
    .join("\n");
}

const upDdl = sinComentarios(upSql);
const downDdl = sinComentarios(downSql);

function sentenciasDe(ddl: string): string[] {
  return ddl
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ===========================================================================================
// Invariantes del propio archivo de migracion (lo minimo que NO es un hecho del motor)
// ===========================================================================================

describe("227 / M1 — la migracion existe con sus dos archivos", () => {
  it("la carpeta va DESPUES de la ultima migracion existente y trae migration.sql y down.sql", () => {
    const dirs = fs
      .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(path.basename(migrationDir)).toBe("20260815120000_orden_nota");
    // M1 va ANTES que la M2 destructiva de esta misma feature
    // (`*_orden_mensajero_meta_drop_nota`), y esa separacion es deliberada (design §1.3 / A4):
    // la aditiva primero, la irreversible despues, para que un `down.sql` unico no pudiera
    // tirar esta tabla con datos ya escritos.
    //
    // OJO al revertir a mano: `scripts/db-rollback.ts` revierte SIEMPRE la ULTIMA carpeta por
    // orden alfabetico, que desde la tanda del Bloque 4 es M2. Deshacer M1 en local exige dos
    // `pnpm run db:rollback` seguidos, en ese orden.
    const m2 = dirs.find((n) => n.endsWith("_orden_mensajero_meta_drop_nota"));
    expect(m2, "falta la migracion M2 de la feature 227").toBeDefined();
    expect(dirs.indexOf("20260815120000_orden_nota")).toBeLessThan(dirs.indexOf(m2!));
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
  });

  it("ninguna cadena del SQL contiene `;` — lo que hace valido partir el DDL por `;`", () => {
    // El bloque de Postgres real ejecuta el `migration.sql` REAL partiendolo por `;`. Si algun
    // dia un literal llevara un `;` dentro, ese split partiria una sentencia por la mitad y el
    // bloque fallaria por un motivo que no es el suyo. La invariante se fija aqui, donde el
    // mensaje de error dice exactamente que pasa.
    for (const literal of [...(upSql.match(/'[^']*'/g) ?? []), ...(downSql.match(/'[^']*'/g) ?? [])]) {
      expect(literal, `este literal del .sql contiene un ';': ${literal}`).not.toContain(";");
    }
  });

  it("R22: la migracion NO lee ni copia `orden_mensajero_meta.nota` — el hilo nace vacio", () => {
    // Las notas privadas de la 116 se escribieron bajo una promesa literal de privacidad;
    // volcarlas al hilo seria una fuga retroactiva (decision P1). Aqui se comprueba sobre el
    // SQL EJECUTABLE, no sobre la prosa: la cabecera menciona la columna para explicar por que
    // NO se toca.
    for (const sentencia of sentenciasDe(upDdl)) {
      expect(sentencia, sentencia).not.toMatch(/orden_mensajero_meta/i);
      expect(sentencia, sentencia).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|SELECT)\b/i);
    }
  });
});

// ===========================================================================================
// El DDL, EJECUTADO: los hechos del motor
// ===========================================================================================

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
  /** Columnas de la restriccion, en orden. */
  columnas: string[];
  /** Tabla referenciada (solo FK). */
  tabla_referenciada: string | null;
  /** `a` no action, `r` restrict, `c` cascade, `n` set null, `d` set default. */
  confdeltype: string | null;
}

interface IndiceReal {
  indexname: string;
  indexdef: string;
}

interface Medicion {
  columnas: ColumnaReal[];
  restricciones: RestriccionReal[];
  indices: IndiceReal[];
  rls: { relname: string; relrowsecurity: boolean }[];
  policies: number;
  notasAntesDeBorrarLaOrden: number;
  notasTrasBorrarLaOrden: number;
  huerfanas: number;
  errores: Record<string, string>;
  tablasTrasElDown: string[];
}

describeSiHayBase("227 / M1 — el DDL REAL contra Postgres (R26, R28, R30)", () => {
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
    // `public."usuario"` y `public."orden"` y crea FK contra ellas, igual que otros dos tests
    // de la feature que corren en paralelo. Sin serializar, los tres toman los mismos locks en
    // distinto orden y Postgres mata a uno con `40P01` (medido: 2 de cada 3 corridas), lo que
    // dejaba los 13 tests de R26/R28/R30 de abajo en SKIPPED en vez de ejecutarse.
    await serializarEscriturasReales(tx);

    const esquema = `t227_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
    // `public` se queda en el search_path: las dos FK y el enum `rol_value` se resuelven
    // contra los objetos REALES.
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${esquema}", public`);

    for (const sentencia of sentenciasDe(upDdl)) {
      await tx.$executeRawUnsafe(sentencia);
    }

    const columnas = await tx.$queryRawUnsafe<ColumnaReal[]>(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'orden_nota'
        ORDER BY ordinal_position`,
      esquema,
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
        WHERE n.nspname = $1 AND t.relname = 'orden_nota'
        ORDER BY c.conname`,
      esquema,
    );

    const indices = await tx.$queryRawUnsafe<IndiceReal[]>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = $1 AND tablename = 'orden_nota'
        ORDER BY indexname`,
      esquema,
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
      `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = $1 AND tablename = 'orden_nota'`,
      esquema,
    );

    // --- datos PROPIOS del test (nada preexistente) -----------------------------------
    const tienda = await crearUsuario(tx);
    const mensajero = await crearUsuario(tx);
    const ordenId = await crearOrden(tx, tienda.id, mensajero.id);

    const notaVigenteId = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO "orden_nota" ("id","orden_id","autor_id","rol_autor","cuerpo")
       VALUES ($1, $2, $3, 'Admin Tienda'::"rol_value", 'la tienda pregunta')`,
      notaVigenteId,
      ordenId,
      tienda.id,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "orden_nota" ("id","orden_id","autor_id","rol_autor","cuerpo","deleted_at")
       VALUES ($1, $2, $3, 'mensajero'::"rol_value", 'respuesta borrada', now())`,
      randomUUID(),
      ordenId,
      mensajero.id,
    );

    const errores: Record<string, string> = {
      // NOT NULL del cuerpo (R6/R7 apoyan en el borde, pero la base no admite el hueco).
      cuerpo_nulo: await resultadoDe(
        tx,
        `INSERT INTO "orden_nota" ("id","orden_id","autor_id","rol_autor","cuerpo")
         VALUES ('${randomUUID()}', '${ordenId}', '${tienda.id}', 'mensajero'::"rol_value", NULL)`,
      ),
      // R30: una nota sobre una orden inexistente no puede nacer.
      orden_inexistente: await resultadoDe(
        tx,
        `INSERT INTO "orden_nota" ("id","orden_id","autor_id","rol_autor","cuerpo")
         VALUES ('${randomUUID()}', '${randomUUID()}', '${tienda.id}', 'mensajero'::"rol_value", 'x')`,
      ),
      // `rol_autor` es el enum NATIVO ya existente, no texto libre.
      rol_inventado: await resultadoDe(
        tx,
        `INSERT INTO "orden_nota" ("id","orden_id","autor_id","rol_autor","cuerpo")
         VALUES ('${randomUUID()}', '${ordenId}', '${tienda.id}', 'jefe'::"rol_value", 'x')`,
      ),
      // RESTRICT: la autoria es evidencia y no se pierde al dar de baja al usuario.
      borrar_autor_con_notas: await resultadoDe(
        tx,
        `DELETE FROM public."usuario" WHERE "id" = '${mensajero.id}'`,
      ),
    };

    const [{ n: antes }] = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "orden_nota" WHERE "orden_id" = $1`,
      ordenId,
    );

    // R30 — el CASCADE, ejercitado: se borra la ORDEN y se cuenta lo que queda.
    await tx.$executeRawUnsafe(`DELETE FROM public."orden" WHERE "id" = $1`, ordenId);
    const [{ n: despues }] = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "orden_nota" WHERE "orden_id" = $1`,
      ordenId,
    );
    const [{ n: huerfanas }] = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n
         FROM "orden_nota" nota
        WHERE NOT EXISTS (SELECT 1 FROM public."orden" o WHERE o."id" = nota."orden_id")`,
    );

    // El `down.sql` REAL deja el esquema como estaba.
    for (const sentencia of sentenciasDe(downDdl)) await tx.$executeRawUnsafe(sentencia);
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
      notasAntesDeBorrarLaOrden: Number(antes),
      notasTrasBorrarLaOrden: Number(despues),
      huerfanas: Number(huerfanas),
      errores,
      tablasTrasElDown,
    };
  }

  /**
   * Ejecuta `sql` dentro de un SAVEPOINT y devuelve el MENSAJE de error, o `""` si paso. Sin
   * el savepoint, la primera violacion esperada abortaria la transaccion entera y mataria el
   * resto de las mediciones.
   */
  async function resultadoDe(tx: Tx, sql: string): Promise<string> {
    await tx.$executeRawUnsafe("SAVEPOINT s227");
    try {
      await tx.$executeRawUnsafe(sql);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s227");
      return "";
    } catch (error) {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s227");
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Un usuario NUEVO, creado por el test. Si faltaran los catalogos, FALLA con el motivo
   * escrito en vez de saltarse: un test que se abstiene porque la base esta vacia es
   * exactamente el verde-en-falso que este archivo existe para evitar.
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
      `t227-${sufijo}@example.test`,
      `t227${sufijo}`,
      tipo.id,
      rol.id,
    );
    return { id };
  }

  /** Una orden NUEVA del test, con las FK obligatorias tomadas de los catalogos. */
  async function crearOrden(tx: Tx, tiendaId: string, mensajeroId: string): Promise<string> {
    const [geo] = await tx.$queryRawUnsafe<{
      zona_id: string;
      provincia_id: string;
      canton_id: string;
    }[]>(
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
        "La base de pruebas no tiene catalogos de geografia/estatus sembrados: sin ellos no " +
          "se puede crear la orden propia del test (y sin orden, R30 no se puede ejercitar). " +
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
      `t227-${id.slice(0, 8)}`,
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
      "autor_id",
      "created_at",
      "cuerpo",
      "deleted_at",
      "id",
      "orden_id",
      "rol_autor",
    ]);
    expect(porNombre.id.data_type).toBe("text");
    expect(porNombre.orden_id.data_type).toBe("text");
    expect(porNombre.autor_id.data_type).toBe("text");
    expect(porNombre.cuerpo.data_type).toBe("text");
    // R4: el rol congelado es el enum NATIVO ya existente, no texto libre ni un enum nuevo.
    expect(porNombre.rol_autor.data_type).toBe("USER-DEFINED");
    expect(porNombre.rol_autor.udt_name).toBe("rol_value");
    expect(porNombre.created_at.data_type).toBe("timestamp without time zone");
    expect(porNombre.created_at.column_default).toBe("CURRENT_TIMESTAMP");
    expect(porNombre.deleted_at.data_type).toBe("timestamp without time zone");
  });

  it("solo `deleted_at` admite NULL, y no existe `updated_at` (R2: el cuerpo no se edita)", () => {
    const porNombre = Object.fromEntries(medicion.columnas.map((c) => [c.column_name, c]));
    for (const c of medicion.columnas) {
      expect(c.is_nullable, c.column_name).toBe(c.column_name === "deleted_at" ? "YES" : "NO");
    }
    expect(porNombre.updated_at).toBeUndefined();
  });

  it("la PK es `id`", () => {
    const pk = medicion.restricciones.filter((r) => r.contype === "p");
    expect(pk).toHaveLength(1);
    expect(pk[0].conname).toBe("orden_nota_pkey");
    expect(pk[0].columnas).toEqual(["id"]);
  });

  it("R30: la FK a `orden` es ON DELETE CASCADE, leida de pg_constraint", () => {
    const fk = medicion.restricciones.find((r) => r.conname === "orden_nota_orden_id_fkey");
    expect(fk).toBeDefined();
    expect(fk!.contype).toBe("f");
    expect(fk!.columnas).toEqual(["orden_id"]);
    expect(fk!.tabla_referenciada).toBe("orden");
    expect(fk!.confdeltype).toBe("c"); // c = CASCADE
  });

  it("la FK a `usuario` es ON DELETE RESTRICT: la autoria no se pierde", () => {
    const fk = medicion.restricciones.find((r) => r.conname === "orden_nota_autor_id_fkey");
    expect(fk).toBeDefined();
    expect(fk!.contype).toBe("f");
    expect(fk!.columnas).toEqual(["autor_id"]);
    expect(fk!.tabla_referenciada).toBe("usuario");
    expect(fk!.confdeltype).toBe("r"); // r = RESTRICT
  });

  it("son exactamente DOS FK y ninguna mas", () => {
    expect(medicion.restricciones.filter((r) => r.contype === "f")).toHaveLength(2);
  });

  it("borrar al AUTOR de una nota FALLA (el RESTRICT, ejercitado)", () => {
    expect(medicion.errores.borrar_autor_con_notas).toMatch(/orden_nota_autor_id_fkey/);
  });

  it("R28: existe el indice compuesto (orden_id, created_at) EN ESE ORDEN, y el de autor", () => {
    const porNombre = Object.fromEntries(medicion.indices.map((i) => [i.indexname, i.indexdef]));
    expect(Object.keys(porNombre).sort()).toEqual([
      "orden_nota_autor_id_idx",
      "orden_nota_orden_id_created_at_idx",
      "orden_nota_pkey",
    ]);
    // El orden de las columnas NO es cosmetico: un indice (created_at, orden_id) no sirve para
    // «el hilo de ESTA orden, ordenado», que es la unica consulta de lectura (R3/R28).
    expect(porNombre.orden_nota_orden_id_created_at_idx).toMatch(
      /\(orden_id, created_at\)\s*$/,
    );
    expect(porNombre.orden_nota_autor_id_idx).toMatch(/\(autor_id\)\s*$/);
  });

  it("R26: relrowsecurity es true en `orden_nota`", () => {
    expect(medicion.rls).toEqual([{ relname: "orden_nota", relrowsecurity: true }]);
  });

  it("R26: CERO policies — solo el service role entra; la autorizacion vive en el service", () => {
    expect(medicion.policies).toBe(0);
  });

  it("la base rechaza un cuerpo NULL, una orden inexistente y un rol inventado", () => {
    expect(medicion.errores.cuerpo_nulo).toMatch(/cuerpo/);
    expect(medicion.errores.orden_inexistente).toMatch(/orden_nota_orden_id_fkey/);
    expect(medicion.errores.rol_inventado).toMatch(/rol_value/);
  });

  it("R30: borrar la orden ARRASTRA sus notas y no deja ni una huerfana", () => {
    // El `2` de antes es la mitad del test: sin el, un `0` despues podria significar que las
    // notas nunca llegaron a existir. Y la nota BORRADA logicamente tambien se va: el CASCADE
    // no distingue vigentes de eliminadas.
    expect(medicion.notasAntesDeBorrarLaOrden).toBe(2);
    expect(medicion.notasTrasBorrarLaOrden).toBe(0);
    expect(medicion.huerfanas).toBe(0);
  });

  it("el down.sql REAL deja el esquema sin rastro de la tabla", () => {
    expect(medicion.tablasTrasElDown).toEqual([]);
  });
});
