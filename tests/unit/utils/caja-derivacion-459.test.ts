import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

import { derivarCaja, derivarComposicionGanancia } from "@/lib/utils/caja-tesoreria";
import {
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  type AgregadoCajaRow,
  type WalletMovimientoCategoria,
} from "@/lib/types/wallet";

/**
 * FICHA 459 / T A.2 — la derivacion nueva de la caja (R1–R7, R10, R11; design §2.2–§2.4).
 *
 * Los literales son los de PRODUCCION medidos el 2026-09-24 (M6 de `progress/medicion_457.md`) y
 * las columnas 2 y 3 de design §2.4, escritos A MANO: nunca calculados con `derivarCaja`.
 */

const fila = (categoria: WalletMovimientoCategoria, total: string): AgregadoCajaRow => ({
  categoria,
  tipo: categoria.startsWith("ingreso_") ? "ingreso" : "egreso",
  total,
});

/** El libro de la caja de produccion, agregado por concepto (M6, 2026-09-24). */
const M6: AgregadoCajaRow[] = [
  fila("ingreso_cod_recaudado", "29059224.00"),
  fila("ingreso_flete", "4372000.00"),
  fila("ingreso_comision_cod", "1017074.04"),
  fila("ingreso_flete_devolucion", "1753200.00"),
  fila("ingreso_iva_flete", "568360.00"),
  fila("ingreso_iva_comision_cod", "132223.43"),
  fila("ingreso_iva_flete_devolucion", "227916.00"),
  fila("egreso_sueldo", "8871709.00"),
  fila("egreso_pago_mensajero", "3439700.00"),
  fila("egreso_gasto_variable", "165000.00"),
  fila("egreso_indemnizacion", "1.00"),
];

describe("459/A.2 — la caja de produccion (M6) con la formula nueva, sin reclasificar", () => {
  const r = derivarCaja(M6);

  it("R2/R3: Entro 29 059 224,00 (solo el contra-entrega), Salio 12 476 410,00, cifra 16 582 814,00", () => {
    // Hoy la app dice Entro 37 129 997,47 y «Dinero en caja» 24 653 587,47: le sobran
    // 8 070 773,47, exactamente la suma de los seis cargos (F2).
    expect(r.entradas).toBe("29059224.00");
    expect(r.salidas).toBe("12476410.00");
    expect(r.enCaja).toBe("16582814.00");
    expect(r.signoEnCaja).toBe("positivo");
  });

  it("R4: la ganancia vale EXACTAMENTE lo mismo que antes: −4 405 636,53", () => {
    // 8 070 773,47 de cargos (ingresos propios) − 12 476 410,00 de egresos propios.
    expect(r.ingresosPropios).toBe("8070773.47");
    expect(r.egresosPropios).toBe("12476410.00");
    expect(r.ganancia).toBe("-4405636.53");
  });

  it("R5: «De las tiendas» = 29 059 224,00 − 8 070 773,47 = 20 988 450,53", () => {
    expect(r.deTerceros).toBe("20988450.53");
    expect(r.signoDeTerceros).toBe("positivo");
    expect(r.deTercerosAbsoluto).toBe("20988450.53");
  });

  it("R6/R11: capital 0,00 y «De Ordenex» = la ganancia", () => {
    expect(r.capital).toBe("0.00");
    expect(r.signoCapital).toBe("cero");
    expect(r.deOrdenex).toBe("-4405636.53");
  });

  it("R7: −4 405 636,53 + 20 988 450,53 + 0 = 16 582 814,00", () => {
    expect(
      new Prisma.Decimal(r.ganancia).add(r.deTerceros).add(r.capital).toFixed(2),
    ).toBe(r.enCaja);
  });

  it("R11: la barra se reparte sobre «De Ordenex» (negativo) y «De las tiendas» → solo_tiendas", () => {
    expect(r.modoComposicion).toBe("solo_tiendas");
    expect(r.porcentajeTiendas).toBe("100.00");
  });

  it("R4/R93: la composicion de la ganancia no cambia (misma entrada, misma funcion)", () => {
    const c = derivarComposicionGanancia(M6);
    expect(c.totalIngresos).toBe("8070773.47");
    expect(c.totalEgresos).toBe("12476410.00");
  });
});

describe("459/A.2 — R7 sobre subconjuntos al azar (semilla fija)", () => {
  /** mulberry32: PRNG determinista, para que un rojo se pueda reproducir. */
  function prng(semilla: number): () => number {
    let a = semilla >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("R7: cifra principal = ganancia + «De las tiendas» + capital, al centimo, en 500 conjuntos", () => {
    const azar = prng(459);
    let comprobados = 0;
    for (let n = 0; n < 500; n += 1) {
      const filas: AgregadoCajaRow[] = [];
      for (const categoria of WALLET_MOVIMIENTO_CATEGORIA_SEED) {
        if (azar() < 0.4) continue;
        // Importe en CENTIMOS enteros, llevado a escala 2 con Decimal: sin un solo float de dinero.
        const centimos = Math.floor(azar() * 100_000_000);
        filas.push(fila(categoria, new Prisma.Decimal(centimos).div(100).toFixed(2)));
      }
      const r = derivarCaja(filas, { periodoFiltrado: azar() < 0.5 });
      const suma = new Prisma.Decimal(r.ganancia).add(r.deTerceros).add(r.capital);
      expect(suma.toFixed(2), `conjunto ${n}`).toBe(r.enCaja);
      expect(
        new Prisma.Decimal(r.deOrdenex).add(r.deTerceros).toFixed(2),
        `conjunto ${n}`,
      ).toBe(r.enCaja);
      comprobados += 1;
    }
    expect(comprobados).toBe(500);
  });
});

describe("459/A.2 — R10: la derivacion no escribe nada", () => {
  it("es pura: no muta la entrada y da lo mismo dos veces", () => {
    const copia = structuredClone(M6);
    const a = derivarCaja(M6);
    const b = derivarCaja(M6);
    expect(M6).toEqual(copia);
    expect(a).toEqual(b);
  });
});
