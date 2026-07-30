import { describe, it, expect } from "vitest";
import { pagoPorResultado } from "@/lib/utils/pago-mensajero";
import { ingresoBodegaPorResultado } from "@/lib/utils/ingreso-bodega";
import { derivarIngresoOrden } from "@/lib/utils/ingreso-ordenex";
import { WALLET_INGRESO_CONCEPTO_SEED } from "@/lib/types/wallet";
import type { PagoTarifa } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";

// Feature 158 (T1.9, R17) — «un incidente NO mueve dinero», fijado con test.
//
// POR QUE ESTE ARCHIVO EXISTE: hoy las tres funciones puras devuelven cero/vacio para
// `incidente` por un `return` POR DEFECTO (`pagoPorResultado` paga solo `entregada`,
// `ingresoBodegaPorResultado` solo `rechazada`, `derivarIngresoOrden` solo
// `entregada`/`devuelta`/`rechazada`). Es decir: el comportamiento correcto sale de una rama
// que NADIE escribio pensando en el incidente. Sin este archivo, una feature futura que
// reorganice esos `if` puede empezar a pagar por un paquete robado y nadie se entera.
//
// Las tarifas de abajo tienen TODOS sus montos > 0 a proposito: si alguna funcion tocara el
// incidente, el resultado seria distinto de cero y el test lo veria. Con tarifas en cero el
// test pasaria por la razon equivocada.

const TARIFA_MENSAJERO: PagoTarifa = { cobroEntregado: "5000.00", cobroRechazado: "2500.00" };

const TARIFA_TIENDA = {
  valorFlete: "1000.00",
  valorFleteGam: "1500.00",
  valorFleteDevuelto: "400.00",
  valorFleteDevueltoGam: "600.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

describe("R17 — el pago al MENSAJERO no cobra por un incidente", () => {
  it("pagoPorResultado('incidente') = 0.00 aunque la tarifa pague 5000 por entrega", () => {
    expect(pagoPorResultado("incidente", TARIFA_MENSAJERO)).toBe("0.00");
    // Control de discriminacion: con la MISMA tarifa, `entregada` SI paga.
    expect(pagoPorResultado("entregada", TARIFA_MENSAJERO)).toBe("5000.00");
  });

  it("sin tarifa tampoco lanza (mismo gap seguro que el resto de resultados)", () => {
    expect(pagoPorResultado("incidente", null)).toBe("0.00");
  });
});

describe("R17 — el ingreso de BODEGA por rechazo no se cobra por un incidente", () => {
  it("ingresoBodegaPorResultado('incidente') = 0.00 aunque el cobro por rechazo sea 2500", () => {
    expect(ingresoBodegaPorResultado("incidente", TARIFA_MENSAJERO)).toBe("0.00");
    // Control de discriminacion: con la MISMA tarifa, `rechazada` SI genera ingreso.
    expect(ingresoBodegaPorResultado("rechazada", TARIFA_MENSAJERO)).toBe("2500.00");
  });

  it("sin tarifa tampoco lanza", () => {
    expect(ingresoBodegaPorResultado("incidente", null)).toBe("0.00");
  });
});

describe("R17 — el ingreso de ORDENEX no factura nada por un incidente", () => {
  it("derivarIngresoOrden('incidente') = {} (ni flete, ni comision, ni sus IVA)", () => {
    const derivado = derivarIngresoOrden(
      {
        resultado: "incidente",
        esCentral: true,
        montoCobrar: "50000.00", // COD alto: si la comision se calculara, se veria
        cobraComision: true,
      },
      TARIFA_TIENDA,
    );
    expect(derivado).toEqual({});
    // Y ninguno de los SEIS conceptos de ingreso aparece, uno por uno.
    for (const concepto of WALLET_INGRESO_CONCEPTO_SEED) {
      expect(
        (derivado as Record<string, unknown>)[concepto],
        `el incidente no debe producir ${concepto}`,
      ).toBeUndefined();
    }
  });

  it("control de discriminacion: con la MISMA tarifa y orden, `entregada` SI factura", () => {
    const derivado = derivarIngresoOrden(
      { resultado: "entregada", esCentral: true, montoCobrar: "50000.00", cobraComision: true },
      TARIFA_TIENDA,
    );
    expect(Object.keys(derivado).length).toBeGreaterThan(0);
  });

  it("tampoco factura la variante NO central ni con `cobraComision: false`", () => {
    expect(
      derivarIngresoOrden(
        { resultado: "incidente", esCentral: false, montoCobrar: null, cobraComision: false },
        TARIFA_TIENDA,
      ),
    ).toEqual({});
  });
});
