import { describe, it, expect } from "vitest";
import { guiaDecisionErrorMessage } from "@/app/(app)/ordenes/_components/guia-decision-error-messages";

// Ajuste maestro: el `conflict` por rutear a una bodega satelite bloqueada (>=1 de sus
// mensajeros con un cierre abierto, decision del humano 2026-07-16) debe traducirse a un
// mensaje especifico (no el generico de conflict), detectando el `motivo` en el
// `detalle`. El mapper hace match por el substring estable "bodega satelite bloqueada",
// asi que el sufijo del motivo puede cambiar sin romperlo.

describe("guiaDecisionErrorMessage", () => {
  it("conflict con motivo de bodega satelite bloqueada -> mensaje especifico", () => {
    const error = {
      status: "conflict",
      detalle: [
        {
          ordenId: "o1",
          // Motivo real que emite hoy GuiaAsignacionService (regla >=1).
          motivo: "bodega satelite bloqueada: tiene un mensajero con un cierre abierto",
        },
      ],
    };
    expect(guiaDecisionErrorMessage(error)).toMatch(
      // La copia sigue la regla real (>=1 mensajero en cierre), no "todos".
      /bodega satélite que tiene al menos un mensajero con un cierre abierto/i,
    );
  });

  it("conflict de otro motivo -> mensaje generico de conflict", () => {
    const error = {
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "estado de origen no permitido: en_bodega_central" }],
    };
    expect(guiaDecisionErrorMessage(error)).toMatch(/ya cambió de estado/i);
  });

  it("status conocido sin detalle -> mensaje por status", () => {
    expect(guiaDecisionErrorMessage({ status: "forbidden" })).toMatch(/no tienes permiso/i);
  });

  it("error desconocido -> fallback generico", () => {
    expect(guiaDecisionErrorMessage(null)).toBe("No se pudo completar la operación. Actualiza la página y vuelve a intentarlo.");
  });

  // Feature 156: el mapper lo comparten "Generar guia" (sin seleccion de mensajero) y
  // "Asignar desde bodega" (con ella), asi que el texto de validation_error NO puede
  // pedir revisar un control que la primera pantalla no tiene.
  it("validation_error -> texto generico que no nombra la seleccion de mensajero", () => {
    const msg = guiaDecisionErrorMessage({
      status: "validation_error",
      fieldErrors: { estatus: ["catalogo de estados incompleto (seed pendiente)"] },
    });
    expect(msg).toBe("Datos inválidos: revisa la selección y vuelve a intentarlo.");
    expect(msg).not.toMatch(/mensajero/i);
  });
});
