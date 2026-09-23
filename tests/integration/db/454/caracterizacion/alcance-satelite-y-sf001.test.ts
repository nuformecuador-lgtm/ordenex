import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { CierreBodegaRepository } from "@/lib/repositories/CierreBodegaRepository";
import { CierreBodegaService } from "@/lib/services/CierreBodegaService";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C24 (R61, R64). ALCANCE DEL adminSatelite Y CIERRE DE BODEGA (SF-001, 431).
 *
 * Dos cierres con la MISMA forma (una entrega de 5 000 en efectivo y una rechazada): uno de un
 * mensajero de la zona satelite y otro de la central. El adminSatelite NO puede aprobar el de la
 * central; aprueba el suyo con los mismos desenlaces que el maestro obtiene en la central. El cierre
 * de bodega que el adminSatelite solicita sobre su aprobado lleva los mismos totales.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C24 — alcance satelite y cierre de bodega (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const central = await e.mensajeroCentral();
      const eS = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 5000 });
      const rS = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 7000 });
      const eC = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 5000, mensajeroId: central.mensajeroId });
      const rC = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 7000, mensajeroId: central.mensajeroId });
      await e.gestionarOk(eS.ordenId, "entregada", { monto: 5000 });
      await e.gestionarOk(rS.ordenId, "rechazada");
      await e.gestionarOk(eC.ordenId, "entregada", { monto: 5000, actor: central.actor });
      await e.gestionarOk(rC.ordenId, "rechazada", { actor: central.actor });
      const cierreSat = await e.solicitarCierreOk();
      const cierreCentral = await e.solicitarCierreOk(central.actor);

      const sateliteSobreCentral = await e.aprobar(cierreCentral, e.actorAdminSatelite);
      const aprobSat = await e.aprobar(cierreSat, e.actorAdminSatelite);
      const aprobCentral = await e.aprobar(cierreCentral, e.actorMaestro);

      const bodega = new CierreBodegaService(new CierreBodegaRepository(e.cliente), e.s.ordenRepo);
      const solicitudBodega = await bodega.solicitarCierreBodega(e.actorAdminSatelite);
      const cb = await e.tx.cierreBodega.findFirst({
        where: { zonaId: e.zonaSateliteId },
        select: {
          totalEfectivo: true,
          totalSimpe: true,
          totalTransferencia: true,
          totalGeneral: true,
          totalPagoMensajero: true,
          totalIngresoBodegaRechazos: true,
        },
      });
      return {
        sateliteSobreCentral: sateliteSobreCentral.status,
        aprobSat: aprobSat.status,
        aprobCentral: aprobCentral.status,
        satelite: { e: await e.estadoDe(eS.ordenId), r: await e.estadoDe(rS.ordenId) },
        central: { e: await e.estadoDe(eC.ordenId), r: await e.estadoDe(rC.ordenId) },
        solicitudBodega: solicitudBodega.status,
        totalesBodega: cb === null ? null : Object.fromEntries(Object.entries(cb).map(([k, v]) => [k, v.toFixed(2)])),
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

  it("el adminSatelite NO puede aprobar un cierre de la central (fuera de su alcance)", () => {
    expect(r.sateliteSobreCentral).toBe("no_encontrada");
  });

  it("el adminSatelite aprueba el de su zona con los MISMOS desenlaces que el maestro en la central", () => {
    expect(r.aprobSat).toBe("ok");
    expect(r.aprobCentral).toBe("ok");
    expect(r.satelite).toEqual({ e: "entregada", r: "por_devolver_a_tienda" });
    expect(r.central).toEqual(r.satelite);
  });

  it("el cierre de bodega (431) sobre el aprobado lleva sus mismos totales", () => {
    expect(r.solicitudBodega).toBe("ok");
    expect(r.totalesBodega).toEqual({
      totalEfectivo: "5000.00",
      totalSimpe: "0.00",
      totalTransferencia: "0.00",
      totalGeneral: "5000.00",
      totalPagoMensajero: "1500.00",
      totalIngresoBodegaRechazos: "164.00",
    });
  });
});
