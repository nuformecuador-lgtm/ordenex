import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { ConfirmacionFisicaNoAplicableError } from "@/lib/repositories/CierresAdminRepository";
import { HAY_BASE_DE_DATOS, clienteConSavepoint } from "../../_postgres-real";
import { conEscenario, montarServicios, prepararMundo, type Escenario, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C23 (R60). LA CONFIRMACION FISICA DE LA APROBACION (238), sobre HOY.
 *
 * (1) Por el SERVICIO: aprobar exige confirmar EXACTAMENTE las gestiones que vuelven a bodega (una
 *     menos -> `validation_error`); con la lista exacta aprueba y marca solo esas. El incidente y la
 *     entrega no se marcan.
 * (2) Por el REPOSITORIO (el `WHERE` donde vive la guarda): si a `resolverCierre` le llega un
 *     incidente en la confirmacion, falla cerrado y no marca nada.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/C23 — confirmacion fisica al aprobar (Postgres real)", () => {
  let mundo: Mundo;
  let servicio: Awaited<ReturnType<typeof porServicio>>;
  let repo: Awaited<ReturnType<typeof porRepositorio>>;

  async function jornada(e: Escenario) {
    const g: Record<string, string> = {};
    const numGuia: Record<string, number> = {};
    for (const res of ["entregada", "rechazada", "devuelta", "reprogramada", "incidente"] as const) {
      const o = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: res === "entregada" ? 1000 : 2000 });
      g[res] = await e.gestionarOk(o.ordenId, res, { monto: 1000 });
      numGuia[res] = o.numGuia;
    }
    const cierreId = await e.solicitarCierreOk();
    return { g, numGuia, cierreId };
  }

  const marcadas = (e: Escenario, ids: string[]) =>
    e.tx.gestionOrden.findMany({
      where: { id: { in: ids }, confirmadaFisicaAt: { not: null } },
      select: { id: true },
    });

  function porServicio() {
    return conEscenario(mundo, async (e) => {
      const { g, cierreId } = await jornada(e);
      const alcance = { destinoTipo: "bodega_satelite" as const, destinoZonaId: e.zonaSateliteId };
      const exacta = await e.confirmacionDe(cierreId, alcance);
      const indemn = [{ gestionId: g.incidente, monto: "500.00" }];
      const incompleta = await e.s.cierresAdmin.aprobarCierre(cierreId, e.actorAdminSatelite, indemn, exacta.slice(1));
      const aprobacion = await e.s.cierresAdmin.aprobarCierre(cierreId, e.actorAdminSatelite, indemn, exacta);
      return {
        g,
        esperadas: exacta.map((c) => c.gestionId).sort(),
        incompleta: incompleta.status,
        aprobacion: aprobacion.status,
        marcadas: (await marcadas(e, Object.values(g))).map((m) => m.id).sort(),
      };
    });
  }

  function porRepositorio() {
    return conEscenario(mundo, async (e) => {
      const { g, cierreId } = await jornada(e);
      let error: unknown = null;
      try {
        // Savepoint REAL: el `throw` del repositorio tiene que revertir lo que ya escribio.
        await montarServicios(clienteConSavepoint(e.tx)).adminRepo.resolverCierre({
          cierreId,
          alcance: { destinoTipo: "bodega_satelite", destinoZonaId: e.zonaSateliteId },
          nuevoEstado: "aprobado",
          resueltoPor: e.adminSateliteId,
          motivoRechazo: null,
          // ⏳ 2026-09-23 (FICHA 454, cambio autorizado #4): aqui viajaba `anclajeDevolucion` (239). El
          // design §7.2 lo sustituye por `aplicacionGestiones`, OBLIGATORIO. Solo cambia el argumento;
          // las tres aserciones de abajo son las de siempre.
          aplicacionGestiones: {
            enRepartoId: e.id("en_reparto"),
            destinoPorResultado: {
              entregada: e.id("entregada"),
              reprogramada: e.id("reprogramada"),
              rechazada: e.id("rechazada"),
              devuelta: e.id("devuelta"),
              incidente: e.id("incidente"),
            },
          },
          indemnizaciones: [{ gestionId: g.incidente, monto: "500.00" }],
          confirmacionFisica: [{ gestionId: g.rechazada }, { gestionId: g.incidente }],
        });
      } catch (err) {
        error = err;
      }
      const cierre = await e.tx.cierreDia.findUniqueOrThrow({ where: { id: cierreId }, select: { estado: true } });
      return {
        esFallaCerrada: error instanceof ConfirmacionFisicaNoAplicableError,
        estado: cierre.estado,
        marcadas: (await marcadas(e, Object.values(g))).map((m) => m.id),
      };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    servicio = await porServicio();
    repo = await porRepositorio();
  }, 180_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("el servicio exige la lista EXACTA: con una gestion menos no aprueba", () => {
    expect(servicio.incompleta).toBe("validation_error");
  });

  it("con la lista exacta aprueba y marca SOLO las que vuelven; ni el incidente ni la entrega", () => {
    expect(servicio.aprobacion).toBe("ok");
    expect(servicio.marcadas).toEqual(servicio.esperadas);
    expect(servicio.marcadas).not.toContain(servicio.g.incidente);
    expect(servicio.marcadas).not.toContain(servicio.g.entregada);
    expect(servicio.esperadas).toContain(servicio.g.rechazada);
  });

  it("el repositorio, si le llega un incidente en la confirmacion, falla cerrado y no marca nada", () => {
    expect(repo.esFallaCerrada).toBe(true);
    expect(repo.estado).toBe("solicitado");
    expect(repo.marcadas).toEqual([]);
  });
});
