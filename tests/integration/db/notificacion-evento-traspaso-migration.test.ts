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
  type TxDeTest,
} from "./_postgres-real";

// FICHA 427 (T5, R42/R43) — la migracion que anade los DOS avisos del traspaso a los DOS enums de
// `notificacion`, y las propiedades que dependen de ella.
//
// MOLDE del de la 413, que a su vez copia el de la 412, la 409, la 403, la 401, la 333, la 271, la
// 262 y la 253, y por el mismo motivo MEDIDO: en este repo anadir un valor a un enum de Postgres
// tiene trampa.
//
//  1. `ALTER TYPE ... DROP VALUE` NO EXISTE. El unico down posible es RECREAR el tipo con la lista
//     previa, y eso obliga a un `ALTER COLUMN ... TYPE` que DESTRUYE Y REHACE los indices de esa
//     columna. Uno de ellos, `notificacion_dedupe_key`, es UNICO, PARCIAL y con
//     `NULLS NOT DISTINCT` — y de ese indice depende que R42 sea estructural.
//  2. Hay que mirar si los `down.sql` ANTERIORES de estos enums recrean-con-lista o solo dropean.
//     Son **DIEZ** —eran nueve hasta que la 413 entro en `dev`— y ninguno se toca: cada uno es una
//     foto de su momento. Se AFIRMA abajo, uno por uno.
//  3. `notificacion_evento` YA NO LO USA UNA SOLA COLUMNA. La 410 anadio `push_envio_dia.evento` y
//     su migracion es ANTERIOR a esta, asi que cuando a este `down.sql` le llega el turno en un
//     rollback real, esa tabla EXISTE. Un down que retipe solo `notificacion.evento` deja una
//     dependencia viva y el `DROP TYPE ..._old` muere con `2BP01`.

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

function carpetaQueTerminaEn(sufijo: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .find((n) => n.endsWith(sufijo));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${sufijo}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const dirNueva = carpetaQueTerminaEn("_notificacion_evento_traspaso");
const dirTabla427 = carpetaQueTerminaEn("_orden_traspaso_mensajero");
const dirPush = carpetaQueTerminaEn("_push_suscripcion");
const dir413 = carpetaQueTerminaEn("_notificacion_evento_reparto_manana");
const dir412 = carpetaQueTerminaEn("_notificacion_evento_cierre_rechazado");
const dir409 = carpetaQueTerminaEn("_notificacion_evento_avisos_agregados");
const dir401 = carpetaQueTerminaEn("_notificacion_evento_geocodificacion_caida");
const dir403 = carpetaQueTerminaEn("_notificacion_evento_webhook_suscripcion");
const dir333 = carpetaQueTerminaEn("_notificacion_evento_gasto_fijo_cobro");
const dir271 = carpetaQueTerminaEn("_notificacion_evento_bloqueo_cierre");
const dir262 = carpetaQueTerminaEn("_notificacion_evento_dia_reparto_corregido");
const dir253 = carpetaQueTerminaEn("_notificacion_evento_postulacion_recurso");
const dir146 = carpetaQueTerminaEn("_notificacion");

const upSql = fs.readFileSync(path.join(dirNueva, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(dirNueva, "down.sql"), "utf8");
const down413 = fs.readFileSync(path.join(dir413, "down.sql"), "utf8");
const down412 = fs.readFileSync(path.join(dir412, "down.sql"), "utf8");
const down409 = fs.readFileSync(path.join(dir409, "down.sql"), "utf8");
const down401 = fs.readFileSync(path.join(dir401, "down.sql"), "utf8");
const down403 = fs.readFileSync(path.join(dir403, "down.sql"), "utf8");
const down333 = fs.readFileSync(path.join(dir333, "down.sql"), "utf8");
const down271 = fs.readFileSync(path.join(dir271, "down.sql"), "utf8");
const down262 = fs.readFileSync(path.join(dir262, "down.sql"), "utf8");
const down253 = fs.readFileSync(path.join(dir253, "down.sql"), "utf8");
const down146 = fs.readFileSync(path.join(dir146, "down.sql"), "utf8");

function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith("--"))
    .join("\n");
}

