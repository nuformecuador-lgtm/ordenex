import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  etiquetasDeEnum,
  serializarEscriturasReales,
  type TxDeTest,
} from "../_postgres-real";

// FICHA 462 (T2.1, R53) — la migracion que anade el aviso de reprogramadas retenidas a los DOS enums
// de `notificacion`, y su `down.sql` DINAMICO.
//
// LO QUE CAMBIA RESPECTO A LOS ONCE DOWNS PREVIOS DE ESTOS ENUMS (decision del leader del
// 2026-09-25, precedente P12 de la 459): el down NO recrea el tipo con una lista fija escrita en
// esta rama. Lee `pg_enum`, quita SOLO los dos valores de esta ficha y conserva cualquier valor que
// otra ficha añada despues. Asi vale igual en `prod`, en `dev` y en un clon, hoy y dentro de seis
// meses. Se afirma:
//  (a) el UP es aditivo, con `IF NOT EXISTS`, no usa los valores que añade (`55P04`) y su
//      timestamp es posterior al de la 427 y al de la 410;
//  (b) el DOWN no trae `CREATE TYPE ... AS ENUM ('...` con lista fija, ni DELETE/UPDATE/TRUNCATE, y
//      su funcion es la MISMA que la de la 459 salvo el sufijo;
//  (c) la base aplicada tiene los dos valores AL FINAL, y las TRES columnas que usan estos enums
//      siguen siendo tres;
//  (d) el DOWN ejercitado de verdad: con UNA fila del evento nuevo ABORTA sin borrar nada; sin
//      filas, quita SOLO los dos valores (conservando un valor ajeno añadido despues, en una copia
//      del tipo) y los DOS indices unicos sobreviven con su definicion exacta.
//
// Todo en transacciones que SIEMPRE se revierten; el DDL tambien es transaccional en Postgres.

const ROOT = path.join(__dirname, "..", "..", "..", "..");
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

const dirNueva = carpetaQueTerminaEn("_notificacion_evento_reprogramadas_esperan_cierre");
const dir427 = carpetaQueTerminaEn("_notificacion_evento_traspaso");
const dirPush = carpetaQueTerminaEn("_push_suscripcion");
const dir459 = carpetaQueTerminaEn("_caja_459_enums");

const upSql = fs.readFileSync(path.join(dirNueva, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(dirNueva, "down.sql"), "utf8");
const down459 = fs.readFileSync(path.join(dir459, "down.sql"), "utf8");

function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith("--"))
    .join("\n");
}

const upDdl = sinComentarios(upSql);
const downDdl = sinComentarios(downSql);

const EVENTO_NUEVO = "reprogramadas_esperan_cierre";
const ENTIDAD_NUEVA = "reprogramadas_esperan_cierre_dia";

/** La funcion de reversion, tal cual esta en el down (una sola sentencia), con su sufijo. */
function funcionDe(down: string, sufijo: string): string {
  const m = new RegExp(
    `CREATE OR REPLACE FUNCTION pg_temp\\.quitar_valores_de_enum_${sufijo}[\\s\\S]*?\\$fn\\$;`,
  ).exec(down);
  if (m === null) throw new Error(`el down.sql no trae la funcion de reversion _${sufijo}`);
  return m[0];
}

