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

// FICHA 333 (A8, design §4.1/§10) — la migracion que anade el aviso de la campana a los DOS enums
// de `notificacion`, mas la propiedad ADITIVA de la migracion de la tabla (R53) y la precondicion
// ruidosa de su rollback (R54).
//
// POR QUE ESTE ARCHIVO EXISTE, y es el molde literal de los de la 253, la 262 y la 271: en este
// repo anadir un valor a un enum de Postgres tiene trampa MEDIDA.
//
//  1. `ALTER TYPE ... DROP VALUE` NO EXISTE. El unico down posible es RECREAR el tipo con la lista
//     previa, y eso obliga a un `ALTER COLUMN ... TYPE` que DESTRUYE Y REHACE los indices de esa
//     columna. Uno de ellos, `notificacion_dedupe_key`, es UNICO, PARCIAL y con
//     `NULLS NOT DISTINCT` — y ese `NULLS NOT DISTINCT` es imprescindible: sin el, las dos columnas
//     de destinatario (una es SIEMPRE NULL por el CHECK XOR) nunca colisionarian y el indice no
//     deduplicaria nada. Que sobreviva a la reconstruccion NO SE SUPONE: se mide abajo, y se mide
//     DESPUES de correr el down, no solo sobre la base tal y como esta.
//  2. Hay que mirar si el `down.sql` de la migracion que CREO los enums recrea-con-lista o solo
//     dropea. Aqui SOLO dropea (la 146 se lleva tambien las tablas), asi que aquel archivo NO se
//     toca. Y los de la 253, la 262 y la 271 SI recrean, cada uno con SU lista —«el enum antes de
//     MI migracion»—, que sigue siendo cierta: tampoco se tocan. Las CUATRO cosas se AFIRMAN abajo.
//  3. `notificacion_entidad_tipo` TAMBIEN se toca, y esa es la mitad que se olvida. Aqui hace
//     falta: `gasto_fijo_cobro_dia` es el PRIMER `entidad_tipo` que no apunta a una fila de tabla
//     —la entidad del aviso es EL DIA CR, no el cobro (design §4.2)— y ningun valor existente lo
//     describe.

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

const dirNueva = carpetaQueTerminaEn("_notificacion_evento_gasto_fijo_cobro");
const dirTabla = carpetaQueTerminaEn("_gasto_fijo_cobro");
const dir271 = carpetaQueTerminaEn("_notificacion_evento_bloqueo_cierre");
const dir262 = carpetaQueTerminaEn("_notificacion_evento_dia_reparto_corregido");
const dir253 = carpetaQueTerminaEn("_notificacion_evento_postulacion_recurso");
const dir146 = carpetaQueTerminaEn("_notificacion");

