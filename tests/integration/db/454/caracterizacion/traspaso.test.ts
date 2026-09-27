import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { TraspasoMensajeroService } from "@/lib/services/TraspasoMensajeroService";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C14 (R54, R28). EL TRASPASO ENTRE MENSAJEROS, sobre el codigo de HOY.
 *
 * Una orden gestionada NO se traspasa. Una en mano y una con ayuda SI; la de ayuda sigue con ayuda en
 * manos del destino. El maestro traspasa por `TraspasoMensajeroService` real (notificadores no-op).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C14 — traspaso de ordenes entre mensajeros (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const vehiculo = await e.tx.vehiculo.findFirst({ select: { id: true } });
      if (vehiculo === null) throw new Error("hace falta al menos un vehiculo en el catalogo");
      await e.tx.usuario.update({ where: { id: e.mensajero2Id }, data: { vehiculoId: vehiculo.id } });

      const g = await e.sembrarOrden({ estatus: "en_reparto", zona: "satelite", montoCobrar: 1000 });
      const m = await e.sembrarOrden({ estatus: "en_reparto", zona: "satelite", montoCobrar: 1000 });
      const a = await e.sembrarOrden({ estatus: "en_reparto", zona: "satelite", montoCobrar: 1000 });
      await e.gestionarOk(g.ordenId, "entregado", { monto: 1000 });
      const ayuda = await e.pedirAyuda(a.ordenId);
      if (ayuda.status !== "ok") throw new Error(`pedirAyuda: ${JSON.stringify(ayuda)}`);

      const svc = new TraspasoMensajeroService(e.s.ordenRepo);
      const gestionada = await svc.traspasar(
        { ordenIds: [g.ordenId], mensajeroDestinoId: e.mensajero2Id, motivo: "reparto" },
        e.actorMaestro,
      );
      const enManoYAyuda = await svc.traspasar(
        { ordenIds: [m.ordenId, a.ordenId], mensajeroDestinoId: e.mensajero2Id, motivo: "reparto" },
        e.actorMaestro,
      );
      return {
        m2: e.mensajero2Id,
        m1: e.mensajeroId,
        gestionada,
        enManoYAyuda,
        g: await e.ordenDe(g.ordenId),
        m: await e.ordenDe(m.ordenId),
        a: await e.ordenDe(a.ordenId),
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

  const estatus = (o: { estatusId: string }) => mundo.valorDeEstatus.get(o.estatusId);

  it("una orden gestionada NO es traspasable (`conflict`) y se queda con su mensajero", () => {
    expect(r.gestionada.status).toBe("conflict");
    expect(r.g.mensajeroAsignadoId).toBe(r.m1);
  });

  it("la orden en mano y la de ayuda SI se traspasan, en un solo lote", () => {
    expect(r.enManoYAyuda).toMatchObject({ status: "ok", movidas: 2 });
    expect(r.m.mensajeroAsignadoId).toBe(r.m2);
    expect(r.a.mensajeroAsignadoId).toBe(r.m2);
    expect(estatus(r.m)).toBe("en_reparto");
  });

  describe("[INTERMEDIO] lo que la 454 cambia por diseno", () => {
    // ⏳ 2026-09-23 (FICHA 454, R28): AQUI DECIA «hoy la orden con ayuda sigue en `ayuda_tienda` tras el
    // traspaso». La ayuda ya no es estado: la orden sigue `en_reparto` (con su ayuda abierta).
    it("la orden con ayuda sigue `en_reparto` tras el traspaso", () => {
      expect(estatus(r.a)).toBe("en_reparto");
    });
  });
});
