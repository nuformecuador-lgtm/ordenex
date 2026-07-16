import { describe, it, expect } from "vitest";
import { guiaDecisionErrorMessage } from "@/app/(app)/ordenes/_components/guia-decision-error-messages";

// Ajuste maestro: el `conflict` por rutear a una bodega satelite con TODOS sus
// mensajeros en cierre debe traducirse a un mensaje especifico (no el generico de
// conflict), detectando el `motivo` en el `detalle`.

describe("guiaDecisionErrorMessage", () => {
  it("conflict con motivo de bodega satelite bloqueada -> mensaje especifico", () => {
    const error = {
      status: "conflict",
      detalle: [
        {
          ordenId: "o1",
          motivo: "bodega satelite bloqueada: todos sus mensajeros tienen un cierre abierto",
        },
      ],
    };
    expect(guiaDecisionErrorMessage(error)).toMatch(
      /bodega satélite cuyos mensajeros están todos con un cierre abierto/i,
    );
  });

  it("conflict de otro motivo -> mensaje generico de conflict", () => {
    const error = {
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "estado de origen no permitido: en_bodega" }],
    };
    expect(guiaDecisionErrorMessage(error)).toMatch(/estado válido para esta acción/i);
  });

  it("status conocido sin detalle -> mensaje por status", () => {
    expect(guiaDecisionErrorMessage({ status: "forbidden" })).toMatch(/no tienes permiso/i);
  });

  it("error desconocido -> fallback generico", () => {
    expect(guiaDecisionErrorMessage(null)).toBe("No se pudo completar la operación.");
  });
});
