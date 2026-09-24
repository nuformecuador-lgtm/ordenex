import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { TableroDiaRepository } from "@/lib/repositories/TableroDiaRepository";
import { ventanaDelDiaEnCursoCR } from "@/lib/utils/ventana-dia-cr";
import { etiquetaContador, CLAVES_CONTADOR } from "@/app/(app)/monitoreo/_components/contadores";
import { C, CLAVES_RESULTADO, R } from "../../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../../454/_escenario";

/**
 * FEATURE 455 — FASE 0 · C04 (R46, R52). EL TABLERO DEL DIA: CONTADORES POR RESULTADO Y BUCKETS.
 *
 * `TableroDiaRepository.contarPorMensajero` es SQL crudo que compara `gestion_orden.resultado` con cada
 * codigo de `gestion_resultado` y clasifica por el CODIGO del estado (`por_recoger`, `en_reparto`,
 * resto). Jornada mixta de UN mensajero, todo asignado hoy y por los servicios reales:
 *  - dos gestiones de cada uno de los 5 resultados (10 ordenes);
 *  - tres ordenes en mano (`C.enReparto`) y dos en `C.recogiendo`;
 *  - una orden en `C.novedadInterna` asignada hoy (cae en `otros`).
 * Invariantes (los NOMBRES de las columnas —`entregadas`, `devueltas`…— no cambian con la 455, §9-F):
 * los conteos exactos de la fila del mensajero.
 * `[INTERMEDIO]`: los rotulos de los ocho contadores (R5/R6 los cambian en la Fase 2).
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("455/C04 — tablero del dia (Postgres real)", () => {
  let mundo: Mundo;
  let fila: Record<string, unknown>;

  beforeAll(async () => {
    mundo = await prepararMundo();
    fila = await conEscenario(mundo, async (e) => {
      for (const clave of CLAVES_RESULTADO) {
        for (let i = 0; i < 2; i++) {
          const o = await e.sembrarOrden({ estatus: C.enReparto as never, montoCobrar: 1000 });
          await e.gestionarOk(o.ordenId, R[clave] as never, { monto: 1000 });
        }
      }
      for (let i = 0; i < 3; i++) await e.sembrarOrden({ estatus: C.enReparto as never, montoCobrar: 1000 });
      for (let i = 0; i < 2; i++) await e.sembrarOrden({ estatus: C.recogiendo as never, montoCobrar: 1000 });
      await e.sembrarOrden({ estatus: C.novedadInterna as never, montoCobrar: 1000 });

      const filas = await new TableroDiaRepository(e.cliente).contarPorMensajero(
        ventanaDelDiaEnCursoCR(new Date()),
        { tipo: "global" },
      );
      const mia = filas.find((f) => f.mensajeroId === e.mensajeroId);
      if (mia === undefined) throw new Error("el tablero no devolvio la fila del mensajero del escenario");
      const conteos: Record<string, unknown> = { ...mia };
      delete conteos.mensajeroId;
      delete conteos.mensajeroNombre;
      return conteos;
    });
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  describe("invariantes", () => {
    it("los contadores por RESULTADO del dia: dos de cada, y 16 asignadas", () => {
      expect(fila).toMatchObject({
        asignadas: 16,
        entregadas: 2,
        reprogramadas: 2,
        devueltas: 2,
        rechazadas: 2,
        incidentes: 2,
      });
    });

    it("los buckets sin resultado: 2 sin recoger, 3 en reparto, 1 en otros", () => {
      expect(fila).toMatchObject({ sinRecoger: 2, enReparto: 3, otros: 1 });
    });
  });

  describe("[INTERMEDIO] lo que la 455 cambia por diseño (R5/R6)", () => {
    // Fase 0 (2026-09-24): los rotulos de HOY. La Fase 2 (T2.3) los reescribe con fecha.
    it("los rotulos de los ocho contadores, hoy", () => {
      expect(CLAVES_CONTADOR.map((k) => etiquetaContador(k))).toEqual([
        "Entregadas",
        "Reprogramadas",
        "Devueltas",
        "Rechazadas",
        "Incidentes",
        "Sin recoger",
        "En reparto",
        "Otros",
      ]);
    });
  });
});
