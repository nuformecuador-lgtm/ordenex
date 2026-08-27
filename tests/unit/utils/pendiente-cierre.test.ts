import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { derivarPendienteCierre } from "@/lib/utils/pendiente-cierre";
import { calcularSplitPago } from "@/lib/utils/cuenta-por-pagar";

// Feature 172 / T A.4 — derivacion PURA del pendiente de un cierre. Cubre R22 (el pendiente se
// deriva de P, E y los pagos VIGENTES, en el servidor), R24 (un pago parcial baja el pendiente
// exactamente en su monto y R80 (un pago anulado NO descuenta).
//
// Feature 293 / T2.1 — la funcion gana un TERMINO (`premiosVivos`) y una FIRMA POR OBJETO.
// Los casos de la 172 siguen aqui intactos, con `premiosVivos: "0.00"`, y esa es la
// no-regresion: el dia que alguien cambie la formula, estos numeros —que son los que el sistema
// lleva dando desde la 172— cambian con el. Los bloques nuevos cubren 293/R24 y 293/R25.
//
// Money-safe: montos como STRING de extremo a extremo. En este archivo no hay ni un `Number(`
// ni un `parseFloat` sobre un monto, y el ultimo bloque afirma lo mismo del modulo.

/** Atajo de los casos de la 172: sin premio, la firma nueva dice exactamente lo de antes. */
function sinPremio(
  pagoDebido: string,
  efectivo: string,
  pagadoVigente: string,
): string {
  return derivarPendienteCierre({ pagoDebido, efectivo, premiosVivos: "0.00", pagadoVigente });
}

describe("R22 — el pendiente sale de min(P, E) menos lo ya entregado", () => {
  it("sin efectivo recaudado (E = 0), el cierre debe el pago entero", () => {
    expect(sinPremio("50000.00", "0.00", "0.00")).toBe("50000.00");
    expect(sinPremio("12345.67", "0", "0")).toBe("12345.67");
  });

  it("con efectivo suficiente (E >= P), no queda nada pendiente", () => {
    expect(sinPremio("50000.00", "50000.00", "0.00")).toBe("0.00");
    expect(sinPremio("50000.00", "90000.00", "0.00")).toBe("0.00");
    // FRONTERA: un centimo por debajo de P si deja pendiente, y es exactamente ese centimo.
    expect(sinPremio("50000.00", "49999.99", "0.00")).toBe("0.01");
  });

  it("un cierre que no devengo nada (P = 0) no debe nada", () => {
    expect(sinPremio("0.00", "0.00", "0.00")).toBe("0.00");
    expect(sinPremio("0.00", "80000.00", "0.00")).toBe("0.00");
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
      expect(sinPremio(P, E, "0.00")).toBe(calcularSplitPago(P, E).pendiente);
    }
  });
});

describe("R24 — los pagos parciales bajan el pendiente exactamente en su monto", () => {
  it("un pago parcial deja pendiente el resto, al centimo", () => {
    // P = 50 000, E = 20 000 -> el cierre genero 30 000 de cuenta por pagar.
    expect(sinPremio("50000.00", "20000.00", "0.00")).toBe("30000.00");
    expect(sinPremio("50000.00", "20000.00", "10000.00")).toBe("20000.00");
    expect(sinPremio("50000.00", "20000.00", "29999.99")).toBe("0.01");
  });

  it("los pagos parciales se acumulan: tres entregas saldan el cierre", () => {
    const P = "30000.00";
    const E = "0.00";
    expect(sinPremio(P, E, "10000.00")).toBe("20000.00");
    expect(sinPremio(P, E, "20000.00")).toBe("10000.00");
    expect(sinPremio(P, E, "30000.00")).toBe("0.00");
  });

  it("con centimos, la resta es exacta (lo que un float redondearia mal)", () => {
    // 0.1 + 0.2 en coma flotante da 0.30000000000000004; con Decimal, 30000.00 - 0.30 es exacto.
    expect(sinPremio("30000.00", "0.00", "0.30")).toBe("29999.70");
    expect(sinPremio("0.30", "0.00", "0.10")).toBe("0.20");
    expect(sinPremio("0.30", "0.00", "0.30")).toBe("0.00");
  });
});

