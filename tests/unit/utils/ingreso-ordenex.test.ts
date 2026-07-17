import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  derivarIngresoOrden,
  agregarIngresosPorConcepto,
  pagoTiendaOrdenex,
  type OrdenIngresoInput,
} from "@/lib/utils/ingreso-ordenex";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";

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
