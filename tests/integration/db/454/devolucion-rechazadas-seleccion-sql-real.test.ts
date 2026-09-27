import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Escenario, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.8, design §8, DG; R51) — LA SELECCION DE LA DEVOLUCION DE `rechazada` (139) AL
 * APROBAR, contra Postgres real.
 *
 * Hasta la 454 la 139 devolvia TODA `rechazada` del mensajero del cierre. Con varios cierres abiertos
 * (271) eso devolvia tambien la de OTRO cierre sin aprobar —el fallo mudo M7—: su paquete salia a
 * `por_devolver*` con la aprobacion de un cierre que no era el suyo. La seleccion pasa a ser POR
 * GESTION: se excluye la orden cuya gestion `rechazada` vigente MAS RECIENTE pertenece a OTRO cierre
 * aun no aprobado. Es dinero: la devolucion arrastra el cobro del rechazo a la tienda.
 *
 * Mutaciones registradas en `progress/impl_454_backend.md` (§Mutaciones T1.8).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Un cierre SIN aprobar del mismo mensajero, creado directo (el «otro cierre abierto»). */
async function otroCierreAbierto(e: Escenario, estado: "solicitado" | "vencido" = "solicitado") {
  const c = await e.tx.cierreDia.create({
    data: {
      mensajeroId: e.mensajeroId,
      estado,
      destinoTipo: "bodega_satelite",
      destinoZonaId: e.zonaSateliteId,
      solicitadoAt: new Date("2026-09-20T10:00:00.000Z"),
    },
    select: { id: true },
  });
  return c.id;
}

/** Orden YA `rechazada` (legada o aplicada antes) con su gestion `rechazada` en `cierreId`. */
async function rechazadaCon(e: Escenario, gestiones: { cierreId: string; en: Date }[]) {
  const o = await e.sembrarOrden({ estatus: "devolucion_a_origen_por_rechazo" });
  for (const g of gestiones) {
    await e.tx.gestionOrden.create({
      data: {
        ordenId: o.ordenId,
        mensajeroId: e.mensajeroId,
        resultado: "devolucion_a_origen_por_rechazo",
        cierreId: g.cierreId,
        createdAt: g.en,
      },
    });
  }
  return o.ordenId;
}

describeSiHayBase("454/T1.8 — seleccion de la devolucion de rechazadas (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const abierto = await otroCierreAbierto(e);
      const aprobadoViejo = (await e.sembrarIntentoPasado((await e.sembrarOrden({ estatus: "entregado" })).ordenId, {
        resultado: "devolucion_a_origen_por_rechazo",
      })).cierreId;
      const T1 = new Date("2026-09-01T10:00:00.000Z");
      const T2 = new Date("2026-09-10T10:00:00.000Z");

      // (a) la de CALLE de ESTE cierre: se aplica a `rechazada` y se devuelve en la MISMA aprobacion.
      const calle = await e.sembrarOrden({ estatus: "en_reparto" });
      await e.gestionarOk(calle.ordenId, "devolucion_a_origen_por_rechazo");
      // (b) su gestion rechazada vive en OTRO cierre ABIERTO: se queda.
      const enOtroAbierto = await rechazadaCon(e, [{ cierreId: abierto, en: T1 }]);
      // (c) su gestion rechazada vive en un cierre YA APROBADO: se devuelve (legada).
      const enAprobado = await rechazadaCon(e, [{ cierreId: aprobadoViejo, en: T1 }]);
      // (d) la MAS RECIENTE en el abierto, una mas vieja en el aprobado: manda la mas reciente -> se queda.
      const recienteAbierta = await rechazadaCon(e, [
        { cierreId: aprobadoViejo, en: T1 },
        { cierreId: abierto, en: T2 },
      ]);
      // (e) la MAS RECIENTE en el aprobado, una mas vieja en el abierto: manda la mas reciente -> sale.
      const recienteAprobada = await rechazadaCon(e, [
        { cierreId: abierto, en: T1 },
        { cierreId: aprobadoViejo, en: T2 },
      ]);

      const cierreId = await e.solicitarCierreOk();
      const aprobacion = await e.aprobar(cierreId);
      return {
        aprobacion: aprobacion.status,
        calle: await e.estadoDe(calle.ordenId),
        enOtroAbierto: await e.estadoDe(enOtroAbierto),
        enAprobado: await e.estadoDe(enAprobado),
        recienteAbierta: await e.estadoDe(recienteAbierta),
        recienteAprobada: await e.estadoDe(recienteAprobada),
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

  it("la aprobacion ocurre (anti-vacuidad)", () => {
    expect(r.aprobacion).toBe("ok");
  });

  it("R51/R10: la `rechazada` de ESTE cierre sale a `por_devolver_a_bodega_central*` en la misma aprobacion", () => {
    expect(r.calle).toBe("por_devolver_a_tienda");
  });

  it("R51: la que tiene su gestion en OTRO cierre sin aprobar NO se mueve", () => {
    expect(r.enOtroAbierto).toBe("devolucion_a_origen_por_rechazo");
  });

  it("R51: la que tiene su gestion en un cierre YA aprobado SI se devuelve", () => {
    expect(r.enAprobado).toBe("por_devolver_a_tienda");
  });

  it("R51: decide la gestion MAS RECIENTE — en el abierto se queda, en el aprobado sale", () => {
    expect(r.recienteAbierta).toBe("devolucion_a_origen_por_rechazo");
    expect(r.recienteAprobada).toBe("por_devolver_a_tienda");
  });
});
