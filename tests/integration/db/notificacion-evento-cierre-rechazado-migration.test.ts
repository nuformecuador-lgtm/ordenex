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

// FICHA 412 (T2.4, R24/R25) — la migración que añade el aviso de «tu cierre fue rechazado» a los
// DOS enums de `notificacion`, y las propiedades que dependen de ella.
//
// MOLDE de los de la 253, la 262, la 271, la 333, la 403, la 401 y la 409, y por el mismo motivo
// MEDIDO: en este repo añadir un valor a un enum de Postgres tiene trampa.
//
//  1. `ALTER TYPE ... DROP VALUE` NO EXISTE. El único down posible es RECREAR el tipo con la lista
//     previa, y eso obliga a un `ALTER COLUMN ... TYPE` que DESTRUYE Y REHACE los índices de esa
//     columna. Uno de ellos, `notificacion_dedupe_key`, es ÚNICO, PARCIAL y con
//     `NULLS NOT DISTINCT` — y de ese índice depende toda la dedupe de esta ficha.
//  2. Hay que mirar si los `down.sql` ANTERIORES de estos enums recrean-con-lista o sólo dropean.
//     Son OCHO y ninguno se toca: cada uno es una foto de su momento. Se AFIRMA abajo.
//
// ⚠️⚠️ Y LA NOVEDAD DE ESTA FICHA, QUE ES LA TERCERA TRAMPA Y NO EXISTÍA HASTA HOY:
//
//     `notificacion_evento` YA NO LO USA UNA SOLA COLUMNA.
//
// La 410 añadió `push_envio_dia.evento` (el cupo diario del canal de push) y su migración es
// ANTERIOR a ésta, así que cuando a este `down.sql` le llega el turno en un rollback real, esa
// tabla EXISTE. Un down que retipe sólo `notificacion.evento` deja una dependencia viva y el
// `DROP TYPE ..._old` muere con `2BP01`. La obligación está escrita en `db/schema.prisma`, junto
// al modelo `PushEnvioDia`; aquí se EJERCITA.
//
// Por eso este archivo, a diferencia del de la 409, **NO** llama a
// `soltarDependientesPosterioresDelEnumDeEventos`: aquella migración es anterior a la 410 y en su
// rollback la tabla ya no existe, así que tenía que simular esa ausencia. Ésta es posterior, y la
// tabla tiene que estar delante — que es justo lo que hace que el caso de abajo pueda ponerse rojo.

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

const dirNueva = carpetaQueTerminaEn("_notificacion_evento_cierre_rechazado");
const dirPush = carpetaQueTerminaEn("_push_suscripcion");
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
 * ⚠️ «LOS ENUMS ANTES DE ESTA MIGRACIÓN», escritos leyendo `db/schema.prisma` de `origin/dev`
 * @ `b4ee84128fd086710dd3f27e6d8d62c3a31e868d` (2026-09-11): TRECE eventos y ONCE entidades, con
 * los dos de la 409 ya dentro.
 *
 * RE-LEÍDOS justo antes de abrir el PR, con `dev` ya movido a
 * `6c5335fc022733967f3590405e776d74a122efc4`: los dos enums siguen idénticos (el único commit de
 * diferencia toca `progress/current.md`), así que estas listas no cambian.
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
];

const EVENTOS_NUEVOS = ["cierre_dia_rechazado"];
const ENTIDADES_NUEVAS = ["cierre_dia_rechazo"];

