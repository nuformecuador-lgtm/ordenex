import { describe, it, expect } from "vitest";

import {
  LIQUIDEZ_POR_CATEGORIA,
  NATURALEZA_POR_CATEGORIA,
  type LiquidezMovimiento,
} from "@/lib/utils/caja-tesoreria";
import {
  CONTRAPARTIDA_EN_CAJA,
  SIN_CONTRAPARTIDA,
  TIPO_POR_CATEGORIA_TIENDA,
} from "@/lib/utils/invariante-tiendas";
import { MAPEO_CONCEPTO_TIENDA } from "@/lib/utils/mapeo-concepto-tienda";
import {
  WALLET_INGRESO_CONCEPTO_SEED,
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  type NaturalezaMovimiento,
  type WalletMovimientoCategoria,
} from "@/lib/types/wallet";
import {
  WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED,
  type WalletTiendaMovimientoCategoria,
} from "@/lib/types/wallet-tienda";

/**
 * FICHA 459 / T A.5 — GUARDIA: **cada concepto de la caja y del libro de las tiendas declara su
 * dueño, si es efectivo o cargo, y su contrapartida en el otro libro** (R9, R90; design §12.3).
 *
 * POR QUE EXISTE. La invariante R8 («De las tiendas» = Σ saldos de las tiendas + cobros de un
 * costo sin reclasificar) no se IMPONE en ninguna parte: se cumple porque cada concepto del libro
 * de una tienda tiene, en la misma transaccion, un asiento en la caja que mueve «De las tiendas»
 * en el mismo sentido y por el mismo importe. Si alguien anade un concepto y se olvida de su
 * pareja —o la declara con el signo cambiado—, la caja y el libro de las tiendas empiezan a
 * divergir en silencio. Esta guardia hace que eso falle en el gate, no en produccion.
 *
 * COMO SE AUTO-COMPRUEBA. Las afirmaciones son de AUSENCIA («no hay ningun problema»), asi que el
 * detector es una funcion propia, `problemasDeClasificacion`, que se ejerce en las DOS
 * direcciones: vacia sobre las tablas reales y NO vacia sobre copias con un par invertido y con
 * un concepto de terceros sin pareja. Sin esa mitad, un detector roto pasaria en verde.
 *
 * La afirmacion 5 (el tipo de cada concepto de la tienda coincide con el CHECK de la base) vive en
 * `tests/integration/db/caja-clasificacion-459.test.ts`: es un hecho del motor.
 */

type Tablas = {
  tipo: Record<WalletTiendaMovimientoCategoria, "credito" | "debito">;
  contrapartida: Record<
    WalletTiendaMovimientoCategoria,
    WalletMovimientoCategoria | typeof SIN_CONTRAPARTIDA
  >;
  naturaleza: Record<WalletMovimientoCategoria, NaturalezaMovimiento>;
  liquidez: Record<WalletMovimientoCategoria, LiquidezMovimiento>;
};

const REALES: Tablas = {
  tipo: TIPO_POR_CATEGORIA_TIENDA,
  contrapartida: CONTRAPARTIDA_EN_CAJA,
  naturaleza: NATURALEZA_POR_CATEGORIA,
  liquidez: LIQUIDEZ_POR_CATEGORIA,
};

/**
 * Cuanto mueve un concepto de la caja «De las tiendas», por unidad de importe (+1, −1 o 0),
 * derivado SOLO de las dos clasificaciones y del prefijo del concepto — la misma informacion con
 * la que `derivarCaja` lo va a sumar:
 *   · un cargo a una tienda la BAJA (es la parte de Ordenex que se descuenta de su saldo);
 *   · un concepto de terceros la sube si es ingreso y la baja si es egreso;
 *   · todo lo demas (propio efectivo) no la toca.
 */
function efectoEnDeLasTiendas(t: Tablas, categoria: WalletMovimientoCategoria): -1 | 0 | 1 {
  if (t.liquidez[categoria] === "cargo_a_tienda") return -1;
  if (t.naturaleza[categoria] === "terceros") return categoria.startsWith("ingreso_") ? 1 : -1;
  return 0;
}

/** Cuanto mueve un concepto del libro de la tienda el saldo de la tienda (+1 credito, −1 debito). */
function efectoEnSaldo(t: Tablas, categoria: WalletTiendaMovimientoCategoria): -1 | 1 {
  return t.tipo[categoria] === "credito" ? 1 : -1;
}

