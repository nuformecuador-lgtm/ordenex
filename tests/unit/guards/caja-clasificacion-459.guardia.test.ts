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
 * POR QUE EXISTE. La invariante R8 («De las tiendas» = Σ saldos de las tiendas) no se IMPONE en
 * ninguna parte: se cumple porque cada concepto del libro de una tienda tiene, en la misma
 * transaccion, un asiento en la caja que mueve «De las tiendas» en el mismo sentido y por el mismo
 * importe. Si alguien anade un concepto y se olvida de su pareja —o la declara con el signo
 * cambiado—, la caja y el libro de las tiendas empiezan a divergir en silencio. Esta guardia hace
 * que eso falle en el gate, no en produccion.
 *
 * FICHA 461 / T A.3 (R26; design §14.3) — EL CONTRATO CAMBIA, a proposito y con estos literales:
 *   (1) el conjunto sin contrapartida es EXACTAMENTE `["ajuste_debito"]`: el cobro de Ordenex a una
 *       tienda (`cobro_manual`) gana su cargo (`ingreso_cobro_tienda`) y la excepcion HF6 de la 459
 *       desaparece (HD2);
 *   (4) los cargos son los seis del feed MAS `ingreso_cobro_tienda` y `egreso_reverso_cobro_tienda`,
 *       todos `propio`, y el SIGNO de su efecto en «De las tiendas» lo da el PREFIJO: un cargo
 *       `ingreso_` la baja (−1) y un reverso de cargo `egreso_` la sube (+1). Un cargo ya no tiene
 *       que ser un ingreso: la liquidez «cargo» vale tambien para egresos (P1 de la 461).
 * Contraprueba nueva: un reverso de cargo clasificado como efectivo → rojo.
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
 *   · un cargo a una tienda (`ingreso_` con liquidez «cargo») la BAJA: es la parte de Ordenex que
 *     se descuenta de su saldo;
 *   · un REVERSO de cargo (`egreso_` con liquidez «cargo», ficha 461) la SUBE: le devuelve el saldo;
 *   · un concepto de terceros la sube si es ingreso y la baja si es egreso;
 *   · todo lo demas (propio efectivo) no la toca.
 */
function efectoEnDeLasTiendas(t: Tablas, categoria: WalletMovimientoCategoria): -1 | 0 | 1 {
  if (t.liquidez[categoria] === "cargo_a_tienda") return categoria.startsWith("ingreso_") ? -1 : 1;
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

  // (1) el conjunto sin contrapartida es EXACTAMENTE {ajuste_debito} (ficha 461: el cobro ya tiene
  // su cargo en la caja).
  const sinPareja = WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.filter(
    (c) => t.contrapartida[c] === SIN_CONTRAPARTIDA,
  ).sort();
  if (JSON.stringify(sinPareja) !== JSON.stringify(["ajuste_debito"])) {
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

  // (4) `cargo_a_tienda` ⇔ los seis del feed MAS el cobro de Ordenex a una tienda y su reverso
  // (ficha 461), y todos son propios. Un cargo `egreso_` es un REVERSO de cargo: se admite, y su
  // signo lo da el prefijo (ver `efectoEnDeLasTiendas`).
  const cargos = WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
    (c) => t.liquidez[c] === "cargo_a_tienda",
  ).sort();
  const cargosEsperados = [
    ...WALLET_INGRESO_CONCEPTO_SEED,
    "ingreso_cobro_tienda",
    "egreso_reverso_cobro_tienda",
    // Ficha 458-B (design §2.3): los dos reversos de cargo de la anulacion del cobro por rechazo.
    "egreso_reverso_flete_devolucion",
    "egreso_reverso_iva_flete_devolucion",
  ].sort();
  if (JSON.stringify(cargos) !== JSON.stringify(cargosEsperados)) {
    problemas.push(`cargos a tienda = ${JSON.stringify(cargos)}`);
  }
  for (const c of cargos) {
    if (t.naturaleza[c] !== "propio") problemas.push(`${c}: cargo que no es propio`);
  }

  return problemas;
}