function valoresDelCreateType(sql: string, tipo: string): string[] | null {
  const m = new RegExp(`CREATE TYPE "${tipo}" AS ENUM \\(([\\s\\S]*?)\\)`).exec(sql);
  if (m === null) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("412/T2.1 — el UP es aditivo y no toca nada más", () => {
  it("añade EXACTAMENTE los dos valores, con `IF NOT EXISTS`, y nada más", () => {
    expect(upDdl).toMatch(
      /ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS 'cierre_dia_rechazado'/,
    );
    expect(upDdl).toMatch(
      /ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS 'cierre_dia_rechazo'/,
    );
    const sentencias = upDdl.split(";").filter((s) => s.trim().length > 0);
    expect(sentencias).toHaveLength(2);
  });

  it("el UP no crea tablas, no altera columnas y NO reescribe ninguna fila", () => {
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

  it("va SOLA y con timestamp POSTERIOR a toda migración de enum ya aplicada Y a la 410", () => {
    expect(path.basename(dirNueva) > path.basename(dir409)).toBe(true);
    expect(path.basename(dirNueva) > path.basename(dir401)).toBe(true);
    // ⭑ Y POSTERIOR A LA 410, que es lo que obliga al down a retipar `push_envio_dia`.
    expect(path.basename(dirNueva) > path.basename(dirPush)).toBe(true);
  });
});

describe("412/T2.3 — el DOWN recrea con la lista de HOY y no borra nada", () => {
  it("⭑ recrea `notificacion_evento` con los TRECE previos, en orden, y sin el nuevo", () => {
    expect(valoresDelCreateType(downDdl, "notificacion_evento")).toEqual(EVENTOS_PREVIOS);
    for (const v of EVENTOS_NUEVOS) expect(downDdl).not.toContain(`'${v}'`);
  });

  it("⭑ recrea `notificacion_entidad_tipo` con las ONCE previas, en orden, y sin la nueva", () => {
    expect(valoresDelCreateType(downDdl, "notificacion_entidad_tipo")).toEqual(ENTIDADES_PREVIAS);
    for (const v of ENTIDADES_NUEVAS) expect(downDdl).not.toContain(`'${v}'`);
  });

  it("⭑ el down NO se lleva por delante los valores de la 409, la 401 ni la 403", () => {
    // LA MITAD QUE IMPORTA. El down recrea-con-lista; si la lista no incluyera los valores que ya
    // estaban en `dev` cuando esta migración se aplica, revertirla los BORRARÍA EN SILENCIO.
    const eventos = valoresDelCreateType(downDdl, "notificacion_evento")!;
    const entidades = valoresDelCreateType(downDdl, "notificacion_entidad_tipo")!;

    expect(eventos).toContain("webhook_suscripcion_pausada");
    expect(eventos).toContain("geocodificacion_caida");
    expect(eventos).toContain("novedades_sin_gestionar");
    expect(eventos).toContain("devoluciones_represadas");
    expect(entidades).toContain("novedades_sin_gestionar_dia");
    expect(entidades).toContain("devoluciones_represadas_dia");
    // Y van al final: el orden del enum se conserva.
    expect(eventos[eventos.length - 1]).toBe("devoluciones_represadas");
    expect(entidades[entidades.length - 1]).toBe("devoluciones_represadas_dia");
  });

  it("⭑⭑ R24: el down retipa LAS **TRES** columnas, no dos — incluida `push_envio_dia.evento`", () => {
    // ES LA TRAMPA DE ESTA FICHA. `notificacion_evento` lo usan DOS columnas desde la 410, y las
    // dos tienen que estar reconstruidas ANTES del `DROP TYPE ..._old`.
    // MUTACIÓN OBLIGATORIA (design §12.9): quitar el `ALTER TABLE "push_envio_dia"` ⇒ este caso
    // se pone rojo AQUÍ, y el de más abajo se pone rojo CONTRA POSTGRES con un `2BP01`.
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

  it("⭑ R25: el down NO borra ni reescribe NINGUNA fila para «hacer sitio»", () => {
    expect(downDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(downDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(downDdl).not.toMatch(/DROP TABLE/);
    expect(downDdl).not.toMatch(/TRUNCATE/i);
  });
});

describe("412/T2.3 — los OCHO `down.sql` anteriores NO se tocan, y ésta es la comprobación", () => {
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

  it("⭑ NINGUNO de los ocho retipa `push_envio_dia`, y eso es CORRECTO", () => {
    // `db:rollback` va de la última migración hacia atrás, y esa tabla se crea en la 410 —
    // POSTERIOR a las ocho—, así que cuando a cada una le llega el turno ya no existe. Retiparla
    // allí sería el error contrario: un `ALTER TABLE` sobre una tabla ausente.
    const anteriores = { down146, down253, down262, down271, down333, down403, down401, down409 };
    for (const [nombre, sql] of Object.entries(anteriores)) {
      expect(sql, `${nombre} retipa push_envio_dia`).not.toMatch(/ALTER TABLE "push_envio_dia"/);
    }
  });

  it("⭑ y NINGUNO de los ocho menciona los valores de ESTA ficha", () => {
    const anteriores = { down146, down253, down262, down271, down333, down403, down401, down409 };
    for (const [nombre, sql] of Object.entries(anteriores)) {
      for (const valor of [...EVENTOS_NUEVOS, ...ENTIDADES_NUEVAS]) {
        expect(sql, `${nombre} menciona ${valor}: alguien lo editó en sitio`).not.toContain(valor);
      }
    }
  });
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("412/T2.5 — la base aplicada, y los DOS índices que la ficha necesita", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function valoresDe(tipo: string): Promise<string[]> {
    // ⚠️ EL `nspname` NO ES DECORACION: el arnés aísla algunas suites en esquemas temporales, y
    // una consulta que filtra sólo por `typname` devuelve las etiquetas DUPLICADAS cuando el tipo
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
    expect(eventos.indexOf("cierre_dia_rechazado")).toBeGreaterThan(
      eventos.indexOf("devoluciones_represadas"),
    );
    expect(entidades.indexOf("cierre_dia_rechazo")).toBeGreaterThan(
      entidades.indexOf("devoluciones_represadas_dia"),
    );
  });

  it("⭑ `push_envio_dia.evento` usa de verdad este enum (si no, el down no probaría nada)", async () => {
    // ANTI-VACUIDAD del caso del `2BP01` de más abajo: si esa columna dejara de usar el tipo, el
    // down pasaría sin retiparla y este archivo seguiría verde sin haber medido la trampa.
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
    // Por eso la entidad tiene que llevar el INSTANTE del rechazo dentro: con el cierre a secas,
    // el segundo rechazo no cabría en esta clave nunca más.
    expect(def).toMatch(/\(evento, entidad_id, destinatario_rol, destinatario_usuario_id\)/);
    expect(def).not.toMatch(/leida/);
  });
});

describeSiHayBase("412/T2.5 — el DOWN ejercitado de verdad, con su precondición", () => {
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

  it("⭑ R25: el DOWN con una fila de un evento nuevo ABORTA RUIDOSAMENTE (y no borra nada)", async () => {
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
           VALUES ($1, 'alert'::"notificacion_tipo", $2::"notificacion_evento",
                   'aviso sin leer', $3::"notificacion_entidad_tipo",
                   'c-x:2091-05-01T00:00:00.000Z',
                   (SELECT "id" FROM "usuario" LIMIT 1))`,
          randomUUID(),
          "cierre_dia_rechazado",
          "cierre_dia_rechazo",
        );

        for (const sentencia of sentenciasDelDown()) await tx.$executeRawUnsafe(sentencia);
      }),
    ).rejects.toThrow();
  });

  it("⭑ R25: y tras ese intento fallido, la fila del aviso SIGUE AHÍ (nadie le hizo sitio)", async () => {
    // La otra mitad de R25: el rollback aborta, pero NO borra ni reescribe avisos de trabajo
    // pendiente que su destinatario puede no haber leído. Se comprueba DENTRO de la misma
    // transacción para no dejar rastro: el `down` se ejecuta en un savepoint propio.
    const sigueAhi = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await apartarFilasConValoresNoListados(tx);
      const id = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO "notificacion"
           ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_usuario_id")
         VALUES ($1, 'alert'::"notificacion_tipo", 'cierre_dia_rechazado'::"notificacion_evento",
                 'aviso sin leer', 'cierre_dia_rechazo'::"notificacion_entidad_tipo",
                 'c-y:2091-05-01T00:00:00.000Z', (SELECT "id" FROM "usuario" LIMIT 1))`,
        id,
      );
      // El `down` se intenta dentro de un SAVEPOINT: su fallo no se lleva la transacción entera,
      // y así se puede volver a consultar después.
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

  it("⭑⭑ R24: CONTROL — sin filas de los valores nuevos, ese MISMO down corre ENTERO y los DOS índices SOBREVIVEN", async () => {
    // Anti-vacuidad del caso anterior: sin este control, `rejects.toThrow()` pasaría aunque el
    // fallo viniera de cualquier otra cosa — POR EJEMPLO de olvidar retipar `push_envio_dia`, que
    // es justo la trampa de esta ficha. Con la mutación «quitar el `ALTER TABLE
    // "push_envio_dia"`», ESTE caso muere con `2BP01` («otros objetos dependen de él») mientras el
    // de arriba seguiría verde. Por eso el control es obligatorio.
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

    // R24, primera mitad: tras el down quedan EXACTAMENTE los 13 y las 11 previos.
    expect(r.eventos).toEqual(EVENTOS_PREVIOS);
    expect(r.entidades).toEqual(ENTIDADES_PREVIAS);

    // R24, segunda mitad: los DOS índices sobreviven a la reconstrucción de sus columnas.
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
