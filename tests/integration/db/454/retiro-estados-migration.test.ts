import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { conAyudaAbiertaDe } from "@/lib/repositories/ayuda-abierta";
import { whereGestionPendiente } from "@/lib/repositories/gestion-pendiente";
import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Escenario, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.24, design §1.6; R38-R42) — M3: BACKFILL Y RETIRO DE `ayuda_tienda` Y
 * `devolucion_por_confirmar`, contra Postgres real.
 *
 * El `migration.sql` y el `down.sql` son UN bloque `DO` cada uno, asi que se ejecutan tal cual desde
 * el archivo, dentro de una transaccion que SIEMPRE se revierte (la base local compartida no cambia).
 * Se recorre up → up (idempotencia) → down → up, con actividad del modelo nuevo entre medias:
 *   (a) las ordenes en los dos estados (una BORRADA incluida) pasan a `en_reparto` con su rastro; las
 *       de ayuda quedan con ayuda ABIERTA y la de devolucion con su gestion PENDIENTE;
 *   (b) una segunda pasada no escribe nada;
 *   (c) retiro condicional: cada valor sigue en el catalogo si y solo si algo lo referencia;
 *   (d) ni jobs ni notificaciones nuevos;
 *   (e) `RAISE` si falta la fila de solicitud (o la gestion `devuelta`);
 *   (f) down: vuelve lo intacto, lo que cambio despues (ayuda rescatada) NO vuelve, y las pendientes
 *       y ayudas NUEVAS se aplican al modelo viejo;
 *   (g) up → down → up termina sin error y en el mismo estado que el primer up.
 */

const RAIZ = path.resolve(__dirname, "..", "..", "..", "..");
const M3 = path.join(RAIZ, "db", "migrations", "20260923120200_retiro_estados_454");
const UP = fs.readFileSync(path.join(M3, "migration.sql"), "utf8");
const DOWN = fs.readFileSync(path.join(M3, "down.sql"), "utf8");
const RASTRO = ["migracion 454: retiro de ayuda_tienda", "migracion 454: retiro de devolucion_por_confirmar"];

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describe("454/T1.24 — M3, leida del archivo", () => {
  it("up y down son UN bloque `DO` cada uno (todo o nada)", () => {
    for (const sql of [UP, DOWN]) {
      const codigo = sql
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n")
        .trim();
      expect(codigo.startsWith("DO $$")).toBe(true);
      expect(codigo.endsWith("$$;")).toBe(true);
    }
  });

  it("el retiro del catalogo mira las CUATRO tablas que referencian `order_status`", () => {
    const del = UP.slice(UP.indexOf('DELETE FROM "order_status"'));
    for (const t of ['"orden"', '"orden_historial_estado"', '"cierre_sin_gestion"', '"analytics_daily"']) {
      expect(del).toContain(`FROM ${t}`);
    }
  });

  it("ni el up ni el down encolan jobs ni escriben notificaciones (R42)", () => {
    for (const sql of [UP, DOWN]) {
      expect(sql).not.toMatch(/INSERT INTO "(jobs|notificacion)"/);
    }
  });
});