describe("459 — guardia de la clasificacion de la caja y del libro de las tiendas", () => {
  it("R9/R90: sobre las tablas REALES no hay ningun problema", () => {
    expect(problemasDeClasificacion(REALES)).toEqual([]);
  });

  it("(1) literal del contrato: los conceptos de la tienda SIN asiento en la caja", () => {
    // Es el CONTRATO, escrito a mano a proposito: cada concepto que entre aqui es una excepcion
    // nueva a R8 y hay que decidirla. Ficha 461 (HD2, R25/R26): el cobro de Ordenex a una tienda
    // SALE de esta lista —tiene su cargo `ingreso_cobro_tienda`— y R8 vale sin excepcion.
    expect(
      WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED.filter(
        (c) => CONTRAPARTIDA_EN_CAJA[c] === SIN_CONTRAPARTIDA,
      ).sort(),
    ).toEqual(["ajuste_debito"]);
  });

  it("(4) literal del contrato: los diez cargos a una tienda (seis del feed, el cobro y su reverso, y los dos reversos del cobro por rechazo de la 458-B)", () => {
    expect(
      WALLET_MOVIMIENTO_CATEGORIA_SEED.filter(
        (c) => LIQUIDEZ_POR_CATEGORIA[c] === "cargo_a_tienda",
      ).sort(),
    ).toEqual([
      "egreso_reverso_cobro_tienda",
      "egreso_reverso_flete_devolucion", // ficha 458-B
      "egreso_reverso_iva_flete_devolucion", // ficha 458-B
      "ingreso_cobro_tienda",
      "ingreso_comision_cod",
      "ingreso_flete",
      "ingreso_flete_devolucion",
      "ingreso_iva_comision_cod",
      "ingreso_iva_flete",
      "ingreso_iva_flete_devolucion",
    ]);
  });

  it("⭑ 461 (R22/R23): el cobro y su reverso son propios y mueven «De las tiendas» con signos opuestos", () => {
    expect(NATURALEZA_POR_CATEGORIA.ingreso_cobro_tienda).toBe("propio");
    expect(NATURALEZA_POR_CATEGORIA.egreso_reverso_cobro_tienda).toBe("propio");
    expect(efectoEnDeLasTiendas(REALES, "ingreso_cobro_tienda")).toBe(-1);
    expect(efectoEnDeLasTiendas(REALES, "egreso_reverso_cobro_tienda")).toBe(1);
    // Y son las parejas de `cobro_manual` y `cobro_tienda_anulado` en el libro de la tienda.
    expect(CONTRAPARTIDA_EN_CAJA.cobro_manual).toBe("ingreso_cobro_tienda");
    expect(CONTRAPARTIDA_EN_CAJA.cobro_tienda_anulado).toBe("egreso_reverso_cobro_tienda");
    expect(TIPO_POR_CATEGORIA_TIENDA.cobro_tienda_anulado).toBe("credito");
  });

  it("⭑ 458-B (R68/R91, design §2.3): los dos reversos del cobro por rechazo son propios, reversos de cargo y suben «De las tiendas»", () => {
    for (const c of ["egreso_reverso_flete_devolucion", "egreso_reverso_iva_flete_devolucion"] as const) {
      expect(NATURALEZA_POR_CATEGORIA[c]).toBe("propio");
      expect(LIQUIDEZ_POR_CATEGORIA[c]).toBe("cargo_a_tienda");
      expect(efectoEnDeLasTiendas(REALES, c)).toBe(1);
    }
    // Y son las parejas de los dos creditos espejo del libro de la tienda (contrapartidas +2).
    expect(CONTRAPARTIDA_EN_CAJA.flete_devolucion_anulado).toBe("egreso_reverso_flete_devolucion");
    expect(CONTRAPARTIDA_EN_CAJA.iva_flete_devolucion_anulado).toBe("egreso_reverso_iva_flete_devolucion");
    expect(TIPO_POR_CATEGORIA_TIENDA.flete_devolucion_anulado).toBe("credito");
    expect(TIPO_POR_CATEGORIA_TIENDA.iva_flete_devolucion_anulado).toBe("credito");
  });

  it("⭑ 458-B contraprueba (mutacion 4 de design §8.2): un reverso del flete por rechazo como EFECTIVO → rojo", () => {
    const comoEfectivo: Tablas = {
      ...REALES,
      liquidez: { ...LIQUIDEZ_POR_CATEGORIA, egreso_reverso_flete_devolucion: "efectivo" },
    };
    expect(problemasDeClasificacion(comoEfectivo).length).toBeGreaterThan(0);
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
      expect(p).toContain('conjunto sin contrapartida = ["ajuste_credito","ajuste_debito"]');
    });

    it("⭑ 461: el cobro SIN contrapartida (volver a la excepcion HF6) → rojo", () => {
      // La mutacion que deshace la ficha: `cobro_manual: SIN_CONTRAPARTIDA`. El cargo queda sin pareja
      // y el conjunto sin contrapartida deja de ser `["ajuste_debito"]`.
      const conExcepcion: Tablas = {
        ...REALES,
        contrapartida: { ...CONTRAPARTIDA_EN_CAJA, cobro_manual: SIN_CONTRAPARTIDA },
      };
      const p = problemasDeClasificacion(conExcepcion);
      expect(p).toContain('conjunto sin contrapartida = ["ajuste_debito","cobro_manual"]');
      expect(p).toContain("ingreso_cobro_tienda mueve «De las tiendas» y es pareja de 0 conceptos");
    });

    it("⭑ 461: un REVERSO de cargo clasificado como EFECTIVO → rojo", () => {
      // Mutacion 3 de design §14.2 en memoria: `egreso_reverso_cobro_tienda: "efectivo"`. Como
      // egreso efectivo PROPIO no mueve «De las tiendas» (0), y su pareja en la tienda es un credito
      // (+1): no mueven igual. Ademas la lista de cargos pierde un miembro.
      const reversoComoEfectivo: Tablas = {
        ...REALES,
        liquidez: { ...LIQUIDEZ_POR_CATEGORIA, egreso_reverso_cobro_tienda: "efectivo" },
      };
      const p = problemasDeClasificacion(reversoComoEfectivo);
      expect(p).toContain("cobro_tienda_anulado (1) ↔ egreso_reverso_cobro_tienda (0): no mueven igual");
      expect(p.some((x) => x.startsWith("cargos a tienda = "))).toBe(true);
    });

    it("⭑ 461 (mutacion 4 de §14.2): el reverso de cargo como TERCEROS → rojo", () => {
      // Como terceros y `egreso_`, bajaria «De las tiendas» (−1) mientras el credito de la tienda la
      // sube (+1): signos opuestos.
      const reversoComoTerceros: Tablas = {
        ...REALES,
        naturaleza: { ...NATURALEZA_POR_CATEGORIA, egreso_reverso_cobro_tienda: "terceros" },
        liquidez: { ...LIQUIDEZ_POR_CATEGORIA, egreso_reverso_cobro_tienda: "efectivo" },
      };
      const p = problemasDeClasificacion(reversoComoTerceros);
      expect(p).toContain("cobro_tienda_anulado (1) ↔ egreso_reverso_cobro_tienda (-1): no mueven igual");
    });

    it("⭑ 457 (R24, DH1): el pago de una tienda a Ordenex clasificado como PROPIO → rojo", () => {
      // La mutacion 2 de design §13 de la 457: `ingreso_abono_tienda: "propio"`. Como propio efectivo
      // no mueve «De las tiendas» (0) mientras el credito de la tienda la sube (+1): la ganancia
      // subiria al cobrar lo que ya se conto al aprobar el cierre, y R8 se romperia en cuanto la
      // tienda pagara. Es DH1 convertida en algo que se rompe.
      const comoPropio: Tablas = {
        ...REALES,
        naturaleza: { ...NATURALEZA_POR_CATEGORIA, ingreso_abono_tienda: "propio" },
      };
      expect(problemasDeClasificacion(comoPropio)).toContain(
        "abono_tienda (1) ↔ ingreso_abono_tienda (0): no mueven igual",
      );
    });

    it("⭑ 457 (R24): el pago de una tienda a Ordenex clasificado como CARGO → rojo", () => {
      // La mutacion 3 de design §13 de la 457: `LIQUIDEZ.ingreso_abono_tienda = "cargo_a_tienda"`. Un
      // cargo `ingreso_` BAJA «De las tiendas» (−1) mientras el credito la sube (+1); y la lista de los
      // ocho cargos deja de ser la del contrato.
      const comoCargo: Tablas = {
        ...REALES,
        liquidez: { ...LIQUIDEZ_POR_CATEGORIA, ingreso_abono_tienda: "cargo_a_tienda" },
      };
      const p = problemasDeClasificacion(comoCargo);
      expect(p).toContain("abono_tienda (1) ↔ ingreso_abono_tienda (-1): no mueven igual");
      expect(p.some((x) => x.startsWith("cargos a tienda = "))).toBe(true);
      expect(p).toContain("ingreso_abono_tienda: cargo que no es propio");
    });

    it("⭑ 457 (R24): las dos parejas del pago de una tienda a Ordenex, declaradas y en el mismo sentido", () => {
      expect(CONTRAPARTIDA_EN_CAJA.abono_tienda).toBe("ingreso_abono_tienda");
      expect(CONTRAPARTIDA_EN_CAJA.abono_tienda_anulado).toBe("egreso_reverso_abono_tienda");
      expect(TIPO_POR_CATEGORIA_TIENDA.abono_tienda).toBe("credito");
      expect(TIPO_POR_CATEGORIA_TIENDA.abono_tienda_anulado).toBe("debito");
      expect(NATURALEZA_POR_CATEGORIA.ingreso_abono_tienda).toBe("terceros");
      expect(NATURALEZA_POR_CATEGORIA.egreso_reverso_abono_tienda).toBe("terceros");
      expect(LIQUIDEZ_POR_CATEGORIA.ingreso_abono_tienda).toBe("efectivo");
      expect(LIQUIDEZ_POR_CATEGORIA.egreso_reverso_abono_tienda).toBe("efectivo");
      expect(efectoEnDeLasTiendas(REALES, "ingreso_abono_tienda")).toBe(1);
      expect(efectoEnDeLasTiendas(REALES, "egreso_reverso_abono_tienda")).toBe(-1);
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
