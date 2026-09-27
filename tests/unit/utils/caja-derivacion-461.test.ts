import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

import { derivarCaja, derivarComposicionGanancia } from "@/lib/utils/caja-tesoreria";
import {
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  type AgregadoCajaRow,
  type WalletMovimientoCategoria,
} from "@/lib/types/wallet";

/**
 * FICHA 461 / T A.2 — la derivacion con el cobro de Ordenex a una tienda y su reverso
 * (R22, R23, R24, R28; design §2.2).
 *
 * Los literales son los de PRODUCCION medidos el 2026-09-24 (M6 de `progress/medicion_457.md`) y
 * las columnas de design §2.4, escritos A MANO: nunca calculados con `derivarCaja`. El conjunto sin
 * cobros (M6 + los 203 reclasificados) tiene que dar EXACTAMENTE lo que daba antes de esta ficha
 * (R28): son los literales de `caja-derivacion-459.test.ts`, repetidos aqui a proposito.
 *
 * MUTACIONES que este archivo pone en rojo (design §14.2): (2) `ingreso_cobro_tienda` como efectivo
 * sube «Entro» y rompe R7 en «Entro»; (3) `egreso_reverso_cobro_tienda` como efectivo sube «Salio».
 */

const fila = (categoria: WalletMovimientoCategoria, total: string): AgregadoCajaRow => ({
  categoria,
  tipo: categoria.startsWith("ingreso_") ? "ingreso" : "egreso",
  total,
});

/** El libro de la caja de produccion, agregado por concepto (M6, 2026-09-24) + los 203 reclasificados. */
const M6_RECLASIFICADO: AgregadoCajaRow[] = [
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
  fila("egreso_pago_por_cuenta_tienda", "25769034.50"),
];

/** El cobro del humano en preview (design §2.5): 42 000,00. */
const COBRO = "42000.00";

const suma = (...xs: string[]) =>
  xs.reduce((a, x) => a.add(new Prisma.Decimal(x)), new Prisma.Decimal(0)).toFixed(2);

describe("461/A.2 — R28: sin cobros ni reversos, la derivacion vale EXACTAMENTE lo de la 459", () => {
  const r = derivarCaja(M6_RECLASIFICADO);

  it("las cinco cifras de la columna 3 de design §2.4 de la 459, literal por literal", () => {
    expect(r.entradas).toBe("29059224.00");
    expect(r.salidas).toBe("38245444.50");
    expect(r.enCaja).toBe("-9186220.50");
    expect(r.ganancia).toBe("-4405636.53");
    expect(r.deTerceros).toBe("-4780583.97");
    expect(r.capital).toBe("0.00");
    expect(r.modoComposicion).toBe("sin_reparto");
  });

  it("la composicion de la ganancia tampoco se mueve: las filas nuevas valen 0,00", () => {
    const c = derivarComposicionGanancia(M6_RECLASIFICADO);
    expect(c.totalIngresos).toBe("8070773.47");
    expect(c.totalEgresos).toBe("12476410.00");
    expect(c.ingresos.ingreso_cobro_tienda).toBe("0.00");
    expect(c.egresos.egreso_reverso_cobro_tienda).toBe("0.00");
  });
});

describe("461/A.2 — R22/R23/R24: un cobro de 42 000,00 (design §2.5)", () => {
  const r = derivarCaja([...M6_RECLASIFICADO, fila("ingreso_cobro_tienda", COBRO)]);

  it("R22: NO cuenta en «Entro» ni en «Salio»; la cifra principal NO cambia", () => {
    // Mutacion 2 de §14.2 (`ingreso_cobro_tienda: "efectivo"`) → «Entro» 29 101 224,00 → rojo.
    expect(r.entradas).toBe("29059224.00");
    expect(r.salidas).toBe("38245444.50");
    expect(r.enCaja).toBe("-9186220.50");
  });

  it("R4/R23: la ganancia sube EXACTAMENTE en el monto y «De las tiendas» baja lo mismo", () => {
    // −4 405 636,53 + 42 000,00 = −4 363 636,53 ; −4 780 583,97 − 42 000,00 = −4 822 583,97
    expect(r.ganancia).toBe("-4363636.53");
    expect(r.ingresosPropios).toBe("8112773.47"); // 8 070 773,47 + 42 000,00
    expect(r.deTerceros).toBe("-4822583.97");
    expect(r.capital).toBe("0.00");
  });

  it("R24: R7 al centimo con el cobro dentro", () => {
    expect(suma(r.ganancia, r.deTerceros, r.capital)).toBe(r.enCaja);
    // Y a mano: −4 363 636,53 − 4 822 583,97 + 0 = −9 186 220,50.
    expect(suma("-4363636.53", "-4822583.97", "0.00")).toBe("-9186220.50");
  });

  it("R27: el cobro es una fila PROPIA de ingresos de la composicion, y el total sigue siendo `ingresosPropios`", () => {
    const c = derivarComposicionGanancia([...M6_RECLASIFICADO, fila("ingreso_cobro_tienda", COBRO)]);
    expect(c.ingresos.ingreso_cobro_tienda).toBe("42000.00");
    expect(c.totalIngresos).toBe("8112773.47");
    expect(c.totalIngresos).toBe(r.ingresosPropios);
  });
});

