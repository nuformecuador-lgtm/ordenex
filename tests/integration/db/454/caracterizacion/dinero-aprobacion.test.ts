import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C11 (R49, R12). EL DINERO DE UNA APROBACION, AL CENTIMO.
 *
 * Un cierre con los CINCO resultados: `entregada` (6 000 efectivo + 4 000 SINPE), `rechazada`,
 * `devuelta`, `reprogramada` e `incidente` con indemnizacion de 3 000. La tienda tiene su propia tarifa
 * (fijada en la tx) y el mensajero la tarifa de su zona (1500/164). Se fijan los totales CONGELADOS al
 * solicitar y los movimientos EXACTOS de los cinco feeds de la aprobacion (42 caja, 43 tienda, 173
 * contra-entrega, 44 pago al mensajero, 158 indemnizacion). Re-aprobar no duplica nada.
 *
 * Las cifras son las que el codigo de HOY produce con estos datos: se fijan como literales para que
 * cualquier cambio de la 454 que mueva un centimo se ponga rojo.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C11 — dinero de la aprobacion (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      await e.tx.tarifa.create({
        data: {
          tiendaId: e.tiendaId,
          zonaId: null,
          isDefault: true,
          valorFlete: "2000.00",
          valorFleteDevuelto: "1500.00",
          valorFleteGam: "2500.00",
          valorFleteDevueltoGam: "1800.00",
          comisionCod: "3.00",
          ivaFlete: "13.00",
          ivaComisionCod: "13.00",
        },
      });
      const ent = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 10000 });
      const rec = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 7000 });
      const dev = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 6000 });
      const rep = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 8000 });
      const inc = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 5000 });
      await e.gestionarOk(ent.ordenId, "entregado", {
        monto: 10000,
        pagos: [
          { metodo: "efectivo", monto: 6000 },
          { metodo: "SINPE", monto: 4000 },
        ],
      });
      await e.gestionarOk(rec.ordenId, "devolucion_a_origen_por_rechazo");
      await e.gestionarOk(dev.ordenId, "novedad");
      await e.gestionarOk(rep.ordenId, "reprogramado");
      const gInc = await e.gestionarOk(inc.ordenId, "incidente");
      const cierreId = await e.solicitarCierreOk();
      const c = await e.tx.cierreDia.findUniqueOrThrow({
        where: { id: cierreId },
        select: {
          totalEfectivo: true,
          totalSimpe: true,
          totalTransferencia: true,
          totalGeneral: true,
          totalPagoMensajero: true,
          totalIngresoBodegaRechazos: true,
        },
      });
      const totales = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.toFixed(2)]));

      const indemnizaciones = [{ gestionId: gInc, monto: "3000.00" }];
      const aprobacion = await e.aprobar(cierreId, e.actorAdminSatelite, indemnizaciones);

      const movimientos = async () => {
        const caja = await e.tx.walletMovimiento.findMany({
          where: { origenId: cierreId },
          select: { tipo: true, categoria: true, monto: true },
        });
        const tienda = await e.tx.walletTiendaMovimiento.findMany({
          where: { origenId: cierreId },
          select: { tipo: true, categoria: true, monto: true },
        });
        const mensajero = await e.tx.pagoMensajeroMovimiento.findMany({
          where: { origenId: cierreId },
          select: { tipo: true, categoria: true, monto: true },
        });
        const fila = (libro: string) => (m: { tipo: string; categoria: string; monto: { toFixed: (n: number) => string } }) =>
          `${libro}|${m.tipo}|${m.categoria}|${m.monto.toFixed(2)}`;
        return [...caja.map(fila("caja")), ...tienda.map(fila("tienda")), ...mensajero.map(fila("mensajero"))].sort();
      };
      const trasAprobar = await movimientos();
      const reaprobacion = await e.aprobar(cierreId, e.actorAdminSatelite, indemnizaciones);
      const trasReaprobar = await movimientos();
      return { totales, aprobacion: aprobacion.status, reaprobacion: reaprobacion.status, trasAprobar, trasReaprobar };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("los totales congelados al solicitar", () => {
    expect(r.totales).toEqual({
      totalEfectivo: "6000.00",
      totalSimpe: "4000.00",
      totalTransferencia: "0.00",
      totalGeneral: "10000.00",
      totalPagoMensajero: "1500.00",
      totalIngresoBodegaRechazos: "164.00",
    });
  });

  it("los movimientos de los cinco feeds, con importes exactos", () => {
    expect(r.aprobacion).toBe("ok");
    expect(r.trasAprobar).toEqual([
      "caja|egreso|egreso_indemnizacion|3000.00",
      "caja|egreso|egreso_pago_mensajero|1500.00",
      "caja|ingreso|ingreso_cod_recaudado|10000.00",
      "caja|ingreso|ingreso_comision_cod|300.00",
      "caja|ingreso|ingreso_flete_devolucion|1800.00",
      "caja|ingreso|ingreso_flete|2500.00",
      "caja|ingreso|ingreso_iva_comision_cod|39.00",
      "caja|ingreso|ingreso_iva_flete_devolucion|234.00",
      "caja|ingreso|ingreso_iva_flete|325.00",
      "mensajero|devengo|pago_devengado|1500.00",
      "mensajero|pago|pago_efectivo|1500.00",
      "tienda|credito|cod_recaudado|10000.00",
      "tienda|debito|comision_cod|300.00",
      "tienda|debito|flete_devolucion|1800.00",
      "tienda|debito|flete|2500.00",
      "tienda|debito|iva_comision_cod|39.00",
      "tienda|debito|iva_flete_devolucion|234.00",
      "tienda|debito|iva_flete|325.00",
    ]);
  });

  it("re-aprobar no emite nada mas", () => {
    expect(r.reaprobacion).toBe("conflict");
    expect(r.trasReaprobar).toEqual(r.trasAprobar);
  });
});
