import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { RastreoPublicoRepository } from "@/lib/repositories/RastreoPublicoRepository";
import { RastreoPublicoService } from "@/lib/services/RastreoPublicoService";
import { ETIQUETA_POR_HITO } from "@/lib/types/rastreo-publico";
import { C, R, RETIRADO } from "../../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Escenario, type Mundo } from "../../454/_escenario";

/**
 * FEATURE 455 — FASE 0 · C13 (R31, R34). EL RASTREO PUBLICO: CUANTAS ENTRADAS Y CON QUE FECHAS.
 *
 * Hoy el rastreo proyecta cada fila de historial a un HITO (`HITO_POR_ESTATUS`, por codigo) y fusiona
 * los hitos consecutivos iguales. La 455 lo cambia a NOMBRES de estado, fusionando los nombres
 * consecutivos iguales y plegando los retirados a su equivalente (design §4). Para que el NUMERO de
 * entradas y sus FECHAS sean un invariante de los dos mundos, el historial esta diseñado asi (24 filas,
 * los 20 estados vigentes y los 4 retirados):
 *   - ningun par consecutivo comparte hito HOY ni nombre DESPUES, salvo tres parejas que se fusionan en
 *     los DOS: `RETIRADO.pendiente -> RETIRADO.enFulfillment` (hoy «en proceso» los dos; despues los
 *     dos se pliegan a «En preparacion»),
 *     `enReparto -> ayuda_tienda` (hoy el mismo hito; despues ayuda se pliega a En reparto) y
 *     `novedad -> devolucion_por_confirmar` (hoy el mismo hito; despues se pliega a Novedad).
 * Invariantes: 21 entradas, con la fecha de la PRIMERA fila de cada racha; y en otra orden con una gestion
 * pendiente (454), la ultima entrada es la pendiente.
 * `[INTERMEDIO]`: los textos (hoy hitos; la Fase 1, T1.9, los cambia por nombres).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const TELEFONO = "88880000";

/** Cada paso es un codigo del interruptor: vigente (`C`) o retirado (`RETIRADO`). */
const HISTORIAL: readonly { codigo: string; retirado: boolean }[] = [
  { codigo: RETIRADO.pendiente, retirado: true },
  { codigo: RETIRADO.enFulfillment, retirado: true },
  { codigo: C.enBodegaCentral, retirado: false },
  { codigo: C.enPreparacion, retirado: false },
  { codigo: C.enRutaBodegaCentral, retirado: false },
  { codigo: C.recogiendo, retirado: false },
  { codigo: C.enReparto, retirado: false },
  { codigo: RETIRADO.ayudaTienda, retirado: true },
  { codigo: C.entregado, retirado: false },
  { codigo: C.porRecolectarEnTienda, retirado: false },
  { codigo: C.enRutaBodegaSatelite, retirado: false },
  { codigo: C.enBodegaSatelite, retirado: false },
  { codigo: C.novedad, retirado: false },
  { codigo: RETIRADO.devolucionPorConfirmar, retirado: true },
  { codigo: C.porDevolverCentral, retirado: false },
  { codigo: C.recolectando, retirado: false },
  { codigo: C.devolviendoABodegaCentral, retirado: false },
  { codigo: C.reprogramado, retirado: false },
  { codigo: C.rechazo, retirado: false },
  { codigo: C.porDevolverATienda, retirado: false },
  { codigo: C.novedadInterna, retirado: false },
  { codigo: C.incidente, retirado: false },
  { codigo: C.devolviendoATienda, retirado: false },
  { codigo: C.devueltaATienda, retirado: false },
];
/** Indices (0-based) de las filas que ABREN una racha: las fusionadas son 1, 7 y 13. */
const ABREN_RACHA = HISTORIAL.map((_, i) => i).filter((i) => ![1, 7, 13].includes(i));

function instante(i: number): Date {
  return new Date(Date.UTC(2026, 8, 1, 12, i * 7));
}

