import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C06 (R18, R19). LA CORRECCION `entregada -> rechazada` (398) EN UN CIERRE
 * ABIERTO, sobre el codigo de HOY.
 *
 * Mensajero de la zona central (tarifa por defecto fijada en la tx a 1500/164). Dos entregas: A con
 * 10 000 en efectivo y B con 5 000 por SINPE. Se solicita el cierre y el MAESTRO corrige A a
 * `rechazada`: los seis totales se recalculan (numeros literales abajo), el desglose de A se borra y
 * queda la bitacora. Al aprobar: el libro de la tienda NO acredita el COD de A, la gestion de A
 * conserva el `ingreso_bodega_rechazo` de la tarifa y la orden sale a `por_devolver_a_tienda`.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C06 — correccion de resultado #69 en cierre abierto (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const central = await e.mensajeroCentral();
      const a = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 10000, mensajeroId: central.mensajeroId });
      const b = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 5000, mensajeroId: central.mensajeroId });
      const gA = await e.gestionarOk(a.ordenId, "entregada", { monto: 10000, actor: central.actor });
      await e.gestionarOk(b.ordenId, "entregada", {
        monto: 5000,
        pagos: [{ metodo: "SINPE", monto: 5000 }],
        actor: central.actor,
      });
      const cierreId = await e.solicitarCierreOk(central.actor);
      const totalesDe = async () => {
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
        return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.toFixed(2)]));
      };
      const totalesAntes = await totalesDe();

      const correccion = await e.s.cierresAdmin.corregirResultadoGestion(
        { gestionId: gA, motivo: "El cliente no la recibio" },
        e.actorMaestro,
      );
      const totalesDespues = await totalesDe();
      const pagosDeA = await e.tx.gestionOrdenPago.count({ where: { gestionId: gA } });
      const gestionA = await e.tx.gestionOrden.findUniqueOrThrow({
        where: { id: gA },
        select: { resultado: true, ingresoBodegaRechazo: true, pagoMensajero: true, montoRecibido: true },
      });
      const bitacora = await e.tx.historialAccion.findMany({
        where: { entidadId: gA, accion: "cierre_dia_gestion_corregida" },
        select: { valorAnterior: true, valorNuevo: true },
      });
      const estadoTrasCorregir = await e.estadoDe(a.ordenId);

      const aprobacion = await e.aprobar(cierreId, e.actorMaestro);
      const creditosCod = await e.tx.walletTiendaMovimiento.findMany({
        where: { origenId: cierreId, tiendaId: e.tiendaId, categoria: "cod_recaudado" },
        select: { tipo: true, monto: true },
      });
      return {
        totalesAntes,
        correccion: correccion.status,
        totalesDespues,
        pagosDeA,
        gestionA: {
          resultado: gestionA.resultado,
          ingreso: gestionA.ingresoBodegaRechazo?.toFixed(2) ?? null,
          pago: gestionA.pagoMensajero?.toFixed(2) ?? null,
          montoRecibido: gestionA.montoRecibido,
        },
        bitacora,
        estadoTrasCorregir,
        aprobacion: aprobacion.status,
        creditosCod: creditosCod.map((c) => `${c.tipo}:${c.monto.toFixed(2)}`),
        estadoFinalA: await e.estadoDe(a.ordenId),
        estadoFinalB: await e.estadoDe(b.ordenId),
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

  describe("invariantes", () => {
    it("precondicion: el snapshot al solicitar congela las dos entregas", () => {
      expect(r.totalesAntes).toEqual({
        totalEfectivo: "10000.00",
        totalSimpe: "5000.00",
        totalTransferencia: "0.00",
        totalGeneral: "15000.00",
        totalPagoMensajero: "3000.00",
        totalIngresoBodegaRechazos: "0.00",
      });
    });

    it("la correccion recalcula los SEIS totales del cierre", () => {
      expect(r.correccion).toBe("ok");
      expect(r.totalesDespues).toEqual({
        totalEfectivo: "0.00",
        totalSimpe: "5000.00",
        totalTransferencia: "0.00",
        totalGeneral: "5000.00",
        totalPagoMensajero: "1500.00",
        totalIngresoBodegaRechazos: "164.00",
      });
    });

    it("la gestion queda sellada `rechazada`, sin cobro, con el ingreso de la tarifa, y su desglose BORRADO", () => {
      expect(r.gestionA).toEqual({ resultado: "rechazada", ingreso: "164.00", pago: "0.00", montoRecibido: null });
      expect(r.pagosDeA).toBe(0);
    });

    it("queda la bitacora `cierre_dia_gestion_corregida` entregada -> rechazada", () => {
      expect(r.bitacora).toEqual([{ valorAnterior: "entregada", valorNuevo: "rechazada" }]);
    });

    it("al aprobar: el libro de la tienda acredita SOLO el COD de B y la orden A sale a `por_devolver_a_tienda`", () => {
      expect(r.aprobacion).toBe("ok");
      expect(r.creditosCod).toEqual(["credito:5000.00"]);
      expect(r.estadoFinalA).toBe("por_devolver_a_tienda");
      expect(r.estadoFinalB).toBe("entregada");
    });
  });

  describe("[INTERMEDIO] lo que la 454 cambia por diseno", () => {
    // ⏳ 2026-09-23 (FICHA 454, R18): AQUI DECIA «hoy, justo tras corregir, la orden ya esta en `rechazada`
    // (transicion #69)». La gestion corregida esta pendiente de confirmar: la orden sigue `en_reparto`
    // y el resultado corregido se aplica al aprobar (R19, afirmado por las invariantes de arriba).
    it("justo tras corregir, la orden sigue `en_reparto` (sin transicion #69)", () => {
      expect(r.estadoTrasCorregir).toBe("en_reparto");
    });
  });
});
