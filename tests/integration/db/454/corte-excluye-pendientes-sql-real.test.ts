import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.10, design §9; R43) — EL CORTE NOCTURNO NO BARRE UNA ORDEN CON GESTION PENDIENTE,
 * contra Postgres real.
 *
 * La orden gestionada sigue `en_reparto` hasta que se aprueba su cierre. Si el corte la barriera a
 * `sin_gestionar`, la aprobacion podria terminarla en `rechazada` por tope de intentos y COBRAR el
 * rechazo (D4). «Pendiente» = gestion de calle vigente cuyo cierre NO esta aprobado: sin cierre,
 * `vencido` o `rechazado` (R13/R59). Se mide en DOS noches seguidas para cubrir los tres casos, con
 * un control positivo en cada una (la orden en mano SI se barre).
 *
 * Mutaciones registradas en `progress/impl_454_backend.md` (§Mutaciones T1.10).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/T1.10 — el corte excluye las ordenes con gestion pendiente (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      // (B) gestion pendiente en un cierre RECHAZADO: sigue pendiente (R13).
      const b = await e.sembrarOrden({ estatus: "en_reparto" });
      await e.gestionarOk(b.ordenId, "novedad");
      const rechazado = await e.solicitarCierreOk();
      const rechazo = await e.rechazar(rechazado);
      // (A) gestion pendiente SIN cierre: la primera noche el corte la vincula a su `vencido`. Es del
      // SEGUNDO mensajero: el primero queda bloqueado por su cierre rechazado (111/R1).
      const m2 = e.mensajero2Id;
      const a = await e.sembrarOrden({ estatus: "en_reparto", mensajeroId: m2 });
      await e.gestionarOk(a.ordenId, "devolucion_a_origen_por_rechazo", { actor: e.actorMensajero2 });
      // (H) control: una orden EN MANO, sin gestion. ESTA si se barre.
      const h = await e.sembrarOrden({ estatus: "en_reparto", mensajeroId: m2 });

      const noche1 = new Date(Date.now() + 1 * 24 * 3600_000);
      const corte1 = await e.correrCorte(noche1, [e.mensajeroId, m2]);
      const tras1 = {
        a: await e.estadoDe(a.ordenId),
        b: await e.estadoDe(b.ordenId),
        h: await e.estadoDe(h.ordenId),
        cierreDeA: (await e.gestionesDe(a.ordenId))[0].cierreId,
      };
      const vencido = tras1.cierreDeA
        ? await e.tx.cierreDia.findUnique({ where: { id: tras1.cierreDeA }, select: { estado: true } })
        : null;

      // Segunda noche: (A) ya esta en un cierre VENCIDO sin aprobar; otra orden en mano de control.
      const h2 = await e.sembrarOrden({ estatus: "en_reparto", mensajeroId: m2 });
      const noche2 = new Date(Date.now() + 2 * 24 * 3600_000);
      const corte2 = await e.correrCorte(noche2, [e.mensajeroId, m2]);

      const barridasA = await e.tx.cierreSinGestion.count({ where: { ordenId: a.ordenId } });
      const barridasB = await e.tx.cierreSinGestion.count({ where: { ordenId: b.ordenId } });
      const sinteticas = await e.tx.gestionOrden.count({
        where: { ordenId: { in: [a.ordenId, b.ordenId] } },
      });
      return {
        rechazo: rechazo.status,
        corte1,
        corte2,
        tras1,
        vencido: vencido?.estado ?? null,
        tras2: {
          a: await e.estadoDe(a.ordenId),
          b: await e.estadoDe(b.ordenId),
          h2: await e.estadoDe(h2.ordenId),
        },
        barridasA,
        barridasB,
        sinteticas,
        historialA: await e.historialDe(a.ordenId),
        historialB: await e.historialDe(b.ordenId),
      };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  });
  afterAll(async () => {
    await mundo.prisma.$disconnect();
  });

  it("anti-vacuidad: el cierre se rechazo y las dos noches crearon algun `vencido`", () => {
    expect(r.rechazo).toBe("ok");
    expect(r.corte1.vencidosCreados).toBeGreaterThanOrEqual(1);
    expect(r.corte2.vencidosCreados).toBeGreaterThanOrEqual(1);
  });

  it("noche 1 — control positivo: la orden EN MANO se barre a `novedad_interna`", () => {
    expect(r.tras1.h).toBe("novedad_interna");
  });

  it("noche 1 — R43: la pendiente SIN cierre y la del cierre RECHAZADO NO se barren", () => {
    expect(r.tras1.a).toBe("en_reparto");
    expect(r.tras1.b).toBe("en_reparto");
    // Y la pendiente sin cierre SI quedo vinculada al `vencido` (su dinero va a ese cierre).
    expect(r.vencido).toBe("vencido");
  });

  it("noche 2 — R43: la pendiente de un cierre VENCIDO tampoco se barre; la nueva en mano si", () => {
    expect(r.tras2.a).toBe("en_reparto");
    expect(r.tras2.b).toBe("en_reparto");
    expect(r.tras2.h2).toBe("novedad_interna");
  });

  it("R43: ni vinculo en `cierre_sin_gestion`, ni gestion sintetica, ni historial para las pendientes", () => {
    expect(r.barridasA).toBe(0);
    expect(r.barridasB).toBe(0);
    expect(r.sinteticas).toBe(2); // solo las dos gestiones de calle
    expect(r.historialA).toEqual([]);
    expect(r.historialB).toEqual([]);
  });
});
