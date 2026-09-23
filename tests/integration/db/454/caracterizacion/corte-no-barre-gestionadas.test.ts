import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, diaCR, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C01 (R43). CARACTERIZACION del corte nocturno sobre el codigo de HOY.
 *
 * Mensajero con O1 `entregada` y O2 `rechazada` (gestiones sin cierre), O3 en mano, O4 con ayuda y
 * O5 reservada para mañana. El corte barre SOLO O3 y O4, sin tocar las gestionadas ni la reservada,
 * y el `vencido` se lleva las dos gestiones. Al aprobarlo: O1 sigue `entregada`, O2 va a
 * `por_devolver*` con UNA sola gestion `rechazada` (ninguna sintetica).
 *
 * Invariantes = no se editan en fases posteriores. `[INTERMEDIO]` = lo que la 454 cambia por diseno.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C01 — el corte no barre las ordenes gestionadas (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const o1 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 5000 });
      const o2 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 7000 });
      const o3 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 3000 });
      const o4 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 2000 });
      const o5 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000, fechaReparto: diaCR(1) });

      const g1 = await e.gestionarOk(o1.ordenId, "entregada", { monto: 5000 });
      const g2 = await e.gestionarOk(o2.ordenId, "rechazada");
      const estadoTrasGestionar = { o1: await e.estadoDe(o1.ordenId), o2: await e.estadoDe(o2.ordenId) };
      const ayuda = await e.pedirAyuda(o4.ordenId);
      if (ayuda.status !== "ok") throw new Error(`pedirAyuda: ${JSON.stringify(ayuda)}`);

      const corte = await e.correrCorte(new Date());
      const vencido = await e.tx.cierreDia.findFirst({
        where: { mensajeroId: e.mensajeroId, estado: "vencido" },
        select: { id: true },
      });
      if (vencido === null) throw new Error(`el corte no creo el vencido: ${JSON.stringify(corte)}`);
      const barridas = (
        await e.tx.cierreSinGestion.findMany({ where: { cierreId: vencido.id }, select: { ordenId: true } })
      ).map((f) => f.ordenId);
      const trasCorte = {
        o1: await e.estadoDe(o1.ordenId),
        o2: await e.estadoDe(o2.ordenId),
        o3: await e.estadoDe(o3.ordenId),
        o4: await e.estadoDe(o4.ordenId),
        o5: await e.estadoDe(o5.ordenId),
      };
      const gestionesTrasCorte = {
        o1: await e.gestionesDe(o1.ordenId),
        o2: await e.gestionesDe(o2.ordenId),
        o5: await e.gestionesDe(o5.ordenId),
      };

      const resolicitud = await e.solicitarCierre();
      const aprobacion = await e.aprobar(vencido.id);
      return {
        ids: { o1: o1.ordenId, o2: o2.ordenId, o3: o3.ordenId, o4: o4.ordenId, o5: o5.ordenId },
        g1,
        g2,
        vencidoId: vencido.id,
        estadoTrasGestionar,
        vencidosCreados: corte.vencidosCreados,
        barridas,
        trasCorte,
        gestionesTrasCorte,
        resolicitud,
        aprobacion,
        final: {
          o1: await e.estadoDe(o1.ordenId),
          o2: await e.estadoDe(o2.ordenId),
          o5: await e.estadoDe(o5.ordenId),
        },
        gestionesO2Final: await e.gestionesDe(o2.ordenId),
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
    it("el corte crea UN vencido y barre O3 (en mano) y O4 (con ayuda) a `sin_gestionar`", () => {
      expect(r.vencidosCreados).toBe(1);
      expect(r.trasCorte.o3).toBe("sin_gestionar");
      expect(r.trasCorte.o4).toBe("sin_gestionar");
      expect([...r.barridas].sort()).toEqual([r.ids.o3, r.ids.o4].sort());
    });

    it("O1 y O2 (gestionadas) y O5 (reservada para mañana) NO se barren ni se vinculan en cierre_sin_gestion", () => {
      expect(r.trasCorte.o1).not.toBe("sin_gestionar");
      expect(r.trasCorte.o2).not.toBe("sin_gestionar");
      expect(r.trasCorte.o5).toBe("en_reparto");
      expect(r.barridas).not.toContain(r.ids.o1);
      expect(r.barridas).not.toContain(r.ids.o2);
      expect(r.barridas).not.toContain(r.ids.o5);
    });

    it("el corte no crea gestion sintetica en O1, O2 ni O5, y el vencido se lleva g1 y g2", () => {
      expect(r.gestionesTrasCorte.o1.map((g) => g.id)).toEqual([r.g1]);
      expect(r.gestionesTrasCorte.o2.map((g) => g.id)).toEqual([r.g2]);
      expect(r.gestionesTrasCorte.o5).toEqual([]);
      expect(r.gestionesTrasCorte.o1[0].cierreId).toBe(r.vencidoId);
      expect(r.gestionesTrasCorte.o2[0].cierreId).toBe(r.vencidoId);
    });

    it("tras re-solicitar y aprobar: O1 `entregada`, O2 `por_devolver_a_tienda` con UNA sola gestion `rechazada`", () => {
      expect(r.resolicitud).toEqual({ status: "ok", via: "resolicitado" });
      expect(r.aprobacion.status).toBe("ok");
      expect(r.final.o1).toBe("entregada");
      expect(r.final.o2).toBe("por_devolver_a_tienda");
      expect(r.gestionesO2Final.filter((g) => g.resultado === "rechazada")).toHaveLength(1);
      expect(r.final.o5).toBe("en_reparto");
    });
  });

  describe("[INTERMEDIO] lo que la 454 cambia por diseno", () => {
    it("hoy, justo tras gestionar, la orden ya esta en el estado del resultado", () => {
      expect(r.estadoTrasGestionar).toEqual({ o1: "entregada", o2: "rechazada" });
    });
  });
});
