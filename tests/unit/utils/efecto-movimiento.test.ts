import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

import { CONCEPTO_REGISTRO_SEED, type ConceptoRegistro } from "@/lib/types/efecto-movimiento";
import type { AgregadoCajaRow } from "@/lib/types/wallet";
import { EFECTO_POR_TIPO, efectoDeMovimiento, type EstadoActualParaEfecto } from "@/lib/utils/efecto-movimiento";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B / TB.12 (R44–R47) — «Así queda», puro. Un caso por concepto sobre la MISMA caja.
//
// La caja de partida (cifras escritas a mano, no derivadas con la funcion que se prueba):
//   ingreso_cod_recaudado 10 000 (de las tiendas) · ingreso_flete 1 000 (propio)
//   egreso_pago_tienda 3 000 (de las tiendas) · ingreso_aporte_capital 500 (capital)
//   ⇒ cifra 7 500,00 · ganancia 1 000,00 · de las tiendas 6 000,00 · capital 500,00
//   (el flete es un CARGO: no entra como efectivo y sale del bolsillo de las tiendas, 461 HD1)
// ═════════════════════════════════════════════════════════════════════════════════════════════

const CAJA: AgregadoCajaRow[] = [
  { categoria: "ingreso_cod_recaudado", tipo: "ingreso", total: "10000.00" },
  { categoria: "ingreso_flete", tipo: "ingreso", total: "1000.00" },
  { categoria: "egreso_pago_tienda", tipo: "egreso", total: "3000.00" },
  { categoria: "ingreso_aporte_capital", tipo: "ingreso", total: "500.00" },
];

const base = (cuenta: EstadoActualParaEfecto["cuenta"] = null): EstadoActualParaEfecto => ({
  caja: CAJA,
  haySaldoInicialVigente: false,
  primerDia: "2026-09-01",
  cuenta,
});
const TIENDA_A_FAVOR = { tipo: "tienda" as const, creditos: "10000.00", debitos: "3000.00" }; // 7 000,00
const TIENDA_EN_CONTRA = { tipo: "tienda" as const, creditos: "0.00", debitos: "300.00" }; // −300,00
const MENSAJERO = { tipo: "mensajero" as const, devengado: "500.00", pagado: "200.00" }; // 300,00

const NO = (v: string) => ({ antes: v, despues: v, cambia: false });
const SI = (antes: string, despues: string) => ({ antes, despues, cambia: true });

function efecto(concepto: ConceptoRegistro, monto: string, cuenta: EstadoActualParaEfecto["cuenta"] = null) {
  return efectoDeMovimiento(concepto, monto, base(cuenta));
}

