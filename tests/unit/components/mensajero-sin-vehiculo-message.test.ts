import { describe, it, expect } from "vitest";
import { guiaDecisionErrorMessage } from "@/app/(app)/ordenes/_components/guia-decision-error-messages";
import { asignacionSateliteErrorMessage } from "@/app/(app)/recepcion-satelite/_components/asignacion-satelite-error-messages";
import { MSG_MENSAJERO_SIN_VEHICULO } from "@/lib/services/mensajes-bloqueo";

// Feature 21: el rechazo por «mensajero sin vehiculo» llega como `validation_error` con el
// motivo en `fieldErrors.mensajeroId`. Sin caso propio, LAS DOS pantallas de asignacion
// dirian «revisa la seleccion» — que manda a mirar donde el problema no esta.

const ERROR = {
  status: "validation_error" as const,
  fieldErrors: { mensajeroId: [MSG_MENSAJERO_SIN_VEHICULO] },
};

describe("mensaje de «mensajero sin vehiculo» en las dos superficies de asignacion", () => {
  it("bodega central: nombra el vehiculo y donde arreglarlo", () => {
    const msg = guiaDecisionErrorMessage(ERROR);
    expect(msg).toContain("vehículo");
    expect(msg).toContain("Configuración > Usuarios");
  });

  it("bodega satelite: MISMO texto (es la misma regla)", () => {
    expect(asignacionSateliteErrorMessage(ERROR)).toBe(guiaDecisionErrorMessage(ERROR));
  });

  it("un validation_error por otro motivo sigue cayendo en el generico", () => {
    const otro = {
      status: "validation_error" as const,
      fieldErrors: { mensajeroId: ["Selecciona un mensajero"] },
    };
    expect(guiaDecisionErrorMessage(otro)).toBe(
      "Datos inválidos: revisa la selección y vuelve a intentarlo.",
    );
  });
});
