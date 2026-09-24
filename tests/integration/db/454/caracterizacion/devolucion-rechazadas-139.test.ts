import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { DevolucionSlaRepository } from "@/lib/repositories/DevolucionSlaRepository";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Escenario, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C10 (R51). LA DEVOLUCION DE LAS `rechazada` AL APROBAR (139).
 *
 * Aprobar C1 mueve a `por_devolver_a_tienda`: la `rechazada` del mensajero gestionada en calle (en C1),
 * un rechazo de ESCRITORIO de la tienda (240, `rechazarDesdeDevuelta`, gestion sin cierre) y un
 * ESCALADO del cron (99, `escalarDevueltaSla`) del mismo mensajero.
 *
 * (La `rechazada` legada de OTRO cierre abierto NO se afirma aqui: es el cambio declarado de R51 y se
 * prueba en T1.8.)
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C10 — devolucion de rechazadas al aprobar (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  /** Orden ya en `devuelta` por un cierre anterior aprobado (fixture de la devolucion anclada). */
  async function devueltaAnclada(e: Escenario) {
    const o = await e.sembrarOrden({ estatus: "devuelta", montoCobrar: 4000 });
    await e.sembrarIntentoPasado(o.ordenId, { resultado: "devuelta" });
    return o;
  }

  function correr() {
    return conEscenario(mundo, async (e) => {
      const calle = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 3000 });
      await e.gestionarOk(calle.ordenId, "rechazada");

      const escritorio = await devueltaAnclada(e);
      const r240 = await e.s.gestionRepo.rechazarDesdeDevuelta({
        ordenId: escritorio.ordenId,
        estatusDevueltaId: e.id("devuelta"),
        estatusRechazadaId: e.id("rechazada"),
        motivo: "La tienda no la recibe",
        actorUsuarioId: e.tiendaId,
      });

      const escalada = await devueltaAnclada(e);
      const r99 = await new DevolucionSlaRepository(e.cliente).escalarDevueltaSla({
        ordenId: escalada.ordenId,
        estatusDevueltaId: e.id("devuelta"),
        estatusRechazadaId: e.id("rechazada"),
        mensajeroId: e.mensajeroId,
        motivo: "escalado SLA wrong_address",
      });

      const antes = {
        calle: await e.estadoDe(calle.ordenId),
        escritorio: await e.estadoDe(escritorio.ordenId),
        escalada: await e.estadoDe(escalada.ordenId),
      };
      const cierreId = await e.solicitarCierreOk();
      const aprobacion = await e.aprobar(cierreId);
      return {
        r240,
        r99,
        antes,
        aprobacion: aprobacion.status,
        adminId: e.adminSateliteId,
        despues: {
          calle: await e.estadoDe(calle.ordenId),
          escritorio: await e.estadoDe(escritorio.ordenId),
          escalada: await e.estadoDe(escalada.ordenId),
        },
        filas139: await e.tx.ordenHistorialEstado.findMany({
          where: {
            ordenId: { in: [calle.ordenId, escritorio.ordenId, escalada.ordenId] },
            origenTipo: "devolucion_rechazada",
          },
          select: { actorUsuarioId: true },
        }),
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

  it("precondicion: las tres ordenes estan en `rechazada` antes de aprobar", () => {
    expect(r.r240).toBe(true);
    expect(r.r99).toBe(true);
    // ⏳ 2026-09-23 (FICHA 454, cambio autorizado #1 de progress/impl_454_backend.md): la clave
    // `calle` SALE de esta invariante y pasa al `[INTERMEDIO]` de abajo (R1). `escritorio` y
    // `escalada` siguen aqui, intactas.
    expect({ escritorio: r.antes.escritorio, escalada: r.antes.escalada }).toEqual({
      escritorio: "rechazada",
      escalada: "rechazada",
    });
    expect(r.aprobacion).toBe("ok");
  });

  it("aprobar C1 lleva las tres a `por_devolver_a_tienda` (zona central), con el aprobador en el historial", () => {
    expect(r.despues).toEqual({
      calle: "por_devolver_a_tienda",
      escritorio: "por_devolver_a_tienda",
      escalada: "por_devolver_a_tienda",
    });
    expect(r.filas139).toHaveLength(3);
    expect(r.filas139.every((f) => f.actorUsuarioId === r.adminId)).toBe(true);
  });

  describe("[INTERMEDIO] lo que la 454 cambia por diseno", () => {
    // ⏳ 2026-09-23 (FICHA 454, R1): AQUI DECIA `calle: "rechazada"` (dentro de la precondicion de
    // arriba). Con la 454 la gestion del mensajero NO mueve la orden: sigue `en_reparto`, con su
    // gestion `rechazada` pendiente de confirmar, hasta que la aprobacion la aplica.
    it("antes de aprobar, la rechazada de CALLE sigue `en_reparto` (pendiente de confirmar)", () => {
      expect(r.antes.calle).toBe("en_reparto");
    });
  });
});
