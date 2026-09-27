import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "./_escenario";

/**
 * FICHA 454 (T1.4, design §5/§6; R1, R2, R5) — REGISTRAR UNA GESTION NO TRANSICIONA LA ORDEN, contra
 * Postgres real y por el portal real del mensajero (`escogerParaGestion` + `gestionar`).
 *
 *   R1  la gestion se persiste con sus datos (resultado, motivo, causa, desglose de pagos, evidencias)
 *       y la orden SIGUE `en_reparto`, sin ninguna fila en `orden_historial_estado`.
 *   R2  en la MISMA transaccion, UN evento `gestion_registrada` con la orden, la gestion, el
 *       resultado, la causa tipificada, el actor y su rol congelado.
 *   R5  el puntero de gestion en curso se libera y se encola la reoptimizacion inmediata de la ruta.
 *
 * Mutaciones registradas en `progress/impl_454_backend.md` (§Mutaciones T1.4).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("454/T1.4 — registrar una gestion sin transicion (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const entregada = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 8000 });
      const devuelta = await e.sembrarOrden({ estatus: "en_reparto" });

      await e.s.misAsignaciones.escogerParaGestion(entregada.ordenId, e.actorMensajero);
      const punteroAntes = await e.s.gestionRepo.getOrdenEnGestion(e.mensajeroId);
      const jobsAntes = await e.tx.job.count({
        where: { tipo: "optimizacion_ruta", payload: { path: ["mensajeroId"], equals: e.mensajeroId } },
      });
      const rE = await e.gestionar(entregada.ordenId, "entregado", {
        monto: 8000,
        pagos: [
          { metodo: "efectivo", monto: 5000 },
          { metodo: "SINPE", monto: 3000 },
        ],
        escoger: false,
      });
      const punteroDespues = await e.s.gestionRepo.getOrdenEnGestion(e.mensajeroId);
      const jobsDespues = await e.tx.job.count({
        where: { tipo: "optimizacion_ruta", payload: { path: ["mensajeroId"], equals: e.mensajeroId } },
      });
      const rD = await e.gestionar(devuelta.ordenId, "novedad", { causaDevolucion: "wrong_address" });

      const gestion = async (ordenId: string) =>
        e.tx.gestionOrden.findFirstOrThrow({
          where: { ordenId },
          select: {
            id: true,
            resultado: true,
            motivo: true,
            causaDevolucion: true,
            montoRecibido: true,
            cierreId: true,
            anuladaAt: true,
            mensajeroId: true,
            pagos: { select: { metodo: true, monto: true }, orderBy: { monto: "desc" } },
            _count: { select: { evidencias: true } },
          },
        });
      const eventos = (ordenId: string) =>
        e.tx.ordenEvento.findMany({
          where: { ordenId },
          select: {
            tipo: true,
            gestionOrdenId: true,
            resultado: true,
            motivo: true,
            familiaAplicacion: true,
            mensajeroId: true,
            actorUsuarioId: true,
            actorRol: true,
            createdAt: true,
          },
        });
      const gE = await gestion(entregada.ordenId);
      const gD = await gestion(devuelta.ordenId);
      return {
        rE: rE.status,
        rD: rD.status,
        punteroAntes,
        punteroDespues,
        jobsNuevos: jobsDespues - jobsAntes,
        estados: { e: await e.estadoDe(entregada.ordenId), d: await e.estadoDe(devuelta.ordenId) },
        historial: {
          e: await e.historialDe(entregada.ordenId),
          d: await e.historialDe(devuelta.ordenId),
        },
        gE: {
          ...gE,
          montoRecibido: gE.montoRecibido?.toFixed(2) ?? null,
          pagos: gE.pagos.map((p) => `${p.metodo}:${p.monto.toFixed(2)}`),
        },
        gD,
        evE: await eventos(entregada.ordenId),
        evD: await eventos(devuelta.ordenId),
        ids: { entregado: entregada.ordenId, novedad: devuelta.ordenId },
        mensajeroId: e.mensajeroId,
      };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);
  afterAll(async () => {
    await mundo.prisma.$disconnect();
  });

  it("anti-vacuidad: las dos gestiones se registran y el puntero estaba puesto", () => {
    expect(r.rE).toBe("ok");
    expect(r.rD).toBe("ok");
    expect(r.punteroAntes).toBe(r.ids.entregado);
  });

  it("R1: las dos ordenes siguen `en_reparto` y no hay ni una fila de historial", () => {
    expect(r.estados).toEqual({ e: "en_reparto", d: "en_reparto" });
    expect(r.historial).toEqual({ e: [], d: [] });
  });

  it("R1: la gestion guarda sus datos — resultado, cobro, desglose, evidencia; sin cierre ni anulacion", () => {
    expect(r.gE).toEqual({
      id: expect.any(String),
      resultado: "entregado",
      motivo: null,
      causaDevolucion: null,
      montoRecibido: "8000.00",
      cierreId: null,
      anuladaAt: null,
      mensajeroId: r.mensajeroId,
      pagos: ["efectivo:5000.00", "SINPE:3000.00"],
      _count: { evidencias: 1 },
    });
    expect(r.gD).toEqual(
      expect.objectContaining({ resultado: "novedad", motivo: "No aparece", causaDevolucion: "wrong_address", cierreId: null }),
    );
  });

  it("R2: UN evento `gestion_registrada` por gestion, con resultado, causa tipificada, actor y rol congelado", () => {
    expect(r.evE).toEqual([
      {
        tipo: "gestion_registrada",
        gestionOrdenId: r.gE.id,
        resultado: "entregado",
        motivo: null,
        familiaAplicacion: "gestion",
        mensajeroId: r.mensajeroId,
        actorUsuarioId: r.mensajeroId,
        actorRol: "mensajero",
        createdAt: expect.any(Date),
      },
    ]);
    expect(r.evD).toEqual([
      expect.objectContaining({ tipo: "gestion_registrada", gestionOrdenId: r.gD.id, resultado: "novedad", motivo: "wrong_address", familiaAplicacion: "gestion" }),
    ]);
  });

  it("R5: el puntero de gestion en curso queda liberado y se encola la reoptimizacion inmediata", () => {
    expect(r.punteroDespues).toBeNull();
    expect(r.jobsNuevos).toBe(1);
  });
});
