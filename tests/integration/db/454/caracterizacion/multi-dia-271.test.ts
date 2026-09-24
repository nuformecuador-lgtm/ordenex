import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C18 (R59). VARIOS CIERRES ABIERTOS DEL MISMO MENSAJERO (271).
 *
 * Ayer: g1 (entrega) y A sin gestionar; el corte REAL crea C1 `vencido` con g1 y A barrida. El
 * mensajero re-solicita C1, trabaja hoy (g2) y solicita C2. Aprobar C2 NO toca A (sigue `sin_gestionar`
 * con su mensajero) ni g1 (sigue en C1, sin dinero emitido). Aprobar C1 despues libera A.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C18 — multi-dia: cada aprobacion toca solo lo suyo (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const o1 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 2000 });
      const a = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 3000 });
      const g1 = await e.gestionarOk(o1.ordenId, "entregado", { monto: 2000 });
      await e.correrCorte(new Date());
      const c1 = await e.tx.cierreDia.findFirst({
        where: { mensajeroId: e.mensajeroId, estado: "vencido" },
        select: { id: true },
      });
      if (c1 === null) throw new Error("el corte no creo C1");
      const resolicitud = await e.solicitarCierre();

      const o2 = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 4000 });
      await e.gestionarOk(o2.ordenId, "entregado", { monto: 4000 });
      const c2 = await e.solicitarCierreOk();

      const aprobC2 = await e.aprobar(c2);
      const trasC2 = {
        a: await e.ordenDe(a.ordenId),
        g1: await e.tx.gestionOrden.findUniqueOrThrow({ where: { id: g1 }, select: { cierreId: true } }),
        c1Estado: (await e.tx.cierreDia.findUniqueOrThrow({ where: { id: c1.id }, select: { estado: true } })).estado,
        dineroC1: await e.tx.walletMovimiento.count({ where: { origenId: c1.id } }),
      };
      const aprobC1 = await e.aprobar(c1.id);
      const trasC1 = { a: await e.ordenDe(a.ordenId), dineroC1: await e.tx.walletMovimiento.count({ where: { origenId: c1.id } }) };
      return { mensajeroId: e.mensajeroId, c1: c1.id, resolicitud, aprobC2: aprobC2.status, trasC2, aprobC1: aprobC1.status, trasC1 };
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

  it("precondicion: C1 re-solicitado y C2 aprobado", () => {
    expect(r.resolicitud).toEqual({ status: "ok", via: "resolicitado" });
    expect(r.aprobC2).toBe("ok");
  });

  it("aprobar C2 no toca A (sigue `novedad_interna` con su mensajero) ni g1 (sigue en C1, sin dinero)", () => {
    expect(estatus(r.trasC2.a)).toBe("novedad_interna");
    expect(r.trasC2.a.mensajeroAsignadoId).toBe(r.mensajeroId);
    expect(r.trasC2.g1.cierreId).toBe(r.c1);
    expect(r.trasC2.c1Estado).toBe("solicitado");
    expect(r.trasC2.dineroC1).toBe(0);
  });

  it("aprobar C1 despues libera A a bodega y emite su dinero", () => {
    expect(r.aprobC1).toBe("ok");
    expect(estatus(r.trasC1.a)).toBe("en_bodega_central");
    expect(r.trasC1.dineroC1).toBeGreaterThan(0);
  });
});
