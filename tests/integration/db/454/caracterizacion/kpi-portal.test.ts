import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C12 (R53). LOS KPI DEL PORTAL DEL MENSAJERO, sobre el codigo de HOY.
 *
 * Jornada: 2 entregadas (COD 10 000 y 5 000), 1 rechazada (7 000), 2 en mano (3 000 y 4 000) y 1 con
 * ayuda (2 000). `pendientes = 3`, `entregadas = 2`, `porCobrar = 9 000`, `totalACobrar = 31 000`.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C12 — KPI del portal del mensajero (Postgres real)", () => {
  let mundo: Mundo;
  let kpis: { pendientes: number; entregadas: number; porCobrar: number; totalACobrar: number };

  beforeAll(async () => {
    mundo = await prepararMundo();
    kpis = await conEscenario(mundo, async (e) => {
      const e1 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 10000 });
      const e2 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 5000 });
      const rj = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 7000 });
      await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 3000 });
      await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 4000 });
      const ay = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 2000 });
      await e.gestionarOk(e1.ordenId, "entregado", { monto: 10000 });
      await e.gestionarOk(e2.ordenId, "entregado", { monto: 5000 });
      await e.gestionarOk(rj.ordenId, "devolucion_a_origen_por_rechazo");
      const a = await e.pedirAyuda(ay.ordenId);
      if (a.status !== "ok") throw new Error(`pedirAyuda: ${JSON.stringify(a)}`);
      const lista = await e.s.misAsignaciones.listarMisAsignaciones(e.actorMensajero);
      if (lista.status !== "ok") throw new Error(`listar: ${JSON.stringify(lista)}`);
      return lista.kpis;
    });
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("pendientes = 3 (dos en mano + una con ayuda)", () => {
    expect(kpis.pendientes).toBe(3);
  });

  it("entregadas = 2", () => {
    expect(kpis.entregadas).toBe(2);
  });

  it("porCobrar = 9 000 (lo que sigue en la mano)", () => {
    expect(kpis.porCobrar).toBe(9000);
  });

  it("totalACobrar = 31 000 (en mano 9 000 + gestionado hoy 22 000)", () => {
    expect(kpis.totalACobrar).toBe(31000);
  });
});
