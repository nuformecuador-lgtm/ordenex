import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { TEXTOS_POR_GRUPO } from "@/app/(app)/novedades/_components/novedad-grupo-textos";
import { C, R } from "../../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../../454/_escenario";

/**
 * FEATURE 455 — FASE 0 · C14 (R53). LAS PESTAÑAS DE `/novedades` DE LA TIENDA.
 *
 * La pestaña de devolucion es `estatus = <codigo>` (`PREDICADO_POR_GRUPO.devolucion`) y la de ayuda es la
 * ayuda ABIERTA de la 454 (derivada de `orden_evento`, sobre una orden que sigue en `C.enReparto`). Mundo
 * propio en tx revertida, por los servicios reales:
 *  - D1, D2 en `C.novedad` de la tienda; D3 en `C.novedad` de OTRA tienda; X1 en `C.rechazo`,
 *    X2 en `C.novedadInterna` (no son novedad de la tienda);
 *  - A1 con ayuda abierta; A2 con ayuda pedida y recuperada; A3 con ayuda y gestion de la tienda
 *    (`R.rechazo`, 237) -> ya no abierta.
 * Invariantes: cada pestaña lista EXACTAMENTE lo suyo, solo de la tienda dueña, y el conteo coincide.
 * `[INTERMEDIO]`: los rotulos de las pestañas (R5/R6, Fase 2).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("455/C14 — pestañas de novedades y ayuda de la tienda (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const nombre = new Map<string, string>();
      const sembrar = async (n: string, clave: keyof typeof C) => {
        const o = await e.sembrarOrden({ estatus: C[clave] as never, montoCobrar: 1000 });
        nombre.set(o.ordenId, n);
        return o.ordenId;
      };
      await sembrar("D1", "novedad");
      await sembrar("D2", "novedad");
      const d3 = await sembrar("D3", "novedad");
      await sembrar("X1", "rechazo");
      await sembrar("X2", "novedadInterna");
      const a1 = await sembrar("A1", "enReparto");
      const a2 = await sembrar("A2", "enReparto");
      const a3 = await sembrar("A3", "enReparto");
      const pedidas = [];
      for (const id of [a1, a2, a3]) pedidas.push((await e.pedirAyuda(id)).status);
      const recuperada = (await e.recuperar(a2)).status;
      const gestionada = (await e.gestionarDesdeAyuda(a3, R.rechazo as never)).status;
      const otraTienda = await e.crearUsuario("adminTienda", null);
      await e.tx.orden.update({ where: { id: d3 }, data: { tiendaId: otraTienda } });

      const repo = e.s.ordenRepo;
      const lista = async (grupo: "ayuda" | "devolucion", tiendaId = e.tiendaId) =>
        (await repo.findNovedadesByTienda(tiendaId, grupo, { skip: 0, take: 100 }))
          .map((f) => nombre.get(f.id) ?? "ajena")
          .sort();
      return {
        pedidas,
        recuperada,
        gestionada,
        devolucion: await lista("devolucion"),
        ayuda: await lista("ayuda"),
        devolucionOtra: await lista("devolucion", otraTienda),
        cuentaDevolucion: await repo.countNovedadesByTienda(e.tiendaId, "devolucion"),
        cuentaAyuda: await repo.countNovedadesByTienda(e.tiendaId, "ayuda"),
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
    it("precondicion: las tres ayudas se piden, A2 se recupera y la tienda gestiona A3", () => {
      expect(r.pedidas).toEqual(["ok", "ok", "ok"]);
      expect(r.recuperada).toBe("ok");
      expect(r.gestionada).toBe("ok");
    });

    it("la pestaña de devolucion de la tienda lista D1 y D2 (ni X1, ni X2, ni la ajena)", () => {
      expect(r.devolucion).toEqual(["D1", "D2"]);
      expect(r.devolucionOtra).toEqual(["D3"]);
      expect(r.cuentaDevolucion).toBe(2);
    });

    it("la pestaña de ayuda lista solo la ayuda abierta (A1)", () => {
      expect(r.ayuda).toEqual(["A1"]);
      expect(r.cuentaAyuda).toBe(1);
    });
  });

  describe("[INTERMEDIO] lo que la 455 cambia por diseño (R5/R6)", () => {
    // Fase 0 (2026-09-24): los rotulos de HOY. La Fase 2 (T2.5) los reescribe con fecha.
    it("los rotulos de las dos pestañas, hoy", () => {
      expect(TEXTOS_POR_GRUPO.devolucion.pestana).toBe("En devolución");
      expect(TEXTOS_POR_GRUPO.ayuda.pestana).toBe("Ayuda solicitada");
    });
  });
});