describe("458-B/TB.12 — un caso por concepto (R44, R45 «no cambia»)", () => {
  it("gasto de Ordenex y sueldo: baja la cifra y la ganancia; las tiendas y el capital no cambian", () => {
    for (const c of ["gasto_ordenex", "sueldo"] as const) {
      expect(efecto(c, "100").lineas).toEqual({
        cuenta: null,
        cifraPrincipal: { ...SI("7500.00", "7400.00"), rotulo: "flujo" },
        ganancia: SI("1000.00", "900.00"),
        deTiendas: NO("6000.00"),
        capital: NO("500.00"),
      });
    }
  });

  it("correccion: resta y suma mueven la cifra y la ganancia", () => {
    expect(efecto("correccion_resta", "100").lineas.cifraPrincipal).toMatchObject(SI("7500.00", "7400.00"));
    expect(efecto("correccion_resta", "100").lineas.ganancia).toEqual(SI("1000.00", "900.00"));
    expect(efecto("correccion_suma", "100").lineas.cifraPrincipal).toMatchObject(SI("7500.00", "7600.00"));
    expect(efecto("correccion_suma", "100").lineas.ganancia).toEqual(SI("1000.00", "1100.00"));
    expect(efecto("correccion_suma", "100").lineas.capital).toEqual(NO("500.00"));
  });

  it("aporte: sube la cifra y la LINEA DE CAPITAL; la ganancia no cambia (mutacion 9)", () => {
    const l = efecto("aporte", "100").lineas;
    expect(l.cifraPrincipal).toMatchObject(SI("7500.00", "7600.00"));
    expect(l.capital).toEqual(SI("500.00", "600.00"));
    expect(l.ganancia).toEqual(NO("1000.00"));
    expect(l.deTiendas).toEqual(NO("6000.00"));
  });

  it("pago de un gasto de una tienda y pago a una tienda: baja la cifra, «De las tiendas» y el saldo de la tienda", () => {
    for (const c of ["pago_gasto_tienda", "pago_a_tienda"] as const) {
      const l = efecto(c, "100", TIENDA_A_FAVOR).lineas;
      expect(l.cuenta).toEqual({ tipo: "tienda", ...SI("7000.00", "6900.00") });
      expect(l.cifraPrincipal).toMatchObject(SI("7500.00", "7400.00"));
      expect(l.deTiendas).toEqual(SI("6000.00", "5900.00"));
      expect(l.ganancia).toEqual(NO("1000.00"));
    }
  });

  it("pago a un mensajero: NO toca la caja ([P2] de la 173) y baja lo que se le debe", () => {
    const l = efecto("pago_a_mensajero", "100", MENSAJERO).lineas;
    expect(l.cuenta).toEqual({ tipo: "mensajero", ...SI("300.00", "200.00") });
    expect(l.cifraPrincipal).toMatchObject(NO("7500.00"));
    expect(l.ganancia).toEqual(NO("1000.00"));
    expect(l.deTiendas).toEqual(NO("6000.00"));
    expect(l.capital).toEqual(NO("500.00"));
  });

  it("una tienda le paga a Ordenex: sube la cifra y «De las tiendas», y la deuda de la tienda baja", () => {
    const l = efecto("tienda_paga_a_ordenex", "100", TIENDA_EN_CONTRA).lineas;
    expect(l.cuenta).toEqual({ tipo: "tienda", ...SI("-300.00", "-200.00") });
    expect(l.cifraPrincipal).toMatchObject(SI("7500.00", "7600.00"));
    expect(l.deTiendas).toEqual(SI("6000.00", "6100.00"));
    expect(l.ganancia).toEqual(NO("1000.00"));
  });

  it("cobro a una tienda: la cifra NO cambia (es un cargo), la ganancia sube y «De las tiendas» baja", () => {
    const l = efecto("cobro_a_tienda", "100", TIENDA_A_FAVOR).lineas;
    expect(l.cifraPrincipal).toMatchObject(NO("7500.00"));
    expect(l.ganancia).toEqual(SI("1000.00", "1100.00"));
    expect(l.deTiendas).toEqual(SI("6000.00", "5900.00"));
    expect(l.cuenta).toEqual({ tipo: "tienda", ...SI("7000.00", "6900.00") });
  });

  it("el rotulo es el ESTADO de la caja (saldo / flujo), no un texto", () => {
    expect(efectoDeMovimiento("sueldo", "1", { ...base(), haySaldoInicialVigente: true }).lineas.cifraPrincipal.rotulo).toBe("saldo");
  });

  it("identidad R7 despues de cada concepto: cifra = ganancia + de las tiendas + capital", () => {
    const cuentaPara = (c: ConceptoRegistro) =>
      EFECTO_POR_TIPO[c].cuenta === "tienda" ? TIENDA_A_FAVOR : EFECTO_POR_TIPO[c].cuenta === "mensajero" ? MENSAJERO : null;
    for (const c of CONCEPTO_REGISTRO_SEED) {
      const l = efecto(c, "123.45", cuentaPara(c)).lineas;
      const suma = new Prisma.Decimal(l.ganancia.despues).add(l.deTiendas.despues).add(l.capital.despues);
      expect(suma.toFixed(2), c).toBe(l.cifraPrincipal.despues);
    }
  });
});

describe("458-B/TB.12 — avisos (R47, tope del servidor)", () => {
  it("R47: un pago de un gasto o un cobro que deja la tienda en contra lo dice", () => {
    const poco = { tipo: "tienda" as const, creditos: "50.00", debitos: "0.00" };
    expect(efecto("pago_gasto_tienda", "100", poco).saldoEnContra).toBe(true);
    expect(efecto("cobro_a_tienda", "100", poco)).toMatchObject({ saldoEnContra: true, lineas: { cuenta: { despues: "-50.00" } } });
    expect(efecto("cobro_a_tienda", "50", poco).saldoEnContra).toBe(false); // queda en 0,00
    expect(efecto("sueldo", "100").saldoEnContra).toBe(false);
  });

  it("pago a una tienda: supera el disponible si pasa del saldo a favor o si no hay saldo a favor", () => {
    expect(efecto("pago_a_tienda", "7000", TIENDA_A_FAVOR).superaDisponible).toBe(false); // exacto: cabe
    expect(efecto("pago_a_tienda", "7000.01", TIENDA_A_FAVOR).superaDisponible).toBe(true);
    expect(efecto("pago_a_tienda", "1", TIENDA_EN_CONTRA).superaDisponible).toBe(true);
  });

  it("una tienda le paga a Ordenex: supera si pasa de la deuda o si no debe nada", () => {
    expect(efecto("tienda_paga_a_ordenex", "300", TIENDA_EN_CONTRA).superaDisponible).toBe(false); // salda exacto
    expect(efecto("tienda_paga_a_ordenex", "300.01", TIENDA_EN_CONTRA).superaDisponible).toBe(true);
    expect(efecto("tienda_paga_a_ordenex", "1", TIENDA_A_FAVOR).superaDisponible).toBe(true);
  });

  it("los demas conceptos no traen `superaDisponible`", () => {
    expect(efecto("cobro_a_tienda", "1", TIENDA_A_FAVOR)).not.toHaveProperty("superaDisponible");
    expect(efecto("sueldo", "1")).not.toHaveProperty("superaDisponible");
  });

  it("un concepto con cuenta sin la cuenta es un error de programacion", () => {
    expect(() => efecto("cobro_a_tienda", "1")).toThrow(/tienda/);
    expect(() => efecto("pago_a_mensajero", "1", TIENDA_A_FAVOR)).toThrow(/mensajero/);
  });
});
