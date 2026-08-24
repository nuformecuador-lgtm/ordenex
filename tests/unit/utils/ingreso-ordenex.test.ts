import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  derivarIngresoOrden,
  agregarIngresosPorConcepto,
  costosListadoOrden,
  pagoTiendaOrdenex,
  costoEnvioDeTarifa,
  type OrdenIngresoInput,
} from "@/lib/utils/ingreso-ordenex";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";

// Feature 42 — tests del util PURO de ingreso de Ordenex (R8/R9/R26). Money-safe: la
// salida agregada es STRING escala 2; cero number/parseFloat.

const TARIFA: TarifaVigente = {
  valorFlete: "1000.00",
  valorFleteGam: "1500.00",
  valorFleteDevuelto: "400.00",
  valorFleteDevueltoGam: "600.00",
  comisionCod: "5.00", // 5%
  ivaFlete: "13.00", // 13%
  ivaComisionCod: "13.00", // 13%
};

function input(overrides: Partial<OrdenIngresoInput> = {}): OrdenIngresoInput {
  return {
    resultado: "entregada",
    esCentral: false,
    montoCobrar: "10000.00",
    cobraComision: true,
    ...overrides,
  };
}

describe("derivarIngresoOrden — entregada (R8)", () => {
  it("no-central: flete = valorFlete + IVA flete (13% del flete)", () => {
    const d = derivarIngresoOrden(input({ esCentral: false }), TARIFA);
    expect(d.ingreso_flete?.toFixed(2)).toBe("1000.00");
    expect(d.ingreso_iva_flete?.toFixed(2)).toBe("130.00"); // 1000 * 13%
  });

  it("central (esCentral): flete = valorFleteGam + IVA flete sobre el flete GAM", () => {
    const d = derivarIngresoOrden(input({ esCentral: true }), TARIFA);
    expect(d.ingreso_flete?.toFixed(2)).toBe("1500.00");
    expect(d.ingreso_iva_flete?.toFixed(2)).toBe("195.00"); // 1500 * 13%
  });

  it("cobraComision=true: comision = % de montoCobrar + IVA de la comision", () => {
    const d = derivarIngresoOrden(input({ cobraComision: true, montoCobrar: "10000.00" }), TARIFA);
    expect(d.ingreso_comision_cod?.toFixed(2)).toBe("500.00"); // 10000 * 5%
    expect(d.ingreso_iva_comision_cod?.toFixed(2)).toBe("65.00"); // 500 * 13%
  });

  it("cobraComision=false: comision y su IVA AUSENTES (no 0.00 forzado)", () => {
    const d = derivarIngresoOrden(input({ cobraComision: false }), TARIFA);
    expect(d.ingreso_comision_cod).toBeUndefined();
    expect(d.ingreso_iva_comision_cod).toBeUndefined();
    // el flete y su IVA siguen presentes.
    expect(d.ingreso_flete?.toFixed(2)).toBe("1000.00");
  });

  it("montoCobrar null se trata como 0 -> comision 0.00 aunque cobraComision", () => {
    const d = derivarIngresoOrden(input({ cobraComision: true, montoCobrar: null }), TARIFA);
    expect(d.ingreso_comision_cod?.toFixed(2)).toBe("0.00");
    expect(d.ingreso_iva_comision_cod?.toFixed(2)).toBe("0.00");
  });
});

describe("derivarIngresoOrden — devuelta/rechazada (R8)", () => {
  it("devuelta no-central: flete devolucion + su IVA (mismo % ivaFlete), SIN comision", () => {
    const d = derivarIngresoOrden(input({ resultado: "devuelta", esCentral: false }), TARIFA);
    expect(d.ingreso_flete_devolucion?.toFixed(2)).toBe("400.00");
    expect(d.ingreso_iva_flete_devolucion?.toFixed(2)).toBe("52.00"); // 400 * 13%
    expect(d.ingreso_comision_cod).toBeUndefined();
    expect(d.ingreso_iva_comision_cod).toBeUndefined();
    expect(d.ingreso_flete).toBeUndefined();
  });

  it("rechazada central: flete devolucion GAM + su IVA", () => {
    const d = derivarIngresoOrden(input({ resultado: "rechazada", esCentral: true }), TARIFA);
    expect(d.ingreso_flete_devolucion?.toFixed(2)).toBe("600.00");
    expect(d.ingreso_iva_flete_devolucion?.toFixed(2)).toBe("78.00"); // 600 * 13%
  });
});