describe("462/T2.1 — el UP es aditivo y no toca nada mas", () => {
  it("anade EXACTAMENTE los dos valores, con `IF NOT EXISTS`, y nada mas", () => {
    expect(upDdl).toMatch(/ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS 'reprogramadas_esperan_cierre'/);
    expect(upDdl).toMatch(
      /ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS 'reprogramadas_esperan_cierre_dia'/,
    );
    expect(upDdl.split(";").filter((s) => s.trim().length > 0)).toHaveLength(2);
  });

  it("el UP no crea tablas, no altera columnas, NO CREA INDICES y NO reescribe ninguna fila", () => {
    expect(upDdl).not.toMatch(/CREATE TABLE/i);
    expect(upDdl).not.toMatch(/ALTER TABLE/i);
    expect(upDdl).not.toMatch(/CREATE INDEX/i);
    expect(upDdl).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\s/im);
  });

  it("el UP NO USA los valores que acaba de anadir (`55P04`)", () => {
    const sinAdd = upDdl.split("\n").filter((l) => !l.includes("ADD VALUE")).join("\n");
    expect(sinAdd).not.toContain(EVENTO_NUEVO);
    expect(sinAdd).not.toContain(ENTIDAD_NUEVA);
  });

  it("va SOLA, con timestamp POSTERIOR a la 427 y a la 410", () => {
    expect(path.basename(dirNueva) > path.basename(dir427)).toBe(true);
    expect(path.basename(dirNueva) > path.basename(dirPush)).toBe(true);
    expect(path.basename(dirNueva)).toMatch(/^20260925130000_/);
  });
});

