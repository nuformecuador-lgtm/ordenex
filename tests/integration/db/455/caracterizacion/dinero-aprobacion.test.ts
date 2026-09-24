import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { C, R } from "../../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../../454/_escenario";

/**
 * FEATURE 455 — FASE 0 · C08 (R47). EL DINERO DE UNA APROBACION CON LOS CINCO RESULTADOS, AL CENTIMO.
 *
 * El dinero se decide por el CODIGO del resultado (`derivarIngresoOrden` cobra el flete a `R.entregado`
 * y el flete de devolucion SOLO a `R.rechazo`; el pago al mensajero y el ingreso de bodega tambien
 * miran el resultado). Un cierre de la zona satelite, por los servicios reales, con: `R.entregado`
 * (6 000 efectivo + 4 000 SINPE), DOS `R.rechazo` (asi un cambio de a quien se cobra el retorno mueve
 * la cifra), `R.novedad`, `R.reprogramado` e `R.incidente` con indemnizacion de 3 000. La tienda tiene
 * su tarifa (fijada en la tx) y el mensajero la de su zona (1500/164).
 * Invariantes: los totales congelados al solicitar, los movimientos EXACTOS de los feeds de la
 * aprobacion (42 caja, 43 tienda, 173 contra-entrega, 44 mensajero, 158 indemnizacion), que re-aprobar
 * no emite nada, y el estado final de cada orden (leido en su clave del interruptor).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("455/C08 — dinero de la aprobacion con los cinco resultados (Postgres real)", () => {
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
      const nueva = (monto: number) => e.sembrarOrden({ estatus: C.enReparto as never, montoCobrar: monto });
      const ent = await nueva(10000);
      const rec1 = await nueva(7000);
      const rec2 = await nueva(7500);
      const dev = await nueva(6000);
      const rep = await nueva(8000);
      const inc = await nueva(5000);
      await e.gestionarOk(ent.ordenId, R.entregado as never, {
        monto: 10000,
        pagos: [
          { metodo: "efectivo", monto: 6000 },
          { metodo: "SINPE", monto: 4000 },
        ],
      });
      await e.gestionarOk(rec1.ordenId, R.rechazo as never);
      await e.gestionarOk(rec2.ordenId, R.rechazo as never);
      await e.gestionarOk(dev.ordenId, R.novedad as never);
      await e.gestionarOk(rep.ordenId, R.reprogramado as never);
      const gInc = await e.gestionarOk(inc.ordenId, R.incidente as never);
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
        const fila =
          (libro: string) => (m: { tipo: string; categoria: string; monto: { toFixed: (n: number) => string } }) =>
            `${libro}|${m.tipo}|${m.categoria}|${m.monto.toFixed(2)}`;
        return [...caja.map(fila("caja")), ...tienda.map(fila("tienda")), ...mensajero.map(fila("mensajero"))].sort();
      };
      const trasAprobar = await movimientos();
      const reaprobacion = await e.aprobar(cierreId, e.actorAdminSatelite, indemnizaciones);
      const trasReaprobar = await movimientos();
      const finales: Record<string, string> = {};
      for (const [n, o] of Object.entries({ ent, rec1, rec2, dev, rep, inc })) {
        finales[n] = await e.estadoDe(o.ordenId);
      }
      return { totales, aprobacion: aprobacion.status, reaprobacion: reaprobacion.status, trasAprobar, trasReaprobar, finales };
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
    expect(r.totales).toEqual(TOTALES_ESPERADOS);
  });

  it("los movimientos de los feeds de la aprobacion, con importes exactos", () => {
    expect(r.aprobacion).toBe("ok");
    expect(r.trasAprobar).toEqual(MOVIMIENTOS_ESPERADOS);
  });

  it("re-aprobar no emite nada mas", () => {
    expect(r.reaprobacion).toBe("conflict");
    expect(r.trasReaprobar).toEqual(r.trasAprobar);
  });

  it("el estado final de cada orden tras aprobar", () => {
    expect(r.finales).toEqual({
      ent: C.entregado,
      // Las ordenes son de la zona central: el rechazo aprobado sale directo a la tienda (139).
      rec1: C.porDevolverATienda,
      rec2: C.porDevolverATienda,
      dev: C.novedad,
      rep: C.reprogramado,
      inc: C.incidente,
    });
  });
});

// Valores medidos sobre el codigo de HOY (2026-09-24).
// Dos rechazos: ingreso de bodega 2 x 164 y flete de devolucion 2 x 1800 (+ IVA 13 %).
const TOTALES_ESPERADOS = {
  totalEfectivo: "6000.00",
  totalSimpe: "4000.00",
  totalTransferencia: "0.00",
  totalGeneral: "10000.00",
  totalPagoMensajero: "1500.00",
  totalIngresoBodegaRechazos: "328.00",
};
const MOVIMIENTOS_ESPERADOS = [
  "caja|egreso|egreso_indemnizacion|3000.00",
  "caja|egreso|egreso_pago_mensajero|1500.00",
  "caja|ingreso|ingreso_cod_recaudado|10000.00",
  "caja|ingreso|ingreso_comision_cod|300.00",
  "caja|ingreso|ingreso_flete_devolucion|3600.00",
  "caja|ingreso|ingreso_flete|2500.00",
  "caja|ingreso|ingreso_iva_comision_cod|39.00",
  "caja|ingreso|ingreso_iva_flete_devolucion|468.00",
  "caja|ingreso|ingreso_iva_flete|325.00",
  "mensajero|devengo|pago_devengado|1500.00",
  "mensajero|pago|pago_efectivo|1500.00",
  "tienda|credito|cod_recaudado|10000.00",
  "tienda|debito|comision_cod|300.00",
  "tienda|debito|flete_devolucion|3600.00",
  "tienda|debito|flete|2500.00",
  "tienda|debito|iva_comision_cod|39.00",
  "tienda|debito|iva_flete_devolucion|468.00",
  "tienda|debito|iva_flete|325.00",
];
