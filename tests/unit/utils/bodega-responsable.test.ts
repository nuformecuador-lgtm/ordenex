import { describe, it, expect } from "vitest";
import { resolverDestinoCierre } from "@/lib/utils/bodega-responsable";

// Feature 41/B1 (R1) — derivacion UNICA de la bodega responsable, compartida por
// solicitarCierre (37) y el corte diario (41). central vs satelite + fallback seguro.

describe("resolverDestinoCierre (R1)", () => {
  it("R1: zona == central -> bodega_central con la propia zona", () => {
    expect(resolverDestinoCierre("z-central", "z-central")).toEqual({
      destinoTipo: "bodega_central",
      destinoZonaId: "z-central",
    });
  });

  it("R1: zona != central -> bodega_satelite con la propia zona", () => {
    expect(resolverDestinoCierre("z-cartago", "z-central")).toEqual({
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z-cartago",
    });
  });

  it("R1 (fallback seguro): centralZonaId null -> NINGUN mensajero es central -> bodega_satelite", () => {
    expect(resolverDestinoCierre("z-cartago", null)).toEqual({
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z-cartago",
    });
    // incluso una zona que "seria" la central cae a satelite si no hay central marcada.
    expect(resolverDestinoCierre("z-central", null).destinoTipo).toBe("bodega_satelite");
  });
});