const upSql = fs.readFileSync(path.join(dirNueva, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(dirNueva, "down.sql"), "utf8");
const upTabla = fs.readFileSync(path.join(dirTabla, "migration.sql"), "utf8");
const downTabla = fs.readFileSync(path.join(dirTabla, "down.sql"), "utf8");
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
const upTablaDdl = sinComentarios(upTabla);
// Los downs anteriores se miden por su DDL, sin comentarios: sus cabeceras NOMBRAN los indices y
// los tipos al explicarse, y una aserción sobre el texto crudo mediría la prosa, no el SQL.
const down271Ddl = sinComentarios(down271);

/** El enum `notificacion_evento` ANTES de esta migracion: 4 (146) + 1 (253) + 1 (262) + 2 (271). */
const EVENTOS_PREVIOS = [
  "orden_rechazada",
  "carga_masiva_terminada",
  "postulacion_mensajero_pendiente",
  "cierre_dia_por_aprobar",
  "postulacion_recurso_pendiente",
  "dia_reparto_corregido",
  "cierre_dia_vencido",
  "mensajero_bloqueado_por_cierres",
];

/** `notificacion_entidad_tipo` ANTES de esta migracion: 4 (146) + 1 (253) + 1 (262). */
const ENTIDADES_PREVIAS = [
  "orden",
  "usuario",
  "cierre_dia",
  "carga",
  "postulacion_recurso",
  "orden_dia_reparto_cambio",
];

const EVENTO_NUEVO = "gasto_fijo_cobro_pendiente";
const ENTIDAD_NUEVA = "gasto_fijo_cobro_dia";

function valoresDelCreateType(sql: string, tipo: string): string[] | null {
  const m = new RegExp(`CREATE TYPE "${tipo}" AS ENUM \\(([\\s\\S]*?)\\)`).exec(sql);
  if (m === null) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("333/A8 — el UP de los enums es aditivo y no toca nada mas", () => {
  it("anade EXACTAMENTE los dos valores, con `IF NOT EXISTS`, y nada mas", () => {
    expect(upDdl).toMatch(
      new RegExp(`ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS '${EVENTO_NUEVO}'`),
    );
    expect(upDdl).toMatch(
      new RegExp(
        `ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS '${ENTIDAD_NUEVA}'`,
      ),
    );
    const sentencias = upDdl.split(";").filter((s) => s.trim().length > 0);
    expect(sentencias).toHaveLength(2);
  });

  it("R53: el UP de los enums no crea tablas, no altera columnas y NO reescribe ninguna fila", () => {
    expect(upDdl).not.toMatch(/CREATE TABLE/i);
    expect(upDdl).not.toMatch(/ALTER TABLE/i);
    expect(upDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(upDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(upDdl).not.toMatch(/^\s*INSERT\s/im);
  });

  it("va SOLA y con timestamp POSTERIOR al de la tabla (55P04)", () => {
    // Postgres no permite USAR un valor de enum recien anadido en la transaccion que lo anadio, y
    // Prisma Migrate corre cada `migration.sql` en una. Que sean dos carpetas y en este orden no
    // es estetico.
    expect(path.basename(dirNueva) > path.basename(dirTabla)).toBe(true);
  });
});

describe("333/A8 — R53: la migracion de la TABLA es aditiva y trae su down", () => {
  it("las dos migraciones traen `down.sql`", () => {
    expect(fs.existsSync(path.join(dirTabla, "down.sql"))).toBe(true);
    expect(fs.existsSync(path.join(dirNueva, "down.sql"))).toBe(true);
  });

  it("⭑ el UP de la tabla NO reescribe ni borra ninguna fila preexistente", () => {
    expect(upTablaDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(upTablaDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(upTablaDdl).not.toMatch(/^\s*INSERT\s/im);
    expect(upTablaDdl).not.toMatch(/TRUNCATE/i);
    expect(upTablaDdl).not.toMatch(/DROP (TABLE|COLUMN|INDEX|CONSTRAINT)/i);
  });

  it("⭑ lo UNICO que altera de una tabla preexistente es la columna del interruptor", () => {
    const alters = upTablaDdl
      .split(";")
      .map((s) => s.trim())
      .filter((s) => /^ALTER TABLE/i.test(s));
    // Dos: el `ENABLE ROW LEVEL SECURITY` de la tabla NUEVA y el `ADD COLUMN` del interruptor.
    expect(alters).toHaveLength(2);
    expect(alters[0]).toMatch(/"gasto_fijo_cobro" ENABLE ROW LEVEL SECURITY/);
    expect(alters[1]).toMatch(
      /"gasto_fijo_plantilla"\s*\n?\s*ADD COLUMN "requiere_aprobacion" BOOLEAN NOT NULL DEFAULT true/,
    );
  });

  it("el down de la tabla revierte en el orden que las dependencias exigen", () => {
    const orden = ["DROP TABLE", "DROP TYPE", "DROP COLUMN"].map((s) => downTabla.indexOf(s));
    expect(orden.every((i) => i >= 0)).toBe(true);
    expect(orden[0]).toBeLessThan(orden[1]);
    expect(orden[1]).toBeLessThan(orden[2]);
  });
});

describe("333/A8 — el DOWN de los enums recrea con la lista de HOY y no borra nada", () => {
  it("⭑ recrea `notificacion_evento` con los OCHO previos, en orden, y sin el nuevo", () => {
    expect(valoresDelCreateType(downDdl, "notificacion_evento")).toEqual(EVENTOS_PREVIOS);
    expect(downDdl).not.toContain(EVENTO_NUEVO);
  });

  it("⭑ recrea `notificacion_entidad_tipo` con los SEIS previos, en orden, y sin el nuevo", () => {
    expect(valoresDelCreateType(downDdl, "notificacion_entidad_tipo")).toEqual(ENTIDADES_PREVIAS);
    expect(downDdl).not.toContain(ENTIDAD_NUEVA);
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

  it("⭑ R54: el down NO borra ni reescribe NINGUNA fila para «hacer sitio»", () => {
    // La precondicion ruidosa. Si quedaran filas con el valor nuevo, el `USING` debe fallar y
    // abortar el rollback: son avisos de DINERO POR AUTORIZAR que el maestro puede no haber
    // leido, y borrarlos en silencio apagaria la unica senal de que hay cobros esperando.
    expect(downDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(downDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(downDdl).not.toMatch(/DROP TABLE/);
    expect(downDdl).not.toMatch(/TRUNCATE/i);
  });
});

describe("333/A8 — los CUATRO `down.sql` anteriores NO se tocan, y esta es la comprobacion", () => {
  it("⭑ el de la 146 SOLO dropea los dos tipos; no los recrea con lista", () => {
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_evento"/);
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_entidad_tipo"/);
    expect(down146).not.toMatch(/CREATE TYPE "notificacion_evento"/);
    for (const v of [EVENTO_NUEVO, ENTIDAD_NUEVA, "cierre_dia_vencido", "dia_reparto_corregido"]) {
      expect(down146).not.toContain(v);
    }
  });

  it("⭑ el de la 253 recrea con SUS CUATRO valores en cada tipo, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down253, "notificacion_evento")).toEqual(
      EVENTOS_PREVIOS.slice(0, 4),
    );
    expect(valoresDelCreateType(down253, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 4),
    );
    expect(down253).not.toContain(EVENTO_NUEVO);
    expect(down253).not.toContain(ENTIDAD_NUEVA);
  });

  it("⭑ el de la 262 recrea con SUS CINCO valores en cada tipo, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down262, "notificacion_evento")).toEqual(
      EVENTOS_PREVIOS.slice(0, 5),
    );
    expect(valoresDelCreateType(down262, "notificacion_entidad_tipo")).toEqual(
      ENTIDADES_PREVIAS.slice(0, 5),
    );
    expect(down262).not.toContain(EVENTO_NUEVO);
    expect(down262).not.toContain(ENTIDAD_NUEVA);
  });

  it("⭑ el de la 271 recrea SOLO `notificacion_evento` con SUS SEIS, y sigue siendo cierto", () => {
    expect(valoresDelCreateType(down271, "notificacion_evento")).toEqual(
      EVENTOS_PREVIOS.slice(0, 6),
    );
    // No toca el otro tipo porque su up tampoco lo toco (medido sobre el DDL, no sobre la
    // cabecera: alli `notificacion_entidad_tipo` aparece al explicar los indices).
    expect(down271Ddl).not.toContain("notificacion_entidad_tipo");
    expect(down271).not.toContain(EVENTO_NUEVO);
  });
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("333/A8 — la base aplicada, y el DOWN ejercitado de verdad", () => {
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

  it("la base tiene los NUEVE eventos y los SIETE entidad_tipo, con el nuevo AL FINAL", async () => {
    // El orden (`enumsortorder`) es lo que demuestra que el valor se ANADIO y no que el tipo se
    // recreo por detras.
    expect(await valoresDe("notificacion_evento")).toEqual([...EVENTOS_PREVIOS, EVENTO_NUEVO]);
    expect(await valoresDe("notificacion_entidad_tipo")).toEqual([
      ...ENTIDADES_PREVIAS,
      ENTIDAD_NUEVA,
    ]);
  });

  it("⭑ un aviso con el evento y la entidad nuevos se puede ESCRIBIR de verdad", async () => {
    // Lo que ningun test estatico puede demostrar: que los valores no solo estan en el cliente
    // generado, sino que la BASE los acepta en sus columnas. `entidad_id` es EL DIA CR
    // (design §4.2) y `destinatario_rol` es `maestro`, porque el CHECK XOR exige exactamente uno
    // de los dos destinatarios.
    const leido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const id = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO "notificacion"
           ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_rol")
         VALUES ($1, 'warning'::"notificacion_tipo",
                 $2::"notificacion_evento",
                 'Hay 2 cobros de gasto fijo esperando tu aprobación.',
                 $3::"notificacion_entidad_tipo", '2026-08-29', 'maestro'::"rol_value")`,
        id,
        EVENTO_NUEVO,
        ENTIDAD_NUEVA,
      );
      const filas = await tx.$queryRawUnsafe<{ evento: string; entidad: string }[]>(
        `SELECT "evento"::text AS evento, "entidad_tipo"::text AS entidad
           FROM "notificacion" WHERE "id" = $1`,
        id,
      );
      return filas[0];
    });
    expect(leido.evento).toBe(EVENTO_NUEVO);
    expect(leido.entidad).toBe(ENTIDAD_NUEVA);
  });

  it("⭑ R54: el DOWN con una fila del evento nuevo ABORTA RUIDOSAMENTE (no borra nada)", async () => {
    // ES LA PRECONDICION DEL `down.sql`, EJERCITADA. Todo corre dentro de una transaccion que
    // SIEMPRE se revierte: el DDL tambien es transaccional en Postgres, asi que la base queda
    // exactamente como estaba.
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
           VALUES ($1, 'warning'::"notificacion_tipo",
                   '${EVENTO_NUEVO}'::"notificacion_evento",
                   'aviso sin leer', '${ENTIDAD_NUEVA}'::"notificacion_entidad_tipo",
                   '2026-08-29', 'maestro'::"rol_value")`,
          randomUUID(),
        );
        for (const sentencia of sentencias) {
          await tx.$executeRawUnsafe(sentencia);
        }
      }),
    ).rejects.toThrow();
  });

  it("⭑ CONTROL: SIN filas del valor nuevo, ese MISMO down corre entero y el indice de dedupe SOBREVIVE", async () => {
    // Anti-vacuidad del caso anterior: sin este control, `rejects.toThrow()` pasaria aunque el
    // fallo viniera de cualquier otra cosa. Y de paso mide R53 donde importa — DESPUES de que el
    // `ALTER COLUMN ... TYPE` haya destruido y rehecho los indices de las dos columnas.
    const def = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      // Se apartan las filas con los valores nuevos DENTRO de la transaccion revertida: no se
      // borran de verdad (el rollback las devuelve), y asi el down encuentra la base «limpia».
      await tx.$executeRawUnsafe(
        `DELETE FROM "notificacion"
          WHERE "evento"::text = $1 OR "entidad_tipo"::text = $2`,
        EVENTO_NUEVO,
        ENTIDAD_NUEVA,
      );
      for (const sentencia of downDdl
        .split(";")
        .map((x) => x.trim())
        .filter((x) => x.length > 0)) {
        await tx.$executeRawUnsafe(sentencia);
      }
      const filas = await tx.$queryRawUnsafe<{ def: string }[]>(
        `SELECT indexdef AS def FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'notificacion_dedupe_key'`,
      );
      return filas[0]?.def ?? "";
    });

    expect(def, "el down se llevo `notificacion_dedupe_key` por delante").not.toBe("");
    expect(def).toMatch(/CREATE UNIQUE INDEX/i);
    expect(def).toMatch(/NULLS NOT DISTINCT/i);
    expect(def).toMatch(/WHERE \(entidad_id IS NOT NULL\)/i);
    expect(def).toMatch(/\(evento, entidad_id, destinatario_rol, destinatario_usuario_id\)/);
  });

  it("⭑ y sobre la base TAL CUAL esta, `notificacion_dedupe_key` sigue intacto", async () => {
    const filas = await prisma.$queryRawUnsafe<{ def: string }[]>(
      `SELECT indexdef AS def FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'notificacion_dedupe_key'`,
    );
    const def = filas[0]?.def ?? "";
    expect(def, "no existe `notificacion_dedupe_key`").not.toBe("");
    expect(def).toMatch(/NULLS NOT DISTINCT/i);
    expect(def).toMatch(/WHERE \(entidad_id IS NOT NULL\)/i);
  });
});
