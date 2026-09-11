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

// FICHA 409 (T2.4, R63) — la migración que añade los DOS avisos agregados a los DOS enums de
// `notificacion`, y las propiedades que dependen de ella.
//
// MOLDE LITERAL de los de la 253, la 262, la 271, la 333, la 403 y la 401, y por el mismo motivo
// MEDIDO: en este repo añadir un valor a un enum de Postgres tiene trampa.
//
//  1. `ALTER TYPE ... DROP VALUE` NO EXISTE. El único down posible es RECREAR el tipo con la lista
//     previa, y eso obliga a un `ALTER COLUMN ... TYPE` que DESTRUYE Y REHACE los índices de esa
//     columna. Uno de ellos, `notificacion_dedupe_key`, es ÚNICO, PARCIAL y con
//     `NULLS NOT DISTINCT` — y de ese índice depende toda la dedupe diaria de esta ficha. Que
//     sobreviva a la reconstrucción NO SE SUPONE: se mide abajo, DESPUÉS de correr el down.
//  2. Hay que mirar si los `down.sql` ANTERIORES de estos enums recrean-con-lista o sólo dropean.
//     El de la 146 sólo dropea (se lleva también las tablas): no se toca. Los de la 253, 262, 271,
//     333, 403 y 401 SÍ recrean, cada uno con SU lista —«el enum antes de MI migración»—, que
//     sigue siendo cierta: tampoco se tocan. Las SIETE cosas se AFIRMAN abajo.
//  3. `notificacion_entidad_tipo` TAMBIÉN se toca, y esa es la mitad que se olvida: la entidad de
//     estos dos avisos es «ámbito + día», y ningún valor existente la describe.

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

const dirNueva = carpetaQueTerminaEn("_notificacion_evento_avisos_agregados");
const dir401 = carpetaQueTerminaEn("_notificacion_evento_geocodificacion_caida");
const dir403 = carpetaQueTerminaEn("_notificacion_evento_webhook_suscripcion");
const dir333 = carpetaQueTerminaEn("_notificacion_evento_gasto_fijo_cobro");
const dir271 = carpetaQueTerminaEn("_notificacion_evento_bloqueo_cierre");
const dir262 = carpetaQueTerminaEn("_notificacion_evento_dia_reparto_corregido");
const dir253 = carpetaQueTerminaEn("_notificacion_evento_postulacion_recurso");
const dir146 = carpetaQueTerminaEn("_notificacion");

const upSql = fs.readFileSync(path.join(dirNueva, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(dirNueva, "down.sql"), "utf8");
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
 * @ `aff769d888a0c893e48be6bd7c3144a97ec87c20` (2026-09-10): ONCE eventos y NUEVE entidades, con
 * los dos de la 403 y los dos de la 401 ya dentro.
 *
 * Si otra ficha añade un valor a estos enums y entra en `dev` ANTES que ésta, estas dos listas
 * —y las del `down.sql`— hay que reescribirlas contra el árbol al mergear: revertir con una lista
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
];

const EVENTOS_NUEVOS = ["novedades_sin_gestionar", "devoluciones_represadas"];
const ENTIDADES_NUEVAS = ["novedades_sin_gestionar_dia", "devoluciones_represadas_dia"];

