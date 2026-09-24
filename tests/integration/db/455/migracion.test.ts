import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { CODIGO_VIGENTE_DE_ANTERIOR, codigoVigente } from "@/lib/types/order-status";
import { C, R, RETIRADO } from "../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Escenario, type Mundo } from "../454/_escenario";

/**
 * FICHA 455 (T1.3, design §3.1; R14-R19) — LAS TRES MIGRACIONES, contra Postgres real.
 *
 * M1 (`order_status_nombre_unico`), M2 (`gestion_resultado_nombre_unico`) y M3
 * (`order_status_retiro_huerfanos`) son UN bloque `DO` cada una y se ejecutan TAL CUAL desde el
 * archivo, dentro de una transaccion que SIEMPRE se revierte (la base local no cambia).
 *
 * La base de la suite ya esta migrada (codigos vigentes). El recorrido:
 *   0. siembra, con los codigos VIGENTES, filas en los 7 estados, las 4 gestiones que cambian, su
 *      historial, un `orden_evento` (454), una vista guardada (453) con ids de catalogo, un job
 *      `webhook_estado` pendiente (guarda un id) y un snapshot de `historial_accion` (texto);
 *   1. DOWN M3 → M2 → M1: la base vuelve a la epoca ANTERIOR → foto F0;
 *   2. UP M1 → M2 → M3 → foto F1: mismos ids, cada value = `codigoVigente(value de F0)`, etiquetas
 *      nuevas en `pg_enum`, ningun codigo anterior, mismas filas y FKs;
 *   3. UP otra vez → F1 intacta (R16);
 *   4. DOWN → F0 (R17) — y un valor de enum anadido DESPUES sobrevive;
 *   5. UP → F1.
 * Ningun job, notificacion ni fila de historial escrita por la migracion (R19, por `xmin`).
 */

const RAIZ = path.resolve(__dirname, "..", "..", "..", "..");
const leer = (carpeta: string, archivo: string) =>
  fs.readFileSync(path.join(RAIZ, "db", "migrations", carpeta, archivo), "utf8");
const M1 = "20260924120000_order_status_nombre_unico";
const M2 = "20260924120100_gestion_resultado_nombre_unico";
const M3 = "20260924120200_order_status_retiro_huerfanos";
const SQL = {
  m1: { up: leer(M1, "migration.sql"), down: leer(M1, "down.sql") },
  m2: { up: leer(M2, "migration.sql"), down: leer(M2, "down.sql") },
  m3: { up: leer(M3, "migration.sql"), down: leer(M3, "down.sql") },
};
const ANTERIORES = Object.keys(CODIGO_VIGENTE_DE_ANTERIOR);
const ESTADOS_QUE_CAMBIAN = [C.entregado, C.novedad, C.reprogramado, C.recogiendo, C.rechazo, C.novedadInterna, C.porDevolverCentral];
const RESULTADOS_QUE_CAMBIAN = [R.entregado, R.reprogramado, R.novedad, R.rechazo];

const sinComentarios = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .trim();

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describe("455/T1.3 — M1-M3, leidas del archivo", () => {
  it("cada up y cada down es UN bloque `DO` (todo o nada)", () => {
    for (const { up, down } of Object.values(SQL)) {
      for (const sql of [up, down]) {
        const codigo = sinComentarios(sql);
        expect(codigo.startsWith("DO $$")).toBe(true);
        expect(codigo.endsWith("$$;")).toBe(true);
      }
    }
  });

  it("R17: ningun down recrea ni borra un tipo (sin CREATE TYPE / DROP TYPE)", () => {
    for (const { up, down } of Object.values(SQL)) {
      for (const sql of [up, down]) expect(sinComentarios(sql)).not.toMatch(/CREATE TYPE|DROP TYPE/i);
    }
  });

  it("R19: ninguna encola jobs, escribe notificaciones ni historial", () => {
    for (const { up, down } of Object.values(SQL)) {
      for (const sql of [up, down]) {
        expect(sql).not.toMatch(/INSERT INTO "(jobs|notificacion|orden_historial_estado|historial_accion)"/);
      }
    }
  });

  it("M1 y su down cubren los 7 codigos de `CODIGO_VIGENTE_DE_ANTERIOR`, por igualdad exacta", () => {
    for (const [anterior, vigente] of Object.entries(CODIGO_VIGENTE_DE_ANTERIOR)) {
      expect(SQL.m1.up).toContain(`SET "value" = '${vigente}'`);
      expect(SQL.m1.up).toMatch(new RegExp(`WHERE "value" = '${anterior}';`));
      expect(SQL.m1.down).toContain(`SET "value" = '${anterior}'`);
      expect(SQL.m1.down).toMatch(new RegExp(`WHERE "value" = '${vigente}';`));
    }
  });

  it("M3 lee las FK de `pg_constraint` (no una lista escrita a mano)", () => {
    expect(SQL.m3.up).toMatch(/FROM pg_constraint c/);
    expect(SQL.m3.up).toMatch(/c\.confrelid = '"order_status"'::regclass/);
  });
});

