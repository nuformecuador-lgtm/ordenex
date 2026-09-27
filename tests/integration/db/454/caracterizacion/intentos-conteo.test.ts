import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Escenario, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C03 (R45). EL CONTEO DE INTENTOS DE ENTREGA, sobre el codigo de HOY.
 *
 * Una orden con: `devuelta` en cierre aprobado, `reprogramada` en cierre aprobado, `rechazada`
 * (gestion REAL del mensajero) en cierre `solicitado`, un ESCALADO sintetico vinculado y aprobado y
 * una `devuelta` ANULADA en cierre aprobado. Conteo = 2. Tras aprobar el cierre de la `rechazada`,
 * conteo = 3.
 *
 * Las cuatro gestiones del pasado se siembran como FIXTURE (gestion + su fila de historial, que es
 * exactamente lo que lee el predicado); la tercera nace por el portal real y su cierre se solicita y
 * se aprueba por los servicios reales.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C03 — conteo de intentos de entrega (Postgres real)", () => {
  let mundo: Mundo;
  let r: { antes: number; despues: number; aprobacion: string; estadoCierre: string };

  async function gestionPasada(
    e: Escenario,
    ordenId: string,
    g: { resultado: "novedad" | "reprogramado" | "devolucion_a_origen_por_rechazo"; origenTipo: "gestion" | "escalado_devuelta_sla"; anulada?: boolean },
  ) {
    const cierre = await e.tx.cierreDia.create({
      data: {
        mensajeroId: e.mensajeroId,
        estado: "aprobado",
        destinoTipo: "bodega_satelite",
        destinoZonaId: e.zonaSateliteId,
        solicitadoAt: new Date("2026-09-01T12:00:00.000Z"),
      },
      select: { id: true },
    });
    const gestion = await e.tx.gestionOrden.create({
      data: {
        ordenId,
        mensajeroId: e.mensajeroId,
        resultado: g.resultado,
        cierreId: cierre.id,
        anuladaAt: g.anulada ? new Date("2026-09-02T12:00:00.000Z") : null,
        createdAt: new Date("2026-09-01T10:00:00.000Z"),
      },
      select: { id: true },
    });
    // REVISION 454 (m4): FIXTURE, no asercion. En una base nueva la M3 retiro el destino legado de la
    // `devuelta`; el escenario lo siembra dentro de la tx revertida.
    await e.asegurarRetirados();
    await e.tx.ordenHistorialEstado.create({
      data: {
        ordenId,
        estatusDestinoId: e.id(g.resultado === "novedad" ? "devolucion_por_confirmar" : g.resultado),
        origenTipo: g.origenTipo,
        gestionOrdenId: gestion.id,
        createdAt: new Date("2026-09-01T10:00:00.000Z"),
      },
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await conEscenario(mundo, async (e) => {
      const o = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 6000 });
      await gestionPasada(e, o.ordenId, { resultado: "novedad", origenTipo: "gestion" });
      await gestionPasada(e, o.ordenId, { resultado: "reprogramado", origenTipo: "gestion" });
      await gestionPasada(e, o.ordenId, { resultado: "devolucion_a_origen_por_rechazo", origenTipo: "escalado_devuelta_sla" });
      await gestionPasada(e, o.ordenId, { resultado: "novedad", origenTipo: "gestion", anulada: true });

      await e.gestionarOk(o.ordenId, "devolucion_a_origen_por_rechazo");
      const cierreId = await e.solicitarCierreOk();
      const antes = await e.s.historialService.contarIntentos(o.ordenId);
      const aprobacion = await e.aprobar(cierreId);
      const despues = await e.s.historialService.contarIntentos(o.ordenId);
      const cierre = await e.tx.cierreDia.findUniqueOrThrow({ where: { id: cierreId }, select: { estado: true } });
      return { antes, despues, aprobacion: aprobacion.status, estadoCierre: cierre.estado };
    });
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("con el cierre de la `rechazada` SOLICITADO, cuentan solo la `devuelta` y la `reprogramada` aprobadas: 2", () => {
    expect(r.antes).toBe(2);
  });

  it("al aprobar ese cierre la `rechazada` pasa a contar: 3 (ni el escalado ni la anulada suman)", () => {
    expect(r.aprobacion).toBe("ok");
    expect(r.estadoCierre).toBe("aprobado");
    expect(r.despues).toBe(3);
  });
});
