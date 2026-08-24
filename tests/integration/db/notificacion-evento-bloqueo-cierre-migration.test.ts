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

// FEATURE 271 (T10.4, §3.2 — Q4 resuelta por el humano el 2026-08-23) — la migracion que anade los
// DOS avisos del bloqueo por cierres a `notificacion_evento`.
//
// POR QUE ESTE ARCHIVO EXISTE, y es el molde literal de los de la 253 y la 262: en este repo anadir
// un valor a un enum de Postgres tiene trampa MEDIDA.
//
//  1. `ALTER TYPE ... DROP VALUE` NO EXISTE. El unico down posible es RECREAR el tipo con la lista
//     previa, y eso obliga a un `ALTER COLUMN ... TYPE` sobre `notificacion.evento`, que DESTRUYE Y
//     REHACE los indices de esa columna. Uno de ellos, `notificacion_dedupe_key`, es UNICO, PARCIAL
//     y con `NULLS NOT DISTINCT` — y ese `NULLS NOT DISTINCT` es imprescindible: sin el, las dos
//     columnas de destinatario (una es SIEMPRE NULL por el CHECK XOR) nunca colisionarian y el
//     indice no deduplicaria nada. Que sobreviva a la reconstruccion NO SE SUPONE: se mide abajo,
//     contra Postgres de verdad.
//  2. Hay que mirar si el `down.sql` de la migracion que CREO el enum recrea-con-lista o solo
//     dropea. Aqui SOLO dropea (la 146 se lleva tambien las tablas), asi que aquel archivo NO se
//     toca. Y los de la 253 y la 262 SI recrean, pero cada uno con SU lista —«el enum antes de MI
//     migracion»—, que sigue siendo cierta: tampoco se tocan. Las tres cosas se AFIRMAN abajo.
//  3. `notificacion_entidad_tipo` NO SE TOCA, y esa es la mitad que se olvida (la 262 tuvo que
//     anadir a los dos). Aqui la entidad de los dos eventos es una fila de `cierre_dia`, que YA
//     esta en el inventario desde la 146. Se afirma que el up NO lo menciona.

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

const dirNueva = carpetaQueTerminaEn("_notificacion_evento_bloqueo_cierre");
const dir262 = carpetaQueTerminaEn("_notificacion_evento_dia_reparto_corregido");
const dir253 = carpetaQueTerminaEn("_notificacion_evento_postulacion_recurso");
const dir146 = carpetaQueTerminaEn("_notificacion");

