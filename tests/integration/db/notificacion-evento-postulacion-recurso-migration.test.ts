import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// Feature 253 (D6) — la migracion que anade el aviso de la campana a los DOS enums de la feature
// 146 (`notificacion_evento` y `notificacion_entidad_tipo`).
//
// POR QUE ESTE ARCHIVO EXISTE, y no es celo: en este repo anadir un valor a un enum de Postgres
// tiene trampa medida.
//
//  1. `ALTER TYPE ... DROP VALUE` NO EXISTE. El unico down posible es RECREAR el tipo con la lista
//     previa, y eso obliga a un `ALTER COLUMN ... TYPE` sobre `notificacion.evento` y
//     `notificacion.entidad_tipo`, que DESTRUYE Y REHACE los indices de esas columnas. Uno de
//     ellos, `notificacion_dedupe_key`, es UNICO, PARCIAL y con `NULLS NOT DISTINCT` — y ese
//     `NULLS NOT DISTINCT` es imprescindible: sin el, las dos columnas de destinatario (una es
//     SIEMPRE NULL por el CHECK XOR) nunca colisionarian y el indice no deduplicaria nada. Que
//     sobreviva a la reconstruccion NO SE SUPONE: se mide abajo, contra Postgres.
//  2. Hay que mirar si el `down.sql` de la migracion que CREO el enum recrea-con-lista o solo
//     dropea, porque si recreara con lista, el valor nuevo cambiaria lo que ese down debe hacer.
//     Aqui SOLO dropea (feature 146 se lleva tambien las tablas), asi que ese archivo NO se toca
//     — es una foto historica. Se afirma abajo, para que la comprobacion quede hecha y no haya
//     que repetirla a mano.

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

const dirNueva = carpetaQueTerminaEn("_notificacion_evento_postulacion_recurso");
const dir146 = carpetaQueTerminaEn("_notificacion");

const upSql = fs.readFileSync(path.join(dirNueva, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(dirNueva, "down.sql"), "utf8");
const down146 = fs.readFileSync(path.join(dir146, "down.sql"), "utf8");
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");
const tiposNotificacion = fs.readFileSync(
  path.join(ROOT, "lib", "types", "notificacion.ts"),
  "utf8",
);

function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !l.trimStart().startsWith("--"))
    .join("\n");
}

const upDdl = sinComentarios(upSql);
const downDdl = sinComentarios(downSql);

/** Los cuatro valores de cada enum ANTES de esta migracion (feature 146). */
const EVENTOS_146 = [
  "orden_rechazada",
  "carga_masiva_terminada",
  "postulacion_mensajero_pendiente",
  "cierre_dia_por_aprobar",
];
const ENTIDADES_146 = ["orden", "usuario", "cierre_dia", "carga"];

describe("253 / D6 — el UP solo ANADE, y nada mas", () => {
  it("es posterior a la migracion de la tabla y trae sus dos archivos", () => {
    expect(path.basename(dirNueva) > path.basename(carpetaQueTerminaEn("_postulacion_recurso"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(dirNueva, "down.sql"))).toBe(true);
  });

  it("anade el valor a `notificacion_evento` de forma idempotente", () => {
    expect(upDdl).toMatch(
      /ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS 'postulacion_recurso_pendiente'/,
    );
  });

  it("anade tambien `postulacion_recurso` a `notificacion_entidad_tipo`", () => {
    // Sin este segundo valor la fila no cabe: `entidad_tipo` es NOT NULL y ninguno de los cuatro
    // valores vigentes describe una postulacion de recurso. Reusar `usuario` seria un dato falso.
    expect(upDdl).toMatch(
      /ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS 'postulacion_recurso'/,
    );
  });

  it("NO usa los valores nuevos en la misma transaccion (Postgres lo prohibe: 55P04)", () => {
    // Solo dos sentencias, las dos `ALTER TYPE`. Ni un INSERT, ni un UPDATE, ni un CREATE.
    const sentencias = upDdl
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(sentencias).toHaveLength(2);
    for (const s of sentencias) expect(s).toMatch(/^ALTER TYPE /);
  });

  it("es ADITIVA: no toca ninguna tabla ni crea nada", () => {
    expect(upDdl).not.toMatch(/CREATE TABLE/);
    expect(upDdl).not.toMatch(/ALTER TABLE/);
    expect(upDdl).not.toMatch(/\bDROP\b/);
    expect(upDdl).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)\s/im);
  });
});

