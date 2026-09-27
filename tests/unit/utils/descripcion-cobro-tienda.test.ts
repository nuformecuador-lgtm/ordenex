import { describe, it, expect } from "vitest";

import {
  descripcionAnulacionCobro,
  descripcionCobroEnCaja,
} from "@/lib/utils/descripcion-cobro-tienda";

/**
 * FICHA 461 / T B.5 (R7) — las descripciones del cobro de Ordenex a una tienda en la caja y de sus
 * contra-asientos. Literales a mano: son lo que la persona lee en el libro.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("461/B.5 (R7) — la linea de caja del cobro: «{Tienda} · {descripcion}»", () => {
  it("con el nombre y el apellido de la tienda, tal como los compone `etiquetaDePersona`", () => {
    expect(descripcionCobroEnCaja("Nuform Rev", "Pago publicidad de la tienda")).toBe(
      "Nuform Rev · Pago publicidad de la tienda",
    );
  });

  it("con una tienda sin apellido", () => {
    expect(descripcionCobroEnCaja("Nuform", "Pago publicidad de la tienda")).toBe(
      "Nuform · Pago publicidad de la tienda",
    );
  });

  it("recorta los espacios de las dos partes y no deja el separador suelto si falta una", () => {
    expect(descripcionCobroEnCaja("  Nuform  ", "  Cintas  ")).toBe("Nuform · Cintas");
    expect(descripcionCobroEnCaja("Nuform", null)).toBe("Nuform");
    expect(descripcionCobroEnCaja("Nuform", "   ")).toBe("Nuform");
  });

  it("es la MISMA composicion que la migracion de datos (`concat_ws(' · ', tienda, descripcion)`)", () => {
    // Una linea completada por la migracion y una escrita por el servicio se leen igual.
    expect(descripcionCobroEnCaja("Tienda Uno", "Reposicion de etiquetas")).toBe(
      "Tienda Uno · Reposicion de etiquetas",
    );
  });
});

describe("461/B.5 (R10/R11) — el contra-asiento: «Anulación · {original}»", () => {
  it("antepone «Anulación · » a la descripcion original, en la tienda y en la caja", () => {
    expect(descripcionAnulacionCobro("Pago publicidad de la tienda")).toBe(
      "Anulación · Pago publicidad de la tienda",
    );
    expect(descripcionAnulacionCobro(descripcionCobroEnCaja("Nuform Rev", "Pago publicidad de la tienda"))).toBe(
      "Anulación · Nuform Rev · Pago publicidad de la tienda",
    );
  });

  it("sin descripcion original queda solo «Anulación», sin separador suelto", () => {
    expect(descripcionAnulacionCobro(null)).toBe("Anulación");
    expect(descripcionAnulacionCobro("   ")).toBe("Anulación");
  });

  it("NO lleva el motivo de la anulacion: eso vive en su propia tabla", () => {
    const linea = descripcionAnulacionCobro("Cintas");
    expect(linea).not.toMatch(/motivo|duplicad/i);
  });
});

describe("461/B.5 (R7/R52) — ningun identificador interno", () => {
  it("las tres lineas se componen sin forma de uuid aunque se les pase el nombre y el texto reales", () => {
    const lineas = [
      descripcionCobroEnCaja("Tienda 461 a1b2c3d4", "Reposicion"),
      descripcionAnulacionCobro("Reposicion"),
      descripcionAnulacionCobro(descripcionCobroEnCaja("Tienda 461", "Reposicion")),
    ];
    for (const l of lineas) expect(l).not.toMatch(UUID);
    // Control positivo del detector: SI caza un uuid si alguien lo colara.
    expect("Tienda · 0b1e6f1a-6d3a-4c6e-9c8f-3a1c9d2b7e55").toMatch(UUID);
  });
});
