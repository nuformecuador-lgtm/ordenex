import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { columnasHistorialAcciones } from "@/app/(app)/historico/acciones/_components/historial-acciones-columnas";
import { HistorialAccionRepository } from "@/lib/repositories/HistorialAccionRepository";
import { HistorialAccionService } from "@/lib/services/HistorialAccionService";
import type { HistorialAccionDTO } from "@/lib/types/historial-accion";
import { C, R, claveDe } from "../../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../../454/_escenario";

/**
 * FEATURE 455 — FASE 0 · C16 (R23). EL SNAPSHOT DE LA CORRECCION DE RESULTADO (398).
 *
 * Corregir una gestion `R.entregado -> R.rechazo` en un cierre abierto escribe `historial_accion`
 * (`cierre_dia_gestion_corregida`) con el CODIGO anterior y el nuevo como TEXTO (snapshot: la 455 no lo
 * reescribe, lo traduce al leer). Mundo propio en tx revertida, por los servicios reales: un mensajero de
 * la zona central entrega una orden, solicita el cierre y el maestro corrige.
 * Invariantes: la bitacora tiene UNA fila de la correccion con los dos codigos (leidos en su clave), y la
 * pantalla de `/historico/acciones` la lee por su servicio (`HistorialAccionService.listar`) con los mismos
 * valores.
 * `[INTERMEDIO]` (R23): lo que la columna «Valor anterior/nuevo» PINTA hoy (el codigo crudo). La Fase 1
 * (T1.12) lo traduce al nombre visible.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("455/C16 — snapshot de la correccion de resultado (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const central = await e.mensajeroCentral();
      const a = await e.sembrarOrden({ estatus: C.enReparto as never, montoCobrar: 10000, mensajeroId: central.mensajeroId });
      const gA = await e.gestionarOk(a.ordenId, R.entregado as never, { monto: 10000, actor: central.actor });
      await e.solicitarCierreOk(central.actor);
      const correccion = await e.s.cierresAdmin.corregirResultadoGestion(
        { gestionId: gA, motivo: "El cliente no la recibio" },
        e.actorMaestro,
      );
      const bitacora = await e.tx.historialAccion.findMany({
        where: { entidadId: gA, accion: "cierre_dia_gestion_corregida" },
        select: { valorAnterior: true, valorNuevo: true },
      });
      const pantalla = new HistorialAccionService(new HistorialAccionRepository(e.cliente));
      const listado = await pantalla.listar(
        { accion: ["cierre_dia_gestion_corregida"], actorId: [e.maestroId], pageSize: 50 },
        e.actorMaestro,
      );
      const filas: HistorialAccionDTO[] = listado.status === "ok" ? listado.items : [];
      const pintar = (id: string, f: HistorialAccionDTO): unknown => {
        const render = columnasHistorialAcciones.find((c) => c.id === id)?.render;
        return typeof render === "function" ? render(f) : `sin render: ${String(render)}`;
      };
      const pintado = filas.map((f) => ({ anterior: pintar("anterior", f), nuevo: pintar("nuevo", f) }));
      return {
        correccion: correccion.status,
        bitacora: bitacora.map((b) => ({ anterior: claveDe(b.valorAnterior), nuevo: claveDe(b.valorNuevo) })),
        listado: listado.status,
        leidas: filas.map((f) => ({ anterior: claveDe(f.valorAnterior), nuevo: claveDe(f.valorNuevo) })),
        pintado,
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

  describe("invariantes", () => {
    it("la correccion escribe UNA fila de bitacora entregado -> rechazo", () => {
      expect(r.correccion).toBe("ok");
      expect(r.bitacora).toEqual([{ anterior: "entregado", nuevo: "rechazo" }]);
    });

    it("la pantalla del historico de acciones la lee con los mismos valores", () => {
      expect(r.listado).toBe("ok");
      expect(r.leidas).toEqual([{ anterior: "entregado", nuevo: "rechazo" }]);
    });
  });

  describe("[INTERMEDIO] lo que la 455 cambia por diseño (R23)", () => {
    // Fase 0 (2026-09-24): la columna pinta el CODIGO crudo (viola R3). La Fase 1 (T1.12) traduce al
    // leer y reescribe este bloque con fecha.
    it("la columna pinta hoy el codigo crudo", () => {
      expect(r.pintado).toEqual([{ anterior: R.entregado, nuevo: R.rechazo }]);
    });
  });
});