interface Foto {
  catalogo: { id: string; value: string }[];
  etiquetas: string[];
  estados: { id: string; value: string }[];
  gestiones: { id: string; resultado: string }[];
  eventos: { id: string; resultado: string | null; anterior: string | null }[];
  historial: { id: string; origen: string; destino: string }[];
  vista: string;
  job: string;
  snapshot: { anterior: string | null; nuevo: string | null };
  filas: number[];
}

describeSiHayBase("455/T1.3 — M1-M3 contra Postgres real (up → up → down → up)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof recorrido>>;
  let conflicto: string;
  let citado: Awaited<ReturnType<typeof retiroCondicional>>;
  let sinCitar: Awaited<ReturnType<typeof retiroCondicional>>;

  async function foto(e: Escenario, ids: { ordenes: string[]; vista: string; job: string; accion: string }): Promise<Foto> {
    const q = <T,>(sql: string, ...p: unknown[]) => e.tx.$queryRawUnsafe<T[]>(sql, ...p);
    const [vista] = await q<{ f: string }>(`SELECT "filtro"::text AS f FROM "vista_filtro" WHERE "id" = $1`, ids.vista);
    const [job] = await q<{ p: string }>(`SELECT "payload"::text AS p FROM "jobs" WHERE "id" = $1`, ids.job);
    const [snap] = await q<{ anterior: string | null; nuevo: string | null }>(
      `SELECT "valor_anterior" AS anterior, "valor_nuevo" AS nuevo FROM "historial_accion" WHERE "id" = $1`,
      ids.accion,
    );
    const filas = await q<{ n: number }>(
      `SELECT (SELECT count(*) FROM "orden" WHERE "id" = ANY($1))::int AS n
       UNION ALL SELECT (SELECT count(*) FROM "gestion_orden" WHERE "orden_id" = ANY($1))::int
       UNION ALL SELECT (SELECT count(*) FROM "orden_evento" WHERE "orden_id" = ANY($1))::int
       UNION ALL SELECT (SELECT count(*) FROM "orden_historial_estado" WHERE "orden_id" = ANY($1))::int`,
      ids.ordenes,
    );
    return {
      catalogo: await q(`SELECT "id", "value" FROM "order_status" ORDER BY "id"`),
      etiquetas: (
        await q<{ l: string }>(
          `SELECT e.enumlabel AS l FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE t.typname = 'gestion_resultado' AND n.nspname = 'public' ORDER BY e.enumsortorder`,
        )
      ).map((x) => x.l),
      estados: await q(
        `SELECT o."id", s."value" FROM "orden" o JOIN "order_status" s ON s."id" = o."estatus_id"
          WHERE o."id" = ANY($1) ORDER BY o."id"`,
        ids.ordenes,
      ),
      gestiones: await q(
        `SELECT "id", "resultado"::text AS resultado FROM "gestion_orden" WHERE "orden_id" = ANY($1) ORDER BY "id"`,
        ids.ordenes,
      ),
      eventos: await q(
        `SELECT "id", "resultado"::text AS resultado, "resultado_anterior"::text AS anterior
           FROM "orden_evento" WHERE "orden_id" = ANY($1) ORDER BY "id"`,
        ids.ordenes,
      ),
      historial: await q(
        `SELECT h."id", so."value" AS origen, sd."value" AS destino FROM "orden_historial_estado" h
           JOIN "order_status" so ON so."id" = h."estatus_origen_id"
           JOIN "order_status" sd ON sd."id" = h."estatus_destino_id"
          WHERE h."orden_id" = ANY($1) ORDER BY h."id"`,
        ids.ordenes,
      ),
      vista: vista.f,
      job: job.p,
      snapshot: snap,
      filas: filas.map((f) => f.n),
    };
  }

  /** Sin las filas del catalogo que M3 puede borrar y su down reponer con otro id. */
  const sinHuerfanos = (f: Foto): Foto => ({
    ...f,
    catalogo: f.catalogo.filter((c) => c.value !== RETIRADO.enFulfillment && c.value !== RETIRADO.pendiente),
  });

  function recorrido() {
    return conEscenario(mundo, async (e) => {
      const deEstaTx = async (tabla: string) => {
        const [fila] = await e.tx.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM "${tabla}" WHERE "xmin" = pg_current_xact_id()::xid`,
        );
        return fila.n;
      };

      // ── 0. siembra, con los codigos VIGENTES ──
      const ordenes: string[] = [];
      for (const estado of ESTADOS_QUE_CAMBIAN) ordenes.push((await e.sembrarOrden({ estatus: estado as never })).ordenId);
      const conGestion = ordenes[0];
      for (const resultado of RESULTADOS_QUE_CAMBIAN) {
        const g = await e.tx.gestionOrden.create({
          data: { ordenId: conGestion, mensajeroId: e.mensajeroId, resultado: resultado as never },
          select: { id: true },
        });
        await e.tx.ordenEvento.create({
          data: {
            ordenId: conGestion,
            tipo: "gestion_corregida",
            gestionOrdenId: g.id,
            resultado: resultado as never,
            resultadoAnterior: R.entregado as never,
            actorUsuarioId: e.mensajeroId,
            actorRol: "mensajero",
            motivo: "455 migracion",
          },
        });
      }
      for (const [i, id] of ordenes.entries()) {
        await e.tx.ordenHistorialEstado.create({
          data: {
            ordenId: id,
            estatusOrigenId: e.id("en_reparto"),
            estatusDestinoId: e.id(ESTADOS_QUE_CAMBIAN[i]),
            origenTipo: "ajuste_estado",
          },
        });
      }
      const vista = randomUUID();
      await e.tx.$executeRawUnsafe(
        `INSERT INTO "vista_filtro" ("id", "usuario_id", "superficie", "nombre", "filtro")
         VALUES ($1, $2, 'ordenes', $3, $4::jsonb)`,
        vista,
        e.maestroId,
        `455 ${vista.slice(0, 8)}`,
        JSON.stringify({ seleccion: { status_id: [e.id(C.novedad), e.id(C.porDevolverCentral)] } }),
      );
      const job = randomUUID();
      await e.tx.$executeRawUnsafe(
        `INSERT INTO "jobs" ("id", "tipo", "payload", "max_intentos", "run_after")
         VALUES ($1, 'webhook_estado', $2::jsonb, 5, now() + interval '1 day')`,
        job,
        JSON.stringify({ ordenId: conGestion, estatusDestinoId: e.id(C.entregado), ocurridoAt: "2026-09-24T12:00:00.000Z" }),
      );
      const accion = randomUUID();
      const [anteriorDelSnapshot, nuevoDelSnapshot] = [ANTERIORES[0], ANTERIORES[4]];
      await e.tx.$executeRawUnsafe(
        `INSERT INTO "historial_accion" ("id", "accion", "entidad_tipo", "entidad_id", "entidad_etiqueta", "lote_id", "valor_anterior", "valor_nuevo")
         VALUES ($1, 'cierre_dia_gestion_corregida', 'gestion_orden', $2, '455', $1, $3, $4)`,
        accion,
        conGestion,
        anteriorDelSnapshot,
        nuevoDelSnapshot,
      );
      const ids = { ordenes, vista, job, accion };

      const vigente = await foto(e, ids);
      const antes = { jobs: await deEstaTx("jobs"), notifs: await deEstaTx("notificacion"), hist: await deEstaTx("orden_historial_estado") };

      // ── 1. DOWN: la base vuelve a la epoca anterior ──
      await e.tx.$executeRawUnsafe(SQL.m3.down);
      await e.tx.$executeRawUnsafe(SQL.m2.down);
      await e.tx.$executeRawUnsafe(SQL.m1.down);
      const f0 = await foto(e, ids);

      // ── 2. UP ──
      await e.tx.$executeRawUnsafe(SQL.m1.up);
      await e.tx.$executeRawUnsafe(SQL.m2.up);
      await e.tx.$executeRawUnsafe(SQL.m3.up);
      const f1 = await foto(e, ids);
      const despues = { jobs: await deEstaTx("jobs"), notifs: await deEstaTx("notificacion"), hist: await deEstaTx("orden_historial_estado") };

      // ── 3. UP otra vez ──
      await e.tx.$executeRawUnsafe(SQL.m1.up);
      await e.tx.$executeRawUnsafe(SQL.m2.up);
      await e.tx.$executeRawUnsafe(SQL.m3.up);
      const f1b = await foto(e, ids);

      // ── 4. un valor de enum anadido DESPUES, y DOWN ──
      await e.tx.$executeRawUnsafe(`ALTER TYPE "gestion_resultado" ADD VALUE IF NOT EXISTS 'valor_posterior_455'`);
      await e.tx.$executeRawUnsafe(SQL.m3.down);
      await e.tx.$executeRawUnsafe(SQL.m2.down);
      await e.tx.$executeRawUnsafe(SQL.m1.down);
      const f2 = await foto(e, ids);

      // ── 5. UP ──
      await e.tx.$executeRawUnsafe(SQL.m1.up);
      await e.tx.$executeRawUnsafe(SQL.m2.up);
      await e.tx.$executeRawUnsafe(SQL.m3.up);
      const f3 = await foto(e, ids);

      return { vigente, f0, f1, f1b, f2, f3, antes, despues, anteriorDelSnapshot, nuevoDelSnapshot };
    });
  }

  /** R20-bis: M1 falla RUIDOSAMENTE si conviven el codigo anterior y el vigente. */
  function choque() {
    return conEscenario(mundo, async (e) => {
      await e.tx.$executeRawUnsafe(
        `INSERT INTO "order_status" ("id", "value") VALUES (gen_random_uuid()::text, $1)`,
        ANTERIORES[1],
      );
      try {
        await e.tx.$executeRawUnsafe(SQL.m1.up);
        return "sin error";
      } catch (err) {
        return String((err as Error).message);
      }
    });
  }

  /** R18: M3 borra el huerfano que nadie cita y conserva el que el historial cita. */
  function retiroCondicional(citarPendiente: boolean) {
    return conEscenario(mundo, async (e) => {
      for (const v of [RETIRADO.enFulfillment, RETIRADO.pendiente]) {
        await e.tx.$executeRawUnsafe(
          `INSERT INTO "order_status" ("id", "value") SELECT gen_random_uuid()::text, $1::text
            WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = $1::text)`,
          v,
        );
      }
      const idDe = async (v: string) =>
        (await e.tx.orderStatus.findUniqueOrThrow({ where: { value: v }, select: { id: true } })).id;
      // Solo `pendiente` queda citado, y por UNA columna que el test saca de information_schema: la
      // primera FK a `order_status` de `orden_historial_estado`.
      const fks = await e.tx.$queryRawUnsafe<{ tabla: string; columna: string }[]>(
        `SELECT k.table_name AS tabla, k.column_name AS columna
           FROM information_schema.referential_constraints rc
           JOIN information_schema.key_column_usage k ON k.constraint_name = rc.constraint_name AND k.constraint_schema = rc.constraint_schema
           JOIN information_schema.constraint_column_usage u ON u.constraint_name = rc.unique_constraint_name AND u.constraint_schema = rc.unique_constraint_schema
          WHERE u.table_schema = 'public' AND u.table_name = 'order_status'
          ORDER BY 1, 2`,
      );
      const referencias = async (v: string) => {
        let n = 0;
        const id = await idDe(v);
        for (const fk of fks) {
          const [f] = await e.tx.$queryRawUnsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM "${fk.tabla}" WHERE "${fk.columna}" = $1`,
            id,
          );
          n += f.n;
        }
        return n;
      };
      if (citarPendiente) {
        const o = await e.sembrarOrden({ estatus: "en_reparto" });
        await e.tx.ordenHistorialEstado.create({
          data: { ordenId: o.ordenId, estatusOrigenId: await idDe(RETIRADO.pendiente), estatusDestinoId: e.id("en_reparto"), origenTipo: "ajuste_estado" },
        });
      }
      const refs = { fulfillment: await referencias(RETIRADO.enFulfillment), pendiente: await referencias(RETIRADO.pendiente) };
      await e.tx.$executeRawUnsafe(SQL.m3.up);
      const quedan = async (v: string) => (await e.tx.orderStatus.count({ where: { value: v } })) === 1;
      return {
        fks: fks.map((f) => `${f.tabla}.${f.columna}`),
        refs,
        fulfillmentQueda: await quedan(RETIRADO.enFulfillment),
        pendienteQueda: await quedan(RETIRADO.pendiente),
      };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await recorrido();
    conflicto = await choque();
    citado = await retiroCondicional(true);
    sinCitar = await retiroCondicional(false);
  }, 180_000);
  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("PRECONDICION: la base de la suite ya esta migrada y la siembra entro", () => {
    expect(r.vigente.estados.map((x) => x.value).sort()).toEqual([...ESTADOS_QUE_CAMBIAN].sort());
    expect(r.vigente.gestiones.map((g) => g.resultado).sort()).toEqual([...RESULTADOS_QUE_CAMBIAN].sort());
    expect(r.vigente.filas).toEqual([7, 4, 4, 7]);
  });

  it("F0 (tras el down) tiene los codigos ANTERIORES en catalogo y en el enum", () => {
    expect(r.f0.estados.map((x) => x.value).sort()).toEqual([...ANTERIORES].sort());
    expect(r.f0.etiquetas).toEqual(expect.arrayContaining([ANTERIORES[0], ANTERIORES[1], ANTERIORES[2], ANTERIORES[4]]));
  });

  it("R14: el up conserva el `id` de cada fila y aplica la correspondencia exacta", () => {
    const valorPorIdF0 = new Map(r.f0.catalogo.map((c) => [c.id, c.value]));
    for (const c of sinHuerfanos(r.f1).catalogo) {
      expect(valorPorIdF0.has(c.id), `el id ${c.id} (${c.value}) no existia antes del up`).toBe(true);
      expect(c.value).toBe(codigoVigente(valorPorIdF0.get(c.id)!));
    }
    // Las FK de las ordenes y del historial siguen apuntando a la MISMA fila: ahora se leen con el codigo vigente.
    expect(r.f1.estados).toEqual(r.f0.estados.map((x) => ({ ...x, value: codigoVigente(x.value) })));
    expect(r.f1.historial).toEqual(
      r.f0.historial.map((h) => ({ ...h, origen: codigoVigente(h.origen), destino: codigoVigente(h.destino) })),
    );
    expect(r.f1.catalogo.map((c) => c.value).filter((v) => ANTERIORES.includes(v))).toEqual([]);
  });

  it("R15: gestiones y eventos intactos (mismas filas, mismo numero) salvo la etiqueta", () => {
    expect(r.f1.filas).toEqual(r.f0.filas);
    expect(r.f1.gestiones).toEqual(r.f0.gestiones.map((g) => ({ ...g, resultado: codigoVigente(g.resultado) })));
    expect(r.f1.eventos).toEqual(
      r.f0.eventos.map((x) => ({
        ...x,
        resultado: x.resultado && codigoVigente(x.resultado),
        anterior: x.anterior && codigoVigente(x.anterior),
      })),
    );
    expect(r.f1.etiquetas.slice(0, 5)).toEqual([R.entregado, R.reprogramado, R.novedad, R.rechazo, R.incidente]);
  });

  it("R14/R21: la vista guardada y el job pendiente guardan ids y NO cambian; el snapshot tampoco (R23)", () => {
    expect(r.f1.vista).toBe(r.f0.vista);
    expect(r.f1.job).toBe(r.f0.job);
    expect(r.f1.snapshot).toEqual({ anterior: r.anteriorDelSnapshot, nuevo: r.nuevoDelSnapshot });
  });

  it("R16: la segunda pasada no cambia nada", () => {
    expect(r.f1b).toEqual(r.f1);
  });

  it("R17: el down devuelve la foto de antes (mismas filas e ids) y el valor posterior sobrevive", () => {
    expect(sinHuerfanos(r.f2)).toEqual({ ...sinHuerfanos(r.f0), etiquetas: [...r.f0.etiquetas, "valor_posterior_455"] });
  });

  it("up → down → up termina igual que el primer up", () => {
    expect(sinHuerfanos(r.f3)).toEqual({ ...sinHuerfanos(r.f1), etiquetas: [...r.f1.etiquetas, "valor_posterior_455"] });
  });

  it("R19: la migracion no encola jobs, no escribe notificaciones ni historial", () => {
    expect(r.despues).toEqual(r.antes);
  });

  it("R20: M1 FALLA si ya conviven el codigo anterior y el vigente (no adivina cual conservar)", () => {
    expect(conflicto).toContain("a la vez el codigo anterior y el vigente");
  });

  it("R18: M3 conserva el huerfano citado y borra el que nadie cita; las FK salen de information_schema", () => {
    expect(citado.fks).toEqual(
      expect.arrayContaining(["orden.estatus_id", "orden_historial_estado.estatus_origen_id"]),
    );
    expect(citado.fks.length).toBeGreaterThanOrEqual(5);
    // Citado por el historial (una de las FK que lista information_schema): se CONSERVA.
    expect(citado.refs.pendiente).toBeGreaterThan(0);
    expect(citado.pendienteQueda).toBe(true);
    // Sin ninguna cita en ninguna de esas FK: se BORRA.
    expect(sinCitar.refs.pendiente).toBe(0);
    expect(sinCitar.pendienteQueda).toBe(false);
    // El del estado de fulfillment sigue la misma regla con lo que esta base tenga.
    for (const x of [citado, sinCitar]) expect(x.fulfillmentQueda).toBe(x.refs.fulfillment > 0);
  });
});
