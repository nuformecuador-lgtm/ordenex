import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { OrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";
import { valorDeCampo } from "@/lib/types/plantilla-datos";
import { C, CLAVES_EN_ORDEN_DEL_SEED } from "../../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../../454/_escenario";

/**
 * FEATURE 455 — FASE 0 · C15 (R35). LA VARIABLE `{{estatus}}` DE LAS PLANTILLAS DE WHATSAPP.
 *
 * El lector de envio (`OrdenEnvioReader.findParaEnvio`) trae el CODIGO del estado y el catalogo de
 * variables lo transforma en texto (`valorDeCampo("estatus", datos)`). Una orden asignada al mensajero
 * del escenario en CADA uno de los 20 estados, leida por el lector REAL.
 * Invariantes: para los 20, el lector encuentra la orden, entrega el codigo de su estado y la variable
 * se resuelve SIN FALLAR a un texto no vacio que no es el codigo.
 * `[INTERMEDIO]`: el texto producido (hoy el hito publico; la Fase 1, T1.11, lo cambia al nombre).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("455/C15 — variable {{estatus}} de las plantillas (Postgres real)", () => {
  let mundo: Mundo;
  let r: { clave: string; leido: string | null; texto: string | null; error: string | null }[];

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await conEscenario(mundo, async (e) => {
      const lector = new OrdenEnvioReader(e.cliente);
      const salida = [];
      for (const clave of CLAVES_EN_ORDEN_DEL_SEED) {
        const o = await e.sembrarOrden({ estatus: C[clave] as never, montoCobrar: 1000 });
        const datos = await lector.findParaEnvio(o.ordenId, e.mensajeroId);
        let texto: string | null = null;
        let error: string | null = null;
        try {
          texto = datos === null ? null : valorDeCampo("estatus", datos);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        salida.push({ clave, leido: datos?.orden.estatusValue ?? null, texto, error });
      }
      return salida;
    });
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  describe("invariantes", () => {
    it("para los 20 estados el lector entrega el codigo y la variable se resuelve sin fallar", () => {
      expect(r).toHaveLength(20);
      expect(r.map((x) => [x.clave, x.leido, x.error])).toEqual(
        CLAVES_EN_ORDEN_DEL_SEED.map((k) => [k, C[k], null]),
      );
    });

    it("el texto nunca es vacio ni el codigo", () => {
      const malos = r.filter((x) => x.texto === null || x.texto.trim() === "" || x.texto === x.leido);
      expect(malos).toEqual([]);
    });
  });

  describe("[INTERMEDIO] lo que la 455 cambia por diseño (R35)", () => {
    // ⏳ 2026-09-24 (T1.11, Fase 1): REESCRITO. En la Fase 0 la variable producia el HITO publico del
    // rastreo («No fue posible entregarlo»…). Ahora produce el NOMBRE VISIBLE del estado, el mismo
    // que ve la oficina. Literal a mano (tabla §0.1 del spec), no contra `nombreDeEstado`.
    it("el texto de cada estado es su nombre visible", () => {
      expect(Object.fromEntries(r.map((x) => [x.clave, x.texto]))).toEqual({
        entregado: "Entregado",
        novedad: "Novedad",
        devolviendoATienda: "Devolviendo a tienda",
        reprogramado: "Reprogramado",
        enRutaBodegaCentral: "En ruta a bodega central",
        enBodegaCentral: "En bodega central",
        enPreparacion: "En preparación",
        recogiendo: "Mensajero recogiendo en la bodega",
        enRutaBodegaSatelite: "En ruta a bodega satélite",
        enReparto: "En reparto",
        rechazo: "Devolución a origen por rechazo",
        enBodegaSatelite: "En bodega satélite",
        devueltaATienda: "Devuelta a tienda",
        novedadInterna: "Novedad interna",
        porDevolverCentral: "Por devolver a bodega central",
        devolviendoABodegaCentral: "Devolviendo a bodega central",
        porDevolverATienda: "Por devolver a tienda",
        porRecolectarEnTienda: "Por recolectar en tienda",
        incidente: "Incidente",
        recolectando: "Recolectando",
      });
    });
  });
});
