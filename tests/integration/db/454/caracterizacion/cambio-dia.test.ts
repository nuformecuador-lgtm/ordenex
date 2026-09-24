import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { CorreccionDiaRepartoService } from "@/lib/services/CorreccionDiaRepartoService";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, diaCR, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C15 (R55). LA CORRECCION DEL DIA DE REPARTO, sobre el codigo de HOY.
 *
 * Dos ordenes del mensajero con dia de reparto = hoy. La gestionada NO admite el cambio de dia; la
 * que sigue en mano SI, con las reglas de hoy (queda para mañana). Via: `CorreccionDiaRepartoService`
 * real, actor maestro, notificador no-op.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C15 — cambio de dia de reparto (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const hoy = diaCR(0);
      const g = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000, fechaReparto: hoy });
      const m = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000, fechaReparto: hoy });
      await e.gestionarOk(g.ordenId, "entregado", { monto: 1000 });

      const svc = new CorreccionDiaRepartoService(e.s.ordenRepo);
      const gestionada = await svc.corregir(
        { ordenIds: [g.ordenId], dia: "manana", motivo: "se reprograma el lote" },
        e.actorMaestro,
      );
      const enMano = await svc.corregir(
        { ordenIds: [m.ordenId], dia: "manana", motivo: "se reprograma el lote" },
        e.actorMaestro,
      );
      return {
        hoy,
        gestionada,
        enMano,
        g: await e.ordenDe(g.ordenId),
        m: await e.ordenDe(m.ordenId),
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

  it("la orden gestionada NO admite el cambio de dia (`conflict`) y conserva su dia", () => {
    expect(r.gestionada.status).toBe("conflict");
    expect(r.g.fechaReparto?.toISOString()).toBe(r.hoy.toISOString());
  });

  it("la orden en mano SI: queda reservada para mañana", () => {
    expect(r.enMano).toMatchObject({ status: "ok", corregidas: 1 });
    expect(r.m.fechaReparto?.toISOString()).toBe(diaCR(1).toISOString());
  });
});
