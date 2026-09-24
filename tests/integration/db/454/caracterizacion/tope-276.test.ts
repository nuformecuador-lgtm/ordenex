import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { reintentosConfig } from "@/lib/config/reintentos";
import { MOTIVO_RECHAZO_TOPE_INTENTOS } from "@/lib/repositories/CierresAdminRepository";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C04 (R46, R10). EL TOPE DE INTENTOS DE LA 276, sobre el codigo de HOY.
 *
 * O en el umbral y O' un intento por debajo, las dos barridas por el corte REAL y aprobadas en el
 * `vencido` que crea. O termina `rechazada` con gestion sintetica SIN cierre, conserva su mensajero y
 * sale a `por_devolver_a_tienda` en la MISMA aprobacion; en el SIGUIENTE cierre del mensajero esa
 * gestion congela `ingreso_bodega_rechazo` = la tarifa (164.00). O' va a bodega con `prioridad`.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const UMBRAL = reintentosConfig.MIN_INTENTOS_ENTREGA;

describeSiHayBase("454/C04 — tope de intentos al aprobar (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const tope = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 8000 });
      const bajo = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 9000 });
      for (let i = 0; i < UMBRAL; i++) {
        await e.sembrarIntentoPasado(tope.ordenId, { en: new Date(Date.UTC(2026, 8, 1 + i, 16)) });
      }
      for (let i = 0; i < UMBRAL - 1; i++) {
        await e.sembrarIntentoPasado(bajo.ordenId, { en: new Date(Date.UTC(2026, 8, 1 + i, 16)) });
      }
      const intentosAntes = {
        tope: await e.s.historialService.contarIntentos(tope.ordenId),
        bajo: await e.s.historialService.contarIntentos(bajo.ordenId),
      };

      const corte = await e.correrCorte(new Date());
      const vencido = await e.tx.cierreDia.findFirst({
        where: { mensajeroId: e.mensajeroId, estado: "vencido" },
        select: { id: true },
      });
      if (vencido === null) throw new Error(`el corte no creo el vencido: ${JSON.stringify(corte)}`);
      const trasCorte = { tope: await e.estadoDe(tope.ordenId), bajo: await e.estadoDe(bajo.ordenId) };
      await e.solicitarCierre();
      const aprobacion = await e.aprobar(vencido.id);

      const sinteticas = await e.tx.gestionOrden.findMany({
        where: { ordenId: tope.ordenId, cierreId: null },
        select: { id: true, resultado: true, motivo: true, mensajeroId: true },
      });
      const final = {
        tope: await e.ordenDe(tope.ordenId),
        bajo: await e.ordenDe(bajo.ordenId),
      };
      const historialTope = await e.historialDe(tope.ordenId);

      // El SIGUIENTE cierre del mensajero: se lleva la gestion sintetica y congela su ingreso.
      const siguiente = await e.solicitarCierre();
      const sinteticaTrasSiguiente =
        sinteticas.length === 1
          ? await e.tx.gestionOrden.findUniqueOrThrow({
              where: { id: sinteticas[0].id },
              select: { cierreId: true, ingresoBodegaRechazo: true },
            })
          : null;
      return {
        mensajeroId: e.mensajeroId,
        adminId: e.adminSateliteId,
        intentosAntes,
        trasCorte,
        aprobacion,
        sinteticas,
        final: {
          tope: { ...final.tope, estatus: mundo.valorDeEstatus.get(final.tope.estatusId) },
          bajo: { ...final.bajo, estatus: mundo.valorDeEstatus.get(final.bajo.estatusId) },
        },
        historialTope,
        siguiente,
        sinteticaTrasSiguiente,
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

  it("precondicion: O tiene exactamente el umbral de intentos y O' uno menos, y el corte barrio las dos", () => {
    expect(r.intentosAntes).toEqual({ tope: UMBRAL, bajo: UMBRAL - 1 });
    expect(r.trasCorte).toEqual({ tope: "sin_gestionar", bajo: "sin_gestionar" });
    expect(r.aprobacion.status).toBe("ok");
  });

  it("O en el tope: `por_devolver_a_tienda` en la MISMA aprobacion, con su mensajero y sin prioridad", () => {
    expect(r.final.tope.estatus).toBe("por_devolver_a_tienda");
    expect(r.final.tope.mensajeroAsignadoId).toBe(r.mensajeroId);
    expect(r.final.tope.prioridad).toBe(false);
    const familias = r.historialTope.map((h) => h.origenTipo);
    expect(familias).toContain("rechazo_tope_intentos");
    expect(familias).toContain("devolucion_rechazada");
  });

  it("O en el tope: UNA gestion sintetica `rechazada`, sin cierre, del mensajero, con el motivo fijo", () => {
    expect(r.sinteticas).toHaveLength(1);
    expect(r.sinteticas[0]).toMatchObject({
      resultado: "rechazada",
      motivo: MOTIVO_RECHAZO_TOPE_INTENTOS,
      mensajeroId: r.mensajeroId,
    });
  });

  it("el SIGUIENTE cierre del mensajero se la lleva y congela `ingreso_bodega_rechazo` = tarifa (164.00)", () => {
    expect(r.siguiente).toMatchObject({ status: "ok", via: "creado" });
    expect(r.sinteticaTrasSiguiente?.cierreId).not.toBeNull();
    expect(r.sinteticaTrasSiguiente?.ingresoBodegaRechazo?.toFixed(2)).toBe("164.00");
  });

  it("O' bajo el umbral: a bodega central, sin mensajero y con `prioridad`", () => {
    expect(r.final.bajo.estatus).toBe("en_bodega_central");
    expect(r.final.bajo.mensajeroAsignadoId).toBeNull();
    expect(r.final.bajo.prioridad).toBe(true);
  });
});
