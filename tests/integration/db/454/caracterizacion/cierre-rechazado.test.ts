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
      await e.gestionarOk(ent.ordenId, "entregado", { monto: 5000 });
      await e.gestionarOk(rec.ordenId, "devolucion_a_origen_por_rechazo");
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
    // ⏳ 2026-09-23 (FICHA 454, cambio autorizado #2): aqui estaba `expect(r.trasRechazo.rec)
    // .toBe("rechazada")`. Pasa al `[INTERMEDIO]` de abajo (R13). Dinero = 0 e historial sin cambios
    // siguen siendo la invariante.
  });

  it("re-solicitar y aprobar emite el dinero y aplica la devolucion de la rechazada", () => {
    expect(r.resolicitud).toEqual({ status: "ok", via: "resolicitado" });
    expect(r.aprobacion).toBe("ok");
    expect(r.trasAprobar.dinero).toBeGreaterThan(0);
    expect(r.trasAprobar.rec).toBe("por_devolver_a_tienda");
    expect(r.trasAprobar.ent).toBe("entregado");
    // ⏳ 2026-09-23 (FICHA 454, cambio autorizado #2): aqui estaba `toBe(r.historialAntes + 1)`.
    // Pasa al `[INTERMEDIO]` (R1 + R8): el numero de filas lo desplaza el cambio de MOMENTO. Que los
    // estados se apliquen UNA vez lo sigue afirmando «re-aprobar no emite … otra vez».
  });

  it("re-aprobar no emite dinero ni estados otra vez", () => {
    expect(r.reaprobacion).toBe("conflict");
    expect(r.trasReaprobar).toEqual({ dinero: r.trasAprobar.dinero, historial: r.trasAprobar.historial });
  });

  describe("[INTERMEDIO] lo que la 454 cambia por diseno", () => {
    // ⏳ 2026-09-23 (FICHA 454, R13): AQUI DECIA «hoy, tras el rechazo, la entregada sigue en
    // `entregada` (se aplico al gestionar)». Con la 454 nada se aplica al gestionar: tras rechazar el
    // cierre las dos siguen `en_reparto`, con su gestion pendiente de confirmar.
    it("tras el rechazo, la entregada y la rechazada siguen `en_reparto` (pendientes de confirmar)", () => {
      expect(r.trasRechazo.ent).toBe("en_reparto");
      expect(r.trasRechazo.rec).toBe("en_reparto");
    });

    // ⏳ 2026-09-23 (FICHA 454, R1 + R8): antes `historialAntes + 1` (dos transiciones al gestionar +
    // la 139 al aprobar). Ahora al gestionar no hay ninguna y al aprobar hay TRES: las dos
    // aplicaciones (`en_reparto -> entregada`, `en_reparto -> rechazada`) y la 139.
    it("gestionar no escribe historial y aprobar escribe TRES filas (dos aplicaciones + la 139)", () => {
      expect(r.historialAntes).toBe(0);
      expect(r.trasAprobar.historial).toBe(r.historialAntes + 3);
    });
  });
});
