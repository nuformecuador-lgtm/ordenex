import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { TableroDiaRepository } from "@/lib/repositories/TableroDiaRepository";
import { ventanaDelDiaEnCursoCR } from "@/lib/utils/ventana-dia-cr";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C25 (R62). EL TABLERO DEL DIA, sobre el codigo de HOY.
 *
 * Jornada mixta de UN mensajero: una gestion de cada resultado (5), una orden en mano, una con ayuda y
 * una por recoger, todas asignadas hoy. Los contadores por resultado salen de la ULTIMA gestion vigente
 * del dia (no del estado de la orden) y los buckets de «sin resultado» del estado.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C25 — tablero del dia (Postgres real)", () => {
  let mundo: Mundo;
  let fila: Record<string, unknown> | null;

  beforeAll(async () => {
    mundo = await prepararMundo();
    fila = await conEscenario(mundo, async (e) => {
      for (const res of ["entregado", "reprogramado", "novedad", "devolucion_a_origen_por_rechazo", "incidente"] as const) {
        const o = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
        await e.gestionarOk(o.ordenId, res, { monto: 1000 });
      }
      await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const ay = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const p = await e.pedirAyuda(ay.ordenId);
      if (p.status !== "ok") throw new Error(`pedirAyuda: ${JSON.stringify(p)}`);
      await e.sembrarOrden({ estatus: "mensajero_recogiendo_en_bodega", montoCobrar: 1000 });

      const filas = await new TableroDiaRepository(e.cliente).contarPorMensajero(
        ventanaDelDiaEnCursoCR(new Date()),
        { tipo: "global" },
      );
      const mia = filas.find((f) => f.mensajeroId === e.mensajeroId);
      if (!mia) return null;
      const conteos: Record<string, unknown> = { ...mia };
      delete conteos.mensajeroId;
      delete conteos.mensajeroNombre;
      return conteos;
    });
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  describe("invariantes", () => {
    it("los contadores por RESULTADO del dia: uno de cada, y 8 asignadas", () => {
      expect(fila).toMatchObject({
        asignadas: 8,
        entregadas: 1,
        reprogramadas: 1,
        devueltas: 1,
        rechazadas: 1,
        incidentes: 1,
      });
    });

    it("sin resultado: la por recoger cae en `sinRecoger` y la en mano cuenta en `enReparto`", () => {
      expect(fila).toMatchObject({ sinRecoger: 1 });
      expect(Number(fila?.enReparto)).toBeGreaterThanOrEqual(1);
    });
  });

  describe("[INTERMEDIO] lo que la 454 cambia por diseno", () => {
    // ⏳ 2026-09-23 (FICHA 454, R62/R22): AQUI DECIA «hoy la orden con ayuda (estado `ayuda_tienda`)
    // cae en `otros`, no en `enReparto`» con `{ enReparto: 1, otros: 1 }`. La ayuda ya no es estado:
    // la orden sigue `en_reparto` sin resultado y cae en `enReparto`, como la que esta en mano. Las
    // cinco gestionadas siguen fuera de los buckets «sin resultado» (su resultado del dia existe).
    it("la orden con ayuda (sigue `en_reparto`) cuenta en `enReparto`; `otros` queda en cero", () => {
      expect(fila).toMatchObject({ enReparto: 2, otros: 0 });
    });
  });
});
