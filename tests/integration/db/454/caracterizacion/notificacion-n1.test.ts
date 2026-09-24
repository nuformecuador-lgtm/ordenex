import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C20 (R35). EL AVISO N1 «ORDEN RECHAZADA POR EL DESTINATARIO».
 *
 * - `rechazada` registrada por el MENSAJERO -> 4 filas (maestro, admin, adminTienda dueña,
 *   adminSatelite de la zona de la orden), una sola vez.
 * - `rechazada` registrada por la TIENDA desde ayuda (237) -> 0 filas.
 * - Aprobar el cierre que contiene las dos -> 0 filas nuevas.
 * `[INTERMEDIO]`: ninguno (el instante es el mismo antes y despues de la 454).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C20 — aviso de orden rechazada (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const calle = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 3000 });
      const ayuda = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 3000 });
      const avisos = async (ordenId: string) =>
        e.tx.notificacion.findMany({
          where: { entidadId: ordenId, evento: "orden_rechazada" },
          select: { destinatarioRol: true, tiendaId: true, zonaId: true },
        });

      await e.gestionarOk(calle.ordenId, "devolucion_a_origen_por_rechazo");
      const trasMensajero = await avisos(calle.ordenId);

      const pedida = await e.pedirAyuda(ayuda.ordenId);
      if (pedida.status !== "ok") throw new Error(`pedirAyuda: ${JSON.stringify(pedida)}`);
      const desdeAyuda = await e.gestionarDesdeAyuda(ayuda.ordenId, "devolucion_a_origen_por_rechazo");
      const trasTienda = await avisos(ayuda.ordenId);

      const cierreId = await e.solicitarCierreOk();
      const aprobacion = await e.aprobar(cierreId);
      return {
        tiendaId: e.tiendaId,
        centralZonaId: mundo.centralZonaId,
        trasMensajero,
        desdeAyuda: desdeAyuda.status,
        trasTienda,
        aprobacion: aprobacion.status,
        trasAprobarCalle: await avisos(calle.ordenId),
        trasAprobarAyuda: await avisos(ayuda.ordenId),
        estadoAyuda: await e.estadoDe(ayuda.ordenId),
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

  const orden = <T extends { destinatarioRol: string | null }>(xs: T[]) =>
    [...xs].sort((a, b) => String(a.destinatarioRol).localeCompare(String(b.destinatarioRol)));

  it("la rechazada del MENSAJERO emite 4 filas: maestro, admin, adminTienda duena y adminSatelite de la zona", () => {
    expect(orden(r.trasMensajero)).toEqual(
      orden([
        { destinatarioRol: "maestro", tiendaId: null, zonaId: null },
        { destinatarioRol: "admin", tiendaId: null, zonaId: null },
        { destinatarioRol: "adminTienda", tiendaId: r.tiendaId, zonaId: null },
        { destinatarioRol: "adminSatelite", tiendaId: null, zonaId: r.centralZonaId },
      ]),
    );
  });

  it("la rechazada de la TIENDA desde ayuda NO emite ninguna", () => {
    expect(r.desdeAyuda).toBe("ok");
    expect(r.estadoAyuda).not.toBe("en_reparto");
    expect(r.trasTienda).toEqual([]);
  });

  it("aprobar el cierre no emite filas nuevas", () => {
    expect(r.aprobacion).toBe("ok");
    expect(r.trasAprobarCalle).toHaveLength(4);
    expect(r.trasAprobarAyuda).toEqual([]);
  });
});
