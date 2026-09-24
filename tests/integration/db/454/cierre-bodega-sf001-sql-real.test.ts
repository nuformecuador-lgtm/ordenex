import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { CierreBodegaRepository } from "@/lib/repositories/CierreBodegaRepository";
import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";
import { CierreBodegaService } from "@/lib/services/CierreBodegaService";
import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.22; R61, R64) — SF-001: EL CIERRE DE BODEGA (40/431) SOBRE CIERRES APROBADOS CON
 * GESTIONES DEL MODELO NUEVO, contra Postgres real y por los servicios reales.
 *
 * Tres gestiones de calle (entregada efectivo, entregada SINPE, rechazada) registradas SIN transicion,
 * aplicadas al aprobar el cierre del mensajero; el adminSatelite solicita el cierre de bodega y el
 * maestro lo APRUEBA marcandolo recibido (`marcarConciliado`, 431). Se mide: los totales de la bodega son los del cierre
 * del mensajero, aprobarla es un unico cambio de estado del cierre de bodega (no toca ordenes, ni
 * gestiones, ni eventos) y el cierre del mensajero queda vinculado.
 *
 * Nota de medicion: la aprobacion de la bodega (`marcarConciliado`, y su antecesora
 * `resolverCierreBodega`) escribe `cierre_bodega` (+ `historial_accion`) y nada mas; no lee
 * `orden_evento` ni el estado de las ordenes, asi que la 454 no puede cambiar su resultado. Este test
 * lo fija para que un cambio futuro en esa direccion se vea. `aprobarCierreBodega` (40) choca hoy con
 * el CHECK de la 431 en cualquier base: hallazgo ajeno a la 454, anotado en la bitacora.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/T1.22 — SF-001: cierre de bodega sobre aprobados del modelo nuevo (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const ef = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 6000 });
      const sp = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 4000 });
      const re = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 9000 });
      await e.gestionarOk(ef.ordenId, "entregada", { monto: 6000 });
      await e.gestionarOk(sp.ordenId, "entregada", { monto: 4000, pagos: [{ metodo: "SINPE", monto: 4000 }] });
      await e.gestionarOk(re.ordenId, "rechazada");
      const cierreId = await e.solicitarCierreOk();
      const aprobacion = await e.aprobar(cierreId);

      const totalesDe = (c: Record<string, { toFixed: (n: number) => string }>) =>
        Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.toFixed(2)]));
      const SEL = {
        totalEfectivo: true,
        totalSimpe: true,
        totalTransferencia: true,
        totalGeneral: true,
        totalPagoMensajero: true,
        totalIngresoBodegaRechazos: true,
      } as const;
      const delMensajero = totalesDe(await e.tx.cierreDia.findUniqueOrThrow({ where: { id: cierreId }, select: SEL }));

      const solicitud = await new CierreBodegaService(new CierreBodegaRepository(e.cliente), e.s.ordenRepo).solicitarCierreBodega(
        e.actorAdminSatelite,
      );
      const cb = await e.tx.cierreBodega.findFirstOrThrow({
        where: { zonaId: e.zonaSateliteId },
        select: { id: true, estado: true },
      });
      const foto = async () => ({
        estados: [await e.estadoDe(ef.ordenId), await e.estadoDe(sp.ordenId), await e.estadoDe(re.ordenId)],
        eventos: await e.tx.ordenEvento.count({ where: { ordenId: { in: [ef.ordenId, sp.ordenId, re.ordenId] } } }),
        historial: await e.tx.ordenHistorialEstado.count({ where: { ordenId: { in: [ef.ordenId, sp.ordenId, re.ordenId] } } }),
        gestiones: await e.tx.gestionOrden.count({ where: { ordenId: { in: [ef.ordenId, sp.ordenId, re.ordenId] } } }),
      });
      const antes = await foto();
      // Desde la 431 la bodega se APRUEBA al marcarla recibida (conciliacion, con su monto): el CHECK
      // `cierre_bodega_conciliacion_coherente` impide un `aprobado` sin conciliar. Es la via viva.
      const aprobBodega = await new CierresBodegaAdminRepository(e.cliente).marcarConciliado({
        id: cb.id,
        montoRecibido: "6000.00",
        nota: null,
        actorUsuarioId: e.maestroId,
      });
      const despues = await foto();
      const bodega = await e.tx.cierreBodega.findUniqueOrThrow({ where: { id: cb.id }, select: { estado: true, ...SEL } });
      const vinculado = await e.tx.cierreDia.findUniqueOrThrow({ where: { id: cierreId }, select: { cierreBodegaId: true } });
      const { estado, ...totalesBodega } = bodega;
      return {
        aprobacion: aprobacion.status,
        solicitud: solicitud.status,
        aprobBodega,
        estadoBodega: estado,
        delMensajero,
        deLaBodega: totalesDe(totalesBodega),
        antes,
        despues,
        vinculado: vinculado.cierreBodegaId === cb.id,
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

  it("anti-vacuidad: el cierre del mensajero se aprueba y el de bodega se solicita y se aprueba", () => {
    expect(r.aprobacion).toBe("ok");
    expect(r.solicitud).toBe("ok");
    expect(r.aprobBodega).toBe("updated");
    expect(r.estadoBodega).toBe("aprobado");
    expect(r.vinculado).toBe(true);
  });

  it("R64: los estados del mensajero ya estan APLICADOS antes de la bodega (entregada x2; la rechazada ya salio por la 139)", () => {
    expect(r.antes.estados).toEqual(["entregada", "entregada", "por_devolver_a_tienda"]);
  });

  it("R61/R64: la bodega lleva exactamente los totales del cierre del mensajero", () => {
    expect(r.deLaBodega).toEqual(r.delMensajero);
    expect(r.delMensajero).toEqual(
      expect.objectContaining({ totalEfectivo: "6000.00", totalSimpe: "4000.00", totalGeneral: "10000.00" }),
    );
  });

  it("aprobar la bodega no toca ordenes, gestiones, eventos ni historial", () => {
    expect(r.despues).toEqual(r.antes);
  });
});