describe("R80 — un pago anulado no descuenta", () => {
  it("al anular, el pendiente vuelve EXACTAMENTE al valor que tenia antes de ese pago", () => {
    const P = "50000.00";
    const E = "0.00";
    // `pagadoVigente` es la suma de pagos VIGENTES. Anular saca ese pago de la suma.
    const antesDelPago = sinPremio(P, E, "0.00");
    const conElPagoVigente = sinPremio(P, E, "20000.00");
    const trasAnularlo = sinPremio(P, E, "0.00");

    expect(antesDelPago).toBe("50000.00");
    expect(conElPagoVigente).toBe("30000.00");
    expect(trasAnularlo).toBe(antesDelPago); // R71/R79: el monto vuelve a estar adeudado.
  });

  it("con dos pagos y uno anulado, solo descuenta el vigente", () => {
    // Dos pagos de 20 000; el segundo se anula -> la suma de vigentes es 20 000, no 40 000.
    expect(sinPremio("50000.00", "0.00", "40000.00")).toBe("10000.00");
    expect(sinPremio("50000.00", "0.00", "20000.00")).toBe("30000.00");
  });
});

describe("el pendiente nunca es negativo", () => {
  it.each([
    ["pagado por encima de lo debido", "30000.00", "0.00", "45000.00"],
    ["pagado justo al limite", "30000.00", "0.00", "30000.00"],
    ["el efectivo ya cubria todo y ademas hay un pago", "30000.00", "30000.00", "5000.00"],
    ["un centimo de mas", "30000.00", "0.00", "30000.01"],
  ])("%s -> 0.00, nunca una deuda al reves", (_caso, P, E, pagado) => {
    expect(sinPremio(P, E, pagado)).toBe("0.00");
  });
});

// ── Feature 293 (T2.1) — el termino nuevo ───────────────────────────────────────────────────

describe("293/R24 — lo pagable de un cierre SUMA los premios vivos imputados a el", () => {
  it("un cierre SALDADO al que se le imputa un premio vuelve a deber EXACTAMENTE el premio", () => {
    // Es el caso de borde 2 de la ficha (R27) y el que se va a ver el primer dia en produccion,
    // donde hoy todos los cierres tienen P = 0,00 y salen «saldados».
    expect(
      derivarPendienteCierre({
        pagoDebido: "0.00",
        efectivo: "0.00",
        premiosVivos: "5000.00",
        pagadoVigente: "0.00",
      }),
    ).toBe("5000.00");
    // Y un cierre ya pagado por completo (P = 30 000 entregados) tambien vuelve a deber.
    expect(
      derivarPendienteCierre({
        pagoDebido: "30000.00",
        efectivo: "0.00",
        premiosVivos: "5000.00",
        pagadoVigente: "30000.00",
      }),
    ).toBe("5000.00");
  });

  it("el premio se SUMA a lo que el cierre ya debia, no lo sustituye", () => {
    // P = 50 000, E = 20 000 -> 30 000 de deuda propia del cierre; + 5 000 de premio.
    expect(
      derivarPendienteCierre({
        pagoDebido: "50000.00",
        efectivo: "20000.00",
        premiosVivos: "5000.00",
        pagadoVigente: "0.00",
      }),
    ).toBe("35000.00");
  });

  it("un pago parcial descuenta de la suma de las dos deudas, al centimo", () => {
    expect(
      derivarPendienteCierre({
        pagoDebido: "50000.00",
        efectivo: "20000.00",
        premiosVivos: "5000.00",
        pagadoVigente: "34999.99",
      }),
    ).toBe("0.01");
    expect(
      derivarPendienteCierre({
        pagoDebido: "50000.00",
        efectivo: "20000.00",
        premiosVivos: "5000.00",
        pagadoVigente: "35000.00",
      }),
    ).toBe("0.00");
  });

  it("anular el premio (premiosVivos vuelve a 0) devuelve el cierre a como estaba (R33)", () => {
    const entrada = { pagoDebido: "30000.00", efectivo: "0.00", pagadoVigente: "30000.00" };
    const saldado = derivarPendienteCierre({ ...entrada, premiosVivos: "0.00" });
    const conPremio = derivarPendienteCierre({ ...entrada, premiosVivos: "5000.00" });
    // `premiosVivos` llega YA NETO: el repositorio resta la compensacion de la anulacion.
    const trasAnular = derivarPendienteCierre({ ...entrada, premiosVivos: "0.00" });

    expect(saldado).toBe("0.00");
    expect(conPremio).toBe("5000.00");
    expect(trasAnular).toBe(saldado);
  });

  it("con centimos, la suma del premio tambien es exacta", () => {
    expect(
      derivarPendienteCierre({
        pagoDebido: "0.30",
        efectivo: "0.00",
        premiosVivos: "0.10",
        pagadoVigente: "0.20",
      }),
    ).toBe("0.20");
  });
});

