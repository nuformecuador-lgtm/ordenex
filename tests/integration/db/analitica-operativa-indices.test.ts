import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// Feature 126 / T7.3 — R25 (T0-Q1 = B del 2026-08-02).
//
// EL RIESGO QUE ESTE ARCHIVO CUBRE, tal como lo dimensiona `design.md §8`: el camino intradia
// hace un `GROUP BY` POR REQUEST sobre `gestion_orden`, acotado por ventana y alcance. Es
// aceptable **porque** el indice existe y el recorte va en el `WHERE`. Sin cualquiera de las
// dos cosas el coste vuelve a ser proporcional a la compania y no al inquilino, y entonces
// «el intradia deja de ser viable y hay que volver a la opcion A de Q1».
//
// HECHO VERIFICADO antes de la migracion: `gestion_orden` tenia CUATRO indices —`orden_id`,
// `mensajero_id`, `cierre_id`, `anulada_por`— mas el parcial de la feature 67
// `(mensajero_id) WHERE cierre_id IS NULL AND anulada_at IS NULL`. Ninguno empieza por
// `created_at`, y la consulta intradia filtra por `created_at` SIN `orden_id` ni
// `mensajero_id` por delante.
//
// Tres afirmaciones, y las tres hacen falta:
//   1. la migracion CREA el indice y su `down.sql` lo revierte EXACTAMENTE (contrato del repo);
//   2. `db/schema.prisma` lo DECLARA —si no, el siguiente `prisma migrate dev` propone
//      borrarlo y el indice desaparece sin que nadie toque el `.sql`—;
//   3. contra Postgres real, el plan de la consulta intradia NO hace `Seq Scan` sobre
//      `gestion_orden`.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const MIGRACION = "db/migrations/20260803090000_gestion_orden_idx_created_at";
const INDICE = "gestion_orden_created_at_idx";

function leer(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, ...rel.split("/")), "utf8");
}

describe("R25 · la migracion del indice intradia y su down", () => {
  it("la migracion crea el indice sobre `gestion_orden(created_at)` y nada mas", () => {
    const up = leer(`${MIGRACION}/migration.sql`);
    expect(up).toMatch(
      new RegExp(`CREATE INDEX (IF NOT EXISTS )?"${INDICE}" ON "gestion_orden"\\("created_at"\\)`),
    );
    // «y nada mas»: una migracion que arrastre drift ajeno no se puede revertir con un DROP.
    const sentencias = up
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("--"))
      .join(" ");
    expect(sentencias.split(";").filter((s) => s.trim()).length).toBe(1);
  });

  it("`down.sql` existe y revierte EXACTAMENTE lo que hace el up", () => {
    const down = leer(`${MIGRACION}/down.sql`);
    expect(down).toMatch(new RegExp(`DROP INDEX IF EXISTS "${INDICE}"`));
    const sentencias = down
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("--"))
      .join(" ");
    expect(sentencias.split(";").filter((s) => s.trim()).length).toBe(1);
  });

  it("el indice esta DECLARADO en `db/schema.prisma`, no solo en el `.sql`", () => {
    // La mutacion: borrar el `@@index` del datamodel y dejar solo el SQL. El indice
    // sobrevive... hasta el siguiente `prisma migrate dev`, que propone BORRARLO porque el
    // datamodel no lo conoce. El rojo tiene que aparecer aqui y no en esa consola.
    const schema = leer("db/schema.prisma");
    expect(schema).toMatch(new RegExp(`@@index\\(\\[createdAt\\], map: "${INDICE}"\\)`));
  });
});

describe.skipIf(!HAY_BASE_DE_DATOS)("R25 · la consulta intradia de gestiones usa indice", () => {
  /**
   * EXPLAIN de la ventana intradia, dentro de una transaccion que SIEMPRE se revierte y con
   * `enable_seqscan` desactivado.
   *
   * POR QUE SE DESACTIVA EL SEQ SCAN, y por que eso NO es hacer trampa. Medido en la base de
   * desarrollo: `gestion_orden` tiene ahi tan pocas filas que el plan mas barato es leerla
   * entera (`cost=0.00..2.46`), y lo seguiria siendo aunque el indice fuera perfecto. Un test
   * que exigiera «no hay Seq Scan» sobre esa tabla estaria midiendo el TAMANO de la base de
   * desarrollo, no la existencia del indice, y saldria rojo o verde por razones ajenas a R25.
   *
   * Lo que R25 necesita demostrar es otra cosa y es comprobable: que EXISTE un indice
   * APLICABLE a este predicado —`created_at` como primera columna, con el rango— de modo que
   * cuando la tabla crezca el planificador tenga a que agarrarse. Con el seq scan desactivado,
   * si el indice existe y sirve, el plan lo NOMBRA; si no existe (la mutacion de R25: borrarlo
   * de la migracion), Postgres vuelve al seq scan pese a la penalizacion, y el caso sale rojo.
   */
  async function planIntradia(): Promise<string> {
    const prisma = crearPrismaDeTest();
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        const desde = new Date("2026-08-03T06:00:00.000Z");
        const hasta = new Date("2026-08-03T15:00:00.000Z");
        const plan = await tx.$queryRaw<{ "QUERY PLAN": string }[]>`
          EXPLAIN SELECT g."id"
          FROM "gestion_orden" g
          WHERE g."anulada_at" IS NULL
            AND g."created_at" >= ${desde}
            AND g."created_at" <  ${hasta}`;
        return plan.map((f) => f["QUERY PLAN"]).join("\n");
      });
    } finally {
      await prisma.$disconnect();
    }
  }

  it("el indice esta aplicado en la base (si no, no hay nada que medir)", async () => {
    const prisma = crearPrismaDeTest();
    try {
      const filas = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'gestion_orden' AND indexname = ${INDICE}`;
      expect(
        filas.length,
        `${INDICE} no esta aplicado en esta base: corre las migraciones antes de medir`,
      ).toBe(1);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("la consulta intradia de gestiones usa indice", async () => {
    const texto = await planIntradia();
    expect(texto, `el plan no nombra ${INDICE}:\n${texto}`).toContain(INDICE);
    expect(/Seq Scan on gestion_orden/i.test(texto), texto).toBe(false);
  });

  it("el caso DISCRIMINA: sin ningun indice aplicable el plan vuelve al Seq Scan", async () => {
    // La contracara. Se prueba con un predicado para el que NO hay indice —una columna de texto
    // sin indexar— y con el mismo seq scan desactivado: el planificador no tiene alternativa y
    // escanea igualmente. Eso demuestra que el verde de arriba lo produce el indice y no el
    // hecho de haber desactivado el seq scan.
    const prisma = crearPrismaDeTest();
    try {
      const texto = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        const plan = await tx.$queryRaw<{ "QUERY PLAN": string }[]>`
          EXPLAIN SELECT g."id" FROM "gestion_orden" g WHERE g."motivo" = 'inexistente'`;
        return plan.map((f) => f["QUERY PLAN"]).join("\n");
      });
      expect(texto).toMatch(/Seq Scan on gestion_orden/i);
      expect(texto).not.toContain(INDICE);
    } finally {
      await prisma.$disconnect();
    }
  });
});