const upDdl = sinComentarios(upSql);
const downDdl = sinComentarios(downSql);
const down271Ddl = sinComentarios(down271);

/**
 * ⚠️ «LOS ENUMS ANTES DE ESTA MIGRACION», escritos LEYENDO `db/schema.prisma` de `origin/dev`
 * @ `95264fb4bfb94206dbe02929d218cd3b26a86f42` (2026-09-14, al arrancar la ficha): **QUINCE eventos
 * y TRECE entidades**, con `reparto_manana` / `reparto_manana_dia` de la 413 ya dentro.
 *
 * Si otra ficha anade un valor a estos enums y entra en `dev` ANTES que esta, estas dos listas —y
 * las del `down.sql`— hay que reescribirlas contra el arbol al mergear: revertir con una lista
 * vieja BORRARIA EN SILENCIO el valor de la otra ficha. Le paso a la 401 con la 403.
 */
const EVENTOS_PREVIOS = [
  "orden_rechazada",
  "carga_masiva_terminada",
  "postulacion_mensajero_pendiente",
  "cierre_dia_por_aprobar",
  "postulacion_recurso_pendiente",
  "dia_reparto_corregido",
  "cierre_dia_vencido",
  "mensajero_bloqueado_por_cierres",
  "gasto_fijo_cobro_pendiente",
  "webhook_suscripcion_pausada", // ficha 403
  "geocodificacion_caida", // ficha 401
  "novedades_sin_gestionar", // ficha 409
  "devoluciones_represadas", // ficha 409
  "cierre_dia_rechazado", // ficha 412
  "reparto_manana", // ficha 413
];

const ENTIDADES_PREVIAS = [
  "orden",
  "usuario",
  "cierre_dia",
  "carga",
  "postulacion_recurso",
  "orden_dia_reparto_cambio",
  "gasto_fijo_cobro_dia",
  "webhook_suscripcion_pausa", // ficha 403
  "geocodificacion_caida_dia", // ficha 401
  "novedades_sin_gestionar_dia", // ficha 409
  "devoluciones_represadas_dia", // ficha 409
  "cierre_dia_rechazo", // ficha 412
  "reparto_manana_dia", // ficha 413
];

const EVENTOS_NUEVOS = ["traspaso_ordenes_recibido", "traspaso_ordenes_cedido"];
const ENTIDADES_NUEVAS = ["orden_traspaso_lote"];

