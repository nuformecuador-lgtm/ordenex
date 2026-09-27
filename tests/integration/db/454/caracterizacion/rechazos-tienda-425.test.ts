import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C28 (R63). LOS RECHAZOS DE TIENDA COMO MATERIAL DE REVISION (425).
 *
 * Un rechazo de tienda SUELTO (via real `rechazarDesdeDevuelta`, 240) se incorpora al cierre que el
 * mensajero solicita como vinculo de REVISION (`cierre_rechazo_tienda`): la gestion NO recibe
 * `cierre_id` ni ningun importe. Una `rechazada` suelta de OTRA familia (fila cruzada de fixture con
 * historial `reprogramacion_tienda`) NO se incorpora: es la que aisla el segundo cerrojo.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C28 — rechazos de tienda como material de revision (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const ent = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      await e.gestionarOk(ent.ordenId, "entregado", { monto: 1000 });

      const dev = await e.sembrarOrden({ estatus: "novedad", montoCobrar: 5000 });
      await e.sembrarIntentoPasado(dev.ordenId, { resultado: "novedad" });
      const rechazo = await e.s.gestionRepo.rechazarDesdeDevuelta({
        ordenId: dev.ordenId,
        estatusDevueltaId: e.id("novedad"),
        estatusRechazadaId: e.id("devolucion_a_origen_por_rechazo"),
        motivo: "La tienda no la recibe",
        actorUsuarioId: e.tiendaId,
      });
      const gTienda = await e.tx.gestionOrden.findFirstOrThrow({
        where: { ordenId: dev.ordenId, resultado: "devolucion_a_origen_por_rechazo" },
        select: { id: true },
      });

      // FILA CRUZADA: `rechazada` suelta cuya familia es la de la reprogramacion de escritorio.
      const cruz = await e.sembrarOrden({ estatus: "devolucion_a_origen_por_rechazo", montoCobrar: 1000 });
      const gCruz = await e.tx.gestionOrden.create({
        data: { ordenId: cruz.ordenId, mensajeroId: e.mensajeroId, resultado: "devolucion_a_origen_por_rechazo", cierreId: null },
        select: { id: true },
      });
      await e.tx.ordenHistorialEstado.create({
        data: {
          ordenId: cruz.ordenId,
          estatusDestinoId: e.id("devolucion_a_origen_por_rechazo"),
          origenTipo: "reprogramacion_tienda",
          gestionOrdenId: gCruz.id,
        },
      });

      const cierreId = await e.solicitarCierreOk();
      const vinculos = await e.tx.cierreRechazoTienda.findMany({ where: { cierreId }, select: { gestionId: true } });
      const gestion = await e.tx.gestionOrden.findUniqueOrThrow({
        where: { id: gTienda.id },
        select: { cierreId: true, pagoMensajero: true, ingresoBodegaRechazo: true },
      });
      return { rechazo, gTienda: gTienda.id, gCruz: gCruz.id, vinculos: vinculos.map((v) => v.gestionId), gestion };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("el rechazo de tienda suelto se incorpora al cierre del mensajero como material de revision", () => {
    expect(r.rechazo).toBe(true);
    expect(r.vinculos).toContain(r.gTienda);
  });

  it("la gestion del rechazo NO recibe `cierre_id` ni ningun importe", () => {
    expect(r.gestion).toEqual({ cierreId: null, pagoMensajero: null, ingresoBodegaRechazo: null });
  });

  it("una `rechazada` suelta de OTRA familia no se incorpora (segundo cerrojo)", () => {
    expect(r.vinculos).toEqual([r.gTienda]);
    expect(r.vinculos).not.toContain(r.gCruz);
  });
});
