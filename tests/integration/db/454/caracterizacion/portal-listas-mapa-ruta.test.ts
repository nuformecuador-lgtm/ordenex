import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C13 (R6, R22). LISTAS, MAPA Y PARADAS DEL PORTAL DEL MENSAJERO.
 *
 * Mensajero con G `entregada`, R `rechazada`, M en mano y A con ayuda, y una ruta optimizada que
 * todavia tiene a M y a A como paradas. Las gestionadas no salen en `porGestionar` (que alimenta el
 * mapa), ni en `conAyuda`, ni en `findParadasEnReparto` (paradas de la ruta). A sale en `conAyuda` SIN
 * `secuenciaRuta` aunque la ruta la tenga; M conserva su posicion.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C13 — listas, mapa y paradas del portal (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const g = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const rj = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const m = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const a = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const ruta = await e.tx.rutaOptimizada.create({
        data: { mensajeroId: e.mensajeroId, calculadaAt: new Date() },
        select: { id: true },
      });
      await e.tx.rutaOptimizadaParada.createMany({
        data: [
          { rutaId: ruta.id, ordenId: m.ordenId, secuencia: 1 },
          { rutaId: ruta.id, ordenId: a.ordenId, secuencia: 2 },
        ],
      });
      await e.gestionarOk(g.ordenId, "entregado", { monto: 1000 });
      await e.gestionarOk(rj.ordenId, "devolucion_a_origen_por_rechazo");
      const ayuda = await e.pedirAyuda(a.ordenId);
      if (ayuda.status !== "ok") throw new Error(`pedirAyuda: ${JSON.stringify(ayuda)}`);

      const lista = await e.s.misAsignaciones.listarMisAsignaciones(e.actorMensajero);
      if (lista.status !== "ok") throw new Error(`listar: ${JSON.stringify(lista)}`);
      const paradas = await e.s.ordenRepo.findParadasEnReparto(e.mensajeroId);
      return {
        ids: { g: g.ordenId, rj: rj.ordenId, m: m.ordenId, a: a.ordenId },
        porGestionar: lista.porGestionar.map((o) => ({ id: o.id, secuenciaRuta: o.secuenciaRuta })),
        conAyuda: lista.conAyuda.map((o) => ({ id: o.id, secuenciaRuta: o.secuenciaRuta })),
        paradas: paradas.map((p) => p.ordenId),
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

  it("`porGestionar` (y el mapa, que se alimenta de el) es SOLO la orden en mano, con su posicion", () => {
    expect(r.porGestionar).toEqual([{ id: r.ids.m, secuenciaRuta: 1 }]);
  });

  it("`conAyuda` es SOLO la orden con ayuda, SIN posicion de ruta", () => {
    expect(r.conAyuda).toEqual([{ id: r.ids.a, secuenciaRuta: null }]);
  });

  it("las paradas de la ruta (`findParadasEnReparto`) son SOLO la orden en mano", () => {
    expect(r.paradas).toEqual([r.ids.m]);
  });
});
