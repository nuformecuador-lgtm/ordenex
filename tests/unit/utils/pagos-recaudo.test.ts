import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { aCentimos, normalizarPagos, sumaCuadra } from "@/lib/utils/pagos-recaudo";

// Feature 208 (T4) — util PURO del desglose del recaudo. Cubre R12 (forma escalar historica),
// R14 (sin cobro -> cero lineas) y R30 (centimos enteros, cero float, cero parseFloat).

describe("aCentimos / sumaCuadra (R30: centimos enteros, nunca float)", () => {
  it("R30: una suma que en float NO cuadraria (0.1 + 0.2) cuadra en centimos", () => {
    // 0.1 + 0.2 === 0.30000000000000004 en coma flotante. En centimos es 10 + 20 === 30.
    expect(sumaCuadra([{ monto: 0.1 }, { monto: 0.2 }], 0.3)).toBe(true);
  });

  it("R30: 33.33 x 3 repartido en tres lineas suma 99.99 exacto", () => {
    expect(sumaCuadra([{ monto: 33.33 }, { monto: 33.33 }, { monto: 33.33 }], 99.99)).toBe(true);
  });

  it("un centavo de diferencia NO cuadra", () => {
    expect(sumaCuadra([{ monto: 5000 }, { monto: 2999.99 }], 8000)).toBe(false);
  });

  it("mixta 5000 + 3000 = 8000 cuadra", () => {
    expect(sumaCuadra([{ monto: 5000 }, { monto: 3000 }], 8000)).toBe(true);
  });

  it("lista vacia cuadra solo con total 0", () => {
    expect(sumaCuadra([], 0)).toBe(true);
    expect(sumaCuadra([], 0.01)).toBe(false);
  });

  it("aCentimos redondea el ruido binario en vez de truncarlo", () => {
    expect(aCentimos(8000.000000000001)).toBe(800000);
    expect(aCentimos(0.07 * 100)).toBe(700); // 7.000000000000001 -> 700, no 699
  });
});

describe("normalizarPagos: las tres formas (R11/R12/R14)", () => {
  it("R11: con desglose devuelve las lineas tal cual, en el mismo orden", () => {
    const pagos = normalizarPagos({
      montoRecibido: 8000,
      pagos: [
        { metodo: "efectivo", monto: 5000 },
        { metodo: "transferencia", monto: 3000 },
      ],
    });
    expect(pagos).toEqual([
      { metodo: "efectivo", monto: 5000 },
      { metodo: "transferencia", monto: 3000 },
    ]);
  });

  it("R12: forma ESCALAR historica (solo metodoPago) -> UNA linea con el total", () => {
    expect(normalizarPagos({ montoRecibido: 12.5, metodoPago: "SINPE" })).toEqual([
      { metodo: "SINPE", monto: 12.5 },
    ]);
  });

  it("R14: montoRecibido 0 con escalar `efectivo` (lo que fuerza el panel) -> CERO lineas", () => {
    expect(normalizarPagos({ montoRecibido: 0, metodoPago: "efectivo" })).toEqual([]);
  });

  it("R14: montoRecibido 0 -> CERO lineas sea cual sea la forma recibida", () => {
    expect(
      normalizarPagos({ montoRecibido: 0, pagos: [{ metodo: "efectivo", monto: 0 }] }),
    ).toEqual([]);
    expect(normalizarPagos({ montoRecibido: 0 })).toEqual([]);
  });

  it("sin ninguna de las dos formas y monto > 0 -> [] (el borde ya lo rechazo antes, R15)", () => {
    expect(normalizarPagos({ montoRecibido: 100 })).toEqual([]);
  });

  it("no comparte referencia con la entrada (mutar la salida no toca al llamador)", () => {
    const entrada = [{ metodo: "efectivo" as const, monto: 100 }];
    const salida = normalizarPagos({ montoRecibido: 100, pagos: entrada });
    salida[0].monto = 999;
    expect(entrada[0].monto).toBe(100);
  });
});

describe("R30/§0: el util es importable desde el bundle del cliente", () => {
  it("no importa `@prisma/client` ni usa parseFloat", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/utils/pagos-recaudo.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']@prisma\/client["']/);
    expect(src).not.toMatch(/parseFloat\(/);
  });
});
