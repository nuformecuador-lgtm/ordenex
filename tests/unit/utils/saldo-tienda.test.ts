import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";
import {
  MAPEO_CONCEPTO_TIENDA,
  conceptoIngresoADebitoTienda,
} from "@/lib/utils/mapeo-concepto-tienda";
import { WALLET_INGRESO_CONCEPTO_SEED } from "@/lib/types/wallet";

// Feature 43/T5 — utils puros (R4/R8/R16/R17). derivarSaldoTienda: saldo = creditos -
// debitos con Prisma.Decimal, salida STRING 2 dec + signo (puede ser negativo).
// mapeo-concepto-tienda: mapeo 1:1 exacto de los 6 conceptos de la 42.

describe("derivarSaldoTienda (R16/R17)", () => {
  it("saldo POSITIVO: creditos > debitos -> STRING 2 dec + signo positivo", () => {
    const s = derivarSaldoTienda("10000.00", "1500.00");
    expect(s).toEqual({
      creditos: "10000.00",
      debitos: "1500.00",
      saldo: "8500.00",
      signo: "positivo",
    });
    expect(typeof s.saldo).toBe("string");
  });

  it("saldo NEGATIVO (R17): la tienda debe (solo devoluciones) -> '-...' + signo negativo", () => {
    const s = derivarSaldoTienda("0.00", "452.00");
    expect(s.saldo).toBe("-452.00");
    expect(s.signo).toBe("negativo");
  });

  it("saldo CERO -> '0.00' + signo cero", () => {
    const s = derivarSaldoTienda("1500.00", "1500.00");
    expect(s.saldo).toBe("0.00");
    expect(s.signo).toBe("cero");
  });

  it("R4: aritmetica Decimal EXACTA, sin perdida de precision (acepta Prisma.Decimal)", () => {
    const s = derivarSaldoTienda(new Prisma.Decimal("0.10"), new Prisma.Decimal("0.20"));
    // 0.10 - 0.20 = -0.10 exacto (un float daria -0.1 con ruido).
    expect(s.saldo).toBe("-0.10");
    expect(s.debitos).toBe("0.20");
  });

  it("R27: todas las salidas son STRING con 2 decimales", () => {
    const s = derivarSaldoTienda("100.5", "0.1");
    expect(s.creditos).toBe("100.50");
    expect(s.debitos).toBe("0.10");
    expect(s.saldo).toBe("100.40");
    for (const v of [s.creditos, s.debitos, s.saldo]) expect(typeof v).toBe("string");
  });
});

describe("mapeo-concepto-tienda (R8)", () => {
  it("mapea 1:1 los 6 conceptos de ingreso de la 42 a categorias de debito de la tienda", () => {
    expect(MAPEO_CONCEPTO_TIENDA).toEqual({
      ingreso_flete: "flete",
      ingreso_flete_devolucion: "flete_devolucion",
      ingreso_comision_cod: "comision_cod",
      ingreso_iva_flete: "iva_flete",
      ingreso_iva_flete_devolucion: "iva_flete_devolucion",
      ingreso_iva_comision_cod: "iva_comision_cod",
    });
  });

  it("cubre EXACTAMENTE los 6 conceptos de WALLET_INGRESO_CONCEPTO_SEED (sin faltantes ni sobrantes)", () => {
    const llaves = Object.keys(MAPEO_CONCEPTO_TIENDA).sort();
    expect(llaves).toEqual([...WALLET_INGRESO_CONCEPTO_SEED].sort());
    // cada concepto resuelve a su debito via el helper.
    for (const c of WALLET_INGRESO_CONCEPTO_SEED) {
      expect(conceptoIngresoADebitoTienda(c)).toBe(MAPEO_CONCEPTO_TIENDA[c]);
    }
  });

  it("las categorias de debito no incluyen cod_recaudado ni pago_tienda ni ajustes", () => {
    const debitos = Object.values(MAPEO_CONCEPTO_TIENDA);
    expect(debitos).not.toContain("cod_recaudado");
    expect(debitos).not.toContain("pago_tienda");
    expect(debitos).not.toContain("ajuste_credito");
    expect(debitos).not.toContain("ajuste_debito");
  });
});
