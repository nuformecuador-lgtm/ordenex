import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { C, CLAVES_EN_ORDEN_DEL_SEED, CLAVES_RESULTADO, R } from "../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS, etiquetasDeEnum } from "../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../454/_escenario";

/**
 * FEATURE 455 (T0.1) — TEST DE HUMO DEL INTERRUPTOR DE CODIGOS.
 *
 * El interruptor (`tests/fixtures/codigos-455.ts`) solo sirve si sus 20 + 5 valores son EXACTAMENTE los
 * codigos que el codigo y la base usan en cada momento. Este test lo afirma hoy (codigos anteriores)
 * y lo volvera a afirmar tras T1.4 (codigos vigentes) sin editarse:
 *  - los 20 valores de `C`, en el orden de `CLAVES_EN_ORDEN_DEL_SEED`, son `ORDER_STATUS_SEED`;
 *  - los 5 de `R` son las etiquetas de `gestion_resultado` en Postgres;
 *  - se siembra UNA orden en cada uno de los 20 estados contra la base real (tx revertida) y se relee.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describe("455/T0.1 — el interruptor coincide con el catalogo del codigo", () => {
  it("los 20 valores de C, en orden, son ORDER_STATUS_SEED", () => {
    expect(CLAVES_EN_ORDEN_DEL_SEED.map((k) => C[k])).toEqual([...ORDER_STATUS_SEED]);
    expect(new Set(Object.keys(C))).toEqual(new Set(CLAVES_EN_ORDEN_DEL_SEED));
  });
});

describeSiHayBase("455/T0.1 — humo del interruptor contra Postgres real", () => {
  let mundo: Mundo;
  let r: { enum: string[]; releidas: string[] };

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await conEscenario(mundo, async (e) => {
      const enumResultado = await etiquetasDeEnum(e.tx as never, "gestion_resultado");
      const releidas: string[] = [];
      for (const clave of CLAVES_EN_ORDEN_DEL_SEED) {
        const o = await e.sembrarOrden({ estatus: C[clave] as never });
        releidas.push(await e.estadoDe(o.ordenId));
      }
      return { enum: enumResultado, releidas };
    });
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("los 5 valores de R son las etiquetas del enum `gestion_resultado`", () => {
    expect(new Set(CLAVES_RESULTADO.map((k) => R[k]))).toEqual(new Set(r.enum));
    expect(r.enum).toHaveLength(5);
  });

  it("se siembra y se relee una orden en cada uno de los 20 estados de C", () => {
    expect(r.releidas).toEqual(CLAVES_EN_ORDEN_DEL_SEED.map((k) => C[k]));
  });
});
