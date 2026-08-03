import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { derivarPendienteCierre } from "@/lib/utils/pendiente-cierre";
import { calcularSplitPago } from "@/lib/utils/cuenta-por-pagar";

// Feature 172 / T A.4 — derivacion PURA del pendiente de un cierre. Cubre R22 (el pendiente se
// deriva de P, E y los pagos VIGENTES, en el servidor), R24 (un pago parcial baja el pendiente
// exactamente en su monto y el resto sigue pendiente) y R80 (un pago anulado NO descuenta).
//
// Money-safe: montos como STRING de extremo a extremo. En este archivo no hay ni un `Number(`
// ni un `parseFloat` sobre un monto, y el ultimo bloque afirma lo mismo del modulo.

describe("R22 — el pendiente sale de min(P, E) menos lo ya entregado", () => {
  it("sin efectivo recaudado (E = 0), el cierre debe el pago entero", () => {
    expect(derivarPendienteCierre("50000.00", "0.00", "0.00")).toBe("50000.00");
    expect(derivarPendienteCierre("12345.67", "0", "0")).toBe("12345.67");
  });

  it("con efectivo suficiente (E >= P), no queda nada pendiente", () => {
    expect(derivarPendienteCierre("50000.00", "50000.00", "0.00")).toBe("0.00");
    expect(derivarPendienteCierre("50000.00", "90000.00", "0.00")).toBe("0.00");
    // FRONTERA: un centimo por debajo de P si deja pendiente, y es exactamente ese centimo.
    expect(derivarPendienteCierre("50000.00", "49999.99", "0.00")).toBe("0.01");
  });

  it("un cierre que no devengo nada (P = 0) no debe nada", () => {
    expect(derivarPendienteCierre("0.00", "0.00", "0.00")).toBe("0.00");
    expect(derivarPendienteCierre("0.00", "80000.00", "0.00")).toBe("0.00");
  });

  it("reutiliza calcularSplitPago: sin pagos registrados coincide con su `pendiente`", () => {
    // Es la contraprueba de que `min(P, E)` NO se reimplementa aqui: si esta funcion tuviera su
    // propia version de la regla, estos pares dejarian de coincidir en cuanto una de las dos
    // cambiara.
    const casos: [string, string][] = [
      ["50000.00", "0.00"],
      ["50000.00", "20000.00"],
      ["50000.00", "50000.00"],
      ["50000.00", "70000.00"],
      ["0.00", "0.00"],
      ["0.01", "0.00"],
    ];
    for (const [P, E] of casos) {
      expect(derivarPendienteCierre(P, E, "0.00")).toBe(calcularSplitPago(P, E).pendiente);
    }
  });
});

describe("R24 — los pagos parciales bajan el pendiente exactamente en su monto", () => {
  it("un pago parcial deja pendiente el resto, al centimo", () => {
    // P = 50 000, E = 20 000 -> el cierre genero 30 000 de cuenta por pagar.
    expect(derivarPendienteCierre("50000.00", "20000.00", "0.00")).toBe("30000.00");
    expect(derivarPendienteCierre("50000.00", "20000.00", "10000.00")).toBe("20000.00");
    expect(derivarPendienteCierre("50000.00", "20000.00", "29999.99")).toBe("0.01");
  });

  it("los pagos parciales se acumulan: tres entregas saldan el cierre", () => {
    const P = "30000.00";
    const E = "0.00";
    expect(derivarPendienteCierre(P, E, "10000.00")).toBe("20000.00");
    expect(derivarPendienteCierre(P, E, "20000.00")).toBe("10000.00");
    expect(derivarPendienteCierre(P, E, "30000.00")).toBe("0.00");
  });

  it("con centimos, la resta es exacta (lo que un float redondearia mal)", () => {
    // 0.1 + 0.2 en coma flotante da 0.30000000000000004; con Decimal, 30000.00 - 0.30 es exacto.
    expect(derivarPendienteCierre("30000.00", "0.00", "0.30")).toBe("29999.70");
    expect(derivarPendienteCierre("0.30", "0.00", "0.10")).toBe("0.20");
    expect(derivarPendienteCierre("0.30", "0.00", "0.30")).toBe("0.00");
  });
});

describe("R80 — un pago anulado no descuenta", () => {
  it("al anular, el pendiente vuelve EXACTAMENTE al valor que tenia antes de ese pago", () => {
    const P = "50000.00";
    const E = "0.00";
    // El tercer argumento es la suma de pagos VIGENTES. Anular saca ese pago de la suma.
    const antesDelPago = derivarPendienteCierre(P, E, "0.00");
    const conElPagoVigente = derivarPendienteCierre(P, E, "20000.00");
    const trasAnularlo = derivarPendienteCierre(P, E, "0.00");

    expect(antesDelPago).toBe("50000.00");
    expect(conElPagoVigente).toBe("30000.00");
    expect(trasAnularlo).toBe(antesDelPago); // R71/R79: el monto vuelve a estar adeudado.
  });

  it("con dos pagos y uno anulado, solo descuenta el vigente", () => {
    // Dos pagos de 20 000; el segundo se anula -> la suma de vigentes es 20 000, no 40 000.
    expect(derivarPendienteCierre("50000.00", "0.00", "40000.00")).toBe("10000.00");
    expect(derivarPendienteCierre("50000.00", "0.00", "20000.00")).toBe("30000.00");
  });
});

describe("el pendiente nunca es negativo", () => {
  it.each([
    ["pagado por encima de lo debido", "30000.00", "0.00", "45000.00"],
    ["pagado justo al limite", "30000.00", "0.00", "30000.00"],
    ["el efectivo ya cubria todo y ademas hay un pago", "30000.00", "30000.00", "5000.00"],
    ["un centimo de mas", "30000.00", "0.00", "30000.01"],
  ])("%s -> 0.00, nunca una deuda al reves", (_caso, P, E, pagado) => {
    expect(derivarPendienteCierre(P, E, pagado)).toBe("0.00");
  });
});

describe("money-safe — el modulo no toca coma flotante", () => {
  it("no contiene Number( ni parseFloat, y reutiliza calcularSplitPago", () => {
    const fuente = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "lib", "utils", "pendiente-cierre.ts"),
      "utf8",
    );
    expect(fuente).not.toMatch(/parseFloat/);
    expect(fuente).not.toMatch(/Number\(/);
    expect(fuente).not.toMatch(/Math\.min/);
    expect(fuente).toMatch(/import \{ calcularSplitPago \} from "@\/lib\/utils\/cuenta-por-pagar";/);
    expect(fuente).toMatch(/Prisma\.Decimal/);
  });

  it("devuelve SIEMPRE un string con 2 decimales, tambien con entradas Decimal", () => {
    const salida = derivarPendienteCierre("100", "0", "0");
    expect(typeof salida).toBe("string");
    expect(salida).toBe("100.00");
    expect(derivarPendienteCierre("100.5", "0", "0.25")).toBe("100.25");
  });
});