function valoresDelCreateType(sql: string, tipo: string): string[] | null {
  const m = new RegExp(`CREATE TYPE "${tipo}" AS ENUM \\(([\\s\\S]*?)\\)`).exec(sql);
  if (m === null) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("409/T2.2 — el UP es aditivo y no toca nada más", () => {
  it("añade EXACTAMENTE los cuatro valores, con `IF NOT EXISTS`, y nada más", () => {
    for (const valor of EVENTOS_NUEVOS) {
      expect(upDdl).toMatch(
        new RegExp(`ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS '${valor}'`),
      );
    }
    for (const valor of ENTIDADES_NUEVAS) {
      expect(upDdl).toMatch(
        new RegExp(`ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS '${valor}'`),
      );
    }
    const sentencias = upDdl.split(";").filter((s) => s.trim().length > 0);
    expect(sentencias).toHaveLength(4);
  });

  it("el UP no crea tablas, no altera columnas y NO reescribe ninguna fila", () => {
    expect(upDdl).not.toMatch(/CREATE TABLE/i);
    expect(upDdl).not.toMatch(/ALTER TABLE/i);
    expect(upDdl).not.toMatch(/CREATE INDEX/i);
    expect(upDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(upDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(upDdl).not.toMatch(/^\s*INSERT\s/im);
  });

  it("va SOLA y con timestamp POSTERIOR a toda migración de enum ya aplicada (55P04)", () => {
    // Postgres no permite USAR un valor de enum recién añadido en la transacción que lo añadió, y
    // Prisma Migrate corre cada `migration.sql` en una. Que sea su propia carpeta no es estética.
    expect(path.basename(dirNueva) > path.basename(dir401)).toBe(true);
    expect(path.basename(dirNueva) > path.basename(dir403)).toBe(true);
  });
});

describe("409/T2.3 — el DOWN recrea con la lista de HOY y no borra nada", () => {
  it("⭑ recrea `notificacion_evento` con los ONCE previos, en orden, y sin los nuevos", () => {
    expect(valoresDelCreateType(downDdl, "notificacion_evento")).toEqual(EVENTOS_PREVIOS);
    for (const v of EVENTOS_NUEVOS) expect(downDdl).not.toContain(`'${v}'`);
  });

  it("⭑ recrea `notificacion_entidad_tipo` con las NUEVE previas, en orden, y sin las nuevas", () => {
    expect(valoresDelCreateType(downDdl, "notificacion_entidad_tipo")).toEqual(ENTIDADES_PREVIAS);
    for (const v of ENTIDADES_NUEVAS) expect(downDdl).not.toContain(`'${v}'`);
  });

  it("⭑ el down NO se lleva por delante los valores de la 401 ni los de la 403", () => {
    // LA MITAD QUE IMPORTA. El down recrea-con-lista; si la lista no incluyera los valores que ya
    // estaban en `dev` cuando esta migración se aplica, revertirla los BORRARÍA EN SILENCIO.
    const eventos = valoresDelCreateType(downDdl, "notificacion_evento")!;
    const entidades = valoresDelCreateType(downDdl, "notificacion_entidad_tipo")!;

    expect(eventos).toContain("webhook_suscripcion_pausada");
    expect(eventos).toContain("geocodificacion_caida");
    expect(entidades).toContain("webhook_suscripcion_pausa");
    expect(entidades).toContain("geocodificacion_caida_dia");
    // Y van al final: el orden del enum se conserva.
    expect(eventos[eventos.length - 1]).toBe("geocodificacion_caida");
    expect(entidades[entidades.length - 1]).toBe("geocodificacion_caida_dia");
  });

  it("lleva, para los DOS tipos, su RENAME, su ALTER COLUMN con USING y su DROP del `_old`", () => {
    for (const [tipo, columna] of [
      ["notificacion_evento", "evento"],
      ["notificacion_entidad_tipo", "entidad_tipo"],
    ]) {
      expect(downDdl).toMatch(new RegExp(`ALTER TYPE "${tipo}" RENAME TO "${tipo}_old"`));
      expect(downDdl).toMatch(new RegExp(`DROP TYPE "${tipo}_old"`));
      expect(downDdl).toMatch(
        new RegExp(
          `ALTER COLUMN "${columna}" TYPE "${tipo}"\\s*\\n?\\s*USING \\("${columna}"::text::"${tipo}"\\)`,
        ),
      );
    }
  });

  it("⭑ el down NO borra ni reescribe NINGUNA fila para «hacer sitio»", () => {
    expect(downDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(downDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(downDdl).not.toMatch(/DROP TABLE/);
    expect(downDdl).not.toMatch(/TRUNCATE/i);
  });
});

describe("409/T2.3 — los SIETE `down.sql` anteriores NO se tocan, y ésta es la comprobación", () => {
  it("⭑ el de la 146 SÓLO dropea los dos tipos; no los recrea con lista", () => {
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_evento"/);
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_entidad_tipo"/);
    expect(down146).not.toMatch(/CREATE TYPE "notificacion_evento"/);
    for (const v of [...EVENTOS_NUEVOS, ...ENTIDADES_NUEVAS]) expect(down146).not.toContain(v);
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

  it("⭑ y NINGUNO de los siete menciona los valores de ESTA ficha", () => {
    const anteriores = { down146, down253, down262, down271, down333, down403, down401 };
    for (const [nombre, sql] of Object.entries(anteriores)) {
      for (const valor of [...EVENTOS_NUEVOS, ...ENTIDADES_NUEVAS]) {
        expect(sql, `${nombre} menciona ${valor}: alguien lo editó en sitio`).not.toContain(valor);
      }
    }
  });
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("409/T2.4 — la base aplicada, y el índice de dedupe que la ficha necesita", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function valoresDe(tipo: string): Promise<string[]> {
    const filas = await prisma.$queryRawUnsafe<{ valores: string }[]>(
      `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS valores
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1`,
      tipo,
    );
    return (filas[0]?.valores ?? "").split(",").filter((v) => v.length > 0);
  }

  it("⭑ la base tiene los cuatro valores nuevos, AÑADIDOS al final (no recreados por detrás)", async () => {
    // ⚠️ NO se compara contra una lista cerrada: la base local es COMPARTIDA entre worktrees y
    // puede traer ya valores de OTRA ficha en curso. Lo que sí es cierto pase lo que pase: los
    // previos siguen estando, en su orden, y los nuevos van DESPUÉS — que es lo que demuestra que
    // se AÑADIERON con `ADD VALUE` y no que el tipo se recreó.
    const eventos = await valoresDe("notificacion_evento");
    const entidades = await valoresDe("notificacion_entidad_tipo");

    expect(eventos.slice(0, EVENTOS_PREVIOS.length)).toEqual(EVENTOS_PREVIOS);
    expect(entidades.slice(0, ENTIDADES_PREVIAS.length)).toEqual(ENTIDADES_PREVIAS);
    for (const v of EVENTOS_NUEVOS) {
      expect(eventos).toContain(v);
      expect(eventos.indexOf(v)).toBeGreaterThan(eventos.indexOf("geocodificacion_caida"));
    }
    for (const v of ENTIDADES_NUEVAS) {
      expect(entidades).toContain(v);
      expect(entidades.indexOf(v)).toBeGreaterThan(entidades.indexOf("geocodificacion_caida_dia"));
    }
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
    // ⚠️ Y AQUÍ SE VE EL HALLAZGO QUE DECIDE TODA LA FICHA: el ALCANCE (`tienda_id`, `zona_id`)
    // NO ESTÁ en la clave. Por eso el ámbito tiene que ir DENTRO del `entidad_id`.
    expect(def).toMatch(/\(evento, entidad_id, destinatario_rol, destinatario_usuario_id\)/);
    expect(def).not.toMatch(/tienda_id/);
    expect(def).not.toMatch(/zona_id/);
  });
});

describeSiHayBase("409/T2.4 — el DOWN ejercitado de verdad, con su precondición", () => {
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
             ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_rol")
           VALUES ($1, 'warning'::"notificacion_tipo", $2::"notificacion_evento",
                   'aviso sin leer', $3::"notificacion_entidad_tipo", 'global:2091-05-01',
                   'maestro'::"rol_value")`,
          randomUUID(),
          "devoluciones_represadas",
          "devoluciones_represadas_dia",
        );
        for (const sentencia of sentenciasDelDown()) await tx.$executeRawUnsafe(sentencia);
      }),
    ).rejects.toThrow();
  });

  it("⭑ CONTROL: sin filas de los valores nuevos, ese MISMO down corre entero y el índice SOBREVIVE", async () => {
    // Anti-vacuidad del caso anterior: sin este control, `rejects.toThrow()` pasaría aunque el
    // fallo viniera de cualquier otra cosa. Y mide lo que importa — DESPUÉS de que el
    // `ALTER COLUMN ... TYPE` haya destruido y rehecho los índices de las dos columnas.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      await apartarFilasConValoresNoListados(tx);
      for (const sentencia of sentenciasDelDown()) await tx.$executeRawUnsafe(sentencia);
      const indices = await tx.$queryRawUnsafe<{ def: string }[]>(
        `SELECT indexdef AS def FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'notificacion_dedupe_key'`,
      );
      const eventos = await tx.$queryRawUnsafe<{ valores: string }[]>(
        `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS valores
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'notificacion_evento'`,
      );
      const entidades = await tx.$queryRawUnsafe<{ valores: string }[]>(
        `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS valores
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'notificacion_entidad_tipo'`,
      );
      return {
        def: indices[0]?.def ?? "",
        eventos: (eventos[0]?.valores ?? "").split(","),
        entidades: (entidades[0]?.valores ?? "").split(","),
      };
    });

    // R63, primera mitad: tras el down quedan EXACTAMENTE los 11 y las 9 previos.
    expect(r.eventos).toEqual(EVENTOS_PREVIOS);
    expect(r.entidades).toEqual(ENTIDADES_PREVIAS);
    // R63, segunda mitad: el índice conserva su `NULLS NOT DISTINCT` y su `WHERE` parcial.
    expect(r.def, "el down se llevó `notificacion_dedupe_key` por delante").not.toBe("");
    expect(r.def).toMatch(/CREATE UNIQUE INDEX/i);
    expect(r.def).toMatch(/NULLS NOT DISTINCT/i);
    expect(r.def).toMatch(/WHERE \(entidad_id IS NOT NULL\)/i);
    expect(r.def).toMatch(/\(evento, entidad_id, destinatario_rol, destinatario_usuario_id\)/);
  });
});
