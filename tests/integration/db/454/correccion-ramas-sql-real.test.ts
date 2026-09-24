import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.14, design §11 D10; R18-R20) — LA CORRECCION `entregada -> rechazada` (398) EN SUS DOS
 * RAMAS, contra Postgres real y en el MISMO cierre abierto.
 *
 *   - NUEVA (la gestion tiene su evento `gestion_registrada`): la orden sigue `en_reparto`; se escribe
 *     el evento `gestion_corregida` (resultado anterior y nuevo, actor con rol congelado, motivo) y su
 *     webhook si la tienda esta suscrita; NO hay transicion ni fila de historial. Al APROBAR se aplica
 *     el resultado CORREGIDO (`rechazada`) con la familia `gestion` y actor el mensajero (R8/R19), y la
 *     139 la devuelve en la misma aprobacion.
 *   - LEGADA (sin evento): la de siempre — transicion #69 `entregada -> rechazada` con la familia
 *     `correccion_resultado_gestion` y actor el admin; ningun evento.
 *
 * Mutaciones registradas en `progress/impl_454_backend.md` (§Mutaciones T1.14).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/T1.14 — correccion #69: rama nueva y rama legada (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const central = await e.mensajeroCentral();
      await e.tx.webhookSuscripcion.create({
        data: { ownerUsuarioId: e.tiendaId, url: "https://example.test/hook-454-corr", secret: "cifrado", activa: true },
      });

      // NUEVA: entregada por el portal real.
      const n = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 10000, mensajeroId: central.mensajeroId });
      const gN = await e.gestionarOk(n.ordenId, "entregado", { monto: 10000, actor: central.actor });
      const cierreId = await e.solicitarCierreOk(central.actor);

      // LEGADA: una `entregada` de antes de la 454 (orden ya `entregada`, historial `gestion`, sin
      // evento) metida en el MISMO cierre abierto.
      const l = await e.sembrarOrden({ estatus: "entregado", mensajeroId: central.mensajeroId });
      const gL = (
        await e.tx.gestionOrden.create({
          data: { ordenId: l.ordenId, mensajeroId: central.mensajeroId, resultado: "entregado", cierreId },
          select: { id: true },
        })
      ).id;
      // Su detalle CONGELADO: la copia del de N (misma tienda, zona y tarifa), como si hubiera
      // entrado al solicitar. Sin el, la aprobacion aborta por `CierreDetalleFaltanteError` (69/R14).
      const { id: _idDetalle, ...detalleN } = await e.tx.cierreDetail.findFirstOrThrow({
        where: { cierreId, ordenId: n.ordenId },
      });
      void _idDetalle;
      await e.tx.cierreDetail.create({ data: { ...detalleN, ordenId: l.ordenId } });
      await e.tx.ordenHistorialEstado.create({
        data: {
          ordenId: l.ordenId,
          estatusOrigenId: e.id("en_reparto"),
          estatusDestinoId: e.id("entregado"),
          origenTipo: "gestion",
          actorUsuarioId: central.mensajeroId,
          gestionOrdenId: gL,
        },
      });

      const corregir = (gestionId: string) =>
        e.s.cierresAdmin.corregirResultadoGestion({ gestionId, motivo: "El cliente no la recibio" }, e.actorMaestro);
      const corrN = await corregir(gN);
      const corrL = await corregir(gL);

      const eventosCorregida = async (ordenId: string) =>
        e.tx.ordenEvento.findMany({
          where: { ordenId, tipo: "gestion_corregida" },
          select: { id: true, gestionOrdenId: true, resultado: true, resultadoAnterior: true, actorUsuarioId: true, actorRol: true, motivo: true },
        });
      const evN = await eventosCorregida(n.ordenId);
      const evL = await eventosCorregida(l.ordenId);
      const jobsN = await e.tx.job.count({
        where: { tipo: "webhook_evento", payload: { path: ["ordenEventoId"], equals: evN[0]?.id ?? "-" } },
      });
      const trasCorregir = {
        estadoN: await e.estadoDe(n.ordenId),
        estadoL: await e.estadoDe(l.ordenId),
        historialN: await e.historialDe(n.ordenId),
        historialL: (await e.historialDe(l.ordenId)).map((h) => `${h.origenTipo}:${h.origen}->${h.destino}:${h.actorUsuarioId === e.maestroId ? "maestro" : "otro"}`),
      };

      const aprobacion = await e.aprobar(cierreId, e.actorMaestro);
      return {
        corrN: corrN.status,
        corrL: corrL.status,
        gN,
        evN,
        evL,
        jobsN,
        trasCorregir,
        aprobacion: aprobacion.status,
        estadoFinalN: await e.estadoDe(n.ordenId),
        estadoFinalL: await e.estadoDe(l.ordenId),
        historialFinalN: (await e.historialDe(n.ordenId)).map((h) => ({
          fila: `${h.origenTipo}:${h.origen}->${h.destino}`,
          actor: h.actorUsuarioId === central.mensajeroId ? "mensajero" : "otro",
          gestion: h.gestionOrdenId === gN ? "gN" : h.gestionOrdenId,
        })),
        maestroId: e.maestroId,
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

  it("anti-vacuidad: las dos correcciones y la aprobacion ocurren", () => {
    expect(r.corrN).toBe("ok");
    expect(r.corrL).toBe("ok");
    expect(r.aprobacion).toBe("ok");
  });

  it("R18 (nueva): tras corregir la orden sigue `en_reparto` y no hay historial", () => {
    expect(r.trasCorregir.estadoN).toBe("en_reparto");
    expect(r.trasCorregir.historialN).toEqual([]);
  });

  it("R18 (nueva): queda UN evento `gestion_corregida` entregado -> devolucion_a_origen_por_rechazo, del maestro, con motivo, y su webhook", () => {
    expect(r.evN).toEqual([
      {
        id: expect.any(String),
        gestionOrdenId: r.gN,
        resultado: "devolucion_a_origen_por_rechazo",
        resultadoAnterior: "entregado",
        actorUsuarioId: r.maestroId,
        actorRol: "maestro",
        motivo: "El cliente no la recibio",
      },
    ]);
    expect(r.jobsN).toBe(1);
  });

  it("R20 (legada): transicion #69 inmediata con familia `correccion_resultado_gestion` y ningun evento", () => {
    expect(r.trasCorregir.estadoL).toBe("devolucion_a_origen_por_rechazo");
    expect(r.trasCorregir.historialL).toEqual([
      "gestion:en_reparto->entregado:otro",
      "correccion_resultado_gestion:entregado->devolucion_a_origen_por_rechazo:maestro",
    ]);
    expect(r.evL).toEqual([]);
  });

  it("R19: al aprobar, la nueva se aplica como `rechazada` (familia `gestion`, actor el mensajero) y se devuelve", () => {
    expect(r.historialFinalN[0]).toEqual({ fila: "gestion:en_reparto->devolucion_a_origen_por_rechazo", actor: "mensajero", gestion: "gN" });
    expect(r.estadoFinalN).toBe("por_devolver_a_tienda");
  });

  it("la legada, ya `rechazada`, sale por la 139 en la misma aprobacion", () => {
    expect(r.estadoFinalL).toBe("por_devolver_a_tienda");
  });
});