describeSiHayBase("455/C13 — rastreo publico (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  /** El catalogo local puede no tener los 4 retirados: se aseguran DENTRO de la tx revertida. */
  async function idRetirado(e: Escenario, value: string): Promise<string> {
    await e.tx.$executeRaw`INSERT INTO "order_status" ("id", "value")
      SELECT gen_random_uuid()::text, ${value}
       WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = ${value})`;
    return (await e.tx.orderStatus.findUniqueOrThrow({ where: { value }, select: { id: true } })).id;
  }

  function correr() {
    return conEscenario(mundo, async (e) => {
      const rastreo = new RastreoPublicoService(new RastreoPublicoRepository(e.cliente));
      const o = await e.sembrarOrden({ estatus: C.devueltaATienda as never, mensajeroId: null });
      for (const [i, paso] of HISTORIAL.entries()) {
        const estatusDestinoId = paso.retirado ? await idRetirado(e, paso.codigo) : e.id(paso.codigo);
        await e.tx.ordenHistorialEstado.create({
          data: { ordenId: o.ordenId, estatusDestinoId, origenTipo: "ajuste_estado", createdAt: instante(i) },
        });
      }
      const esperadas = ABREN_RACHA.length;
      const c = await rastreo.consultar(o.numGuia, TELEFONO);
      const linea = c.estado === "ok" ? c.envio.linea : [];

      // Otra orden con una gestion PENDIENTE (454): la ultima entrada es la pendiente.
      const p = await e.sembrarOrden({ estatus: C.enReparto as never, montoCobrar: 1000 });
      await e.tx.ordenHistorialEstado.create({
        data: { ordenId: p.ordenId, estatusDestinoId: e.id(C.enReparto), origenTipo: "ajuste_estado", createdAt: instante(0) },
      });
      await e.gestionarOk(p.ordenId, R.rechazo as never);
      const cp = await rastreo.consultar(p.numGuia, TELEFONO);
      const lineaPendiente = cp.estado === "ok" ? cp.envio.linea : [];

      // Fechas publicadas de cada fila SOLA (misma orden de una fila por consulta), para comparar
      // las fechas de la linea fusionada con las de la PRIMERA fila de cada racha sin reformatear.
      const fechaSola: string[] = [];
      for (const i of ABREN_RACHA) {
        const sola = await e.sembrarOrden({ estatus: C.enReparto as never, mensajeroId: null });
        await e.tx.ordenHistorialEstado.create({
          data: { ordenId: sola.ordenId, estatusDestinoId: e.id(C.enReparto), origenTipo: "ajuste_estado", createdAt: instante(i) },
        });
        const cs = await rastreo.consultar(sola.numGuia, TELEFONO);
        fechaSola.push(cs.estado === "ok" ? cs.envio.linea[0]?.fecha ?? "∅" : `no:${cs.estado}`);
      }

      return {
        estado: c.estado,
        entradas: linea.length,
        esperadas,
        fechas: linea.map((l) => l.fecha),
        fechaSola,
        vigente: c.estado === "ok" ? c.envio.actualizadoEn : "∅",
        textos: linea.map((l) => ETIQUETA_POR_HITO[l.hito]),
        pendiente: {
          entradas: lineaPendiente.length,
          ultimaPendiente: lineaPendiente[lineaPendiente.length - 1]?.pendiente === true,
          nombreResultado: lineaPendiente[lineaPendiente.length - 1]?.nombreResultado ?? "∅",
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

  describe("invariantes", () => {
    it("24 filas de historial se publican como 21 entradas", () => {
      expect(r.estado).toBe("ok");
      expect(r.esperadas).toBe(21);
      expect(r.entradas).toBe(21);
    });

    it("cada entrada lleva la fecha de la PRIMERA fila de su racha, y la vigente es la ultima", () => {
      expect(r.fechas).toEqual(r.fechaSola);
      expect(r.vigente).toBe(r.fechas[r.fechas.length - 1]);
    });

    it("con una gestion pendiente (454), la ultima entrada es la pendiente", () => {
      expect(r.pendiente.entradas).toBe(2);
      expect(r.pendiente.ultimaPendiente).toBe(true);
    });
  });

  describe("[INTERMEDIO] lo que la 455 cambia por diseño (R31, R33, R34)", () => {
    // Fase 0 (2026-09-24): los textos de HOY son los nueve hitos de la 229 y la entrada pendiente lleva
    // la copia `NOMBRE_RESULTADO_PENDIENTE` de la 454. La Fase 1 (T1.9) los cambia por nombres de estado.
    it("los textos de la linea, hoy (hitos)", () => {
      expect(r.textos).toEqual([
        "En proceso",
        "En nuestras instalaciones",
        "Envío registrado",
        "En tránsito",
        "En nuestras instalaciones",
        "En reparto",
        "Entregado",
        "Envío registrado",
        "En tránsito",
        "En nuestras instalaciones",
        "No fue posible entregarlo",
        "En devolución a la tienda",
        "Envío registrado",
        "En devolución a la tienda",
        "Entrega reprogramada",
        "No fue posible entregarlo",
        "En devolución a la tienda",
        "En reparto",
        "No fue posible entregarlo",
        "En devolución a la tienda",
        "Devuelto a la tienda",
      ]);
    });

    it("el nombre del resultado pendiente, hoy", () => {
      expect(r.pendiente.nombreResultado).toBe("Rechazada");
    });
  });
});
