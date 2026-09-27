import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { RastreoPublicoRepository } from "@/lib/repositories/RastreoPublicoRepository";
import { RastreoPublicoService } from "@/lib/services/RastreoPublicoService";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Escenario, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C27 (R31, R40). EL RASTREO PUBLICO Y LAS FILAS HISTORICAS.
 *
 * - Una entrega gestionada y APROBADA: el rastreo muestra el hito confirmado `entregado`.
 * - Filas HISTORICAS (fixture de historial) con destino `devolucion_por_confirmar` se leen
 *   `no_entregado`; con destino `ayuda_tienda`, `en_reparto`. Es lo que R40 exige conservar cuando los
 *   dos valores salgan del catalogo.
 * `[INTERMEDIO]`: el hito justo tras gestionar (hoy ya `entregado`).
 *
 * FICHA 455 (2026-09-24, T1.9, design DF/§4; R31/R34) — TRADUCCION 1:1 DEL VOCABULARIO, no cambio de
 * invariante. La 455 retira los hitos del rastreo: el DTO publica el NOMBRE VISIBLE del estado de
 * cada tramo (`nombreVigente`, `linea[].nombre`) y un estado retirado se pliega a su vigente
 * equivalente (R34). Cada literal de hito se sustituye por el nombre del estado que ese tramo tiene,
 * con la misma forma de asercion (`toEqual` literal, misma longitud): el hito de bodega (fila
 * `en_bodega_central`) -> «En bodega central»; `no_entregado` (fila `devolucion_por_confirmar`,
 * retirado, equivalente `novedad`) -> «Novedad»; `en_reparto` (fila `ayuda_tienda`, retirado,
 * equivalente `en_reparto`) -> «En reparto»; `entregado` -> «Entregado». Lo que R40 de la 454 exige
 * —que la fila historica se siga leyendo, plegada a lo que el destinatario ya veia, y no caiga a un
 * neutral ni al codigo crudo— sigue afirmado.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const TELEFONO = "88880000";

describeSiHayBase("454/C27 — rastreo publico e historial legado (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  async function fila(e: Escenario, ordenId: string, destino: string, minutos: number) {
    // REVISION 454 (m4): FIXTURE, no asercion. Las filas historicas con destino retirado solo
    // existen si el catalogo tiene el estado; en una base nueva lo siembra la tx revertida.
    await e.asegurarRetirados();
    await e.tx.ordenHistorialEstado.create({
      data: {
        ordenId,
        estatusDestinoId: e.id(destino),
        origenTipo: "ajuste_estado",
        createdAt: new Date(Date.UTC(2026, 8, 10, 15, minutos)),
      },
    });
  }

  function correr() {
    return conEscenario(mundo, async (e) => {
      const rastreo = new RastreoPublicoService(new RastreoPublicoRepository(e.cliente));
      const hitos = async (numGuia: number) => {
        const c = await rastreo.consultar(numGuia, TELEFONO);
        return c.estado === "ok" ? { vigente: c.envio.nombreVigente, linea: c.envio.linea.map((l) => l.nombre) } : null;
      };

      const o = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 2000 });
      await fila(e, o.ordenId, "en_reparto", 0);
      await e.gestionarOk(o.ordenId, "entregado", { monto: 2000 });
      const trasGestionar = await hitos(o.numGuia);
      const cierreId = await e.solicitarCierreOk();
      const aprobacion = await e.aprobar(cierreId);
      const trasAprobar = await hitos(o.numGuia);

      const dev = await e.sembrarOrden({ estatus: "novedad", montoCobrar: 1000 });
      await fila(e, dev.ordenId, "en_bodega_central", 0);
      await fila(e, dev.ordenId, "devolucion_por_confirmar", 1);
      const legadoDevolucion = await hitos(dev.numGuia);

      const ay = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      await fila(e, ay.ordenId, "en_bodega_central", 0);
      await fila(e, ay.ordenId, "ayuda_tienda", 1);
      const legadoAyuda = await hitos(ay.numGuia);

      return { trasGestionar, aprobacion: aprobacion.status, trasAprobar, legadoDevolucion, legadoAyuda };
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
    it("tras aprobar, el rastreo muestra el estado confirmado «Entregado»", () => {
      expect(r.aprobacion).toBe("ok");
      expect(r.trasAprobar?.vigente).toBe("Entregado");
      expect(r.trasAprobar?.linea).toEqual(["En reparto", "Entregado"]);
    });

    it("una fila historica con destino `devolucion_por_confirmar` se lee «Novedad» (su equivalente)", () => {
      expect(r.legadoDevolucion?.linea).toEqual(["En bodega central", "Novedad"]);
    });

    it("una fila historica con destino `ayuda_tienda` se lee «En reparto» (su equivalente)", () => {
      expect(r.legadoAyuda?.linea).toEqual(["En bodega central", "En reparto"]);
    });
  });

  describe("[INTERMEDIO] lo que la 454 cambia por diseno", () => {
    it("hoy, justo tras gestionar, el estado vigente publicado ya es «Entregado» (pendiente)", () => {
      expect(r.trasGestionar?.vigente).toBe("Entregado");
    });
  });
});
