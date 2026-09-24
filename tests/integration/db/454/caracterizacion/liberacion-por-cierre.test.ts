import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C09 (R50, R59). LA APROBACION LIBERA SOLO LO QUE BARRIO ESE CIERRE.
 *
 * El corte REAL de una noche barre A y B (C1 `vencido`); el de la noche siguiente barre C (C2
 * `vencido`). Aprobar C1 libera A y B a bodega; C sigue `sin_gestionar` con su mensajero.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const DIA_MS = 24 * 60 * 60 * 1000;

describeSiHayBase("454/C09 — la liberacion se acota al cierre aprobado (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const ahora = new Date();
      const a = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const b = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      await e.correrCorte(ahora);
      const c = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      await e.correrCorte(new Date(ahora.getTime() + DIA_MS));
      const vencidos = await e.tx.cierreDia.findMany({
        where: { mensajeroId: e.mensajeroId, estado: "vencido" },
        orderBy: { solicitadoAt: "asc" },
        select: { id: true, sinGestion: { select: { ordenId: true } } },
      });
      if (vencidos.length !== 2) throw new Error(`se esperaban 2 vencidos, hay ${vencidos.length}`);
      const [c1, c2] = vencidos;
      const resolicitud = await e.solicitarCierre();
      const c1Estado = (await e.tx.cierreDia.findUniqueOrThrow({ where: { id: c1.id }, select: { estado: true } })).estado;
      const aprobacion = await e.aprobar(c1.id);
      return {
        mensajeroId: e.mensajeroId,
        barridasC1: c1.sinGestion.map((s) => s.ordenId).sort(),
        barridasC2: c2.sinGestion.map((s) => s.ordenId),
        ids: { a: a.ordenId, b: b.ordenId, c: c.ordenId },
        resolicitud,
        c1Estado,
        aprobacion: aprobacion.status,
        a: await e.ordenDe(a.ordenId),
        b: await e.ordenDe(b.ordenId),
        c: await e.ordenDe(c.ordenId),
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

  it("precondicion: C1 barrio A y B, C2 barrio C, y se re-solicita C1 (el mas viejo)", () => {
    expect(r.barridasC1).toEqual([r.ids.a, r.ids.b].sort());
    expect(r.barridasC2).toEqual([r.ids.c]);
    expect(r.resolicitud).toEqual({ status: "ok", via: "resolicitado" });
    expect(r.c1Estado).toBe("solicitado");
    expect(r.aprobacion).toBe("ok");
  });

  it("aprobar C1 libera A y B a bodega, sin mensajero y con prioridad", () => {
    for (const o of [r.a, r.b]) {
      expect(estatus(o)).toBe("en_bodega_central");
      expect(o.mensajeroAsignadoId).toBeNull();
      expect(o.prioridad).toBe(true);
    }
  });

  it("C, barrida por C2, sigue `novedad_interna` con su mensajero", () => {
    expect(estatus(r.c)).toBe("novedad_interna");
    expect(r.c.mensajeroAsignadoId).toBe(r.mensajeroId);
  });
});