describe("461/A.2 — R22/R23/R24: el cobro y su anulacion (design §2.5)", () => {
  const r = derivarCaja([
    ...M6_RECLASIFICADO,
    fila("ingreso_cobro_tienda", COBRO),
    fila("egreso_reverso_cobro_tienda", COBRO),
  ]);

  it("R22: el reverso NO cuenta en «Salio»; «Entro» y la cifra principal, intactos", () => {
    // Mutacion 3 de §14.2 (`egreso_reverso_cobro_tienda: "efectivo"`) → «Salio» 38 287 444,50 → rojo.
    expect(r.entradas).toBe("29059224.00");
    expect(r.salidas).toBe("38245444.50");
    expect(r.enCaja).toBe("-9186220.50");
  });

  it("R12/R23: todo vuelve a la columna 3: ganancia y «De las tiendas» como sin el cobro", () => {
    expect(r.ganancia).toBe("-4405636.53");
    expect(r.deTerceros).toBe("-4780583.97");
    // Y los dos brutos si lo llevan dentro: el cobro como ingreso propio, el reverso como egreso propio.
    expect(r.ingresosPropios).toBe("8112773.47");
    expect(r.egresosPropios).toBe("12518410.00"); // 12 476 410,00 + 42 000,00
  });

  it("R24: R7 al centimo con el cobro y su reverso dentro", () => {
    expect(suma(r.ganancia, r.deTerceros, r.capital)).toBe(r.enCaja);
  });

  it("R27: el reverso es una fila PROPIA de egresos nombrada; los totales siguen siendo los propios", () => {
    const c = derivarComposicionGanancia([
      ...M6_RECLASIFICADO,
      fila("ingreso_cobro_tienda", COBRO),
      fila("egreso_reverso_cobro_tienda", COBRO),
    ]);
    expect(c.egresos.egreso_reverso_cobro_tienda).toBe("42000.00");
    expect(c.totalEgresos).toBe("12518410.00");
    expect(c.totalEgresos).toBe(r.egresosPropios);
    expect(c.otrosEgresos).toBe("0.00"); // no cae en «Otros»
  });
});

describe("461/A.2 — un cobro SOLO (sin contra-entrega): la tienda queda en contra", () => {
  it("R5/R23: sobre una caja vacia, el cobro deja «De las tiendas» negativa y la ganancia positiva, con cifra 0,00", () => {
    const r = derivarCaja([fila("ingreso_cobro_tienda", "2500.50")]);
    expect(r.entradas).toBe("0.00");
    expect(r.salidas).toBe("0.00");
    expect(r.enCaja).toBe("0.00");
    expect(r.ganancia).toBe("2500.50");
    expect(r.deTerceros).toBe("-2500.50");
    expect(r.signoDeTerceros).toBe("negativo");
    expect(r.deTercerosAbsoluto).toBe("2500.50");
    // R7: 2 500,50 − 2 500,50 + 0 = 0,00.
    expect(suma(r.ganancia, r.deTerceros, r.capital)).toBe(r.enCaja);
  });
});

describe("461/A.2 — R24: R7 sobre subconjuntos al azar CON los conceptos nuevos (semilla fija)", () => {
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

  it("R7 al centimo en 500 conjuntos; el cobro y su reverso entran en al menos 100 de ellos", () => {
    const azar = prng(461);
    let comprobados = 0;
    let conCobro = 0;
    let conReverso = 0;
    for (let n = 0; n < 500; n += 1) {
      const filas: AgregadoCajaRow[] = [];
      for (const categoria of WALLET_MOVIMIENTO_CATEGORIA_SEED) {
        if (azar() < 0.4) continue;
        // Importe en CENTIMOS enteros, llevado a escala 2 con Decimal: sin un solo float de dinero.
        const centimos = Math.floor(azar() * 100_000_000);
        filas.push(fila(categoria, new Prisma.Decimal(centimos).div(100).toFixed(2)));
      }
      if (filas.some((f) => f.categoria === "ingreso_cobro_tienda")) conCobro += 1;
      if (filas.some((f) => f.categoria === "egreso_reverso_cobro_tienda")) conReverso += 1;
      const r = derivarCaja(filas, { periodoFiltrado: azar() < 0.5 });
      expect(suma(r.ganancia, r.deTerceros, r.capital), `conjunto ${n}`).toBe(r.enCaja);
      expect(suma(r.deOrdenex, r.deTerceros), `conjunto ${n}`).toBe(r.enCaja);
      // Y ni el cobro ni su reverso estan en «Entro»/«Salio»: la cifra es la de los efectivos solos.
      const efectivos = derivarCaja(
        filas.filter(
          (f) => f.categoria !== "ingreso_cobro_tienda" && f.categoria !== "egreso_reverso_cobro_tienda",
        ),
      );
      expect(r.entradas, `conjunto ${n} · Entro`).toBe(efectivos.entradas);
      expect(r.salidas, `conjunto ${n} · Salio`).toBe(efectivos.salidas);
      expect(r.enCaja, `conjunto ${n} · cifra`).toBe(efectivos.enCaja);
      comprobados += 1;
    }
    expect(comprobados).toBe(500);
    // Anti-vacuidad: los conceptos nuevos SI entraron en la muestra.
    expect(conCobro).toBeGreaterThan(100);
    expect(conReverso).toBeGreaterThan(100);
  });
});
