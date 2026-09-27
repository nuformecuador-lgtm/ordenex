import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

import { derivarCaja, derivarComposicionGanancia } from "@/lib/utils/caja-tesoreria";
import {
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  type AgregadoCajaRow,
  type WalletMovimientoCategoria,
} from "@/lib/types/wallet";

/**
 * FICHA 457 / T2.2 — la derivacion con el pago de una tienda a Ordenex y su anulacion (R19, R39; design
 * §4.1). Los literales de partida son los de PRODUCCION medidos el 2026-09-24 (M6 de
 * `progress/medicion_457.md`), los MISMOS de `caja-derivacion-461.test.ts`, escritos A MANO: nunca
 * calculados con `derivarCaja`. El conjunto sin pagos de una tienda tiene que dar EXACTAMENTE lo que daba
 * antes de esta ficha (R73).
 *
 * MUTACIONES que este archivo pone en rojo (design §13): (2) `ingreso_abono_tienda: "propio"` → la ganancia
 * sube; (3) `LIQUIDEZ.ingreso_abono_tienda = "cargo_a_tienda"` → «Entro» no sube.
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

/** El pago real que motiva la ficha: Nuform debe 6 170 666,55 y paga 4 000,00 (design §17). */
const M = "4000.00";

const suma = (...xs: string[]) =>
  xs.reduce((a, x) => a.add(new Prisma.Decimal(x)), new Prisma.Decimal(0)).toFixed(2);
const resta = (a: string, b: string) => new Prisma.Decimal(a).sub(new Prisma.Decimal(b)).toFixed(2);

describe("457/T2.2 — R73: sin pagos de una tienda ni sus anulaciones, la derivacion vale EXACTAMENTE lo de antes", () => {
  const r = derivarCaja(M6_RECLASIFICADO);

  it("las cifras de la 459/461, literal por literal", () => {
    expect(r.entradas).toBe("29059224.00");
    expect(r.salidas).toBe("38245444.50");
    expect(r.enCaja).toBe("-9186220.50");
    expect(r.ganancia).toBe("-4405636.53");
    expect(r.deTerceros).toBe("-4780583.97");
    expect(r.capital).toBe("0.00");
  });
});

describe("457/T2.2 — R19: registrar un pago de M (design §4.1, fila «Registrar»)", () => {
  const antes = derivarCaja(M6_RECLASIFICADO);
  const r = derivarCaja([...M6_RECLASIFICADO, fila("ingreso_abono_tienda", M)]);

  it("«Entro» y la cifra principal suben EXACTAMENTE M; «Salio» no cambia", () => {
    // Mutacion 3 de §13 (`ingreso_abono_tienda` como cargo) → «Entro» se queda en 29 059 224,00 → rojo.
    expect(r.entradas).toBe("29063224.00");
    expect(resta(r.entradas, antes.entradas)).toBe(M);
    expect(r.salidas).toBe(antes.salidas);
    expect(r.enCaja).toBe("-9182220.50");
    expect(resta(r.enCaja, antes.enCaja)).toBe(M);
  });

  it("«De las tiendas» sube EXACTAMENTE M; la ganancia, su composicion y el capital NO cambian (DH1)", () => {
    // Mutacion 2 de §13 (`ingreso_abono_tienda: "propio"`) → la ganancia subiria 4 000,00 → rojo.
    expect(r.deTerceros).toBe("-4776583.97");
    expect(resta(r.deTerceros, antes.deTerceros)).toBe(M);
    expect(r.ganancia).toBe(antes.ganancia);
    expect(r.ingresosPropios).toBe(antes.ingresosPropios);
    expect(r.egresosPropios).toBe(antes.egresosPropios);
    expect(r.capital).toBe(antes.capital);
    const c = derivarComposicionGanancia([...M6_RECLASIFICADO, fila("ingreso_abono_tienda", M)]);
    const c0 = derivarComposicionGanancia(M6_RECLASIFICADO);
    expect(c).toEqual(c0);
  });

  it("R23 (R7): cifra principal = ganancia + «De las tiendas» + capital, al centimo, con el pago dentro", () => {
    expect(suma(r.ganancia, r.deTerceros, r.capital)).toBe(r.enCaja);
    // Y a mano: −4 405 636,53 − 4 776 583,97 + 0 = −9 182 220,50.
    expect(suma("-4405636.53", "-4776583.97", "0.00")).toBe("-9182220.50");
  });
});

