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

// FICHA 413 (T2.4, R38) — la migración que añade el aviso de «tu reparto de mañana» a los DOS
// enums de `notificacion`, y las propiedades que dependen de ella.
//
// MOLDE del de la 412, que a su vez copia el de la 253, la 262, la 271, la 333, la 403, la 401 y
// la 409, y por el mismo motivo MEDIDO: en este repo añadir un valor a un enum de Postgres tiene
// trampa.
//
//  1. `ALTER TYPE ... DROP VALUE` NO EXISTE. El único down posible es RECREAR el tipo con la lista
//     previa, y eso obliga a un `ALTER COLUMN ... TYPE` que DESTRUYE Y REHACE los índices de esa
//     columna. Uno de ellos, `notificacion_dedupe_key`, es ÚNICO, PARCIAL y con
//     `NULLS NOT DISTINCT` — y de ese índice depende toda la dedupe de esta ficha.
//  2. Hay que mirar si los `down.sql` ANTERIORES de estos enums recrean-con-lista o sólo dropean.
//     Son **NUEVE** —eran ocho hasta que la 412 entró en `dev`— y ninguno se toca: cada uno es una
//     foto de su momento. Se AFIRMA abajo, uno por uno.
//  3. `notificacion_evento` YA NO LO USA UNA SOLA COLUMNA. La 410 añadió `push_envio_dia.evento`
//     y su migración es ANTERIOR a ésta, así que cuando a este `down.sql` le llega el turno en un
//     rollback real, esa tabla EXISTE. Un down que retipe sólo `notificacion.evento` deja una
//     dependencia viva y el `DROP TYPE ..._old` muere con `2BP01`. La obligación está escrita en
//     `db/schema.prisma`, junto al modelo `PushEnvioDia`; aquí se EJERCITA.
//
// ⚠️ EL SPEC DE ESTA FICHA DECÍA «13 eventos y 11 entidades»: era la foto del 2026-09-10, ANTES de
// que la 412 se mergeara. Leído contra `db/schema.prisma` de `origin/dev`
// @ `01d280ae10d20ac168af995bf64501fdb59c1100` el 2026-09-11, son **CATORCE y DOCE**. Es
// exactamente el motivo por el que T2.3 obliga a LEER la lista y no a recordarla.

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

const dirNueva = carpetaQueTerminaEn("_notificacion_evento_reparto_manana");
const dirPush = carpetaQueTerminaEn("_push_suscripcion");
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
 * ⚠️ «LOS ENUMS ANTES DE ESTA MIGRACIÓN», escritos LEYENDO `db/schema.prisma` de `origin/dev`
 * @ `01d280ae10d20ac168af995bf64501fdb59c1100` (2026-09-11, al arrancar la ficha): **CATORCE
 * eventos y DOCE entidades**, con los dos de la 412 ya dentro.
 *
 * Si otra ficha añade un valor a estos enums y entra en `dev` ANTES que ésta, estas dos listas —y
 * las del `down.sql`— hay que reescribirlas contra el árbol al mergear: revertir con una lista
 * vieja BORRARÍA EN SILENCIO el valor de la otra ficha. Le pasó a la 401 con la 403.
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
];

const EVENTOS_NUEVOS = ["reparto_manana"];
const ENTIDADES_NUEVAS = ["reparto_manana_dia"];