describe("253 / D6 — el DOWN recrea los dos enums SIN el valor nuevo", () => {
  it("`notificacion_evento` se recrea con EXACTAMENTE los cuatro de la 146", () => {
    const m = /CREATE TYPE "notificacion_evento" AS ENUM \(([\s\S]*?)\)/.exec(downDdl);
    expect(m).not.toBeNull();
    expect([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual(EVENTOS_146);
  });

  it("`notificacion_entidad_tipo` tambien", () => {
    const m = /CREATE TYPE "notificacion_entidad_tipo" AS ENUM \(([^)]*)\)/.exec(downDdl);
    expect(m).not.toBeNull();
    expect([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual(ENTIDADES_146);
  });

  it("cada recreacion lleva su RENAME, su ALTER COLUMN con USING y su DROP del `_old`", () => {
    for (const tipo of ["notificacion_evento", "notificacion_entidad_tipo"]) {
      expect(downDdl).toMatch(new RegExp(`ALTER TYPE "${tipo}" RENAME TO "${tipo}_old"`));
      expect(downDdl).toMatch(new RegExp(`DROP TYPE "${tipo}_old"`));
    }
    expect(downDdl).toMatch(
      /ALTER COLUMN "evento" TYPE "notificacion_evento"\s*\n?\s*USING \("evento"::text::"notificacion_evento"\)/,
    );
    expect(downDdl).toMatch(
      /ALTER COLUMN "entidad_tipo" TYPE "notificacion_entidad_tipo"\s*\n?\s*USING \("entidad_tipo"::text::"notificacion_entidad_tipo"\)/,
    );
  });

  it("el down NO borra ninguna fila de `notificacion` para «hacer sitio»", () => {
    // Si quedaran filas con el valor nuevo, el USING debe fallar RUIDOSAMENTE. Borrarlas en
    // silencio apagaria avisos que un administrador puede no haber leido.
    expect(downDdl).not.toMatch(/^\s*DELETE\s/im);
    expect(downDdl).not.toMatch(/^\s*UPDATE\s/im);
    expect(downDdl).not.toMatch(/DROP TABLE/);
  });
});

describe("253 / D6 — el down de la 146 NO se toca, y esto es la comprobacion de que no hacia falta", () => {
  it("aquel down SOLO dropea los enums; no los recrea con lista", () => {
    // Es la pregunta que este repo obliga a hacerse al anadir un valor a un enum. Respuesta
    // medida: solo dropea. Si algun dia alguien lo convirtiera en un recrea-con-lista, este test
    // se pone rojo y avisa de que hay que revisar tambien AQUEL archivo.
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_evento"/);
    expect(down146).toMatch(/DROP TYPE IF EXISTS "notificacion_entidad_tipo"/);
    expect(down146).not.toMatch(/CREATE TYPE "notificacion_evento"/);
    expect(down146).not.toMatch(/CREATE TYPE "notificacion_entidad_tipo"/);
    // Y no menciona el valor nuevo: es una foto historica y se queda como esta.
    expect(down146).not.toContain("postulacion_recurso");
  });
});

// ⚠️ ACTUALIZADO EL 2026-08-22 POR LA FEATURE 262 (D7), Y SOLO ESTAS DOS ASERCIONES.
//
// Las dos de abajo son sobre el ESQUEMA VIVO —«que tiene `db/schema.prisma` HOY»—, asi que crecen
// con cada valor que se anada. La 262 anade `dia_reparto_corregido` y `orden_dia_reparto_cambio`
// con su propia migracion (`*_notificacion_evento_dia_reparto_corregido`) y su propio `down.sql` de
// recreacion, y tiene su propio archivo de test para ellas.
//
// ⛔ TODO LO DEMAS DE ESTE ARCHIVO NO SE TOCA, y esto se escribe para que quede dicho: el UP de la
// 253, su DOWN con los CUATRO valores de la 146 y la afirmacion de que «el down de la 146 solo
// dropea» son FOTOS HISTORICAS y siguen siendo ciertas palabra por palabra. Editarlas para
// «ponerlas al dia» seria borrar la evidencia de lo que aquella migracion hizo.
describe("253 / D6 — el enum Prisma y el tipo de TypeScript no quedan a la deriva", () => {
  it("`NotificacionEvento` del schema gana el valor, y sigue siendo un inventario CERRADO", () => {
    const bloque = /enum NotificacionEvento \{([\s\S]*?)\n\}/.exec(schemaPrisma)![1];
    const valores = bloque
      .split("\n")
      .map((l) => l.trim().split(/\s+\/\//)[0].trim())
      .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"));
    expect(valores).toEqual([
      ...EVENTOS_146,
      "postulacion_recurso_pendiente", // feature 253 / D6
      "dia_reparto_corregido", // feature 262 / D7 (2026-08-22)
      // FEATURE 271 (§9.2, Q4 resuelta el 2026-08-23) - los DOS avisos del bloqueo por cierres.
      "cierre_dia_vencido",
      "mensajero_bloqueado_por_cierres",
    ]);
  });

  it("`NotificacionEntidadTipo` del schema, igual", () => {
    const bloque = /enum NotificacionEntidadTipo \{([\s\S]*?)\n\}/.exec(schemaPrisma)![1];
    const valores = bloque
      .split("\n")
      .map((l) => l.trim().split(/\s+\/\//)[0].trim())
      .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("@@"));
    expect(valores).toEqual([
      ...ENTIDADES_146,
      "postulacion_recurso", // feature 253 / D6
      "orden_dia_reparto_cambio", // feature 262 / D7 (2026-08-22)
    ]);
  });

  it("`lib/types/notificacion.ts` refleja los dos, sin drift con Prisma", () => {
    expect(tiposNotificacion).toContain('"postulacion_recurso_pendiente"');
    expect(tiposNotificacion).toContain('"postulacion_recurso"');
  });
});

// ===========================================================================================
// CONTRA POSTGRES DE VERDAD — lo que ninguna regex puede afirmar
// ===========================================================================================

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("253 / D6 — la base aplicada, y el down ejercitado de verdad", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function valoresDe(tipo: string): Promise<string[]> {
    const filas = await prisma.$queryRawUnsafe<{ valores: string | null }[]>(
      `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS valores
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = $1`,
      tipo,
    );
    return (filas[0]?.valores ?? "").split(",").filter((v) => v.length > 0);
  }

  // ⚠️ ACTUALIZADAS EL 2026-08-22 POR LA 262, y por la misma razon que las dos del schema: estas
  // dos leen la BASE APLICADA, o sea el estado de HOY, no una foto historica. Con la migracion
  // `*_notificacion_evento_dia_reparto_corregido` la base tiene SEIS de cada uno. Lo que se
  // conserva intacto es el orden —`enumsortorder`—, que es lo que demuestra que el valor se ANADIO
  // al final y no se recreo el tipo.
  it("la base tiene los SEIS eventos, con los nuevos al final y en orden de adicion", async () => {
    expect(await valoresDe("notificacion_evento")).toEqual([
      ...EVENTOS_146,
      "postulacion_recurso_pendiente", // feature 253 / D6
      "dia_reparto_corregido", // feature 262 / D7
      // FEATURE 271 (§9.2, Q4 resuelta el 2026-08-23) - los DOS avisos del bloqueo por cierres.
      "cierre_dia_vencido",
      "mensajero_bloqueado_por_cierres",
    ]);
  });

  it("y los SEIS tipos de entidad", async () => {
    expect(await valoresDe("notificacion_entidad_tipo")).toEqual([
      ...ENTIDADES_146,
      "postulacion_recurso", // feature 253 / D6
      "orden_dia_reparto_cambio", // feature 262 / D7
    ]);
  });

  it("una notificacion con el evento y la entidad nuevos se puede ESCRIBIR de verdad", async () => {
    // Es lo que ningun test de arriba puede demostrar: que el valor no solo esta en el cliente
    // generado, sino que la base lo acepta en la columna. Se escribe y se borra en el acto; la
    // fila lleva `entidad_id` NULL, asi que no entra en el indice unico de dedupe (parcial).
    const id = randomUUID();
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "notificacion"
           ("id","tipo","evento","descripcion","entidad_tipo","entidad_id","destinatario_rol")
         VALUES ($1, 'warning'::"notificacion_tipo",
                 'postulacion_recurso_pendiente'::"notificacion_evento",
                 'prueba 253', 'postulacion_recurso'::"notificacion_entidad_tipo",
                 NULL, 'maestro'::"rol_value")`,
        id,
      );
      const filas = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "notificacion" WHERE id = $1`,
        id,
      );
      expect(Number(filas[0].n)).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe(`DELETE FROM "notificacion" WHERE id = $1`, id);
    }
  }, 60_000);

  it("⚠️ el `notificacion_dedupe_key` conserva `NULLS NOT DISTINCT` y su `WHERE` parcial", async () => {
    // Esta es LA razon de que este bloque exista. El `down.sql` de esta migracion hace
    // `ALTER COLUMN "evento" TYPE ...`, que destruye y rehace todos los indices que tocan esa
    // columna. Si Postgres no reconstruyera el `NULLS NOT DISTINCT`, la dedupe de la feature 146
    // dejaria de deduplicar EN SILENCIO —las dos columnas de destinatario nunca colisionarian— y
    // ningun test de la 146 se enteraria, porque la 146 no vuelve a mirar su propio indice.
    //
    // El down se ejecuto en local el 2026-08-20 (up -> down -> up) y esta asercion se corre sobre
    // el resultado: el indice tiene que seguir teniendo las dos propiedades.
    const filas = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'notificacion_dedupe_key'`,
    );
    expect(filas, "falta `notificacion_dedupe_key`: el down se llevo el indice de la 146").toHaveLength(
      1,
    );
    expect(filas[0].indexdef).toContain("NULLS NOT DISTINCT");
    expect(filas[0].indexdef).toContain("WHERE (entidad_id IS NOT NULL)");
    expect(filas[0].indexdef).toContain("UNIQUE");
  });

  it("los otros cinco indices de `notificacion` tampoco se perdieron", async () => {
    const filas = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'notificacion' ORDER BY indexname`,
    );
    expect(filas.map((f) => f.indexname)).toEqual([
      "notificacion_dedupe_key",
      "notificacion_entidad_idx",
      "notificacion_pkey",
      "notificacion_rol_created_at_idx",
      "notificacion_tienda_id_created_at_idx",
      "notificacion_usuario_created_at_idx",
      "notificacion_zona_id_created_at_idx",
    ]);
  });

  it("y el CHECK XOR de destinatario sigue en pie tras el ALTER COLUMN", async () => {
    const filas = await prisma.$queryRawUnsafe<{ conname: string }[]>(
      `SELECT con.conname FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
        WHERE c.relname = 'notificacion' AND con.contype = 'c'`,
    );
    expect(filas.map((f) => f.conname)).toContain("notificacion_destinatario_xor");
  });
});
