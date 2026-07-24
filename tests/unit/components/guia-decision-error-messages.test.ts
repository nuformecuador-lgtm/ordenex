import { describe, it, expect } from "vitest";

import { guiaDecisionErrorMessage } from "@/app/(app)/ordenes/_components/guia-decision-error-messages";
import { asignacionSateliteErrorMessage } from "@/app/(app)/recepcion-satelite/_components/asignacion-satelite-error-messages";
import {
  MSG_DIRECCION_EN_VALIDACION,
  MSG_DIRECCION_NO_ENCONTRADA,
  MOTIVOS_DIRECCION_EN_VALIDACION,
  MOTIVOS_DIRECCION_NO_ENCONTRADA,
} from "@/app/(app)/_components/geocodificacion-motivo-messages";

// Feature 93 (R9) — el mapeo de los 5 `motivo` del gate de coordenadas (92) a
// los 2 mensajes de usuario vive en UN solo sitio y lo consultan los DOS mappers
// (`guiaDecisionErrorMessage` y `asignacionSateliteErrorMessage`), que cubren los
// cuatro modales de asignación. Antes de la 93 ambos ramificaban solo por
// `status` y el `motivo` se descartaba antes del toast.

function conflict(...motivos: string[]) {
  return {
    status: "conflict",
    detalle: motivos.map((motivo, i) => ({ ordenId: `o${i + 1}`, motivo })),
  };
}

describe("R9 · mapeo de motivos del gate de coordenadas", () => {
  it("R9: los 5 motivos declarados se reparten en exactamente 2 mensajes", () => {
    const todos = [
      ...MOTIVOS_DIRECCION_NO_ENCONTRADA,
      ...MOTIVOS_DIRECCION_EN_VALIDACION,
    ];
    expect(todos).toHaveLength(5);
    const mensajes = new Set(todos.map((m) => guiaDecisionErrorMessage(conflict(m))));
    expect(mensajes.size).toBe(2);
  });

  it.each(MOTIVOS_DIRECCION_NO_ENCONTRADA)(
    'R9: "%s" → "Dirección no encontrada" (desenlace definitivo)',
    (motivo) => {
      expect(guiaDecisionErrorMessage(conflict(motivo))).toBe(
        "Dirección no encontrada",
      );
      expect(asignacionSateliteErrorMessage(conflict(motivo))).toBe(
        "Dirección no encontrada",
      );
    },
  );

  it.each(MOTIVOS_DIRECCION_EN_VALIDACION)(
    'R9: "%s" → mensaje DISTINTO de validación en curso (no es fallo definitivo)',
    (motivo) => {
      const msg = guiaDecisionErrorMessage(conflict(motivo));
      expect(msg).toBe(MSG_DIRECCION_EN_VALIDACION);
      expect(msg).not.toBe(MSG_DIRECCION_NO_ENCONTRADA);
      expect(msg).toMatch(/valid/i);
      expect(asignacionSateliteErrorMessage(conflict(motivo))).toBe(msg);
    },
  );

  it("R9: el literal pedido es exactamente 'Dirección no encontrada'", () => {
    expect(MSG_DIRECCION_NO_ENCONTRADA).toBe("Dirección no encontrada");
  });

  it("R9: si conviven un motivo definitivo y uno transitorio gana el definitivo", () => {
    expect(
      guiaDecisionErrorMessage(
        conflict("geocodificacion_en_curso", "direccion_no_geocodificable"),
      ),
    ).toBe(MSG_DIRECCION_NO_ENCONTRADA);
  });

  it("R9: el motivo se lee ANTES del switch por status (no cae en el genérico de conflict)", () => {
    const generico = guiaDecisionErrorMessage({ status: "conflict" });
    expect(generico).toBe(
      "Alguna orden ya no está en un estado válido para esta acción.",
    );
    expect(guiaDecisionErrorMessage(conflict("geocodificacion_agotada"))).not.toBe(
      generico,
    );
  });

  it("R9: no hay regresión — un conflict con otro motivo sigue en el mensaje por status", () => {
    expect(guiaDecisionErrorMessage(conflict("orden_borrada"))).toBe(
      "Alguna orden ya no está en un estado válido para esta acción.",
    );
    expect(asignacionSateliteErrorMessage(conflict("orden_borrada"))).toBe(
      "Alguna orden ya no está en un estado válido para asignarse.",
    );
  });

  it("R9: el motivo de bodega satélite bloqueada conserva su mensaje propio", () => {
    expect(
      guiaDecisionErrorMessage(conflict("bodega satelite bloqueada")),
    ).toContain("bodega satélite");
  });

  it("R9: entradas defensivas (null, sin detalle, detalle no-array) no rompen el mapper", () => {
    expect(guiaDecisionErrorMessage(null)).toBe("No se pudo completar la operación.");
    expect(guiaDecisionErrorMessage({ status: "forbidden" })).toBe(
      "No tienes permiso para esta acción.",
    );
    expect(guiaDecisionErrorMessage({ status: "conflict", detalle: "nope" })).toBe(
      "Alguna orden ya no está en un estado válido para esta acción.",
    );
  });
});
