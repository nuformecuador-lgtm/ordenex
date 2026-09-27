import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { reintentosConfig } from "@/lib/config/reintentos";
import { C, R, claveDe } from "../../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Escenario, type Mundo } from "../../454/_escenario";

/**
 * FEATURE 455 — FASE 0 · C09 (R49). EL CONTEO DE INTENTOS Y LA DECISION DEL TOPE (276).
 *
 * El conteo de intentos filtra por una lista de INCLUSION de codigos de resultado
 * (`RESULTADOS_QUE_CUENTAN_COMO_INTENTO`) y el tope decide con ese numero. Dos ordenes en mano del
 * mensajero del escenario, con historial sembrado como fixture (gestion en cierre YA APROBADO + su fila
 * de historial de visita real):
 *  - T («tope»): los resultados que cuentan (`R.novedad`, `R.reprogramado`, `R.rechazo`, en ciclo hasta
 *    llegar al umbral) + los que NO cuentan: `R.entregado` e `R.incidente` aprobados, un escalado
 *    sintetico y una `R.novedad` ANULADA;
 *  - B («bajo»): los mismos, con un intento que cuenta de menos.
 * El corte REAL barre las dos y la aprobacion del `vencido` decide: T termina en rechazo con gestion
 * sintetica y sale a devolucion; B vuelve a bodega con prioridad.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const UMBRAL = reintentosConfig.MIN_INTENTOS_ENTREGA;
const QUE_CUENTAN = [R.novedad, R.reprogramado, R.rechazo] as const;

describeSiHayBase("455/C09 — intentos de entrega y tope 276 (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  async function noCuenta(e: Escenario, ordenId: string, resultado: string, dia: number): Promise<void> {
    const en = new Date(Date.UTC(2026, 7, dia, 16));
    const cierre = await e.tx.cierreDia.create({
      data: {
        mensajeroId: e.mensajeroId,
        estado: "aprobado",
        destinoTipo: "bodega_satelite",
        destinoZonaId: e.zonaSateliteId,
        solicitadoAt: en,
      },
      select: { id: true },
    });
    const g = await e.tx.gestionOrden.create({
      data: { ordenId, mensajeroId: e.mensajeroId, resultado: resultado as never, cierreId: cierre.id, createdAt: en },
      select: { id: true },
    });
    await e.tx.ordenHistorialEstado.create({
      data: { ordenId, estatusDestinoId: e.id(resultado), origenTipo: "gestion", gestionOrdenId: g.id, createdAt: en },
    });
  }

  async function historialDe(e: Escenario, ordenId: string, cuentan: number): Promise<void> {
    for (let i = 0; i < cuentan; i++) {
      await e.sembrarIntentoPasado(ordenId, {
        resultado: QUE_CUENTAN[i % QUE_CUENTAN.length] as never,
        en: new Date(Date.UTC(2026, 8, 1 + i, 16)),
      });
    }
    await noCuenta(e, ordenId, R.entregado, 1);
    await noCuenta(e, ordenId, R.incidente, 2);
    await e.sembrarIntentoPasado(ordenId, {
      resultado: R.rechazo as never,
      origenTipo: "escalado_devuelta_sla",
      en: new Date(Date.UTC(2026, 7, 3, 16)),
    });
    await e.sembrarIntentoPasado(ordenId, {
      resultado: R.novedad as never,
      anulada: true,
      en: new Date(Date.UTC(2026, 7, 4, 16)),
    });
  }

  function correr() {
    return conEscenario(mundo, async (e) => {
      const tope = await e.sembrarOrden({ estatus: C.enReparto as never, montoCobrar: 8000 });
      const bajo = await e.sembrarOrden({ estatus: C.enReparto as never, montoCobrar: 9000 });
      await historialDe(e, tope.ordenId, UMBRAL);
      await historialDe(e, bajo.ordenId, UMBRAL - 1);
      const intentos = {
        tope: await e.s.historialService.contarIntentos(tope.ordenId),
        bajo: await e.s.historialService.contarIntentos(bajo.ordenId),
      };
      const enLote = await e.s.historialService.contarIntentosEnLote([tope.ordenId, bajo.ordenId]);

      const corte = await e.correrCorte(new Date());
      const vencido = await e.tx.cierreDia.findFirst({
        where: { mensajeroId: e.mensajeroId, estado: "vencido" },
        select: { id: true },
      });
      if (vencido === null) throw new Error(`el corte no creo el vencido: ${JSON.stringify(corte)}`);
      await e.solicitarCierre();
      const aprobacion = await e.aprobar(vencido.id);
      const sinteticas = await e.tx.gestionOrden.findMany({
        where: { ordenId: tope.ordenId, cierreId: null },
        select: { resultado: true },
      });
      const final = { tope: await e.ordenDe(tope.ordenId), bajo: await e.ordenDe(bajo.ordenId) };
      return {
        intentos,
        enLote: { tope: enLote.get(tope.ordenId) ?? 0, bajo: enLote.get(bajo.ordenId) ?? 0 },
        aprobacion: aprobacion.status,
        sinteticas: sinteticas.map((s) => claveDe(s.resultado)),
        final: {
          tope: {
            estado: claveDe(mundo.valorDeEstatus.get(final.tope.estatusId)),
            prioridad: final.tope.prioridad,
          },
          bajo: {
            estado: claveDe(mundo.valorDeEstatus.get(final.bajo.estatusId)),
            prioridad: final.bajo.prioridad,
            mensajero: final.bajo.mensajeroAsignadoId,
          },
        },
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

  it("solo cuentan novedad, reprogramado y rechazo de visita real aprobada: T = umbral, B = umbral - 1", () => {
    expect(UMBRAL).toBeGreaterThanOrEqual(2);
    expect(r.intentos).toEqual({ tope: UMBRAL, bajo: UMBRAL - 1 });
    expect(r.enLote).toEqual(r.intentos);
  });

  it("T en el tope: rechazo con UNA gestion sintetica y sale a devolucion a la tienda (orden central)", () => {
    expect(r.aprobacion).toBe("ok");
    expect(r.sinteticas).toEqual(["rechazo"]);
    expect(r.final.tope).toEqual({ estado: "porDevolverATienda", prioridad: false });
  });

  it("B bajo el umbral: vuelve a bodega central, sin mensajero y con prioridad", () => {
    expect(r.final.bajo).toEqual({ estado: "enBodegaCentral", prioridad: true, mensajero: null });
  });
});
