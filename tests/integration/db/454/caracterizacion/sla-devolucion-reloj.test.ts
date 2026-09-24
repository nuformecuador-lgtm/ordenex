import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { devolucionSlaConfig } from "@/lib/config/devolucion-sla";
import { DevolucionSlaRepository } from "@/lib/repositories/DevolucionSlaRepository";
import { DevolucionSlaService } from "@/lib/services/DevolucionSlaService";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C05 (R47). EL RELOJ DEL PLAZO DE LA TIENDA ARRANCA AL APROBAR.
 *
 * Gestion `devuelta` (causa `wrong_address`, ventana de 5 dias) registrada en t0 y aprobada en
 * t1 = t0 + 20 h. El cron REAL de devoluciones a t1 + ventana − 1 min NO escala; a t1 + ventana + 1 min
 * escala a `rechazada` con gestion sintetica, que el SIGUIENTE cierre del mensajero cobra (164.00).
 *
 * t0 se fija retrocediendo 20 h la gestion recien registrada por el portal real (es la unica forma de
 * separar el ancla de la aprobacion del instante de la gestion dentro de una sola transaccion). t1 se
 * LEE de la fila de historial que escribe la aprobacion, no se supone.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const VENTANA_MS = devolucionSlaConfig.DIAS_RECHAZO_AUTOMATICO * 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;

describeSiHayBase("454/C05 — el plazo de la devolucion se ancla en la aprobacion (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const o = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 5000 });
      const g = await e.gestionarOk(o.ordenId, "devuelta", { causaDevolucion: "wrong_address" });
      const estadoTrasGestionar = await e.estadoDe(o.ordenId);
      const ahora = await e.tx.gestionOrden.findUniqueOrThrow({ where: { id: g }, select: { createdAt: true } });
      const t0 = new Date(ahora.createdAt.getTime() - 20 * 60 * MIN);
      await e.tx.gestionOrden.update({ where: { id: g }, data: { createdAt: t0 } });

      const cierreId = await e.solicitarCierreOk();
      const aprobacion = await e.aprobar(cierreId);
      const ancla = await e.tx.ordenHistorialEstado.findFirst({
        where: { ordenId: o.ordenId, origenTipo: "anclaje_devolucion" },
        select: { createdAt: true },
      });
      if (ancla === null) throw new Error("la aprobacion no escribio la fila de anclaje");
      const t1 = ancla.createdAt;
      const estadoTrasAprobar = await e.estadoDe(o.ordenId);

      const cron = new DevolucionSlaService(
        new DevolucionSlaRepository(e.cliente),
        e.s.zonaRepo,
        e.s.ordenRepo,
        e.s.historialService,
        { warn: () => {} },
      );
      await cron.ejecutar(new Date(t1.getTime() + VENTANA_MS - MIN));
      const estadoAntesDeVencer = await e.estadoDe(o.ordenId);
      await cron.ejecutar(new Date(t1.getTime() + VENTANA_MS + MIN));
      const estadoAlVencer = await e.estadoDe(o.ordenId);
      const sinteticas = await e.tx.gestionOrden.findMany({
        where: { ordenId: o.ordenId, cierreId: null, resultado: "rechazada" },
        select: { id: true, mensajeroId: true },
      });
      const siguiente = await e.solicitarCierre();
      const sintetica =
        sinteticas.length === 1
          ? await e.tx.gestionOrden.findUniqueOrThrow({
              where: { id: sinteticas[0].id },
              select: { cierreId: true, ingresoBodegaRechazo: true },
            })
          : null;
      return {
        t0,
        t1,
        mensajeroId: e.mensajeroId,
        estadoTrasGestionar,
        aprobacion: aprobacion.status,
        estadoTrasAprobar,
        estadoAntesDeVencer,
        estadoAlVencer,
        sinteticas,
        siguiente,
        sintetica,
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

  it("precondicion: la aprobacion ocurre ~20 h despues de la gestion y deja la orden en `devuelta`", () => {
    expect(r.aprobacion).toBe("ok");
    expect(r.t1.getTime() - r.t0.getTime()).toBeGreaterThanOrEqual(20 * 60 * MIN - 5 * MIN);
    expect(r.estadoTrasAprobar).toBe("devuelta");
  });

  it("el cron a t1 + ventana − 1 min NO escala", () => {
    expect(r.estadoAntesDeVencer).toBe("devuelta");
  });

  it("el cron a t1 + ventana + 1 min escala a `rechazada` con UNA gestion sintetica del mensajero", () => {
    expect(r.estadoAlVencer).toBe("rechazada");
    expect(r.sinteticas).toHaveLength(1);
    expect(r.sinteticas[0].mensajeroId).toBe(r.mensajeroId);
  });

  it("la gestion sintetica cobra en el SIGUIENTE cierre del mensajero (164.00)", () => {
    expect(r.siguiente).toMatchObject({ status: "ok", via: "creado" });
    expect(r.sintetica?.cierreId).not.toBeNull();
    expect(r.sintetica?.ingresoBodegaRechazo?.toFixed(2)).toBe("164.00");
  });

  describe("[INTERMEDIO] lo que la 454 cambia por diseno", () => {
    // ⏳ 2026-09-23 (FICHA 454, R1): AQUI DECIA que tras gestionar la devolucion la orden quedaba en el pre-estado
    // `devolucion_por_confirmar`. El pre-estado muere: la orden sigue `en_reparto` hasta aprobar.
    it("tras gestionar la devolucion, la orden sigue `en_reparto` (pendiente de confirmar)", () => {
      expect(r.estadoTrasGestionar).toBe("en_reparto");
    });
  });
});