describe("293/R25 — el premio queda FUERA de la regla min(P, E)", () => {
  it("con E >= P (cierre saldado por el efectivo del dia) el premio NO se da por entregado", () => {
    // ES EL CASO QUE DISTINGUE ESTA REGLA DE LA ALTERNATIVA D (`design.md §11`): si el premio se
    // sumara DENTRO de `calcularSplitPago` (`P + premio` contra `E`), con efectivo de sobra
    // saldria `0.00` — el mensajero se quedaria sin su premio y nadie veria un error.
    const conEfectivoDeSobra = derivarPendienteCierre({
      pagoDebido: "30000.00",
      efectivo: "90000.00",
      premiosVivos: "5000.00",
      pagadoVigente: "0.00",
    });
    expect(conEfectivoDeSobra).toBe("5000.00");
    // Y la contraprueba de que la alternativa D daria otra cosa: metido dentro, `min(35000,
    // 90000) = 35000` y el pendiente seria CERO.
    expect(calcularSplitPago("35000.00", "90000.00").pendiente).toBe("0.00");
    expect(conEfectivoDeSobra).not.toBe(calcularSplitPago("35000.00", "90000.00").pendiente);
  });

  it("`calcularSplitPago` sigue viendo SOLO P y E: el premio no le llega por ningun lado", () => {
    // El `min(P,E)` que el feed escribio al aprobar el cierre no puede cambiar a posteriori.
    // P = 30 000, E = 12 000 -> la deuda PROPIA del cierre es 18 000, y es la misma con premio
    // y sin el. Las tres cifras esperadas van como LITERAL, no derivadas de la funcion bajo
    // prueba: una asercion contra su propia fuente siempre esta verde.
    expect(calcularSplitPago("30000.00", "12000.00").pendiente).toBe("18000.00");
    const casos: [string, string][] = [
      ["0.00", "18000.00"],
      ["5000.00", "23000.00"],
      ["999999.99", "1017999.99"],
    ];
    for (const [premio, esperado] of casos) {
      expect(
        derivarPendienteCierre({
          pagoDebido: "30000.00",
          efectivo: "12000.00",
          premiosVivos: premio,
          pagadoVigente: "0.00",
        }),
      ).toBe(esperado);
    }
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
    const salida = sinPremio("100", "0", "0");
    expect(typeof salida).toBe("string");
    expect(salida).toBe("100.00");
    expect(sinPremio("100.5", "0", "0.25")).toBe("100.25");
    // Y con el premio dentro, la escala se mantiene.
    expect(
      derivarPendienteCierre({
        pagoDebido: "100",
        efectivo: "0",
        premiosVivos: "0.5",
        pagadoVigente: "0.25",
      }),
    ).toBe("100.25");
  });
});
