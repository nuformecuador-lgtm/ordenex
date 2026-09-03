import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 362 / T0.3 + T8.2 (R8/R40) — LA MIGRACION, LEIDA DE LA BASE APLICADA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ TODO LO DE ESTE ARCHIVO SE LEE DE POSTGRES, NO DEL `.sql`. Afirmar la RLS leyendo la
// migracion que la escribe seria una asercion contra su propia fuente: seguiria verde aunque la
// migracion no se hubiera aplicado nunca. La unica excepcion es el `down.sql`, que por definicion
// no esta aplicado y solo se puede leer como texto.
//
// Lo que se mide:
//   - R8: `pg_class.relrowsecurity = true` y CERO policies (patron `orden_historial_estado`);
//   - R2: las columnas de mutacion NO existen en la tabla real;
//   - R40: las tres consultas del modulo resuelven por INDICE y no por `Seq Scan`, sobre un
//     corpus lo bastante grande para que el planificador prefiera el indice — y la cifra va
//     escrita;
//   - el `down.sql` existe y revierte lo que el `migration.sql` crea.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const RAIZ = path.resolve(__dirname, "../../..");
const CARPETA = "20260902120000_historial_accion";

/**
 * ⭑ EL CORPUS DEL `EXPLAIN`, CON LA CIFRA DELANTE.
 *
 * 3.000 filas. El planificador de Postgres elige `Seq Scan` sobre tablas pequeñas AUNQUE el indice
 * exista —leer 200 filas secuencialmente es mas barato que bajar por un btree—, asi que un corpus
 * pequeño dejaria este archivo verde por vacuidad: no probaria que el indice sirve, probaria que
 * la tabla cabia en una pagina.
 *
 * 3.000 es del orden de UN MES de operacion real (≈105 filas/dia en un dia como el 2026-09-02) y
 * basta para que el planificador prefiera el indice en las tres consultas. El caso de
 * anti-vacuidad de abajo lo comprueba en vez de suponerlo.
 */
const FILAS_DEL_CORPUS = 3000;

interface FilaExplain {
  "QUERY PLAN": string;
}

