import { describe, it, expect } from "vitest";
import { pagoPorResultado } from "@/lib/utils/pago-mensajero";
import type { PagoTarifa } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";

// Feature 39 (F1.4) — tests unit del util puro `pagoPorResultado` (sin DB/red). Cubre
// R4/R5 (entregada -> cobroEntregado), R6 (rechazada -> 0.00 AUN con cobroRechazado>0),
// R7 (reprogramada/devuelta -> 0.00), R7b (todo != entregada -> 0.00, NUNCA cobroRechazado
// al mensajero), R8 (tarifa null -> 0.00 sin lanzar) y R9/R23 (STRING con 2 decimales).

// Tarifa con cobroRechazado > 0 a proposito: NINGUN caso debe devolverlo al mensajero.
const TARIFA: PagoTarifa = { cobroEntregado: "5.00", cobroRechazado: "9.99" };

describe("pagoPorResultado — entregada paga cobroEntregado (R5)", () => {
  it("R5: entregada -> cobroEntregado (STRING 2 decimales)", () => {
    const pago = pagoPorResultado("entregada", TARIFA);
    expect(pago).toBe("5.00");
    expect(typeof pago).toBe("string"); // R9/R23
  });

  it("R5/R9: normaliza a 2 decimales exactos (Decimal, sin float)", () => {
    expect(pagoPorResultado("entregada", { cobroEntregado: "5", cobroRechazado: "0" })).toBe("5.00");
    expect(pagoPorResultado("entregada", { cobroEntregado: "5.1", cobroRechazado: "0" })).toBe("5.10");
    expect(pagoPorResultado("entregada", { cobroEntregado: "5.005", cobroRechazado: "0" })).toBe("5.01");
  });
});

describe("pagoPorResultado — solo entregada paga (R6/R7/R7b)", () => {
  it("R6: rechazada -> 0.00 AUN con cobroRechazado > 0 (NUNCA se paga cobroRechazado al mensajero)", () => {
    const pago = pagoPorResultado("rechazada", TARIFA);
    expect(pago).toBe("0.00");
    expect(pago).not.toBe(TARIFA.cobroRechazado); // no es 9.99
  });

  it("R7: reprogramada -> 0.00", () => {
    expect(pagoPorResultado("reprogramada", TARIFA)).toBe("0.00");
  });

  it("R7: devuelta -> 0.00", () => {
    expect(pagoPorResultado("devuelta", TARIFA)).toBe("0.00");
  });

  it("R7b: TODO resultado != entregada -> 0.00 (incl. tarifa con cobroRechazado alto)", () => {
    for (const resultado of ["rechazada", "reprogramada", "devuelta"] as const) {
      expect(pagoPorResultado(resultado, { cobroEntregado: "5.00", cobroRechazado: "100.00" })).toBe(
        "0.00",
      );
    }
  });
});

describe("pagoPorResultado — gap de datos (R8)", () => {
  it("R8: tarifa null -> 0.00 sin lanzar, para cualquier resultado", () => {
    expect(pagoPorResultado("entregada", null)).toBe("0.00");
    expect(pagoPorResultado("rechazada", null)).toBe("0.00");
    expect(pagoPorResultado("reprogramada", null)).toBe("0.00");
    expect(pagoPorResultado("devuelta", null)).toBe("0.00");
  });
});
