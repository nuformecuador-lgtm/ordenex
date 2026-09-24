import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C21 (R15-R17). DESHACER UNA GESTION, sobre el codigo de HOY.
 *
 * - Deshacer una gestion SIN cierre: queda anulada y la orden vuelve a ser gestionable; el cierre que
 *   se solicita despues NO la vincula y aprobarlo NO cobra su COD.
 * - Una gestion registrada por la TIENDA desde ayuda: el mensajero no puede deshacerla.
 * - Una gestion ya incluida en un cierre: no se deshace.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C21 — deshacer una gestion (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const o1 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 5000 });
      const o2 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 2000 });
      const o3 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });

      const g1 = await e.gestionarOk(o1.ordenId, "entregado", { monto: 5000 });
      const deshacer1 = await e.s.cierreDia.deshacerGestion(g1, e.actorMensajero);
      const trasDeshacer = {
        g1: await e.tx.gestionOrden.findUniqueOrThrow({ where: { id: g1 }, select: { anuladaAt: true } }),
        estado: await e.estadoDe(o1.ordenId),
      };
      // La orden vuelve a ser gestionable: se registra de nuevo, ahora como rechazada.
      const regestion = await e.gestionar(o1.ordenId, "devolucion_a_origen_por_rechazo");

      const g2 = await e.gestionarOk(o2.ordenId, "entregado", { monto: 2000 });

      const pedida = await e.pedirAyuda(o3.ordenId);
      if (pedida.status !== "ok") throw new Error(`pedirAyuda: ${JSON.stringify(pedida)}`);
      const tienda = await e.gestionarDesdeAyuda(o3.ordenId, "devolucion_a_origen_por_rechazo");
      if (tienda.status !== "ok") throw new Error(`gestionarDesdeAyuda: ${JSON.stringify(tienda)}`);
      const g3 = (
        await e.tx.gestionOrden.findFirstOrThrow({ where: { ordenId: o3.ordenId }, select: { id: true } })
      ).id;
      const deshacerTienda = await e.s.cierreDia.deshacerGestion(g3, e.actorMensajero);

      const cierreId = await e.solicitarCierreOk();
      const deshacerEnCierre = await e.s.cierreDia.deshacerGestion(g2, e.actorMensajero);
      const g1TrasCierre = await e.tx.gestionOrden.findUniqueOrThrow({ where: { id: g1 }, select: { cierreId: true } });
      const aprobacion = await e.aprobar(cierreId);
      const cod = await e.tx.walletTiendaMovimiento.findMany({
        where: { origenId: cierreId, categoria: "cod_recaudado" },
        select: { monto: true },
      });
      return {
        deshacer1,
        trasDeshacer,
        regestion: regestion.status,
        deshacerTienda,
        deshacerEnCierre,
        g1TrasCierre,
        aprobacion: aprobacion.status,
        cod: cod.map((c) => c.monto.toFixed(2)),
      };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("deshacer una gestion sin cierre la anula y la orden vuelve a ser gestionable", () => {
    expect(r.deshacer1.status).toBe("ok");
    expect(r.trasDeshacer.g1.anuladaAt).not.toBeNull();
    expect(r.regestion).toBe("ok");
  });

  it("el cierre solicitado despues NO vincula la gestion anulada y aprobar NO cobra su COD", () => {
    expect(r.g1TrasCierre.cierreId).toBeNull();
    expect(r.aprobacion).toBe("ok");
    expect(r.cod).toEqual(["2000.00"]);
  });

  it("la gestion registrada por la TIENDA no la puede deshacer el mensajero", () => {
    expect(r.deshacerTienda).toMatchObject({ status: "conflict" });
    expect((r.deshacerTienda as { motivo?: string }).motivo).toContain("la resolvió la tienda");
  });

  it("una gestion ya incluida en un cierre no se deshace", () => {
    expect(r.deshacerEnCierre).toMatchObject({ status: "conflict" });
  });

  describe("[INTERMEDIO] lo que la 454 cambia por diseno", () => {
    it("hoy, deshacer devuelve la orden a `en_reparto` con una transicion", () => {
      expect(r.trasDeshacer.estado).toBe("en_reparto");
    });
  });
});
