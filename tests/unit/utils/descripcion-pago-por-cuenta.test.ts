import { describe, expect, it } from "vitest";

import {
  descripcionAnulacionPagoPorCuenta,
  descripcionPagoPorCuentaEnCaja,
  descripcionPagoPorCuentaEnTienda,
} from "@/lib/utils/descripcion-pago-por-cuenta";

/** FICHA 459 / T B.8 — R43: las lineas del pago por cuenta, sin ningun identificador interno. */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("459/B.8 — descripciones del pago por cuenta de una tienda", () => {
  it("libro de la tienda, con referencia", () => {
    expect(
      descripcionPagoPorCuentaEnTienda({
        beneficiario: "Facebook",
        motivo: "Publicidad de septiembre",
        metodo: "SINPE",
        referencia: "1234567",
      }),
    ).toBe("A Facebook · Publicidad de septiembre · SINPE · 1234567");
  });

  it("libro de la tienda, en efectivo y sin referencia", () => {
    expect(
      descripcionPagoPorCuentaEnTienda({
        beneficiario: "Jet Cargo",
        motivo: "Importacion",
        metodo: "efectivo",
        referencia: null,
      }),
    ).toBe("A Jet Cargo · Importacion · Efectivo");
  });

  it("recorta los espacios que rodean el texto libre", () => {
    expect(
      descripcionPagoPorCuentaEnTienda({
        beneficiario: "  Daniel  ",
        motivo: " Salario ",
        metodo: "transferencia",
        referencia: " TR-9 ",
      }),
    ).toBe("A Daniel · Salario · Transferencia · TR-9");
  });

  it("la caja antepone el NOMBRE de la tienda", () => {
    expect(
      descripcionPagoPorCuentaEnCaja("Nuform", {
        beneficiario: "Facebook",
        motivo: "Publicidad",
        metodo: "SINPE",
        referencia: "88",
      }),
    ).toBe("Nuform · A Facebook · Publicidad · SINPE · 88");
  });

  it("la anulacion antepone «Anulación · » a la linea original, sin el motivo de la anulacion", () => {
    const original = "Nuform · A Facebook · Publicidad · SINPE · 88";
    expect(descripcionAnulacionPagoPorCuenta(original)).toBe(`Anulación · ${original}`);
  });

  it("ninguna de las tres lineas tiene forma de uuid (R43/R100)", () => {
    const datos = {
      beneficiario: "Facebook",
      motivo: "Publicidad",
      metodo: "SINPE" as const,
      referencia: "88",
    };
    const lineas = [
      descripcionPagoPorCuentaEnTienda(datos),
      descripcionPagoPorCuentaEnCaja("Nuform", datos),
      descripcionAnulacionPagoPorCuenta(descripcionPagoPorCuentaEnCaja("Nuform", datos)),
    ];
    for (const l of lineas) expect(l).not.toMatch(UUID);
    // Contraprueba del detector: una linea con un uuid SI casa.
    expect("x · 7f1c2d3e-0000-4000-8000-000000000001").toMatch(UUID);
  });
});
