import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import { LiberacionReprogramadaService } from "@/lib/services/LiberacionReprogramadaService";
import { liberarAlAprobarCierreCon } from "@/lib/services/liberacion-al-aprobar-cierre";
import { fechaRepartoComoTexto } from "@/lib/utils/dia-reparto";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, diaCR, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C19 (R48). LA LIBERACION DE LAS REPROGRAMADAS, sobre el codigo de HOY.
 *
 * H reprogramada para HOY y M para MAÑANA, en el mismo cierre. El TIMBRE de la aprobacion (315,
 * cableado como en el composition root) libera H y NO M. El reloj de las 00:00 del dia siguiente
 * libera M.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C19 — liberacion de reprogramadas (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const ahora = new Date();
      const h = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const m = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      await e.gestionarOk(h.ordenId, "reprogramada", { fechaReprogramacion: fechaRepartoComoTexto(diaCR(0)) });
      await e.gestionarOk(m.ordenId, "reprogramada", { fechaReprogramacion: fechaRepartoComoTexto(diaCR(1)) });
      const cierreId = await e.solicitarCierreOk();

      const liberacion = new LiberacionReprogramadaService(
        new LiberacionReprogramadaRepository(e.cliente),
        e.s.zonaRepo,
        e.s.ordenRepo,
      );
      const admin = new CierresAdminService(
        e.s.adminRepo,
        e.s.zonaRepo,
        e.s.ordenRepo,
        { createSignedUrl: async (p: string) => p, createSignedUrls: async (ps: string[]) => Object.fromEntries(ps.map((p) => [p, p])) },
        new LiquidacionPagoRepository(e.cliente),
        new PagoMensajeroMovimientoRepository(e.cliente),
        undefined,
        liberarAlAprobarCierreCon(liberacion, () => ahora),
      );
      const confirmacion = await e.confirmacionDe(cierreId, {
        destinoTipo: "bodega_satelite",
        destinoZonaId: e.zonaSateliteId,
      });
      const aprobacion = await admin.aprobarCierre(cierreId, e.actorAdminSatelite, [], confirmacion);
      const trasTimbre = { h: await e.ordenDe(h.ordenId), m: await e.ordenDe(m.ordenId) };

      await liberacion.ejecutarLiberacion(diaCR(1, ahora));
      const trasReloj = { m: await e.ordenDe(m.ordenId) };
      return { aprobacion: aprobacion.status, trasTimbre, trasReloj };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  const estatus = (o: { estatusId: string }) => mundo.valorDeEstatus.get(o.estatusId);

  it("el timbre de la aprobacion libera la reprogramada para HOY a bodega, con prioridad", () => {
    expect(r.aprobacion).toBe("ok");
    expect(estatus(r.trasTimbre.h)).toBe("en_bodega_central");
    expect(r.trasTimbre.h.mensajeroAsignadoId).toBeNull();
    expect(r.trasTimbre.h.prioridad).toBe(true);
  });

  it("el timbre NO libera la reprogramada para MAÑANA", () => {
    expect(estatus(r.trasTimbre.m)).toBe("reprogramada");
  });

  it("el reloj de las 00:00 del dia siguiente la libera", () => {
    expect(estatus(r.trasReloj.m)).toBe("en_bodega_central");
  });
});
