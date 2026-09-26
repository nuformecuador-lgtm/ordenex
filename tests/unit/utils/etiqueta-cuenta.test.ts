import { describe, expect, it } from "vitest";

import { CUENTA_SIN_NOMBRE, etiquetaDeCuenta } from "@/lib/utils/etiqueta-cuenta";

// Ficha 458-A (TA.1, R33, P5): una sola funcion nombra tiendas, mensajeros y bodegas en la wallet.
// Los literales se escriben a mano: SON el contrato («Tania Tienda» en todas las superficies).

describe("etiquetaDeCuenta (458-A, R33)", () => {
  it("una tienda con primer apellido se lee igual en tablas, avisos e historial: «Tania Tienda»", () => {
    expect(etiquetaDeCuenta({ nombre: "Tania", primerApellido: "Tienda", segundoApellido: null })).toBe(
      "Tania Tienda",
    );
  });

  it("un mensajero se nombra completo, sin huecos ni espacios de mas", () => {
    expect(
      etiquetaDeCuenta({ nombre: " Juan ", primerApellido: "Pérez", segundoApellido: "  Mora" }),
    ).toBe("Juan Pérez Mora");
    expect(etiquetaDeCuenta({ nombre: "Juan", primerApellido: "", segundoApellido: "Mora" })).toBe(
      "Juan Mora",
    );
  });

  it("una bodega satélite se nombra por su zona", () => {
    expect(etiquetaDeCuenta({ nombre: "Satélite Liberia" })).toBe("Satélite Liberia");
  });

  it("R4: sin cuenta o con el nombre en blanco dice un texto legible, nunca vacío ni un id", () => {
    expect(etiquetaDeCuenta(null)).toBe(CUENTA_SIN_NOMBRE);
    expect(etiquetaDeCuenta(undefined)).toBe(CUENTA_SIN_NOMBRE);
    expect(etiquetaDeCuenta({ nombre: "   ", primerApellido: null })).toBe(CUENTA_SIN_NOMBRE);
    expect(CUENTA_SIN_NOMBRE).toBe("Cuenta sin nombre");
  });
});