describeSiHayBase("454/T1.24 — M3 contra Postgres real", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof recorrido>>;
  let sinSolicitud: string;
  let sinDevuelta: string;

  async function ayudaVieja(e: Escenario, opts: { borrada?: boolean } = {}) {
    const o = await e.sembrarOrden({ estatus: "ayuda_tienda" });
    await e.tx.ordenHistorialEstado.create({
      data: {
        ordenId: o.ordenId,
        estatusOrigenId: e.id("en_reparto"),
        estatusDestinoId: e.id("ayuda_tienda"),
        origenTipo: "solicitud_ayuda_tienda",
        actorUsuarioId: e.mensajeroId,
        createdAt: new Date(Date.now() - 3600_000),
      },
    });
    if (opts.borrada) await e.tx.orden.update({ where: { id: o.ordenId }, data: { deletedAt: new Date() } });
    return o.ordenId;
  }

  async function devueltaVieja(e: Escenario) {
    const o = await e.sembrarOrden({ estatus: "devolucion_por_confirmar" });
    const g = await e.tx.gestionOrden.create({
      data: {
        ordenId: o.ordenId,
        mensajeroId: e.mensajeroId,
        resultado: "devuelta",
        causaDevolucion: "wrong_number",
        createdAt: new Date(Date.now() - 7200_000),
      },
      select: { id: true },
    });
    await e.tx.ordenHistorialEstado.create({
      data: {
        ordenId: o.ordenId,
        estatusOrigenId: e.id("en_reparto"),
        estatusDestinoId: e.id("devolucion_por_confirmar"),
        origenTipo: "gestion",
        actorUsuarioId: e.mensajeroId,
        gestionOrdenId: g.id,
        createdAt: new Date(Date.now() - 7200_000),
      },
    });
    return { ordenId: o.ordenId, gestionId: g.id };
  }

  function recorrido() {
    return conEscenario(mundo, async (e) => {
      const ay = await ayudaVieja(e);
      const ayBorrada = await ayudaVieja(e, { borrada: true });
      const ayRescatada = await ayudaVieja(e);
      const dpc = await devueltaVieja(e);
      const todas = [ay, ayBorrada, ayRescatada, dpc.ordenId];

      const jobs = () => e.tx.job.count();
      const notifs = () => e.tx.notificacion.count();
      const antes = { jobs: await jobs(), notifs: await notifs() };
      const estados = async (ids: string[]) => Promise.all(ids.map((id) => e.estadoDe(id)));
      const rastros = () => e.tx.ordenHistorialEstado.count({ where: { ordenId: { in: todas }, motivo: { in: RASTRO } } });
      const eventos = () => e.tx.ordenEvento.count({ where: { ordenId: { in: todas } } });
      const pendiente = async (ordenId: string) =>
        e.tx.gestionOrden.count({ where: { ordenId, ...whereGestionPendiente() } });
      const referencias = async (value: string) => {
        const [fila] = await e.tx.$queryRawUnsafe<{ n: number }[]>(
          `SELECT (
             (SELECT count(*) FROM "orden" o JOIN "order_status" s ON s."id" = o."estatus_id" WHERE s."value" = $1)
           + (SELECT count(*) FROM "orden_historial_estado" h JOIN "order_status" s ON s."id" IN (h."estatus_origen_id", h."estatus_destino_id") WHERE s."value" = $1)
           + (SELECT count(*) FROM "cierre_sin_gestion" c JOIN "order_status" s ON s."id" = c."estatus_origen_id" WHERE s."value" = $1)
           + (SELECT count(*) FROM "analytics_daily" a JOIN "order_status" s ON s."id" = a."estatus_id" WHERE s."value" = $1)
           )::int AS n`,
          value,
        );
        return fila.n;
      };
      const enCatalogo = async (value: string) => (await e.tx.orderStatus.count({ where: { value } })) === 1;

      // ── UP ──
      await e.tx.$executeRawUnsafe(UP);
      const up1 = {
        estados: await estados(todas),
        rastros: await rastros(),
        eventos: await eventos(),
        abiertas: [...(await conAyudaAbiertaDe(e.cliente, todas))].sort(),
        pendienteDpc: await pendiente(dpc.ordenId),
        eventoAyuda: await e.tx.ordenEvento.findFirst({
          where: { ordenId: ay, tipo: "ayuda_solicitada" },
          select: { actorUsuarioId: true, actorRol: true, mensajeroId: true, motivo: true },
        }),
        eventoDpc: await e.tx.ordenEvento.findFirst({
          where: { ordenId: dpc.ordenId, tipo: "gestion_registrada" },
          select: { gestionOrdenId: true, familiaAplicacion: true, resultado: true, actorUsuarioId: true, actorRol: true, motivo: true },
        }),
        catalogo: {
          ayuda: { existe: await enCatalogo("ayuda_tienda"), refs: await referencias("ayuda_tienda") },
          dpc: { existe: await enCatalogo("devolucion_por_confirmar"), refs: await referencias("devolucion_por_confirmar") },
        },
        jobs: await jobs(),
        notifs: await notifs(),
      };

      // ── UP otra vez: idempotente ──
      await e.tx.$executeRawUnsafe(UP);
      const up2 = { estados: await estados(todas), rastros: await rastros(), eventos: await eventos() };

      // ── Actividad del modelo NUEVO antes del down ──
      const rescate = (await e.recuperar(ayRescatada)).status;
      const nPend = await e.sembrarOrden({ estatus: "en_reparto" });
      const gNPend = await e.gestionarOk(nPend.ordenId, "rechazada");
      const nAy = await e.sembrarOrden({ estatus: "en_reparto" });
      const pedida = (await e.pedirAyuda(nAy.ordenId)).status;

      // ── DOWN ──
      await e.tx.$executeRawUnsafe(DOWN);
      const down = {
        estados: await estados(todas),
        nPend: await e.estadoDe(nPend.ordenId),
        nAy: await e.estadoDe(nAy.ordenId),
        rastros: await rastros(),
        eventosM3: await e.tx.ordenEvento.count({
          where: {
            OR: [
              { ordenId: { in: todas }, tipo: "ayuda_solicitada", motivo: { startsWith: "migracion 454" } },
              { gestionOrdenId: dpc.gestionId, tipo: "gestion_registrada" },
            ],
          },
        }),
        filaNPend: (await e.historialDe(nPend.ordenId)).map((h) => ({
          fila: `${h.origenTipo}:${h.origen}->${h.destino}`,
          actor: h.actorUsuarioId === e.mensajeroId,
          gestion: h.gestionOrdenId === gNPend,
        })),
        filaNAy: (await e.historialDe(nAy.ordenId)).map((h) => `${h.origenTipo}:${h.origen}->${h.destino}`),
      };

      // ── UP de nuevo ──
      await e.tx.$executeRawUnsafe(UP);
      const up3 = {
        estados: await estados(todas),
        nPend: await e.estadoDe(nPend.ordenId),
        nAy: await e.estadoDe(nAy.ordenId),
        abiertas: [...(await conAyudaAbiertaDe(e.cliente, [...todas, nAy.ordenId]))].sort(),
        pendienteDpc: await pendiente(dpc.ordenId),
      };
      return {
        ids: { ay, ayBorrada, ayRescatada, dpc: dpc.ordenId, dpcGestion: dpc.gestionId, nAy: nAy.ordenId },
        mensajeroId: e.mensajeroId,
        antes,
        up1,
        up2,
        rescate,
        pedida,
        down,
        up3,
      };
    });
  }

  function falla(prep: (e: Escenario) => Promise<unknown>) {
    return conEscenario(mundo, async (e) => {
      await prep(e);
      try {
        await e.tx.$executeRawUnsafe(UP);
        return "sin error";
      } catch (err) {
        return String((err as Error).message);
      }
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await recorrido();
    sinSolicitud = await falla(async (e) => {
      await e.sembrarOrden({ estatus: "ayuda_tienda" }); // sin fila `solicitud_ayuda_tienda`
    });
    sinDevuelta = await falla(async (e) => {
      await e.sembrarOrden({ estatus: "devolucion_por_confirmar" }); // sin gestion `devuelta`
    });
  }, 180_000);
  afterAll(async () => {
    await mundo.prisma.$disconnect();
  });

  it("(a) R38: las cuatro (una borrada) pasan a `en_reparto` con UN rastro cada una", () => {
    expect(r.up1.estados).toEqual(["en_reparto", "en_reparto", "en_reparto", "en_reparto"]);
    expect(r.up1.rastros).toBe(4);
  });

  it("(a) R38: las tres de ayuda quedan con ayuda ABIERTA (la derivacion no mira `deleted_at`: lo filtra quien lista)", () => {
    expect(r.up1.abiertas).toEqual([r.ids.ay, r.ids.ayBorrada, r.ids.ayRescatada].sort());
    expect(r.up1.eventoAyuda).toEqual({
      actorUsuarioId: r.mensajeroId,
      actorRol: "mensajero",
      mensajeroId: r.mensajeroId,
      motivo: expect.stringMatching(/^migracion 454: ayuda pedida el \d{4}-\d{2}-\d{2} /),
    });
  });

  it("(a) R38: la de devolucion queda con su gestion `devuelta` PENDIENTE de confirmar", () => {
    expect(r.up1.pendienteDpc).toBe(1);
    expect(r.up1.eventoDpc).toEqual({
      gestionOrdenId: r.ids.dpcGestion,
      familiaAplicacion: "gestion",
      resultado: "devuelta",
      actorUsuarioId: r.mensajeroId,
      actorRol: "mensajero",
      motivo: "wrong_number",
    });
  });

  it("(b) idempotente: la segunda pasada no escribe nada", () => {
    expect(r.up2).toEqual({ estados: r.up1.estados, rastros: r.up1.rastros, eventos: r.up1.eventos });
  });

  it("(c) R39: cada valor sigue en el catalogo si y solo si algo lo referencia", () => {
    expect(r.up1.catalogo.ayuda.existe).toBe(r.up1.catalogo.ayuda.refs > 0);
    expect(r.up1.catalogo.dpc.existe).toBe(r.up1.catalogo.dpc.refs > 0);
    // En esta base, el propio rastro referencia los dos: el retiro es no-op (como en produccion).
    expect(r.up1.catalogo.ayuda.refs).toBeGreaterThan(0);
    expect(r.up1.catalogo.dpc.refs).toBeGreaterThan(0);
  });

  it("(d) R42: ni jobs ni notificaciones nuevos", () => {
    expect({ jobs: r.up1.jobs, notifs: r.up1.notifs }).toEqual(r.antes);
  });

  it("(e) sin fila de solicitud, o sin gestion `devuelta`, la migracion FALLA", () => {
    expect(sinSolicitud).toContain("sin fila de solicitud");
    expect(sinDevuelta).toContain("sin gestion devuelta vigente");
  });

  it("(f) R41: down devuelve lo intacto a su origen; la ayuda rescatada despues NO vuelve", () => {
    expect(r.rescate).toBe("ok");
    expect(r.down.estados).toEqual(["ayuda_tienda", "ayuda_tienda", "en_reparto", "devolucion_por_confirmar"]);
    expect(r.down.rastros).toBe(0);
    expect(r.down.eventosM3).toBe(0);
  });

  it("(f) R41: down aplica al modelo viejo la gestion pendiente y la ayuda abierta NUEVAS", () => {
    expect(r.pedida).toBe("ok");
    expect(r.down.nPend).toBe("rechazada");
    expect(r.down.filaNPend).toEqual([{ fila: "gestion:en_reparto->rechazada", actor: true, gestion: true }]);
    expect(r.down.nAy).toBe("ayuda_tienda");
    expect(r.down.filaNAy).toEqual(["solicitud_ayuda_tienda:en_reparto->ayuda_tienda"]);
  });

  it("(g) up → down → up: sin error y en el estado del primer up", () => {
    expect(r.up3.estados).toEqual(["en_reparto", "en_reparto", "en_reparto", "en_reparto"]);
    expect(r.up3.nPend).toBe("rechazada");
    expect(r.up3.nAy).toBe("en_reparto");
    expect(r.up3.abiertas).toEqual([r.ids.ay, r.ids.ayBorrada, r.ids.nAy].sort());
    expect(r.up3.pendienteDpc).toBe(1);
  });
});
