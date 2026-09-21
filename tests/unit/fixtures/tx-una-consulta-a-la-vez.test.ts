import { describe, expect, it } from "vitest";

import { txVigilado } from "@/tests/fixtures/tx-una-consulta-a-la-vez";

/**
 * FICHA 450 (T4.2, R10) — AUTOCOMPROBACION DEL DOBLE QUE CUENTA CONSULTAS EN VUELO.
 *
 * Sin este archivo, `tests/fixtures/tx-una-consulta-a-la-vez.ts` podria no medir nada y los
 * bloques «450» de las dos suites de feed saldrian verdes para siempre. Este repo ya tuvo un arnes
 * de mutaciones que reporto 9/9 supervivientes **dos veces sin haber ejecutado un solo test**: un
 * instrumento sin control positivo no es evidencia, es decoracion.
 *
 * Los dos casos son el control positivo y el negativo del mismo instrumento:
 *   · ante una implementacion sintetica con `Promise.all` sobre el cliente de transaccion, el
 *     doble tiene que MARCAR solape;
 *   · ante la misma implementacion escrita en serie, NO puede marcarlo.
 */

interface TxDePrueba {
  cierreDetail: { findMany: () => Promise<{ ordenId: string }[]> };
  gestionOrden: { findMany: () => Promise<{ ordenId: string }[]> };
}

const RESPUESTAS = {
  "cierreDetail.findMany": [{ ordenId: "o1" }],
  "gestionOrden.findMany": [{ ordenId: "o1" }],
};

/** La forma PROHIBIDA por R3: las dos lecturas a la vez sobre el cliente de la transaccion. */
async function leerEnParalelo(tx: TxDePrueba): Promise<number> {
  const [a, b] = await Promise.all([tx.cierreDetail.findMany(), tx.gestionOrden.findMany()]);
  return a.length + b.length;
}

/** La forma correcta: una consulta a la vez. */
async function leerEnSerie(tx: TxDePrueba): Promise<number> {
  const a = await tx.cierreDetail.findMany();
  const b = await tx.gestionOrden.findMany();
  return a.length + b.length;
}

describe("FICHA 450 · el doble de tx sabe ver un solape (y sabe no inventarselo)", () => {
  it("CONTROL POSITIVO: marca solape ante un `Promise.all` sobre el cliente de transaccion", async () => {
    const vigilado = txVigilado<TxDePrueba>(RESPUESTAS);

    const total = await leerEnParalelo(vigilado.tx);

    expect(total).toBe(2); // anti-vacio: las dos lecturas devolvieron de verdad
    expect(vigilado.llamadas).toEqual(["cierreDetail.findMany", "gestionOrden.findMany"]);
    expect(vigilado.maximoEnVuelo()).toBe(2);
    expect(vigilado.solapes).toHaveLength(1);
    expect(vigilado.solapes[0].delegados).toEqual([
      "cierreDetail.findMany",
      "gestionOrden.findMany",
    ]);
  });

  it("CONTROL NEGATIVO: NO marca solape ante las mismas dos lecturas en serie", async () => {
    const vigilado = txVigilado<TxDePrueba>(RESPUESTAS);

    const total = await leerEnSerie(vigilado.tx);

    expect(total).toBe(2); // las MISMAS dos lecturas: lo unico que cambia es como se esperan
    expect(vigilado.llamadas).toEqual(["cierreDetail.findMany", "gestionOrden.findMany"]);
    expect(vigilado.maximoEnVuelo()).toBe(1);
    expect(vigilado.solapes).toEqual([]);
  });

  it("cuenta tres en vuelo cuando de verdad son tres", async () => {
    const vigilado = txVigilado<TxDePrueba & { cierreDia: { findMany: () => Promise<[]> } }>({
      ...RESPUESTAS,
      "cierreDia.findMany": [],
    });

    await Promise.all([
      vigilado.tx.cierreDetail.findMany(),
      vigilado.tx.gestionOrden.findMany(),
      vigilado.tx.cierreDia.findMany(),
    ]);

    expect(vigilado.maximoEnVuelo()).toBe(3);
    expect(vigilado.solapes).toHaveLength(2); // se anota al llegar la 2.a y al llegar la 3.a
  });

  it("los dobles DELATORES (`extras`) se exponen tal cual y no cuentan como lectura", async () => {
    const delator = { findMany: () => Promise.resolve([]) };
    const vigilado = txVigilado<TxDePrueba & { orden: typeof delator }>(RESPUESTAS, {
      orden: delator,
    });

    await vigilado.tx.cierreDetail.findMany();

    expect(vigilado.tx.orden).toBe(delator);
    expect(vigilado.llamadas).toEqual(["cierreDetail.findMany"]);
  });

  it("una clave mal formada falla ruidosamente en vez de crear un doble mudo", () => {
    expect(() => txVigilado<TxDePrueba>({ findMany: [] })).toThrow(/mal formada/);
  });
});