/** Las cinco afirmaciones (1–4 aqui; la 5 en la integracion), como lista de problemas. */
function problemasDeClasificacion(t: Tablas): string[] {
  const problemas: string[] = [];

  // Totalidad en RUNTIME (el compilador ya la exige; esto la hace independiente de `tsc`).
  for (const c of WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED) {
    if (!(c in t.tipo)) problemas.push(`${c}: sin tipo`);
    if (!(c in t.contrapartida)) problemas.push(`${c}: sin contrapartida declarada`);
  }
  for (const c of WALLET_MOVIMIENTO_CATEGORIA_SEED) {
    if (!(c in t.naturaleza)) problemas.push(`${c}: sin dueño`);
    if (!(c in t.liquidez)) problemas.push(`${c}: sin liquidez`);
  }

  // (1) el conjunto sin contrapartida es EXACTAMENTE {cobro_manual, ajuste_debito}.
  const sinPareja = WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.filter(
    (c) => t.contrapartida[c] === SIN_CONTRAPARTIDA,
  ).sort();
  if (JSON.stringify(sinPareja) !== JSON.stringify(["ajuste_debito", "cobro_manual"])) {
    problemas.push(`conjunto sin contrapartida = ${JSON.stringify(sinPareja)}`);
  }

  // (2) cada pareja mueve «De las tiendas» en el MISMO sentido que el saldo de la tienda.
  for (const c of WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED) {
    const par = t.contrapartida[c];
    if (par === SIN_CONTRAPARTIDA) continue;
    const enCaja = efectoEnDeLasTiendas(t, par);
    const enTienda = efectoEnSaldo(t, c);
    if (enCaja !== enTienda) {
      problemas.push(`${c} (${enTienda}) ↔ ${par} (${enCaja}): no mueven igual`);
    }
  }

  // (3) todo concepto de la caja que mueve «De las tiendas» es pareja de EXACTAMENTE uno.
  for (const cat of WALLET_MOVIMIENTO_CATEGORIA_SEED) {
    if (efectoEnDeLasTiendas(t, cat) === 0) continue;
    const parejas = WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.filter(
      (c) => t.contrapartida[c] === cat,
    );
    if (parejas.length !== 1) {
      problemas.push(`${cat} mueve «De las tiendas» y es pareja de ${parejas.length} conceptos`);
    }
  }

  // (4) `cargo_a_tienda` ⇔ los seis del feed, y los seis son ingresos propios.
  const cargos = WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
    (c) => t.liquidez[c] === "cargo_a_tienda",
  ).sort();
  if (JSON.stringify(cargos) !== JSON.stringify([...WALLET_INGRESO_CONCEPTO_SEED].sort())) {
    problemas.push(`cargos a tienda = ${JSON.stringify(cargos)}`);
  }
  for (const c of cargos) {
    if (t.naturaleza[c] !== "propio") problemas.push(`${c}: cargo que no es propio`);
    if (!c.startsWith("ingreso_")) problemas.push(`${c}: cargo que no es ingreso`);
  }

  return problemas;
}

describe("459 — guardia de la clasificacion de la caja y del libro de las tiendas", () => {
  it("R9/R90: sobre las tablas REALES no hay ningun problema", () => {
    expect(problemasDeClasificacion(REALES)).toEqual([]);
  });

  it("(1) literal del contrato: los conceptos de la tienda SIN asiento en la caja", () => {
    // Es el CONTRATO, escrito a mano a proposito: cada concepto que entre aqui es una excepcion
    // nueva a R8 y hay que decidirla (P3 de la 459).
    expect(
      WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.filter(
        (c) => CONTRAPARTIDA_EN_CAJA[c] === SIN_CONTRAPARTIDA,
      ).sort(),
    ).toEqual(["ajuste_debito", "cobro_manual"]);
  });

  it("(4) literal del contrato: los seis cargos a una tienda", () => {
    expect(
      WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
        (c) => LIQUIDEZ_POR_CATEGORIA[c] === "cargo_a_tienda",
      ).sort(),
    ).toEqual([
      "ingreso_comision_cod",
      "ingreso_flete",
      "ingreso_flete_devolucion",
      "ingreso_iva_comision_cod",
      "ingreso_iva_flete",
      "ingreso_iva_flete_devolucion",
    ]);
  });

  it("las parejas de los seis cargos son las del feed del cierre (MAPEO_CONCEPTO_TIENDA)", () => {
    // La tabla de la invariante no puede decir otra cosa que el feed que ESCRIBE los debitos.
    for (const concepto of WALLET_INGRESO_CONCEPTO_SEED) {
      expect(CONTRAPARTIDA_EN_CAJA[MAPEO_CONCEPTO_TIENDA[concepto]]).toBe(concepto);
    }
  });

  describe("contraprueba: el detector SABE encontrar", () => {
    it("un par INVERTIDO (el contra-entrega emparejado con el pago a tienda) → rojo", () => {
      const invertido: Tablas = {
        ...REALES,
        contrapartida: { ...CONTRAPARTIDA_EN_CAJA, cod_recaudado: "egreso_pago_tienda" },
      };
      const p = problemasDeClasificacion(invertido);
      expect(p).toContain("cod_recaudado (1) ↔ egreso_pago_tienda (-1): no mueven igual");
      expect(p).toContain(
        "ingreso_cod_recaudado mueve «De las tiendas» y es pareja de 0 conceptos",
      );
    });

    it("un concepto de TERCEROS sin pareja (la anulacion del pago a tienda) → rojo", () => {
      const sinPareja: Tablas = {
        ...REALES,
        contrapartida: { ...CONTRAPARTIDA_EN_CAJA, ajuste_credito: SIN_CONTRAPARTIDA },
      };
      const p = problemasDeClasificacion(sinPareja);
      expect(p).toContain(
        "ingreso_reverso_pago_tienda mueve «De las tiendas» y es pareja de 0 conceptos",
      );
      expect(p).toContain(
        'conjunto sin contrapartida = ["ajuste_credito","ajuste_debito","cobro_manual"]',
      );
    });

    it("un cargo clasificado como EFECTIVO → rojo (el doble conteo de F2)", () => {
      const cargoComoEfectivo: Tablas = {
        ...REALES,
        liquidez: { ...LIQUIDEZ_POR_CATEGORIA, ingreso_flete: "efectivo" },
      };
      const p = problemasDeClasificacion(cargoComoEfectivo);
      expect(p).toContain("flete (-1) ↔ ingreso_flete (0): no mueven igual");
    });

    it("un tipo de la tienda cambiado → rojo", () => {
      const tipoCambiado: Tablas = {
        ...REALES,
        tipo: { ...TIPO_POR_CATEGORIA_TIENDA, pago_tienda: "credito" },
      };
      expect(problemasDeClasificacion(tipoCambiado)).toContain(
        "pago_tienda (1) ↔ egreso_pago_tienda (-1): no mueven igual",
      );
    });
  });
});