describe("462/T2.1 — el DOWN es DINAMICO (P12): lee pg_enum y no recrea con lista fija", () => {
  it("⭑ NO trae ningun `CREATE TYPE ... AS ENUM ('...')` con lista escrita a mano", () => {
    expect(downDdl).not.toMatch(/CREATE TYPE "[a-z_]+" AS ENUM \(\s*'/);
    expect(downDdl).not.toMatch(/RENAME TO "notificacion_evento_old"/);
  });

  it("⭑ quita EXACTAMENTE los dos valores de esta ficha, uno por tipo", () => {
    expect(downDdl).toMatch(
      /quitar_valores_de_enum_462\('public', 'notificacion_evento', ARRAY\[\s*'reprogramadas_esperan_cierre'\s*\]\)/,
    );
    expect(downDdl).toMatch(
      /quitar_valores_de_enum_462\('public', 'notificacion_entidad_tipo', ARRAY\[\s*'reprogramadas_esperan_cierre_dia'\s*\]\)/,
    );
    // Y NINGUN otro valor de estos enums aparece en el down: no toca lo de nadie mas.
    for (const ajeno of ["traspaso_ordenes_recibido", "reparto_manana", "orden_traspaso_lote", "devoluciones_represadas"]) {
      expect(downDdl).not.toContain(`'${ajeno}'`);
    }
  });

  it("⭑ el down NO borra ni reescribe NINGUNA fila para «hacer sitio»", () => {
    expect(downDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(downDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(downDdl).not.toMatch(/DROP TABLE/);
    expect(downDdl).not.toMatch(/TRUNCATE/i);
  });

  it("⭑ la funcion es LA MISMA que la de la 459, byte a byte salvo el sufijo", () => {
    const normalizar = (f: string) => f.replace(/_462\b/g, "_NNN").replace(/rollback 462/g, "rollback NNN").replace(/_old_462/g, "_old_NNN");
    const normalizar459 = (f: string) => f.replace(/_459\b/g, "_NNN").replace(/rollback 459/g, "rollback NNN").replace(/_old_459/g, "_old_NNN");
    expect(normalizar(funcionDe(downSql, "462"))).toBe(normalizar459(funcionDe(down459, "459")));
  });
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("462/T2.1 — la base aplicada", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ tiene los dos valores nuevos, ANADIDOS al final (no recreados por detras)", async () => {
    const eventos = await etiquetasDeEnum(prisma, "notificacion_evento");
    const entidades = await etiquetasDeEnum(prisma, "notificacion_entidad_tipo");
    expect(eventos).toContain(EVENTO_NUEVO);
    expect(entidades).toContain(ENTIDAD_NUEVA);
    expect(eventos.indexOf(EVENTO_NUEVO)).toBeGreaterThan(eventos.indexOf("traspaso_ordenes_cedido"));
    expect(entidades.indexOf(ENTIDAD_NUEVA)).toBeGreaterThan(entidades.indexOf("orden_traspaso_lote"));
  });

  it("⭑ las columnas que usan estos enums siguen siendo TRES (anti-vacuidad del down)", async () => {
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
});

describeSiHayBase("462/T2.1 — el DOWN ejercitado de verdad, con su precondicion", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Las sentencias del down SIN el BEGIN/COMMIT (ya estamos dentro de la tx del test). La funcion
   * `$fn$…$fn$` va ENTERA como una sentencia (partirla por `;` la rompe); se extrae del SQL ya sin
   * comentarios, que es el mismo texto del que se separa el resto.
   */
  function sentenciasDelDown(): string[] {
    const funcion = funcionDe(downDdl, "462");
    expect(downDdl).toContain(funcion); // anti-vacuidad: se extrajo del mismo texto que se parte
    const resto = downDdl
      .replace(funcion, "")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !/^(BEGIN|COMMIT)$/i.test(s));
    expect(resto).toHaveLength(2); // los dos SELECT que llaman a la funcion
    return [funcion, ...resto];
  }

  async function fotoIndices(tx: TxDeTest) {
    return tx.$queryRawUnsafe<{ indexname: string; def: string }[]>(
      `SELECT indexname, indexdef AS def FROM pg_indexes
        WHERE schemaname = 'public' AND indexname IN ('notificacion_dedupe_key','push_envio_dia_cupo')
        ORDER BY 1`,
    );
  }

  it("⭑ con una fila del evento nuevo ABORTA RUIDOSAMENTE y la fila SIGUE AHI", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const id = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO "notificacion" ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_rol")
         VALUES ($1, 'warning'::"notificacion_tipo", $2::"notificacion_evento", 'x', $3::"notificacion_entidad_tipo", $4, 'admin'::"rol_value")`,
        id,
        EVENTO_NUEVO,
        ENTIDAD_NUEVA,
        `central:2092-01-01`,
      );
      await tx.$executeRawUnsafe(`SAVEPOINT antes_del_down`);
      let error = "NO FALLO";
      try {
        for (const s of sentenciasDelDown()) await tx.$executeRawUnsafe(s);
      } catch (e) {
        error = String((e as Error).message);
      }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT antes_del_down`);
      const filas = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "notificacion" WHERE "id" = $1`, id);
      return { error, n: Number(filas[0]?.n ?? 0) };
    });
    expect(r.error).toContain("rollback 462");
    expect(r.error).toContain("se aborta sin borrar nada");
    expect(r.n).toBe(1);
  });

  it("⭑⭑ CONTROL — sin filas de los valores nuevos, el down corre ENTERO: quita SOLO los dos valores y los DOS indices sobreviven", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      // Apartar, dentro de la tx revertida, lo que use los valores de esta ficha (base compartida).
      await tx.$executeRawUnsafe(`DELETE FROM "notificacion" WHERE "evento"::text = $1 OR "entidad_tipo"::text = $2`, EVENTO_NUEVO, ENTIDAD_NUEVA);
      await tx.$executeRawUnsafe(`DELETE FROM "push_envio_dia" WHERE "evento"::text = $1`, EVENTO_NUEVO);
      const eventosAntes = await etiquetasDeEnum(tx, "notificacion_evento");
      const entidadesAntes = await etiquetasDeEnum(tx, "notificacion_entidad_tipo");
      const indicesAntes = await fotoIndices(tx);

      for (const s of sentenciasDelDown()) await tx.$executeRawUnsafe(s);

      const eventos = await etiquetasDeEnum(tx, "notificacion_evento");
      const entidades = await etiquetasDeEnum(tx, "notificacion_entidad_tipo");
      const indices = await fotoIndices(tx);
      // Idempotente: una segunda pasada no hace nada.
      for (const s of sentenciasDelDown()) await tx.$executeRawUnsafe(s);
      const otraVez = await etiquetasDeEnum(tx, "notificacion_evento");
      return { eventosAntes, entidadesAntes, indicesAntes, eventos, entidades, indices, otraVez };
    });

    // Anti-vacuidad: la base SI tenia los valores antes.
    expect(r.eventosAntes).toContain(EVENTO_NUEVO);
    expect(r.entidadesAntes).toContain(ENTIDAD_NUEVA);
    // Quita EXACTAMENTE los dos, conservando TODO lo demas en su orden.
    expect(r.eventos).toEqual(r.eventosAntes.filter((v) => v !== EVENTO_NUEVO));
    expect(r.entidades).toEqual(r.entidadesAntes.filter((v) => v !== ENTIDAD_NUEVA));
    expect(r.otraVez).toEqual(r.eventos);
    // Los DOS indices unicos, con su definicion EXACTA (NULLS NOT DISTINCT, WHERE parcial, cupo).
    expect(r.indices).toEqual(r.indicesAntes);
    const dedupe = r.indices.find((i) => i.indexname === "notificacion_dedupe_key")?.def ?? "";
    expect(dedupe).toMatch(/NULLS NOT DISTINCT/i);
    expect(dedupe).toMatch(/WHERE \(entidad_id IS NOT NULL\)/i);
    const cupo = r.indices.find((i) => i.indexname === "push_envio_dia_cupo")?.def ?? "";
    expect(cupo).toMatch(/CREATE UNIQUE INDEX/i);
    expect(cupo).toMatch(/\(usuario_id, evento, dia_cr\)/);
  });

  it("⭑ P12: en una COPIA del tipo con un valor AJENO añadido despues, el down lo CONSERVA", async () => {
    // Es la propiedad que la lista fija no tenia: revertir sobre una base que avanzo no borra lo
    // de otra ficha (memoria «el down.sql borra los valores posteriores»).
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const esquema = `t462_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const vigentes = await etiquetasDeEnum(tx, "notificacion_evento");
      const conAjeno = [...vigentes, "valor_ajeno_posterior"];
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${esquema}"`);
      await tx.$executeRawUnsafe(
        `CREATE TYPE "${esquema}"."notificacion_evento" AS ENUM (${conAjeno.map((v) => `'${v}'`).join(", ")})`,
      );
      await tx.$executeRawUnsafe(
        `CREATE TABLE "${esquema}"."aviso" ("id" text PRIMARY KEY, "evento" "${esquema}"."notificacion_evento" NOT NULL, "dia" text NOT NULL)`,
      );
      await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX "aviso_cupo" ON "${esquema}"."aviso" ("evento", "dia")`);
      await tx.$executeRawUnsafe(`INSERT INTO "${esquema}"."aviso" VALUES ('f1', 'valor_ajeno_posterior', 'd')`);
      await tx.$executeRawUnsafe(funcionDe(downDdl, "462"));
      await tx.$executeRawUnsafe(`SELECT pg_temp.quitar_valores_de_enum_462($1, 'notificacion_evento', $2::text[])`, esquema, [EVENTO_NUEVO]);
      const despues = await tx.$queryRawUnsafe<{ e: string }[]>(
        `SELECT e.enumlabel AS e FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'notificacion_evento' AND n.nspname = $1 ORDER BY e.enumsortorder`,
        esquema,
      );
      const indice = await tx.$queryRawUnsafe<{ def: string }[]>(
        `SELECT indexdef AS def FROM pg_indexes WHERE schemaname = $1 AND indexname = 'aviso_cupo'`,
        esquema,
      );
      const filas = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "${esquema}"."aviso"`);
      return { conAjeno, despues: despues.map((x) => x.e), indice: indice[0]?.def ?? "", filas: filas.map((f) => f.id) };
    });

    expect(r.conAjeno).toContain(EVENTO_NUEVO);
    expect(r.despues).toEqual(r.conAjeno.filter((v) => v !== EVENTO_NUEVO));
    expect(r.despues.at(-1)).toBe("valor_ajeno_posterior");
    expect(r.indice).toMatch(/CREATE UNIQUE INDEX/i);
    expect(r.filas).toEqual(["f1"]);
  });
});
