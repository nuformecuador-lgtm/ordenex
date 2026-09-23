import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C17 (R13, R58). EL CIERRE RECHAZADO, sobre el codigo de HOY.
 *
 * Solicitar -> RECHAZAR: ni un movimiento de dinero ni un cambio de estado de orden. El mensajero lo
 * re-solicita -> aprobar: el dinero sale UNA vez y los estados se aplican UNA vez; re-aprobar no
 * duplica.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C17 — cierre rechazado, re-solicitado y aprobado (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const ent = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 5000 });
      const rec = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 7000 });
      await e.gestionarOk(ent.ordenId, "entregada", { monto: 5000 });
      await e.gestionarOk(rec.ordenId, "rechazada");
      const cierreId = await e.solicitarCierreOk();

      const dinero = async () =>
        (await e.tx.walletMovimiento.count({ where: { origenId: cierreId } })) +
        (await e.tx.walletTiendaMovimiento.count({ where: { origenId: cierreId } })) +
        (await e.tx.pagoMensajeroMovimiento.count({ where: { origenId: cierreId } }));
      const historial = async () =>
        e.tx.ordenHistorialEstado.count({ where: { ordenId: { in: [ent.ordenId, rec.ordenId] } } });

      const historialAntes = await historial();
      const rechazo = await e.rechazar(cierreId);
      const trasRechazo = {
        dinero: await dinero(),
        historial: await historial(),
        ent: await e.estadoDe(ent.ordenId),
        rec: await e.estadoDe(rec.ordenId),
      };
      const resolicitud = await e.solicitarCierre();
      const aprobacion = await e.aprobar(cierreId);
      const trasAprobar = {
        dinero: await dinero(),
        historial: await historial(),
        ent: await e.estadoDe(ent.ordenId),
        rec: await e.estadoDe(rec.ordenId),
      };
      const reaprobacion = await e.aprobar(cierreId);
      const trasReaprobar = { dinero: await dinero(), historial: await historial() };
      return {
        historialAntes,
        rechazo: rechazo.status,
        trasRechazo,
        resolicitud,
        aprobacion: aprobacion.status,
        trasAprobar,
        reaprobacion: reaprobacion.status,
        trasReaprobar,
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

  it("rechazar no mueve dinero ni cambia el estado de ninguna orden", () => {
    expect(r.rechazo).toBe("ok");
    expect(r.trasRechazo.dinero).toBe(0);
    expect(r.trasRechazo.historial).toBe(r.historialAntes);
    expect(r.trasRechazo.rec).toBe("rechazada");
  });

  it("re-solicitar y aprobar emite el dinero y aplica la devolucion de la rechazada", () => {
    expect(r.resolicitud).toEqual({ status: "ok", via: "resolicitado" });
    expect(r.aprobacion).toBe("ok");
    expect(r.trasAprobar.dinero).toBeGreaterThan(0);
    expect(r.trasAprobar.rec).toBe("por_devolver_a_tienda");
    expect(r.trasAprobar.ent).toBe("entregada");
    expect(r.trasAprobar.historial).toBe(r.historialAntes + 1);
  });

  it("re-aprobar no emite dinero ni estados otra vez", () => {
    expect(r.reaprobacion).toBe("conflict");
    expect(r.trasReaprobar).toEqual({ dinero: r.trasAprobar.dinero, historial: r.trasAprobar.historial });
  });

  describe("[INTERMEDIO] lo que la 454 cambia por diseno", () => {
    it("hoy, tras el rechazo, la entregada sigue en `entregada` (se aplico al gestionar)", () => {
      expect(r.trasRechazo.ent).toBe("entregada");
    });
  });
});
