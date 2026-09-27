import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C16 (R57). DOS GESTIONES VIVAS DE LA MISMA ORDEN (pasa en produccion).
 *
 * O se devuelve (g1) y el mensajero solicita C1. Por FIXTURE SQL la orden vuelve a `en_reparto` (la
 * via real seria un rescate de bodega + reasignacion), se devuelve otra vez (g2) y se solicita C2.
 * Quedan DOS `devuelta` vigentes, g2 la mas reciente. Aprobar C1 NO mueve O; aprobar C2 la ancla.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C16 — dos gestiones vivas: solo aplica la mas reciente (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      // ⏳ 2026-09-23 (FICHA 454, cambio autorizado #3 de progress/impl_454_backend.md): AQUI g1 nacia
      // por el portal (`gestionarOk`). Con la 454 eso es IMPOSIBLE: g1 quedaria PENDIENTE de confirmar
      // y el segundo `gestionarOk` sobre la misma orden responde `conflict` (R3) — la prohibicion de
      // dos pendientes NUEVAS la cubren C07 (`no-doble-gestion`) y el R3 de la guardia de
      // gestionabilidad. La poblacion viva de «dos gestiones vivas» es LEGADA (design §7.3, fila 1),
      // asi que g1 se siembra LEGADA: gestion `devuelta` con su fila de historial de familia `gestion`
      // y SIN evento `gestion_registrada`, sobre una orden en el pre-estado de la 239. Las tres
      // aserciones no cambian.
      const o = await e.sembrarOrden({ estatus: "devolucion_por_confirmar", montoCobrar: 4000 });
      const g1 = (
        await e.tx.gestionOrden.create({
          data: {
            ordenId: o.ordenId,
            mensajeroId: e.mensajeroId,
            resultado: "novedad",
            causaDevolucion: "not_found",
            motivo: "No aparece",
          },
          select: { id: true },
        })
      ).id;
      await e.tx.ordenHistorialEstado.create({
        data: {
          ordenId: o.ordenId,
          estatusOrigenId: e.id("en_reparto"),
          estatusDestinoId: e.id("devolucion_por_confirmar"),
          actorUsuarioId: e.mensajeroId,
          origenTipo: "gestion",
          gestionOrdenId: g1,
        },
      });
      const c1 = await e.solicitarCierreOk();
      // FIXTURE: la orden vuelve a la mano del mismo mensajero sin anular g1.
      await e.tx.orden.update({ where: { id: o.ordenId }, data: { estatusId: e.id("en_reparto") } });
      await e.tx.gestionOrden.update({
        where: { id: g1 },
        data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      });
      const g2 = await e.gestionarOk(o.ordenId, "novedad");
      const c2 = await e.solicitarCierreOk();
      const vigentes = await e.tx.gestionOrden.count({
        where: { ordenId: o.ordenId, resultado: "novedad", anuladaAt: null },
      });

      const aprobC1 = await e.aprobar(c1);
      const trasC1 = await e.estadoDe(o.ordenId);
      const anclajesTrasC1 = await e.tx.ordenHistorialEstado.count({
        where: { ordenId: o.ordenId, origenTipo: "anclaje_devolucion" },
      });
      const aprobC2 = await e.aprobar(c2);
      const trasC2 = await e.estadoDe(o.ordenId);
      const anclaje = await e.tx.ordenHistorialEstado.findMany({
        where: { ordenId: o.ordenId, origenTipo: "anclaje_devolucion" },
        select: { gestionOrdenId: true },
      });
      return { g2, vigentes, aprobC1: aprobC1.status, aprobC2: aprobC2.status, trasC1, anclajesTrasC1, trasC2, anclaje };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("precondicion: dos `devuelta` vigentes de la misma orden, en dos cierres distintos", () => {
    expect(r.vigentes).toBe(2);
    expect(r.aprobC1).toBe("ok");
    expect(r.aprobC2).toBe("ok");
  });

  it("aprobar el cierre de la gestion VIEJA no mueve la orden ni deja rastro de anclaje", () => {
    expect(r.anclajesTrasC1).toBe(0);
  });

  it("aprobar el cierre de la MAS RECIENTE la lleva a `devuelta`, anclada a ESA gestion", () => {
    expect(r.trasC2).toBe("novedad");
    expect(r.anclaje).toEqual([{ gestionOrdenId: r.g2 }]);
  });

  describe("[INTERMEDIO] lo que la 454 cambia por diseno", () => {
    // ⏳ 2026-09-23 (FICHA 454, R1/R57): AQUI DECIA «hoy, tras aprobar el viejo, la orden sigue en el
    // pre-estado `devolucion_por_confirmar`». El pre-estado muere con la ficha: la orden esta
    // `en_reparto` (con g2 pendiente) y aprobar el cierre de g1 (legada) no la mueve.
    it("tras aprobar el viejo, la orden sigue `en_reparto` con la gestion mas reciente pendiente", () => {
      expect(r.trasC1).toBe("en_reparto");
    });
  });
});
