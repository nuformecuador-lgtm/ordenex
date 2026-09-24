import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C26 (R33). EL WEBHOOK `orden.estado_actualizado` DE UNA ENTREGA.
 *
 * La tienda tiene una suscripcion ACTIVA. Tras gestionar la entrega Y aprobar su cierre, hay
 * exactamente UN job `webhook_estado` con destino `entregada` para esa orden, y su payload no lleva
 * datos personales (solo ids e instante). `[INTERMEDIO]`: el instante — hoy el job nace al gestionar.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C26 — webhook de estado de una entrega (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      await e.tx.webhookSuscripcion.create({
        data: { ownerUsuarioId: e.tiendaId, url: "https://example.test/hook-454", secret: "cifrado-de-prueba", activa: true },
      });
      const o = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 4000 });
      const entregadaId = e.id("entregado");
      const jobs = async () =>
        (
          await e.tx.job.findMany({
            where: { tipo: "webhook_estado", payload: { path: ["ordenId"], equals: o.ordenId } },
            select: { payload: true },
          })
        ).map((j) => j.payload as Record<string, unknown>);

      await e.gestionarOk(o.ordenId, "entregado", { monto: 4000 });
      const trasGestionar = (await jobs()).filter((p) => p.estatusDestinoId === entregadaId);
      const cierreId = await e.solicitarCierreOk();
      const aprobacion = await e.aprobar(cierreId);
      const alFinal = (await jobs()).filter((p) => p.estatusDestinoId === entregadaId);
      const orden = await e.tx.orden.findUniqueOrThrow({
        where: { id: o.ordenId },
        select: { destinatario: true, telefonoDest: true },
      });
      return { aprobacion: aprobacion.status, trasGestionar, alFinal, orden, ordenId: o.ordenId };
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
    it("tras gestionar y aprobar hay exactamente UN `orden.estado_actualizado` a `entregada`", () => {
      expect(r.aprobacion).toBe("ok");
      expect(r.alFinal).toHaveLength(1);
    });

    it("el payload del job no lleva datos personales: solo ids e instante", () => {
      const p = r.alFinal[0];
      expect(Object.keys(p).sort()).toEqual(["estatusDestinoId", "ocurridoAt", "ordenId"]);
      const texto = JSON.stringify(p);
      expect(texto).not.toContain(r.orden.destinatario);
      expect(texto).not.toContain(r.orden.telefonoDest);
    });
  });

  describe("[INTERMEDIO] lo que la 454 cambia por diseno", () => {
    // ⏳ 2026-09-23 (FICHA 454, R33): AQUI DECIA «hoy el job nace AL GESTIONAR, no al aprobar». El estado se
    // aplica al aprobar, y con el su `orden.estado_actualizado`: al gestionar no hay ninguno.
    it("al gestionar NO nace ningun `orden.estado_actualizado`: nace al aprobar", () => {
      expect(r.trasGestionar).toHaveLength(0);
    });
  });
});