function valoresDelCreateType(sql: string, tipo: string): string[] | null {
  const m = new RegExp(`CREATE TYPE "${tipo}" AS ENUM \\(([\\s\\S]*?)\\)`).exec(sql);
  if (m === null) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("413/T2.2 — el UP es aditivo y no toca nada más", () => {
  it("añade EXACTAMENTE los dos valores, con `IF NOT EXISTS`, y nada más", () => {
    expect(upDdl).toMatch(
      /ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS 'reparto_manana'/,
    );
    expect(upDdl).toMatch(
      /ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS 'reparto_manana_dia'/,
    );
    const sentencias = upDdl.split(";").filter((s) => s.trim().length > 0);
    expect(sentencias).toHaveLength(2);
  });

  it("el UP no crea tablas, no altera columnas, NO CREA ÍNDICES y NO reescribe ninguna fila", () => {
    // «Ningún índice nuevo» es una decisión declarada (design §10.3): el conteo por mensajero se
    // sirve con `@@index([mensajeroAsignadoId, asignadoAt, fechaReparto])` (246/D7), cuyo prefijo
    // lo cubre. No se añade uno «por si acaso» a la tabla más caliente del sistema.
    expect(upDdl).not.toMatch(/CREATE TABLE/i);
    expect(upDdl).not.toMatch(/ALTER TABLE/i);
    expect(upDdl).not.toMatch(/CREATE INDEX/i);
    expect(upDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(upDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(upDdl).not.toMatch(/^\s*INSERT\s/im);
  });

  it("el UP NO USA los valores que acaba de añadir (`55P04`)", () => {
    // Postgres no permite usar un valor de enum recién añadido en la transacción que lo añadió, y
    // Prisma Migrate corre cada `migration.sql` en una. Su primer uso ocurre en runtime.
    const sinAdd = upDdl
      .split("\n")
      .filter((l) => !l.includes("ADD VALUE"))
      .join("\n");
    for (const v of [...EVENTOS_NUEVOS, ...ENTIDADES_NUEVAS]) expect(sinAdd).not.toContain(v);
  });

  it("va SOLA y con timestamp POSTERIOR a toda migración de enum ya aplicada, a la 410 y a la 412", () => {
    expect(path.basename(dirNueva) > path.basename(dir409)).toBe(true);
    expect(path.basename(dirNueva) > path.basename(dir401)).toBe(true);
    // ⭑ POSTERIOR A LA 410, que es lo que obliga al down a retipar `push_envio_dia`.
    expect(path.basename(dirNueva) > path.basename(dirPush)).toBe(true);
    // ⭑ Y POSTERIOR A LA 412, que es la que fija las dos listas del down.
    expect(path.basename(dirNueva) > path.basename(dir412)).toBe(true);
  });
});

describe("413/T2.3 — el DOWN recrea con la lista de HOY y no borra nada", () => {
  it("⭑ recrea `notificacion_evento` con los CATORCE previos, en orden, y sin el nuevo", () => {
    expect(valoresDelCreateType(downDdl, "notificacion_evento")).toEqual(EVENTOS_PREVIOS);
    for (const v of EVENTOS_NUEVOS) expect(downDdl).not.toContain(`'${v}'`);
  });

  it("⭑ recrea `notificacion_entidad_tipo` con las DOCE previas, en orden, y sin la nueva", () => {
    expect(valoresDelCreateType(downDdl, "notificacion_entidad_tipo")).toEqual(ENTIDADES_PREVIAS);
    for (const v of ENTIDADES_NUEVAS) expect(downDdl).not.toContain(`'${v}'`);
  });

  it("⭑⭑ el down NO se lleva por delante el valor de la 412, ni los de la 409, la 401 ni la 403", () => {
    // LA MITAD QUE IMPORTA, y la que casi se falla en esta ficha: el spec decía «13 y 11», o sea
    // la foto de ANTES de que la 412 entrara en `dev`. Revertir con esa lista habría BORRADO EN
    // SILENCIO `cierre_dia_rechazado` y `cierre_dia_rechazo`. Le pasó a la 401 con la 403.
    const eventos = valoresDelCreateType(downDdl, "notificacion_evento")!;
    const entidades = valoresDelCreateType(downDdl, "notificacion_entidad_tipo")!;

    expect(eventos).toContain("webhook_suscripcion_pausada");
    expect(eventos).toContain("geocodificacion_caida");
    expect(eventos).toContain("novedades_sin_gestionar");
    expect(eventos).toContain("devoluciones_represadas");
    expect(eventos).toContain("cierre_dia_rechazado"); // ⭑ la 412
    expect(entidades).toContain("novedades_sin_gestionar_dia");
    expect(entidades).toContain("devoluciones_represadas_dia");
    expect(entidades).toContain("cierre_dia_rechazo"); // ⭑ la 412
    // Y van al final: el orden del enum se conserva.
    expect(eventos[eventos.length - 1]).toBe("cierre_dia_rechazado");
    expect(entidades[entidades.length - 1]).toBe("cierre_dia_rechazo");
    // Y son exactamente catorce y doce, dicho con el número delante.
    expect(eventos).toHaveLength(14);
    expect(entidades).toHaveLength(12);
  });

  it("⭑⭑ R38: el down retipa LAS **TRES** columnas, no dos — incluida `push_envio_dia.evento`", () => {
    // ES LA TRAMPA HEREDADA DE LA 410. `notificacion_evento` lo usan DOS columnas, y las dos tienen
    // que estar reconstruidas ANTES del `DROP TYPE ..._old`.
    // MUTACIÓN: quitar el `ALTER TABLE "push_envio_dia"` ⇒ este caso se pone rojo AQUÍ, y el
    // CONTROL de más abajo se pone rojo CONTRA POSTGRES con un `2BP01`.
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

describe("413/T2.3 — los NUEVE `down.sql` anteriores NO se tocan, y ésta es la comprobación", () => {
  it("⭑ el de la 146 SÓLO dropea los dos tipos; no los recrea con lista", () => {
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_evento"/);
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_entidad_tipo"/);
    expect(down146).not.toMatch(/CREATE TYPE "notificacion_evento"/);
  });

  it("⭑ el de la 253 recrea con SUS CUATRO en cada tipo, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down253, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 4));
    expect(valoresDelCreateType(down253, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 4),
    );
  });

  it("⭑ el de la 262 recrea con SUS CINCO en cada tipo, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down262, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 5));
    expect(valoresDelCreateType(down262, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 5),
    );
  });

  it("⭑ el de la 271 recrea SÓLO `notificacion_evento` con SUS SEIS, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down271, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 6));
    expect(down271Ddl).not.toContain("notificacion_entidad_tipo");
  });

  it("⭑ el de la 333 recrea los DOS con SUS OCHO y SUS SEIS, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down333, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 8));
    expect(valoresDelCreateType(down333, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 6),
    );
  });

  it("⭑ el de la 403 recrea los DOS con SUS NUEVE y SUS SIETE, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down403, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 9));
    expect(valoresDelCreateType(down403, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 7),
    );
  });

  it("⭑ el de la 401 recrea los DOS con SUS DIEZ y SUS OCHO, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down401, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 10));
    expect(valoresDelCreateType(down401, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 8),
    );
  });

  it("⭑ el de la 409 recrea los DOS con SUS ONCE y SUS NUEVE, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down409, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 11));
    expect(valoresDelCreateType(down409, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 9),
    );
  });

  it("⭑ el de la 412 recrea los DOS con SUS TRECE y SUS ONCE, y sigue siendo cierto", () => {
    // ⚠️ NO «le falta» un valor: recrea con trece porque ésa era la foto de `dev` justo ANTES de
    // que ella añadiera el catorceavo. Es correcta y NO SE TOCA.
    expect(valoresDelCreateType(down412, "notificacion_evento")).toEqual(EVENTOS_PREVIOS.slice(0, 13));
    expect(valoresDelCreateType(down412, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 11),
    );
  });

  it("⭑ sólo el de la 412 retipa `push_envio_dia`, y los OCHO primeros NO — y eso es CORRECTO", () => {
    // `db:rollback` va de la última migración hacia atrás, y esa tabla se crea en la 410 —
    // POSTERIOR a las ocho primeras—, así que cuando a cada una le llega el turno ya no existe.
    // Retiparla allí sería el error contrario: un `ALTER TABLE` sobre una tabla ausente.
    const anteriores = { down146, down253, down262, down271, down333, down403, down401, down409 };
    for (const [nombre, sql] of Object.entries(anteriores)) {
      expect(sql, `${nombre} retipa push_envio_dia`).not.toMatch(/ALTER TABLE "push_envio_dia"/);
    }
    // Y la 412 SÍ, porque su timestamp es posterior al de la 410 — igual que el de ésta.
    expect(down412).toMatch(/ALTER TABLE "push_envio_dia"/);
  });

  it("⭑ y NINGUNO de los nueve menciona los valores de ESTA ficha", () => {
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
    };
    for (const [nombre, sql] of Object.entries(anteriores)) {
      for (const valor of [...EVENTOS_NUEVOS, ...ENTIDADES_NUEVAS]) {
        expect(sql, `${nombre} menciona ${valor}: alguien lo editó en sitio`).not.toContain(valor);
      }
    }
  });
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("413/T2.4 — la base aplicada, y los DOS índices que la ficha necesita", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function valoresDe(tipo: string): Promise<string[]> {
    // ⚠️ EL `nspname` NO ES DECORACIÓN: el arnés aísla algunas suites en esquemas temporales, y una
    // consulta que filtra sólo por `typname` devuelve las etiquetas DUPLICADAS cuando el tipo
    // existe en dos esquemas. Es la ficha 421, y aquí se evita de entrada.
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

  it("⭑ la base tiene los dos valores nuevos, AÑADIDOS al final (no recreados por detrás)", async () => {
    // ⚠️ NO se compara contra una lista cerrada: la base local es COMPARTIDA entre worktrees y
    // puede traer ya valores de OTRA ficha en curso. Lo que sí es cierto pase lo que pase: los
    // previos siguen estando, en su orden, y los nuevos van DESPUÉS — que es lo que demuestra que
    // se AÑADIERON con `ADD VALUE` y no que el tipo se recreó.
    const eventos = await valoresDe("notificacion_evento");
    const entidades = await valoresDe("notificacion_entidad_tipo");

    expect(eventos.slice(0, EVENTOS_PREVIOS.length)).toEqual(EVENTOS_PREVIOS);
    expect(entidades.slice(0, ENTIDADES_PREVIAS.length)).toEqual(ENTIDADES_PREVIAS);
    expect(eventos.indexOf("reparto_manana")).toBeGreaterThan(
      eventos.indexOf("cierre_dia_rechazado"),
    );
    expect(entidades.indexOf("reparto_manana_dia")).toBeGreaterThan(
      entidades.indexOf("cierre_dia_rechazo"),
    );
  });

  it("⭑ `push_envio_dia.evento` usa de verdad este enum (si no, el down no probaría nada)", async () => {
    // ANTI-VACUIDAD del caso del `2BP01` de más abajo: si esa columna dejara de usar el tipo, el
    // down pasaría sin retiparla y este archivo seguiría verde sin haber medido la trampa.
    //
    // Y ES LA LISTA COMPLETA: **TRES** columnas, ni una más. Si apareciera una cuarta, este aserto
    // se pone rojo y obliga a añadirla al `down.sql` ANTES de que el `DROP TYPE` muera con `2BP01`.
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
    // ⚠️ Y AQUÍ SE VE EL HECHO QUE DECIDE TODA LA FICHA: el índice NO MIRA EL ESTADO DE LECTURA.
    // Por eso la entidad tiene que llevar el DÍA ANUNCIADO dentro (R23); y por eso NO necesita el
    // mensajero, porque `destinatario_usuario_id` YA está en la clave (R7).
    expect(def).toMatch(/\(evento, entidad_id, destinatario_rol, destinatario_usuario_id\)/);
    expect(def).not.toMatch(/leida/);
  });
});

describeSiHayBase("413/T2.4 — el DOWN ejercitado de verdad, con su precondición", () => {
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
   * Aparta, DENTRO de la transacción revertida, toda fila cuyo valor de enum NO figure en las
   * listas que este `down.sql` recrea. Es su precondición dicha en código.
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
    // ES LA PRECONDICIÓN DEL `down.sql`, EJERCITADA. Todo corre dentro de una transacción que
    // SIEMPRE se revierte: el DDL también es transaccional en Postgres, así que la base queda
    // exactamente como estaba.
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        await apartarFilasConValoresNoListados(tx);
        await tx.$executeRawUnsafe(
          `INSERT INTO "notificacion"
             ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_usuario_id")
           VALUES ($1, 'box'::"notificacion_tipo", $2::"notificacion_evento",
                   'Es tu reparto del 12 de septiembre.', $3::"notificacion_entidad_tipo",
                   '2091-05-01',
                   (SELECT "id" FROM "usuario" LIMIT 1))`,
          randomUUID(),
          "reparto_manana",
          "reparto_manana_dia",
        );

        for (const sentencia of sentenciasDelDown()) await tx.$executeRawUnsafe(sentencia);
      }),
    ).rejects.toThrow();
  });

  it("⭑ y tras ese intento fallido, la fila del aviso SIGUE AHÍ (nadie le hizo sitio)", async () => {
    // La otra mitad de la precondición: el rollback aborta, pero NO borra ni reescribe avisos de
    // trabajo pendiente que su destinatario puede no haber leído. Se comprueba DENTRO de la misma
    // transacción para no dejar rastro: el `down` se ejecuta en un savepoint propio.
    const sigueAhi = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await apartarFilasConValoresNoListados(tx);
      const id = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO "notificacion"
           ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_usuario_id")
         VALUES ($1, 'box'::"notificacion_tipo", 'reparto_manana'::"notificacion_evento",
                 'Es tu reparto del 12 de septiembre.', 'reparto_manana_dia'::"notificacion_entidad_tipo",
                 '2091-05-02', (SELECT "id" FROM "usuario" LIMIT 1))`,
        id,
      );
      // El `down` se intenta dentro de un SAVEPOINT: su fallo no se lleva la transacción entera, y
      // así se puede volver a consultar después.
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

  it("⭑⭑ R38: CONTROL — sin filas de los valores nuevos, ese MISMO down corre ENTERO y los DOS índices SOBREVIVEN", async () => {
    // ⚠️ ANTI-VACUIDAD DEL CASO ANTERIOR, Y ES OBLIGATORIO. Sin este control, `rejects.toThrow()`
    // pasaría aunque el fallo viniera de CUALQUIER otra cosa — por ejemplo de olvidar retipar
    // `push_envio_dia`, que es justo la trampa heredada de la 410. Con esa mutación, ESTE caso
    // muere con `2BP01` («otros objetos dependen de él») mientras el de arriba seguiría verde. Es
    // la lección que dejó medida la 412: un `rejects.toThrow()` puede quedarse verde CON la
    // mutación puesta, porque falla por otro motivo.
    //
    // Y mide lo que importa DESPUÉS de que los `ALTER COLUMN ... TYPE` hayan destruido y rehecho
    // los índices de las TRES columnas.
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

    // R38, primera mitad: tras el down quedan EXACTAMENTE los 14 y las 12 previos. Ni uno menos —
    // eso es lo que demuestra que la reversión NO borra los valores de la 412 ni los de la 409.
    expect(r.eventos).toEqual(EVENTOS_PREVIOS);
    expect(r.entidades).toEqual(ENTIDADES_PREVIAS);

    // R38, segunda mitad: los DOS índices sobreviven a la reconstrucción de sus columnas.
    const dedupe = r.indices.find((i) => i.indexname === "notificacion_dedupe_key")?.def ?? "";
    const cupo = r.indices.find((i) => i.indexname === "push_envio_dia_cupo")?.def ?? "";

    expect(dedupe, "el down se llevó `notificacion_dedupe_key` por delante").not.toBe("");
    expect(dedupe).toMatch(/CREATE UNIQUE INDEX/i);
    expect(dedupe).toMatch(/NULLS NOT DISTINCT/i);
    expect(dedupe).toMatch(/WHERE \(entidad_id IS NOT NULL\)/i);
    expect(dedupe).toMatch(/\(evento, entidad_id, destinatario_rol, destinatario_usuario_id\)/);

    // ⭑ Y el de la 410, que ES la regla «un push al día por tipo»: si el down hubiera dejado la
    // columna sin retipar, no habríamos llegado hasta aquí.
    expect(cupo, "el down se llevó `push_envio_dia_cupo` por delante").not.toBe("");
    expect(cupo).toMatch(/CREATE UNIQUE INDEX/i);
    expect(cupo).toMatch(/\(usuario_id, evento, dia_cr\)/);
  });
});