describeSiHayBase("362/T0.3 — la migracion del historial de acciones, contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // R8 — RLS
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R8: `historial_accion` tiene la RLS ACTIVA en la base aplicada", async () => {
    const filas = await prisma.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(
      `SELECT c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'historial_accion'`,
    );
    expect(filas, "la tabla del registro no existe en la base aplicada").toHaveLength(1);
    expect(filas[0].relrowsecurity).toBe(true);
  });

  it("R8: y NO tiene policies — la autorizacion vive en el servicio, no en la base", async () => {
    // Este repo NO usa Supabase Auth (sesion propia, sin `auth.uid()`): una policy no tendria a
    // quien preguntar. Lo que la RLS garantiza es lo que R8 pide: a estas filas no se llega si no
    // es por el servidor de la aplicacion — y en una tabla que registra quien mueve el dinero,
    // eso es el minimo.
    const filas = await prisma.$queryRawUnsafe<{ policyname: string }[]>(
      `SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'historial_accion'`,
    );
    expect(filas).toEqual([]);
  });

  it("R8: es la MISMA postura que `orden_historial_estado`, el patron que se copia", async () => {
    // Control positivo: si la consulta de arriba estuviera mal escrita, esto lo delataria.
    const filas = await prisma.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('historial_accion', 'orden_historial_estado')
        ORDER BY c.relname`,
    );
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.relrowsecurity)).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // R2 — la forma de la tabla, leida de la base
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it("⭑ R2: la tabla REAL no tiene `updated_at` ni `deleted_at`", async () => {
    const columnas = await prisma.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'historial_accion'
        ORDER BY column_name`,
    );
    const nombres = columnas.map((c) => c.column_name);
    // Anti-vacuidad: la tabla tiene las columnas que tiene que tener.
    expect(nombres).toContain("entidad_etiqueta");
    expect(nombres).toContain("lote_id");
    expect(nombres).toContain("created_at");
    // Y NO las de mutacion.
    expect(nombres, "un `updated_at` en un registro append-only").not.toContain("updated_at");
    expect(nombres, "un `deleted_at` en un registro append-only").not.toContain("deleted_at");
    // R17: la categoria se DERIVA, no se guarda.
    expect(nombres, "la categoria guardada seria una segunda verdad").not.toContain("categoria");
    // R5: el motivo NO existe, y no puede existir.
    expect(nombres, "`motivo` es texto libre: el vector de datos de cliente").not.toContain(
      "motivo",
    );
  });

  it("R6: `monto` es `numeric(12,2)`, nunca coma flotante", async () => {
    const filas = await prisma.$queryRawUnsafe<
      { data_type: string; numeric_precision: number; numeric_scale: number }[]
    >(
      `SELECT data_type, numeric_precision, numeric_scale FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'historial_accion' AND column_name = 'monto'`,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].data_type).toBe("numeric");
    expect(filas[0].numeric_precision).toBe(12);
    expect(filas[0].numeric_scale).toBe(2);
  });

  it("la FK del actor es RESTRICT: la autoria es evidencia y no se pierde al dar de baja", async () => {
    // `confdeltype` es un `char` de Postgres y el driver de Prisma no lo sabe mapear: se lee la
    // DEFINICION textual, que ademas dice mas.
    const filas = await prisma.$queryRawUnsafe<{ conname: string; def: string }[]>(
      `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'historial_accion' AND c.contype = 'f'`,
    );
    // UNA sola FK: `entidad_id` es OPACO a proposito (design §1.3-a). `RESTRICT` lo haria
    // INBORRABLE y `SET NULL` vaciaria el rastro en silencio.
    expect(filas, "la tabla tiene mas de una FK: `entidad_id` no debe tenerla").toHaveLength(1);
    expect(filas[0].conname).toBe("historial_accion_actor_usuario_id_fkey");
    expect(filas[0].def).toContain('FOREIGN KEY (actor_usuario_id) REFERENCES usuario(id)');
    // ⚠️ Lo que NO puede ser es `ON DELETE SET NULL`, que dejaria filas de auditoria sin autor.
    expect(filas[0].def).not.toContain("ON DELETE SET NULL");
    expect(filas[0].def).not.toContain("ON DELETE CASCADE");
  });

  it("el `down.sql` existe y revierte lo que el `migration.sql` crea", async () => {
    const dir = path.join(RAIZ, "db/migrations", CARPETA);
    const up = readFileSync(path.join(dir, "migration.sql"), "utf8");
    const down = readFileSync(path.join(dir, "down.sql"), "utf8");

    expect(up).toContain('CREATE TABLE "historial_accion"');
    expect(up).toContain('CREATE TYPE "historial_accion_tipo"');
    expect(up).toContain('CREATE TYPE "historial_accion_entidad"');
    expect(up).toContain('ALTER TABLE "historial_accion" ENABLE ROW LEVEL SECURITY');

    expect(down).toContain('DROP TABLE IF EXISTS "historial_accion"');
    expect(down).toContain('DROP TYPE IF EXISTS "historial_accion_tipo"');
    expect(down).toContain('DROP TYPE IF EXISTS "historial_accion_entidad"');
    // La tabla va PRIMERO: mientras exista, los tipos tienen columnas que dependen de ellos.
    expect(down.indexOf("DROP TABLE")).toBeLessThan(down.indexOf("DROP TYPE"));
    // Y no hay ningun `UPDATE`/`INSERT` «para reparar» nada. Se barren las SENTENCIAS, no el
    // archivo: la cabecera del `down.sql` explica a proposito que ahi no hay ni un `INSERT`, y un
    // barrido sobre el texto crudo obligaria a borrar esa frase para pasar.
    const sentencias = down
      .split("\n")
      .filter((linea) => !linea.trimStart().startsWith("--"))
      .join("\n");
    expect(sentencias.trim().length, "el `down.sql` se leyo sin sentencias").toBeGreaterThan(40);
    expect(sentencias).not.toMatch(/\bINSERT\b/i);
    expect(sentencias).not.toMatch(/\bUPDATE\b/i);
    expect(sentencias).not.toMatch(/\bDELETE\b/i);
  });

  it("los TRES indices existen, y sus nombres caben en el limite de 63 de Postgres", async () => {
    const filas = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'historial_accion'
        ORDER BY indexname`,
    );
    const nombres = filas.map((f) => f.indexname);
    expect(nombres).toContain("historial_accion_created_at_id_idx");
    expect(nombres).toContain("historial_accion_actor_usuario_id_created_at_idx");
    expect(nombres).toContain("historial_accion_entidad_tipo_entidad_id_idx");
    // `orden_historial_estado` ya se comio un truncamiento silencioso: aqui se comprueba.
    for (const nombre of nombres) expect(nombre.length).toBeLessThanOrEqual(63);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// R40 — las tres consultas del modulo resuelven por INDICE
// ═════════════════════════════════════════════════════════════════════════════════════════════

describeSiHayBase("362/T8.2 (R40) — el listado no recorre la tabla entera", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Siembra el corpus dentro de la tx y deja las estadisticas al dia para el planificador. */
  async function sembrarCorpus(tx: TxDeTest, actorId: string): Promise<string> {
    const entidadObjetivo = randomUUID();
    const lote = 500;
    for (let desde = 0; desde < FILAS_DEL_CORPUS; desde += lote) {
      await tx.historialAccion.createMany({
        data: Array.from({ length: Math.min(lote, FILAS_DEL_CORPUS - desde) }, (_, i) => ({
          id: randomUUID(),
          accion: "orden_eliminada" as const,
          entidadTipo: "orden" as const,
          // Una sola entidad objetivo, para que «que le paso a ESTA» sea selectivo.
          entidadId: desde + i === 0 ? entidadObjetivo : randomUUID(),
          entidadEtiqueta: `corpus-${desde + i}`,
          actorUsuarioId: desde + i < 5 ? actorId : null,
          actorNombre: desde + i < 5 ? "Actor Corpus" : null,
          actorRol: desde + i < 5 ? ("maestro" as const) : null,
          monto: null,
          valorAnterior: null,
          valorNuevo: null,
          loteId: randomUUID(),
          createdAt: new Date(Date.UTC(2026, 0, 1) + (desde + i) * 60_000),
        })),
      });
    }
    // ⚠️ SIN `ANALYZE` el planificador usa estadisticas VIEJAS (o ninguna) y puede elegir el plan
    // equivocado por un motivo que no tiene nada que ver con los indices. Se corre dentro de la
    // transaccion, sobre las filas recien insertadas.
    await tx.$executeRawUnsafe(`ANALYZE "historial_accion"`);
    return entidadObjetivo;
  }

  async function plan(tx: TxDeTest, sql: string, ...args: unknown[]): Promise<string> {
    const filas = await tx.$queryRawUnsafe<FilaExplain[]>(`EXPLAIN ${sql}`, ...args);
    return filas.map((f) => f["QUERY PLAN"]).join("\n");
  }

  it("ANTI-VACUIDAD: el corpus tiene las filas declaradas, y sin indice HABRIA `Seq Scan`", async () => {
    // La mitad que hace honesto a este archivo: se comprueba que el corpus es lo bastante grande
    // para que el planificador PREFIERA el indice. Con pocas filas elegiria `Seq Scan` aunque el
    // indice existiera, y los tres casos de abajo pasarian sin probar nada.
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const actor = await tx.usuario.findFirstOrThrow({ select: { id: true } });
      await sembrarCorpus(tx, actor.id);
      const total = await tx.historialAccion.count();
      // Un `WHERE` que NINGUN indice sirve: si esto NO fuera `Seq Scan`, el detector estaria roto.
      const sinIndice = await plan(
        tx,
        `SELECT * FROM "historial_accion" WHERE "entidad_etiqueta" = 'no-existe'`,
      );
      return { total, sinIndice };
    });

    expect(r.total).toBeGreaterThanOrEqual(FILAS_DEL_CORPUS);
    expect(r.sinIndice, "el detector de planes no distingue un `Seq Scan`").toContain("Seq Scan");
  });

  it("⭑ (1/3) la PRIMERA PAGINA por fecha resuelve por indice, no por `Seq Scan`", async () => {
    const plan1 = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const actor = await tx.usuario.findFirstOrThrow({ select: { id: true } });
      await sembrarCorpus(tx, actor.id);
      return plan(
        tx,
        `SELECT * FROM "historial_accion" ORDER BY "created_at" DESC, "id" ASC LIMIT 25`,
      );
    });

    expect(plan1, `el 90 % de las visitas recorreria la tabla entera:\n${plan1}`).not.toContain(
      "Seq Scan",
    );
    expect(plan1).toContain("historial_accion_created_at_id_idx");
  });

  it("⭑ (2/3) «que hizo Fulano» resuelve por su indice", async () => {
    const plan2 = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const actor = await tx.usuario.findFirstOrThrow({ select: { id: true } });
      await sembrarCorpus(tx, actor.id);
      return plan(
        tx,
        `SELECT * FROM "historial_accion" WHERE "actor_usuario_id" = $1
          ORDER BY "created_at" DESC, "id" ASC LIMIT 25`,
        actor.id,
      );
    });

    expect(plan2, `el filtro mas probable del modulo seria un barrido:\n${plan2}`).not.toContain(
      "Seq Scan",
    );
    expect(plan2).toContain("historial_accion_actor_usuario_id_created_at_idx");
  });

  it("⭑ (3/3) «que le paso a esta entidad» resuelve por su indice", async () => {
    const plan3 = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const actor = await tx.usuario.findFirstOrThrow({ select: { id: true } });
      const entidadId = await sembrarCorpus(tx, actor.id);
      return plan(
        tx,
        `SELECT * FROM "historial_accion" WHERE "entidad_tipo" = 'orden'::"historial_accion_entidad"
           AND "entidad_id" = $1`,
        entidadId,
      );
    });

    expect(plan3, `la pregunta que abre la ficha seria un barrido:\n${plan3}`).not.toContain(
      "Seq Scan",
    );
    expect(plan3).toContain("historial_accion_entidad_tipo_entidad_id_idx");
  });
});