describe("derivarIngresoOrden — reprogramada y gap de tarifa (R8/R9)", () => {
  it("reprogramada -> ningun concepto", () => {
    const d = derivarIngresoOrden(input({ resultado: "reprogramada" }), TARIFA);
    expect(d).toEqual({});
  });

  it("R9: tarifa null -> objeto vacio, sin lanzar (todos los conceptos 0.00 en el agregado)", () => {
    expect(() => derivarIngresoOrden(input(), null)).not.toThrow();
    expect(derivarIngresoOrden(input(), null)).toEqual({});
  });
});

describe("agregarIngresosPorConcepto (R10)", () => {
  it("cierre solo-entregada con comision: emite flete, iva flete, comision, iva comision; NO devolucion", () => {
    const agg = agregarIngresosPorConcepto([
      { input: input({ resultado: "entregada" }), tarifa: TARIFA },
      { input: input({ resultado: "entregada" }), tarifa: TARIFA },
    ]);
    const map = Object.fromEntries(agg.map((a) => [a.categoria, a.monto]));
    expect(map.ingreso_flete).toBe("2000.00");
    expect(map.ingreso_iva_flete).toBe("260.00");
    expect(map.ingreso_comision_cod).toBe("1000.00");
    expect(map.ingreso_iva_comision_cod).toBe("130.00");
    // R10: sin devoluciones, NO se emiten esos conceptos.
    expect(map.ingreso_flete_devolucion).toBeUndefined();
    expect(map.ingreso_iva_flete_devolucion).toBeUndefined();
  });

  it("cierre sin comision (cobraComision=false): NO emite comision ni su IVA", () => {
    const agg = agregarIngresosPorConcepto([
      { input: input({ resultado: "entregada", cobraComision: false }), tarifa: TARIFA },
    ]);
    const cats = agg.map((a) => a.categoria);
    expect(cats).toContain("ingreso_flete");
    expect(cats).not.toContain("ingreso_comision_cod");
    expect(cats).not.toContain("ingreso_iva_comision_cod");
  });

  it("cierre mixto (entregada + devuelta): emite conceptos de ambos caminos", () => {
    const agg = agregarIngresosPorConcepto([
      { input: input({ resultado: "entregada", cobraComision: true }), tarifa: TARIFA },
      { input: input({ resultado: "devuelta" }), tarifa: TARIFA },
    ]);
    const cats = agg.map((a) => a.categoria);
    expect(cats).toEqual(
      expect.arrayContaining([
        "ingreso_flete",
        "ingreso_iva_flete",
        "ingreso_comision_cod",
        "ingreso_iva_comision_cod",
        "ingreso_flete_devolucion",
        "ingreso_iva_flete_devolucion",
      ]),
    );
  });

  it("R9/R10: todas sin tarifa -> ningun concepto (todo 0.00, omitidos)", () => {
    const agg = agregarIngresosPorConcepto([
      { input: input({ resultado: "entregada" }), tarifa: null },
      { input: input({ resultado: "devuelta" }), tarifa: null },
    ]);
    expect(agg).toEqual([]);
  });

  it("salida STRING escala 2 (money-safe)", () => {
    const agg = agregarIngresosPorConcepto([{ input: input(), tarifa: TARIFA }]);
    for (const a of agg) {
      expect(typeof a.monto).toBe("string");
      expect(a.monto).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("suma Decimal exacta (sin drift de float): 0.10 + 0.20 en montos derivados", () => {
    // tarifa con flete que produce centavos que un float acumularia mal.
    const t: TarifaVigente = { ...TARIFA, valorFlete: "0.10", ivaFlete: "0" };
    const agg = agregarIngresosPorConcepto([
      { input: input({ resultado: "entregada", cobraComision: false }), tarifa: t },
      { input: input({ resultado: "entregada", cobraComision: false }), tarifa: { ...t, valorFlete: "0.20" } },
    ]);
    const map = Object.fromEntries(agg.map((a) => [a.categoria, a.monto]));
    expect(new Prisma.Decimal(map.ingreso_flete).toFixed(2)).toBe("0.30");
  });
});

// Pago a la tienda: lo RECIBIDO en el cierre menos lo que Ordenex le factura sobre esa plata.
describe("pagoTiendaOrdenex", () => {
  it("resta al total general el flete + IVA y la comision + IVA", () => {
    expect(pagoTiendaOrdenex("25000.00", "2825.00", "847.50")).toBe("21327.50");
  });

  it("es NEGATIVO si lo facturado supera lo recibido", () => {
    expect(pagoTiendaOrdenex("100.00", "2825.00", "847.50")).toBe("-3572.50");
  });

  it("resta Decimal exacta (sin drift de float) y sale STRING escala 2", () => {
    // 0.30 - 0.10 - 0.20 en float da 5.55e-17; con Decimal es 0.00 exacto.
    expect(pagoTiendaOrdenex("0.30", "0.10", "0.20")).toBe("0.00");
  });
});

// Feature 98 (T2) — costoEnvioDeTarifa: FLETE + IVA del flete (D2), money-safe STRING escala 2
// (R7), gap -> "0.00" (R8/D1). Mapea R2, R7, R8.
describe("costoEnvioDeTarifa (feature 98)", () => {
  it("R2/R7: no-central -> valorFlete + IVA del flete (1000 + 13% = 1130.00)", () => {
    expect(costoEnvioDeTarifa(TARIFA, false)).toBe("1130.00");
  });

  it("R2/R7: central (esCentral) -> valorFleteGam + IVA del flete (1500 + 13% = 1695.00)", () => {
    expect(costoEnvioDeTarifa(TARIFA, true)).toBe("1695.00");
  });

  it("R8/D1: tarifa null (tienda sin tarifa vigente) -> '0.00', no lanza", () => {
    expect(costoEnvioDeTarifa(null, false)).toBe("0.00");
    expect(costoEnvioDeTarifa(null, true)).toBe("0.00");
  });

  it("R7: ivaFlete = 0 -> costoEnvio == flete base (sin IVA)", () => {
    const sinIva: TarifaVigente = { ...TARIFA, ivaFlete: "0.00" };
    expect(costoEnvioDeTarifa(sinIva, false)).toBe("1000.00");
    expect(costoEnvioDeTarifa(sinIva, true)).toBe("1500.00");
  });

  it("R7: IVA no trivial (15%) con redondeo ROUND_HALF_UP money-safe", () => {
    // flete 3.50 * 15% = 0.525 -> HALF_UP 0.53 -> total 4.03 (no 4.02 de truncar).
    const t: TarifaVigente = { ...TARIFA, valorFlete: "3.50", ivaFlete: "15.00" };
    expect(costoEnvioDeTarifa(t, false)).toBe("4.03");
  });

  it("R7: salida SIEMPRE STRING escala 2 (nunca number)", () => {
    const c = costoEnvioDeTarifa(TARIFA, false);
    expect(typeof c).toBe("string");
    expect(c).toMatch(/^\d+\.\d{2}$/);
  });
});

// ---------------------------------------------------------------------------------------
// Feature 204 — `costosListadoOrden`: los dos importes derivados de las columnas
// "Flete + IVA" y "Comisión + IVA" de `/ordenes`, que hasta ahora calculaba el NAVEGADOR.
//
// Los importes esperados de este bloque NO están elegidos por su estética: son los que
// midieron la ficha. Se comparó, orden a orden, lo que la tabla pintaba contra lo que
// factura el cierre, sobre las 66 órdenes con tarifa activa de la base. 14 no coincidían.
// Cada caso de abajo lleva ANOTADO lo que daba el navegador, y el último test lo COMPRUEBA
// ejecutando la fórmula vieja: si un día alguien "arregla" el servidor para que coincida con
// el navegador, este bloque se pone rojo en vez de dejar pasar el céntimo.
// ---------------------------------------------------------------------------------------

// La tarifa REAL de la base (la única fila `activo`), no una inventada.
const TARIFA_REAL: TarifaVigente = {
  valorFlete: "3000.00",
  valorFleteGam: "2000.00",
  valorFleteDevuelto: "1500.00",
  valorFleteDevueltoGam: "1000.00",
  comisionCod: "3.50",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

function orden(montoCobrar: string | null, extra: { esCentral?: boolean; cobraComision?: boolean } = {}) {
  return { esCentral: false, montoCobrar, cobraComision: true, ...extra };
}

describe("costosListadoOrden (feature 204) — comisión + IVA, con los montos reales", () => {
  // Medio exacto en el tercer decimal: la comisión es 521.50 clavada y su IVA, 67.795.
  // Decimal HALF_UP sube a 67.80; el navegador hacía 521.5 * 1.13, que en binario vale
  // 589.29499999999995907, y `toFixed(2)` BAJABA a 589.29.
  it("14900.00 al 3.50% + IVA 13% -> 589.30 (el navegador pintaba 589.29)", () => {
    expect(costosListadoOrden(TARIFA_REAL, orden("14900.00")).comisionConIva).toBe("589.30");
  });

  // Doble redondeo: la comisión exacta es 581.644 y el servidor la REDONDEA a 581.64 antes
  // de aplicarle el IVA. El navegador se lo aplicaba sin redondear (581.644 * 1.13) y subía.
  // Este caso no es de binario: es otra fórmula.
  it("16618.40 al 3.50% + IVA 13% -> 657.25 (el navegador pintaba 657.26)", () => {
    expect(costosListadoOrden(TARIFA_REAL, orden("16618.40")).comisionConIva).toBe("657.25");
  });

  it("6500.00 -> 257.08 (el navegador pintaba 257.07)", () => {
    expect(costosListadoOrden(TARIFA_REAL, orden("6500.00")).comisionConIva).toBe("257.08");
  });

  it("12900.00 -> 510.20 (el navegador pintaba 510.19)", () => {
    expect(costosListadoOrden(TARIFA_REAL, orden("12900.00")).comisionConIva).toBe("510.20");
  });

  it("14618.40 -> 578.15 (el navegador pintaba 578.16)", () => {
    expect(costosListadoOrden(TARIFA_REAL, orden("14618.40")).comisionConIva).toBe("578.15");
  });

  it("17700.00 -> 700.04, donde los dos caminos YA coincidían", () => {
    // Contrapeso: la mayoría de las órdenes no cambian de valor. Si este caso se moviera,
    // el arreglo habría desplazado importes que estaban bien.
    expect(costosListadoOrden(TARIFA_REAL, orden("17700.00")).comisionConIva).toBe("700.04");
  });

  it("es EXACTAMENTE lo que factura el cierre: comisión + su IVA de derivarIngresoOrden", () => {
    // La garantía estructural, no por valor: el listado no puede divergir del cierre porque
    // sale de la misma función.
    for (const monto of ["14900.00", "16618.40", "6500.00", "0.00", "33.33"]) {
      const d = derivarIngresoOrden(
        { resultado: "entregada", esCentral: false, montoCobrar: monto, cobraComision: true },
        TARIFA_REAL,
      );
      const esperado = d.ingreso_comision_cod!.plus(d.ingreso_iva_comision_cod!).toFixed(2);
      expect(costosListadoOrden(TARIFA_REAL, orden(monto)).comisionConIva).toBe(esperado);
    }
  });
});

describe("costosListadoOrden (feature 204) — flete + IVA", () => {
  it("con la tarifa REAL (flete redondo) los dos caminos coincidían: 3000 + 13% = 3390.00", () => {
    expect(costosListadoOrden(TARIFA_REAL, orden("0.00")).fleteConIva).toBe("3390.00");
  });

  it("esCentral elige la columna GAM: 2000 + 13% = 2260.00", () => {
    expect(costosListadoOrden(TARIFA_REAL, orden("0.00", { esCentral: true })).fleteConIva).toBe(
      "2260.00",
    );
  });

  // El fallo del flete estaba LATENTE: no aparece con 3000.00, aparece con cualquier flete
  // acabado en .50 al 13% (2500.50 * 13% = 325.065, medio exacto que HALF_UP sube).
  it("2500.50 al 13% -> 2825.57 (el navegador habría pintado 2825.56)", () => {
    const t: TarifaVigente = { ...TARIFA_REAL, valorFlete: "2500.50" };
    expect(costosListadoOrden(t, orden("0.00")).fleteConIva).toBe("2825.57");
  });

  it("coincide con costoEnvioDeTarifa, que ya derivaba esta misma cifra en el servidor", () => {
    for (const flete of ["3000.00", "2500.50", "0.10", "1.00"]) {
      const t: TarifaVigente = { ...TARIFA_REAL, valorFlete: flete };
      expect(costosListadoOrden(t, orden("0.00")).fleteConIva).toBe(costoEnvioDeTarifa(t, false));
    }
  });
});

describe("costosListadoOrden (feature 204) — degradación y contrato de salida", () => {
  it("sin tarifa vigente los dos importes son '0.00' (R9), no null ni error", () => {
    expect(costosListadoOrden(null, orden("14900.00"))).toEqual({
      fleteConIva: "0.00",
      comisionConIva: "0.00",
    });
  });

  it("orden que NO cobra comisión: comisión 0.00 y el flete intacto", () => {
    const c = costosListadoOrden(TARIFA_REAL, orden("14900.00", { cobraComision: false }));
    expect(c.comisionConIva).toBe("0.00");
    expect(c.fleteConIva).toBe("3390.00");
  });

  it("montoCobrar null (orden sin COD) -> comisión 0.00", () => {
    expect(costosListadoOrden(TARIFA_REAL, orden(null)).comisionConIva).toBe("0.00");
  });

  it("los dos campos son SIEMPRE STRING de escala 2", () => {
    for (const t of [TARIFA_REAL, null]) {
      const c = costosListadoOrden(t, orden("14900.00"));
      expect(c.fleteConIva).toMatch(/^\d+\.\d{2}$/);
      expect(c.comisionConIva).toMatch(/^\d+\.\d{2}$/);
    }
  });
});

describe("costosListadoOrden (feature 204) — CONTRAPRUEBA: la fórmula del navegador difería", () => {
  // Sin esto, los valores de arriba podrían ser los mismos que ya daba el navegador y todo
  // el arreglo sería decorativo. Aquí se EJECUTA la aritmética que vivía en
  // `ordenes-columns.tsx` y se afirma, monto a monto, que da otra cosa.
  const comisionEnElNavegador = (monto: number, pct: number, iva: number): string =>
    (monto * (pct / 100) * (1 + iva / 100)).toFixed(2);
  const fleteEnElNavegador = (flete: number, iva: number): string =>
    (flete * (1 + iva / 100)).toFixed(2);

  it.each([
    { caso: "14900.00 -> 589.30, no 589.29", monto: "14900.00", montoNum: 14900, servidorEsperado: "589.30", navegadorEsperado: "589.29" },
    { caso: "16618.40 -> 657.25, no 657.26", monto: "16618.40", montoNum: 16618.4, servidorEsperado: "657.25", navegadorEsperado: "657.26" },
    { caso: "6500.00 -> 257.08, no 257.07", monto: "6500.00", montoNum: 6500, servidorEsperado: "257.08", navegadorEsperado: "257.07" },
    { caso: "12900.00 -> 510.20, no 510.19", monto: "12900.00", montoNum: 12900, servidorEsperado: "510.20", navegadorEsperado: "510.19" },
    { caso: "14618.40 -> 578.15, no 578.16", monto: "14618.40", montoNum: 14618.4, servidorEsperado: "578.15", navegadorEsperado: "578.16" },
  ])("comisión de $caso — y NO son el mismo número", ({
    monto,
    montoNum,
    servidorEsperado: esperadoServidor,
    navegadorEsperado: esperadoNavegador,
  }) => {
    const servidor = costosListadoOrden(TARIFA_REAL, orden(monto)).comisionConIva;
    const navegador = comisionEnElNavegador(montoNum, 3.5, 13);
    expect(servidor).toBe(esperadoServidor);
    expect(navegador).toBe(esperadoNavegador);
    expect(servidor).not.toBe(navegador);
    // Y la desviación es de un céntimo, en los dos sentidos.
    expect(new Prisma.Decimal(navegador).minus(servidor).abs().toFixed(2)).toBe("0.01");
  });

  it("flete 2500.50 al 13%: servidor 2825.57, navegador 2825.56", () => {
    const t: TarifaVigente = { ...TARIFA_REAL, valorFlete: "2500.50" };
    expect(costosListadoOrden(t, orden("0.00")).fleteConIva).toBe("2825.57");
    expect(fleteEnElNavegador(2500.5, 13)).toBe("2825.56");
  });

  it("y donde el navegador ya acertaba, el servidor da lo MISMO (no se movió nada más)", () => {
    for (const [monto, montoNum] of [
      ["17700.00", 17700],
      ["10900.00", 10900],
      ["21000.00", 21000],
    ] as const) {
      expect(costosListadoOrden(TARIFA_REAL, orden(monto)).comisionConIva).toBe(
        comisionEnElNavegador(montoNum, 3.5, 13),
      );
    }
  });
});
