import { describe, it, expect } from "vitest";
import { ingresoBodegaPorResultado } from "@/lib/utils/ingreso-bodega";
import type { PagoTarifa } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";

// Feature 56 (F1.4) — tests unit del util puro `ingresoBodegaPorResultado` (sin DB/red).
// Cubre R1 (usa cobroRechazado de la tarifa resuelta), R3 (rechazada + cobroRechazado>0 ->
// ese monto), R4 (entregada/reprogramada/devuelta -> 0.00), R5 (rechazada con
// cobroRechazado==0 -> 0.00), R6 (tarifa null -> 0.00 sin lanzar) y R7 (Decimal exacto,
// STRING escala 2, sin parseFloat/float).

// Tarifa con AMBOS cobros > 0: verifica que se usa cobroRechazado, NUNCA cobroEntregado.
const TARIFA: PagoTarifa = { cobroEntregado: "5.00", cobroRechazado: "9.99" };

describe("ingresoBodegaPorResultado — rechazada aplica cobroRechazado (R1/R3)", () => {
  it("R3: rechazada + cobroRechazado>0 -> cobroRechazado (STRING 2 decimales)", () => {
    const ingreso = ingresoBodegaPorResultado("rechazada", TARIFA);
    expect(ingreso).toBe("9.99");
    expect(typeof ingreso).toBe("string"); // R7
  });

  it("R1/R3: usa cobroRechazado, NUNCA cobroEntregado", () => {
    const ingreso = ingresoBodegaPorResultado("rechazada", TARIFA);
    expect(ingreso).not.toBe(TARIFA.cobroEntregado); // no es 5.00
    expect(ingreso).toBe(TARIFA.cobroRechazado);
  });

  it("R7: normaliza a 2 decimales exactos (Decimal, sin float)", () => {
    expect(ingresoBodegaPorResultado("rechazada", { cobroEntregado: "0", cobroRechazado: "3" })).toBe("3.00");
    expect(ingresoBodegaPorResultado("rechazada", { cobroEntregado: "0", cobroRechazado: "3.1" })).toBe("3.10");
    expect(ingresoBodegaPorResultado("rechazada", { cobroEntregado: "0", cobroRechazado: "3.005" })).toBe("3.01");
  });
});

describe("ingresoBodegaPorResultado — solo rechazada genera ingreso (R4)", () => {
  it("R4: entregada -> 0.00 AUN con cobroRechazado > 0", () => {
    const ingreso = ingresoBodegaPorResultado("entregada", TARIFA);
    expect(ingreso).toBe("0.00");
    expect(ingreso).not.toBe(TARIFA.cobroRechazado); // no es 9.99
  });

  it("R4: reprogramada -> 0.00", () => {
    expect(ingresoBodegaPorResultado("reprogramada", TARIFA)).toBe("0.00");
  });

  it("R4: devuelta -> 0.00", () => {
    expect(ingresoBodegaPorResultado("devuelta", TARIFA)).toBe("0.00");
  });

  it("R4: TODO resultado != rechazada -> 0.00 (incl. tarifa con cobroRechazado alto)", () => {
    for (const resultado of ["entregada", "reprogramada", "devuelta"] as const) {
      expect(
        ingresoBodegaPorResultado(resultado, { cobroEntregado: "5.00", cobroRechazado: "100.00" }),
      ).toBe("0.00");
    }
  });
});

describe("ingresoBodegaPorResultado — condicion de aplicacion (R5)", () => {
  it("R5: rechazada con cobroRechazado == 0.00 -> 0.00 (no aplica el pago por rechazo)", () => {
    expect(ingresoBodegaPorResultado("rechazada", { cobroEntregado: "5.00", cobroRechazado: "0.00" })).toBe("0.00");
    expect(ingresoBodegaPorResultado("rechazada", { cobroEntregado: "5.00", cobroRechazado: "0" })).toBe("0.00");
  });
});

describe("ingresoBodegaPorResultado — gap de datos (R6)", () => {
  it("R6: tarifa null -> 0.00 sin lanzar, para cualquier resultado", () => {
    expect(ingresoBodegaPorResultado("rechazada", null)).toBe("0.00");
    expect(ingresoBodegaPorResultado("entregada", null)).toBe("0.00");
    expect(ingresoBodegaPorResultado("reprogramada", null)).toBe("0.00");
    expect(ingresoBodegaPorResultado("devuelta", null)).toBe("0.00");
  });
});