function valoresDelCreateType(sql: string, tipo: string): string[] | null {
  const m = new RegExp(`CREATE TYPE "${tipo}" AS ENUM \\(([\\s\\S]*?)\\)`).exec(sql);
  if (m === null) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("427/T4 — el UP es aditivo y no toca nada mas", () => {
  it("anade EXACTAMENTE los tres valores, con `IF NOT EXISTS`, y nada mas", () => {
    expect(upDdl).toMatch(
      /ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS 'traspaso_ordenes_recibido'/,
    );
    expect(upDdl).toMatch(
      /ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS 'traspaso_ordenes_cedido'/,
    );
    expect(upDdl).toMatch(
      /ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS 'orden_traspaso_lote'/,
    );
    const sentencias = upDdl.split(";").filter((s) => s.trim().length > 0);
    expect(sentencias).toHaveLength(3);
  });

  it("el UP no crea tablas, no altera columnas, NO CREA INDICES y NO reescribe ninguna fila", () => {
    expect(upDdl).not.toMatch(/CREATE TABLE/i);
    expect(upDdl).not.toMatch(/ALTER TABLE/i);
    expect(upDdl).not.toMatch(/CREATE INDEX/i);
    expect(upDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(upDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(upDdl).not.toMatch(/^\s*INSERT\s/im);
  });

  it("el UP NO USA los valores que acaba de anadir (`55P04`)", () => {
    // Postgres no permite usar un valor de enum recien anadido en la transaccion que lo anadio, y
    // Prisma Migrate corre cada `migration.sql` en una. Su primer uso ocurre en runtime.
    const sinAdd = upDdl
      .split("\n")
      .filter((l) => !l.includes("ADD VALUE"))
      .join("\n");
    for (const v of [...EVENTOS_NUEVOS, ...ENTIDADES_NUEVAS]) expect(sinAdd).not.toContain(v);
  });

  it("va SOLA, con timestamp POSTERIOR a la 410, a la 413 y a la TABLA de esta misma ficha", () => {
    expect(path.basename(dirNueva) > path.basename(dir409)).toBe(true);
    // ⭑ POSTERIOR A LA 410, que es lo que obliga al down a retipar `push_envio_dia`.
    expect(path.basename(dirNueva) > path.basename(dirPush)).toBe(true);
    // ⭑ POSTERIOR A LA 413, que es la que fija las dos listas del down.
    expect(path.basename(dirNueva) > path.basename(dir413)).toBe(true);
    // ⭑ Y POSTERIOR A LA TABLA de esta misma ficha: van en carpetas SEPARADAS porque Postgres no
    // deja usar un valor de enum en la transaccion que lo anadio.
    expect(path.basename(dirNueva) > path.basename(dirTabla427)).toBe(true);
  });
});

describe("427/T4 — el DOWN recrea con la lista de HOY y no borra nada", () => {
  it("⭑ recrea `notificacion_evento` con los QUINCE previos, en orden, y sin los nuevos", () => {
    expect(valoresDelCreateType(downDdl, "notificacion_evento")).toEqual(EVENTOS_PREVIOS);
    for (const v of EVENTOS_NUEVOS) expect(downDdl).not.toContain(`'${v}'`);
  });

  it("⭑ recrea `notificacion_entidad_tipo` con las TRECE previas, en orden, y sin la nueva", () => {
    expect(valoresDelCreateType(downDdl, "notificacion_entidad_tipo")).toEqual(ENTIDADES_PREVIAS);
    for (const v of ENTIDADES_NUEVAS) expect(downDdl).not.toContain(`'${v}'`);
  });

  it("⭑⭑ el down NO se lleva por delante el valor de la 413, ni los de la 412, 409, 401 ni 403", () => {
    // LA MITAD QUE IMPORTA: revertir con una lista vieja BORRA EN SILENCIO el valor de otra ficha.
    // Le paso a la 401 con la 403 y esta escrito en su `down.sql`.
    const eventos = valoresDelCreateType(downDdl, "notificacion_evento")!;
    const entidades = valoresDelCreateType(downDdl, "notificacion_entidad_tipo")!;

    expect(eventos).toContain("webhook_suscripcion_pausada");
    expect(eventos).toContain("geocodificacion_caida");
    expect(eventos).toContain("novedades_sin_gestionar");
    expect(eventos).toContain("devoluciones_represadas");
    expect(eventos).toContain("cierre_dia_rechazado");
    expect(eventos).toContain("reparto_manana"); // ⭑ la 413
    expect(entidades).toContain("cierre_dia_rechazo");
    expect(entidades).toContain("reparto_manana_dia"); // ⭑ la 413
    // Y van al final: el orden del enum se conserva.
    expect(eventos[eventos.length - 1]).toBe("reparto_manana");
    expect(entidades[entidades.length - 1]).toBe("reparto_manana_dia");
    // Y son exactamente quince y trece, dicho con el numero delante.
    expect(eventos).toHaveLength(15);
    expect(entidades).toHaveLength(13);
  });

  it("⭑⭑ el down retipa LAS **TRES** columnas, no dos — incluida `push_envio_dia.evento`", () => {
    // ES LA TRAMPA HEREDADA DE LA 410. `notificacion_evento` lo usan DOS columnas, y las dos tienen
    // que estar reconstruidas ANTES del `DROP TYPE ..._old`.
    // MUTACION: quitar el `ALTER TABLE "push_envio_dia"` => este caso se pone rojo AQUI, y el
    // CONTROL de mas abajo se pone rojo CONTRA POSTGRES con un `2BP01`.
    expect(downDdl).toMatch(
      /ALTER TABLE "notificacion"\s*\n?\s*ALTER COLUMN "evento" TYPE "notificacion_evento"\s*\n?\s*USING \("evento"::text::"notificacion_evento"\)/,
    );
    expect(downDdl).toMatch(
      /ALTER TABLE "push_envio_dia"\s*\n?\s*ALTER COLUMN "evento" TYPE "notificacion_evento"\s*\n?\s*USING \("evento"::text::"notificacion_evento"\)/,
    );
    expect(downDdl).toMatch(
      /ALTER TABLE "notificacion"\s*\n?\s*ALTER COLUMN "entidad_tipo" TYPE "notificacion_entidad_tipo"\s*\n?\s*USING \("entidad_tipo"::text::"notificacion_entidad_tipo"\)/,
    );

    // Y las DOS del enum de eventos van ANTES de su `DROP TYPE`, que es lo que las hace servir.
    const posPush = downDdl.indexOf('ALTER TABLE "push_envio_dia"');
    const posDrop = downDdl.indexOf('DROP TYPE "notificacion_evento_old"');
    expect(posPush).toBeGreaterThan(-1);
    expect(posDrop).toBeGreaterThan(posPush);
  });

  it("lleva, para los DOS tipos, su RENAME y su DROP del `_old`", () => {
    for (const tipo of ["notificacion_evento", "notificacion_entidad_tipo"]) {
      expect(downDdl).toMatch(new RegExp(`ALTER TYPE "${tipo}" RENAME TO "${tipo}_old"`));
      expect(downDdl).toMatch(new RegExp(`DROP TYPE "${tipo}_old"`));
    }
  });

  it("⭑ el down NO borra ni reescribe NINGUNA fila para «hacer sitio»", () => {
    expect(downDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(downDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(downDdl).not.toMatch(/DROP TABLE/);
    expect(downDdl).not.toMatch(/TRUNCATE/i);
  });
});

describe("427/T4 — los DIEZ `down.sql` anteriores NO se tocan, y esta es la comprobacion", () => {
  it("⭑ el de la 146 SOLO dropea los dos tipos; no los recrea con lista", () => {
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_evento"/);
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_entidad_tipo"/);
    expect(down146).not.toMatch(/CREATE TYPE "notificacion_evento"/);
  });

  it.each([
    ["253", () => down253, 4, 4],
    ["262", () => down262, 5, 5],
    ["333", () => down333, 8, 6],
    ["403", () => down403, 9, 7],
    ["401", () => down401, 10, 8],
    ["409", () => down409, 11, 9],
    ["412", () => down412, 13, 11],
    ["413", () => down413, 14, 12],
  ])("⭑ el de la %s recrea con SUS listas, y sigue siendo cierto", (_f, sql, nE, nEnt) => {
    expect(valoresDelCreateType(sql(), "notificacion_evento")).toEqual(
      EVENTOS_PREVIOS.slice(0, nE),
    );
    expect(valoresDelCreateType(sql(), "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, nEnt),
    );
  });

  it("⭑ el de la 271 recrea SOLO `notificacion_evento` con SUS SEIS, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down271, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 6));
    expect(down271Ddl).not.toContain("notificacion_entidad_tipo");
  });

  it("⭑ solo la 412 y la 413 retipan `push_envio_dia`, y las OCHO primeras NO — es CORRECTO", () => {
    // `db:rollback` va de la ultima migracion hacia atras, y esa tabla se crea en la 410 —POSTERIOR
    // a las ocho primeras—, asi que cuando a cada una le llega el turno ya no existe. Retiparla alli
    // seria el error contrario: un `ALTER TABLE` sobre una tabla ausente.
    const anteriores = { down146, down253, down262, down271, down333, down403, down401, down409 };
    for (const [nombre, sql] of Object.entries(anteriores)) {
      expect(sql, `${nombre} retipa push_envio_dia`).not.toMatch(/ALTER TABLE "push_envio_dia"/);
    }
    expect(down412).toMatch(/ALTER TABLE "push_envio_dia"/);
    expect(down413).toMatch(/ALTER TABLE "push_envio_dia"/);
  });

  it("⭑ y NINGUNO de los diez menciona los valores de ESTA ficha", () => {
    const anteriores = {
      down146,
      down253,
      down262,
      down271,
      down333,
      down403,
      down401,
      down409,
      down412,
      down413,
    };
    for (const [nombre, sql] of Object.entries(anteriores)) {
      for (const valor of [...EVENTOS_NUEVOS, ...ENTIDADES_NUEVAS]) {
        expect(sql, `${nombre} menciona ${valor}: alguien lo edito en sitio`).not.toContain(valor);
      }
    }
  });
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("427/T5 — la base aplicada, y los DOS indices que la ficha necesita", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function valoresDe(tipo: string): Promise<string[]> {
    // ⚠️ EL `nspname` NO ES DECORACION: el arnes aisla algunas suites en esquemas temporales, y una
    // consulta que filtra solo por `typname` devuelve las etiquetas DUPLICADAS cuando el tipo existe
    // en dos esquemas (ficha 421).
    const filas = await prisma.$queryRawUnsafe<{ valores: string }[]>(
      `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS valores
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = $1 AND n.nspname = 'public'`,
      tipo,
    );
    return (filas[0]?.valores ?? "").split(",").filter((v) => v.length > 0);
  }

  it("⭑ la base tiene los tres valores nuevos, ANADIDOS al final (no recreados por detras)", async () => {
    // ⚠️ NO se compara contra una lista cerrada: la base local es COMPARTIDA entre worktrees y puede
    // traer ya valores de OTRA ficha en curso. Lo que si es cierto pase lo que pase: los previos
    // siguen estando, en su orden, y los nuevos van DESPUES — que es lo que demuestra que se
    // ANADIERON con `ADD VALUE` y no que el tipo se recreo.
    const eventos = await valoresDe("notificacion_evento");
    const entidades = await valoresDe("notificacion_entidad_tipo");

    expect(eventos.slice(0, EVENTOS_PREVIOS.length)).toEqual(EVENTOS_PREVIOS);
    expect(entidades.slice(0, ENTIDADES_PREVIAS.length)).toEqual(ENTIDADES_PREVIAS);
    for (const v of EVENTOS_NUEVOS) {
      expect(eventos.indexOf(v)).toBeGreaterThan(eventos.indexOf("reparto_manana"));
    }
    expect(entidades.indexOf("orden_traspaso_lote")).toBeGreaterThan(
      entidades.indexOf("reparto_manana_dia"),
    );
  });

  it("⭑ `push_envio_dia.evento` usa de verdad este enum (si no, el down no probaria nada)", async () => {
    // ANTI-VACUIDAD del caso del `2BP01` de mas abajo. Y ES LA LISTA COMPLETA: **TRES** columnas, ni
    // una mas. Si apareciera una cuarta, este aserto se pone rojo y obliga a anadirla al `down.sql`
    // ANTES de que el `DROP TYPE` muera.
    const columnas = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
      `SELECT c.table_name, c.column_name
         FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.udt_name IN ('notificacion_evento','notificacion_entidad_tipo')
        ORDER BY 1, 2`,
    );
    expect(columnas).toEqual([
      { table_name: "notificacion", column_name: "entidad_tipo" },
      { table_name: "notificacion", column_name: "evento" },
      { table_name: "push_envio_dia", column_name: "evento" },
    ]);
  });

  it("⭑ sobre la base TAL CUAL, `notificacion_dedupe_key` sigue intacto tras el UP", async () => {
    const filas = await prisma.$queryRawUnsafe<{ def: string }[]>(
      `SELECT indexdef AS def FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'notificacion_dedupe_key'`,
    );
    const def = filas[0]?.def ?? "";

    expect(def, "no existe `notificacion_dedupe_key`").not.toBe("");
    expect(def).toMatch(/NULLS NOT DISTINCT/i);
    expect(def).toMatch(/WHERE \(entidad_id IS NOT NULL\)/i);
    // ⚠️ Y AQUI SE VE EL HECHO QUE DECIDE TODA LA FICHA: el indice NO MIRA EL ESTADO DE LECTURA. Por
    // eso la entidad tiene que ser el `lote_id` del ACTO (R42); y por eso NO necesita prefijo de
    // mensajero, porque `destinatario_usuario_id` YA esta en la clave.
    expect(def).toMatch(/\(evento, entidad_id, destinatario_rol, destinatario_usuario_id\)/);
    expect(def).not.toMatch(/leida/);
  });
});

describeSiHayBase("427/T5 — el DOWN ejercitado de verdad, con su precondicion", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const sentenciasDelDown = () =>
    downDdl
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);

  /**
   * Aparta, DENTRO de la transaccion revertida, toda fila cuyo valor de enum NO figure en las listas
   * que este `down.sql` recrea. Es su precondicion dicha en codigo.
   */
  async function apartarFilasConValoresNoListados(tx: TxDeTest): Promise<void> {
    const eventos = valoresDelCreateType(downDdl, "notificacion_evento")!;
    const entidades = valoresDelCreateType(downDdl, "notificacion_entidad_tipo")!;
    await tx.$executeRawUnsafe(
      `DELETE FROM "notificacion"
        WHERE NOT ("evento"::text = ANY($1::text[])) OR NOT ("entidad_tipo"::text = ANY($2::text[]))`,
      eventos,
      entidades,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM "push_envio_dia" WHERE NOT ("evento"::text = ANY($1::text[]))`,
      eventos,
    );
  }

  it("⭑ el DOWN con una fila de un evento nuevo ABORTA RUIDOSAMENTE (y no borra nada)", async () => {
    // ES LA PRECONDICION DEL `down.sql`, EJERCITADA. Todo corre dentro de una transaccion que
    // SIEMPRE se revierte: el DDL tambien es transaccional en Postgres.
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        await apartarFilasConValoresNoListados(tx);
        await tx.$executeRawUnsafe(
          `INSERT INTO "notificacion"
             ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_usuario_id")
           VALUES ($1, 'box'::"notificacion_tipo", $2::"notificacion_evento",
                   'Recibiste 31 ordenes de otro mensajero.', $3::"notificacion_entidad_tipo",
                   $4, (SELECT "id" FROM "usuario" LIMIT 1))`,
          randomUUID(),
          "traspaso_ordenes_recibido",
          "orden_traspaso_lote",
          randomUUID(),
        );

        for (const sentencia of sentenciasDelDown()) await tx.$executeRawUnsafe(sentencia);
      }),
    ).rejects.toThrow();
  });

  it("⭑ y tras ese intento fallido, la fila del aviso SIGUE AHI (nadie le hizo sitio)", async () => {
    // La otra mitad de la precondicion: el rollback aborta, pero NO borra ni reescribe avisos de
    // trabajo pendiente que su destinatario puede no haber leido todavia — y este le dice cuantos
    // paquetes acaba de recibir.
    const sigueAhi = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await apartarFilasConValoresNoListados(tx);
      const id = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO "notificacion"
           ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_usuario_id")
         VALUES ($1, 'box'::"notificacion_tipo", 'traspaso_ordenes_cedido'::"notificacion_evento",
                 '31 ordenes tuyas pasaron a otro mensajero.',
                 'orden_traspaso_lote'::"notificacion_entidad_tipo", $2,
                 (SELECT "id" FROM "usuario" LIMIT 1))`,
        id,
        randomUUID(),
      );
      await tx.$executeRawUnsafe(`SAVEPOINT antes_del_down`);
      let abortado = false;
      try {
        for (const sentencia of sentenciasDelDown()) await tx.$executeRawUnsafe(sentencia);
      } catch {
        abortado = true;
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT antes_del_down`);
      const filas = await tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM "notificacion" WHERE "id" = $1`,
        id,
      );
      return { abortado, n: Number(filas[0]?.n ?? 0) };
    });

    expect(sigueAhi.abortado).toBe(true);
    expect(sigueAhi.n).toBe(1);
  });

  it("⭑⭑ CONTROL — sin filas de los valores nuevos, ese MISMO down corre ENTERO y los DOS indices SOBREVIVEN", async () => {
    // ⚠️ ANTI-VACUIDAD DEL CASO ANTERIOR, Y ES OBLIGATORIO. Sin este control, `rejects.toThrow()`
    // pasaria aunque el fallo viniera de CUALQUIER otra cosa — por ejemplo de olvidar retipar
    // `push_envio_dia`, que es justo la trampa heredada de la 410. Con esa mutacion, ESTE caso muere
    // con `2BP01` mientras el de arriba seguiria verde. Es la leccion que dejo medida la 412.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await apartarFilasConValoresNoListados(tx);

      for (const sentencia of sentenciasDelDown()) await tx.$executeRawUnsafe(sentencia);

      const indices = await tx.$queryRawUnsafe<{ indexname: string; def: string }[]>(
        `SELECT indexname, indexdef AS def FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN ('notificacion_dedupe_key','push_envio_dia_cupo')
          ORDER BY 1`,
      );
      const eventos = await tx.$queryRawUnsafe<{ valores: string }[]>(
        `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS valores
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'notificacion_evento' AND n.nspname = 'public'`,
      );
      const entidades = await tx.$queryRawUnsafe<{ valores: string }[]>(
        `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS valores
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'notificacion_entidad_tipo' AND n.nspname = 'public'`,
      );
      return {
        indices,
        eventos: (eventos[0]?.valores ?? "").split(","),
        entidades: (entidades[0]?.valores ?? "").split(","),
      };
    });

    // Primera mitad: tras el down quedan EXACTAMENTE los 15 y las 13 previos. Ni uno menos — eso es
    // lo que demuestra que la reversion NO borra los valores de la 413 ni los de la 412.
    expect(r.eventos).toEqual(EVENTOS_PREVIOS);
    expect(r.entidades).toEqual(ENTIDADES_PREVIAS);

    // Segunda mitad: los DOS indices sobreviven a la reconstruccion de sus columnas.
    const dedupe = r.indices.find((i) => i.indexname === "notificacion_dedupe_key")?.def ?? "";
    const cupo = r.indices.find((i) => i.indexname === "push_envio_dia_cupo")?.def ?? "";

    expect(dedupe, "el down se llevo `notificacion_dedupe_key` por delante").not.toBe("");
    expect(dedupe).toMatch(/CREATE UNIQUE INDEX/i);
    expect(dedupe).toMatch(/NULLS NOT DISTINCT/i);
    expect(dedupe).toMatch(/WHERE \(entidad_id IS NOT NULL\)/i);
    expect(dedupe).toMatch(/\(evento, entidad_id, destinatario_rol, destinatario_usuario_id\)/);

    // ⭑ Y el de la 410, que ES la regla «un push al dia por tipo» (R43): si el down hubiera dejado
    // la columna sin retipar, no habriamos llegado hasta aqui.
    expect(cupo, "el down se llevo `push_envio_dia_cupo` por delante").not.toBe("");
    expect(cupo).toMatch(/CREATE UNIQUE INDEX/i);
    expect(cupo).toMatch(/\(usuario_id, evento, dia_cr\)/);
  });
});