describe("457/T2.2 — R39: el pago y su anulacion (design §4.1, fila «Anularlo»)", () => {
  const antes = derivarCaja(M6_RECLASIFICADO);
  const conPago = derivarCaja([...M6_RECLASIFICADO, fila("ingreso_abono_tienda", M)]);
  const r = derivarCaja([
    ...M6_RECLASIFICADO,
    fila("ingreso_abono_tienda", M),
    fila("egreso_reverso_abono_tienda", M),
  ]);

  it("«Salio» sube M; la cifra principal y «De las tiendas» BAJAN M (vuelven a la columna de antes)", () => {
    expect(resta(r.salidas, conPago.salidas)).toBe(M);
    expect(r.salidas).toBe("38249444.50");
    expect(r.entradas).toBe(conPago.entradas); // «Entro» no baja: el pago entro; su reverso SALE
    expect(r.enCaja).toBe(antes.enCaja);
    expect(r.deTerceros).toBe(antes.deTerceros);
  });

  it("la ganancia, su composicion y el capital NO cambian con la anulacion", () => {
    expect(r.ganancia).toBe(antes.ganancia);
    expect(r.capital).toBe(antes.capital);
    expect(derivarComposicionGanancia([
      ...M6_RECLASIFICADO,
      fila("ingreso_abono_tienda", M),
      fila("egreso_reverso_abono_tienda", M),
    ])).toEqual(derivarComposicionGanancia(M6_RECLASIFICADO));
  });

  it("R23 (R7) al centimo con el pago y su reverso dentro", () => {
    expect(suma(r.ganancia, r.deTerceros, r.capital)).toBe(r.enCaja);
  });
});

describe("457/T2.2 — un pago SOLO (la tienda en contra por un cobro): la deuda baja, la ganancia no se mueve", () => {
  it("cobro de 10 000,00 y pago de 4 000,00: «De las tiendas» −6 000,00, ganancia +10 000,00, cifra +4 000,00", () => {
    const r = derivarCaja([fila("ingreso_cobro_tienda", "10000.00"), fila("ingreso_abono_tienda", M)]);
    expect(r.entradas).toBe(M);
    expect(r.salidas).toBe("0.00");
    expect(r.enCaja).toBe(M);
    expect(r.ganancia).toBe("10000.00");
    expect(r.deTerceros).toBe("-6000.00");
    expect(suma(r.ganancia, r.deTerceros, r.capital)).toBe(r.enCaja);
  });
});

/**
 * R7 sobre 500 subconjuntos con semilla fija: la identidad no depende de QUE conceptos haya en el libro.
 * Un generador congruencial lineal (Park–Miller) para que la corrida sea reproducible: si un caso falla,
 * el subconjunto que lo rompe es siempre el mismo.
 */
describe("457/T2.2 — R7 por construccion: identidad sobre 500 subconjuntos con semilla fija", () => {
  const POOL: AgregadoCajaRow[] = [
    ...M6_RECLASIFICADO,
    fila("ingreso_abono_tienda", "4000.00"),
    fila("egreso_reverso_abono_tienda", "4000.00"),
    fila("ingreso_abono_tienda", "6170666.55"),
    fila("ingreso_cobro_tienda", "42000.00"),
    fila("egreso_reverso_cobro_tienda", "42000.00"),
    fila("ingreso_aporte_capital", "1000000.00"),
    fila("egreso_reverso_aporte_capital", "50000.25"),
    fila("ingreso_reverso_pago_tienda", "5000.00"),
    fila("egreso_pago_tienda", "3000.00"),
    fila("ingreso_reverso_pago_por_cuenta_tienda", "1234.56"),
    fila("ingreso_ajuste", "1000.25"),
    fila("egreso_ajuste", "500.10"),
    fila("egreso_gasto_fijo", "80000.00"),
    fila("egreso_gasto", "1.00"),
    // Ficha 458-B: los dos reversos de cargo de la anulacion de un cobro por rechazo.
    fila("egreso_reverso_flete_devolucion", "1000.00"),
    fila("egreso_reverso_iva_flete_devolucion", "130.00"),
  ];

  it("el POOL cubre las 27 categorias del catalogo (anti-vacuidad)", () => {
    const cubiertas = new Set(POOL.map((f) => f.categoria));
    for (const c of WALLET_MOVIMIENTO_CATEGORIA_SEED) expect(cubiertas.has(c), c).toBe(true);
  });

  it("cifra principal = ganancia + «De las tiendas» + capital en los 500 subconjuntos", () => {
    let semilla = 457;
    const siguiente = () => {
      semilla = (semilla * 48271) % 2147483647;
      return semilla;
    };
    let conAbono = 0;
    for (let i = 0; i < 500; i++) {
      const mascara = siguiente();
      const sub = POOL.filter((_, j) => ((mascara >> (j % 31)) & 1) === 1 || siguiente() % 3 === 0);
      if (sub.some((f) => f.categoria === "ingreso_abono_tienda")) conAbono += 1;
      const r = derivarCaja(sub);
      expect(suma(r.ganancia, r.deTerceros, r.capital), `subconjunto ${i}`).toBe(r.enCaja);
      expect(resta(r.entradas, r.salidas), `entradas − salidas ${i}`).toBe(r.enCaja);
    }
    // Anti-vacuidad: el pago de una tienda estuvo dentro en una parte sustancial de los subconjuntos.
    expect(conAbono).toBeGreaterThan(200);
  });
});
