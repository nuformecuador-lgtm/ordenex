import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.11, design §11 U4; R15-R17, R20) — DESHACER UNA GESTION EN SUS DOS RAMAS, contra
 * Postgres real.
 *
 *   - NUEVA (con evento `gestion_registrada`): la orden nunca salio de `en_reparto`, asi que deshacer
 *     es ANULAR: gestion con `anulada_at`, evento `gestion_anulada` (resultado, actor mensajero) y su
 *     webhook; NINGUNA fila de historial. La orden vuelve a ser gestionable y la gestion anulada no
 *     entra en el cierre ni se aplica al aprobar.
 *   - NUEVA con la orden MOVIDA por otra via: `conflict`, sin anular nada.
 *   - LEGADA (sin evento, la orden ya transiciono): la de siempre — vuelve a `en_reparto` con la
 *     familia `deshacer_gestion`; ningun evento.
 *
 * Mutaciones registradas en `progress/impl_454_backend.md` (§Mutaciones T1.11).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/T1.11 — deshacer: rama nueva y rama legada (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      await e.tx.webhookSuscripcion.create({
        data: { ownerUsuarioId: e.tiendaId, url: "https://example.test/hook-454-desh", secret: "cifrado", activa: true },
      });
      const deshacer = (gestionId: string, actor = e.actorMensajero) => e.s.cierreDia.deshacerGestion(gestionId, actor);
      // M y L son del SEGUNDO mensajero: la legada deshecha le deja una orden en mano, que bloquearia
      // el cierre del primero (37: «tenes ordenes sin gestionar»).
      const m2 = { mensajeroId: e.mensajero2Id, actor: e.actorMensajero2 };

      // NUEVA
      const n = await e.sembrarOrden({ estatus: "en_reparto" });
      const gN = await e.gestionarOk(n.ordenId, "novedad");
      const desN = await deshacer(gN);
      const eventosN = await e.tx.ordenEvento.findMany({
        where: { ordenId: n.ordenId, tipo: "gestion_anulada" },
        select: { id: true, gestionOrdenId: true, resultado: true, actorUsuarioId: true, actorRol: true },
      });
      const jobsN = await e.tx.job.count({
        where: { tipo: "webhook_evento", payload: { path: ["ordenEventoId"], equals: eventosN[0]?.id ?? "-" } },
      });
      const trasN = {
        estado: await e.estadoDe(n.ordenId),
        historial: await e.historialDe(n.ordenId),
        anulada: (await e.gestionesDe(n.ordenId))[0].anuladaAt !== null,
      };
      // La orden vuelve a ser gestionable: una segunda gestion (entregada) entra.
      const gN2 = await e.gestionarOk(n.ordenId, "entregado");

      // NUEVA con la orden movida por otra via.
      const m = await e.sembrarOrden({ estatus: "en_reparto", mensajeroId: m2.mensajeroId });
      const gM = await e.gestionarOk(m.ordenId, "devolucion_a_origen_por_rechazo", { actor: m2.actor });
      await e.tx.orden.update({ where: { id: m.ordenId }, data: { estatusId: e.id("novedad_interna") } });
      const desM = await deshacer(gM, m2.actor);
      // Y la guarda de DENTRO de la tx (anti-TOCTOU), llamada directa: el servicio ya la filtra antes.
      const repoM = await e.s.cierreDiaRepo.anularGestionPendiente({
        gestionId: gM,
        ordenId: m.ordenId,
        mensajeroId: m2.mensajeroId,
        actorUsuarioId: m2.mensajeroId,
        estatusEnRepartoId: e.id("en_reparto"),
      });
      const trasM = {
        anulada: (await e.gestionesDe(m.ordenId))[0].anuladaAt !== null,
        eventos: await e.tx.ordenEvento.count({ where: { ordenId: m.ordenId, tipo: "gestion_anulada" } }),
      };
      // LEGADA
      const l = await e.sembrarOrden({ estatus: "devolucion_a_origen_por_rechazo", mensajeroId: m2.mensajeroId });
      const gL = (
        await e.tx.gestionOrden.create({
          data: { ordenId: l.ordenId, mensajeroId: m2.mensajeroId, resultado: "devolucion_a_origen_por_rechazo", motivo: "No la quiso" },
          select: { id: true },
        })
      ).id;
      await e.tx.ordenHistorialEstado.create({
        data: {
          ordenId: l.ordenId,
          estatusOrigenId: e.id("en_reparto"),
          estatusDestinoId: e.id("devolucion_a_origen_por_rechazo"),
          origenTipo: "gestion",
          actorUsuarioId: m2.mensajeroId,
          gestionOrdenId: gL,
        },
      });
      const desL = await deshacer(gL, m2.actor);
      const trasL = {
        estado: await e.estadoDe(l.ordenId),
        historial: (await e.historialDe(l.ordenId)).map((h) => `${h.origenTipo}:${h.origen}->${h.destino}`),
        eventos: await e.tx.ordenEvento.count({ where: { ordenId: l.ordenId } }),
      };

      // El cierre del mensajero: la anulada ni entra ni se aplica; la segunda si.
      const cierreId = await e.solicitarCierreOk();
      const enCierre = (await e.gestionesDe(n.ordenId)).map((g) => ({
        es: g.id === gN ? "gN" : g.id === gN2 ? "gN2" : "?",
        cierre: g.cierreId === cierreId,
      }));
      const aprobacion = await e.aprobar(cierreId);
      return {
        desN: desN.status,
        gN,
        eventosN,
        jobsN,
        trasN,
        desM,
        repoM,
        trasM,
        desL: desL.status,
        trasL,
        enCierre,
        aprobacion: aprobacion.status,
        estadoFinalN: await e.estadoDe(n.ordenId),
        historialFinalN: (await e.historialDe(n.ordenId)).map((h) => ({
          fila: `${h.origenTipo}:${h.origen}->${h.destino}`,
          gestion: h.gestionOrdenId === gN2 ? "gN2" : h.gestionOrdenId === gN ? "gN" : h.gestionOrdenId,
        })),
        mensajeroId: e.mensajeroId,
      };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);
  afterAll(async () => {
    await mundo.prisma.$disconnect();
  });

  it("anti-vacuidad: los deshacer de las dos ramas y la aprobacion ocurren", () => {
    expect(r.desN).toBe("ok");
    expect(r.desL).toBe("ok");
    expect(r.aprobacion).toBe("ok");
  });

  it("R15 (nueva): anula sin transicion — la orden sigue `en_reparto` y no hay historial", () => {
    expect(r.trasN).toEqual({ estado: "en_reparto", historial: [], anulada: true });
  });

  it("R15 (nueva): deja UN evento `gestion_anulada` del mensajero y su webhook", () => {
    expect(r.eventosN).toEqual([
      { id: expect.any(String), gestionOrdenId: r.gN, resultado: "novedad", actorUsuarioId: r.mensajeroId, actorRol: "mensajero" },
    ]);
    expect(r.jobsN).toBe(1);
  });

  it("R16 (nueva): con la orden movida por otra via, `conflict` y nada anulado", () => {
    expect(r.desM.status).toBe("conflict");
    expect(r.repoM).toBe(false);
    expect(r.trasM).toEqual({ anulada: false, eventos: 0 });
  });

  it("R20 (legada): vuelve a `en_reparto` por `deshacer_gestion`, sin evento", () => {
    expect(r.trasL.estado).toBe("en_reparto");
    expect(r.trasL.historial).toEqual(["gestion:en_reparto->devolucion_a_origen_por_rechazo", "deshacer_gestion:devolucion_a_origen_por_rechazo->en_reparto"]);
    expect(r.trasL.eventos).toBe(0);
  });

  it("R17: la anulada no entra en el cierre ni se aplica; la segunda gestion si", () => {
    expect(r.enCierre).toEqual([
      { es: "gN", cierre: false },
      { es: "gN2", cierre: true },
    ]);
    expect(r.estadoFinalN).toBe("entregado");
    expect(r.historialFinalN).toEqual([{ fila: "gestion:en_reparto->entregado", gestion: "gN2" }]);
  });
});