const upSql = fs.readFileSync(path.join(dirNueva, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(dirNueva, "down.sql"), "utf8");
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

/** El enum ANTES de esta migracion: los 4 de la 146 + el de la 253 + el de la 262. */
const EVENTOS_PREVIOS = [
  "orden_rechazada",
  "carga_masiva_terminada",
  "postulacion_mensajero_pendiente",
  "cierre_dia_por_aprobar",
  "postulacion_recurso_pendiente",
  "dia_reparto_corregido",
];

const NUEVOS = ["cierre_dia_vencido", "mensajero_bloqueado_por_cierres"];

describe("271 / §3.2 — el UP es aditivo y NO toca nada mas", () => {
  it("anade EXACTAMENTE los dos valores, con `IF NOT EXISTS`", () => {
    for (const valor of NUEVOS) {
      expect(upDdl).toMatch(
        new RegExp(`ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS '${valor}'`),
      );
    }
    // Solo DOS sentencias: nada de tablas, columnas, indices ni backfill (R55).
    const sentencias = upDdl.split(";").filter((s) => s.trim().length > 0);
    expect(sentencias).toHaveLength(2);
  });

  it("R55: el UP no crea tablas, no altera columnas y NO reescribe ninguna fila", () => {
    expect(upDdl).not.toMatch(/CREATE TABLE/i);
    expect(upDdl).not.toMatch(/ADD COLUMN/i);
    expect(upDdl).not.toMatch(/ALTER TABLE/i);
    expect(upDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(upDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(upDdl).not.toMatch(/^\s*INSERT\s/im);
  });

  it("`notificacion_entidad_tipo` NO se toca: `cierre_dia` ya estaba en el inventario", () => {
    // La mitad que se olvida. Aqui no hace falta, y anadir un valor que sobra a un inventario
    // CERRADO es peor que no anadirlo.
    expect(upDdl).not.toContain("notificacion_entidad_tipo");
  });
});

describe("271 / §3.2 — el DOWN recrea con la lista de HOY y no borra nada", () => {
  it("recrea `notificacion_evento` con los SEIS previos, en orden, y sin los dos nuevos", () => {
    const m = /CREATE TYPE "notificacion_evento" AS ENUM \(([\s\S]*?)\)/.exec(downDdl);
    expect(m).not.toBeNull();
    expect([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual(EVENTOS_PREVIOS);
    for (const valor of NUEVOS) {
      expect(m![1]).not.toContain(valor);
    }
  });

  it("lleva su RENAME, su ALTER COLUMN con USING y su DROP del `_old`", () => {
    expect(downDdl).toMatch(/ALTER TYPE "notificacion_evento" RENAME TO "notificacion_evento_old"/);
    expect(downDdl).toMatch(/DROP TYPE "notificacion_evento_old"/);
    expect(downDdl).toMatch(
      /ALTER COLUMN "evento" TYPE "notificacion_evento"\s*\n?\s*USING \("evento"::text::"notificacion_evento"\)/,
    );
  });

  it("y NO toca `notificacion_entidad_tipo`, porque el up tampoco lo toco", () => {
    expect(downDdl).not.toContain("notificacion_entidad_tipo");
  });

  it("⭑ el down NO borra ni reescribe NINGUNA fila para «hacer sitio»", () => {
    // ⚠️ LA PRECONDICION RUIDOSA. Si quedaran filas con un valor nuevo, el `USING` debe fallar
    // RUIDOSAMENTE y abortar el rollback. Esas filas son avisos de BLOQUEO que un mensajero puede
    // no haber leido: borrarlos en silencio apagaria la unica senal de por que no puede trabajar.
    expect(downDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(downDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(downDdl).not.toMatch(/DROP TABLE/);
    expect(downDdl).not.toMatch(/TRUNCATE/i);
  });
});

describe("271 / §3.2 — los `down.sql` ANTERIORES no se tocan, y esta es la comprobacion", () => {
  it("⭑ el de la 146 SOLO dropea el enum; no lo recrea con lista", () => {
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_evento"/);
    expect(down146).not.toMatch(/CREATE TYPE "notificacion_evento"/);
    // Y NO menciona ninguno de los valores posteriores: es una foto historica.
    for (const valor of [...NUEVOS, "dia_reparto_corregido", "postulacion_recurso"]) {
      expect(down146).not.toContain(valor);
    }
  });

  it("⭑ el de la 253 recrea con SUS CUATRO valores, y sigue siendo cierto", () => {
    const m = /CREATE TYPE "notificacion_evento" AS ENUM \(([\s\S]*?)\)/.exec(down253);
    expect(m).not.toBeNull();
    expect([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual(EVENTOS_PREVIOS.slice(0, 4));
    for (const valor of NUEVOS) expect(down253).not.toContain(valor);
  });

  it("⭑ el de la 262 recrea con SUS CINCO valores, y sigue siendo cierto", () => {
    // Renumerar o editar una migracion ya aplicada es la leccion de «migracion editada en sitio =
    // drift»: lo anadido despues no llega nunca a esa base.
    const m = /CREATE TYPE "notificacion_evento" AS ENUM \(([\s\S]*?)\)/.exec(down262);
    expect(m).not.toBeNull();
    expect([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual(EVENTOS_PREVIOS.slice(0, 5));
    for (const valor of NUEVOS) expect(down262).not.toContain(valor);
  });
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("271 / §3.2 — la base aplicada, y el DOWN ejercitado de verdad", () => {
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

  it("la base tiene los OCHO eventos, con los dos nuevos AL FINAL y en orden de adicion", async () => {
    // El orden (`enumsortorder`) es lo que demuestra que los valores se ANADIERON y no que el tipo
    // se recreo por detras.
    expect(await valoresDe("notificacion_evento")).toEqual([...EVENTOS_PREVIOS, ...NUEVOS]);
  });

  it("⭑ una notificacion con cada evento nuevo se puede ESCRIBIR de verdad", async () => {
    // Es lo que ningun test estatico puede demostrar: que el valor no solo esta en el cliente
    // generado, sino que la BASE lo acepta en la columna. Se escribe y se borra en el acto; la fila
    // lleva `entidad_id` NULL, asi que no entra en el indice unico de dedupe (que es parcial), y
    // lleva `destinatario_rol` porque el CHECK `notificacion_destinatario_xor` exige exactamente
    // uno de los dos destinatarios (146 §1.2).
    for (const evento of NUEVOS) {
      const id = randomUUID();
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "notificacion"
             ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_rol")
           VALUES ($1, 'alert'::"notificacion_tipo",
                   $2::"notificacion_evento",
                   'prueba 271', 'cierre_dia'::"notificacion_entidad_tipo",
                   NULL, 'maestro'::"rol_value")`,
          id,
          evento,
        );
        const filas = await prisma.$queryRawUnsafe<{ evento: string }[]>(
          `SELECT "evento"::text AS evento FROM "notificacion" WHERE "id" = $1`,
          id,
        );
        expect(filas[0]?.evento).toBe(evento);
      } finally {
        await prisma.$executeRawUnsafe(`DELETE FROM "notificacion" WHERE "id" = $1`, id);
      }
    }
  });

  it("⭑ T10.4: el DOWN con una fila del evento nuevo ABORTA RUIDOSAMENTE (no borra nada)", async () => {
    // ⚠️ ES LA PRECONDICION DEL `down.sql`, EJERCITADA. Si quedara una fila con un valor nuevo, el
    // `USING` del `ALTER COLUMN` no puede castearla al tipo recreado y el rollback DEBE fallar. Es
    // el comportamiento CORRECTO y deliberado: esas filas son avisos de BLOQUEO que un mensajero
    // puede no haber leido, y borrarlas en silencio apagaria la unica senal de por que no puede
    // trabajar. Aqui se comprueba que el down NO tiene ninguna via para «hacer sitio».
    //
    // Todo corre dentro de una transaccion que SIEMPRE se revierte: el DDL tambien es
    // transaccional en Postgres, asi que la base queda exactamente como estaba.
    const sentencias = downDdl
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);

    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        await tx.$executeRawUnsafe(
          `INSERT INTO "notificacion"
             ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_rol")
           VALUES ($1, 'alert'::"notificacion_tipo",
                   'cierre_dia_vencido'::"notificacion_evento",
                   'aviso sin leer', 'cierre_dia'::"notificacion_entidad_tipo",
                   NULL, 'maestro'::"rol_value")`,
          randomUUID(),
        );
        for (const sentencia of sentencias) {
          await tx.$executeRawUnsafe(sentencia);
        }
      }),
    ).rejects.toThrow();
  });

  it("⭑ CONTROL: SIN filas del evento nuevo, ese MISMO down corre entero sin fallar", async () => {
    // Anti-vacuidad del caso anterior. Sin este control, `rejects.toThrow()` pasaria aunque el
    // fallo viniera de cualquier otra cosa —una sentencia mal escrita, un permiso, un lock— y el
    // test estaria midiendo su propio ruido en vez de la precondicion.
    const sentencias = downDdl
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);

    const ok = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      // Se apartan las filas con los valores nuevos, DENTRO de la transaccion revertida: no se
      // borran de verdad (el rollback las devuelve), y asi el down encuentra la base «limpia».
      await tx.$executeRawUnsafe(
        `DELETE FROM "notificacion" WHERE "evento"::text = ANY($1::text[])`,
        NUEVOS,
      );
      for (const sentencia of sentencias) {
        await tx.$executeRawUnsafe(sentencia);
      }
      return "el down corrio entero";
    });

    expect(ok).toBe("el down corrio entero");
  });

  it("⭑ `notificacion_dedupe_key` SIGUE siendo UNIQUE, PARCIAL y con NULLS NOT DISTINCT", async () => {
    // ⚠️ NO SE SUPONE QUE SOBREVIVA a la reconstruccion del down: se mide. Sin `NULLS NOT DISTINCT`
    // el indice no deduplicaria nada —una de las dos columnas de destinatario es SIEMPRE NULL por
    // el CHECK XOR— y la campana repetiria el mismo aviso indefinidamente.
    const filas = await prisma.$queryRawUnsafe<{ def: string }[]>(
      `SELECT indexdef AS def FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'notificacion_dedupe_key'`,
    );
    const def = filas[0]?.def ?? "";
    expect(def, "no existe `notificacion_dedupe_key`").not.toBe("");
    expect(def).toMatch(/CREATE UNIQUE INDEX/i);
    expect(def).toMatch(/NULLS NOT DISTINCT/i);
    expect(def).toMatch(/WHERE \(entidad_id IS NOT NULL\)/i);
    // Y las cuatro columnas de la clave, en orden.
    expect(def).toMatch(/\(evento, entidad_id, destinatario_rol, destinatario_usuario_id\)/);
  });
});
