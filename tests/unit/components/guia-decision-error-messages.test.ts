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
      "Alguna orden de la selección ya no admite esta acción. Actualiza la lista y vuelve a intentarlo.",
    );
    expect(guiaDecisionErrorMessage(conflict("geocodificacion_agotada"))).not.toBe(
      generico,
    );
  });

  it("R9: no hay regresión — un conflict con otro motivo sigue en el mensaje por status", () => {
    expect(guiaDecisionErrorMessage(conflict("orden_borrada"))).toBe(
      "Alguna orden de la selección ya no admite esta acción. Actualiza la lista y vuelve a intentarlo.",
    );
    expect(asignacionSateliteErrorMessage(conflict("orden_borrada"))).toBe(
      "Alguna orden de la selección ya no se puede asignar. Actualiza la lista y vuelve a intentarlo.",
    );
  });

  it("R9: el motivo de bodega satélite bloqueada conserva su mensaje propio", () => {
    expect(
      guiaDecisionErrorMessage(conflict("bodega satelite bloqueada")),
    ).toContain("bodega satélite");
  });

  // El genérico habla de "estado" y MIENTE cuando la causa es otra: el reporte de
  // producción fue "no puedo asignar" con las órdenes en un estado perfectamente válido,
  // bloqueadas en realidad por el cierre abierto del mensajero elegido.
  it("el mensajero con cierre pendiente tiene mensaje propio, no el genérico de estado", () => {
    const mensaje = guiaDecisionErrorMessage(
      conflict("mensajero bloqueado por cierre pendiente"),
    );
    expect(mensaje).toMatch(/cierre sin resolver/i);
    expect(mensaje).not.toMatch(/estado válido/i);
  });

  it("la orden reprogramada tiene mensaje propio, no el genérico de estado", () => {
    const mensaje = guiaDecisionErrorMessage(
      conflict("orden reprogramada: bloqueada hasta la fecha de reprogramacion"),
    );
    expect(mensaje).toMatch(/reprogramada/i);
    expect(mensaje).not.toMatch(/estado válido/i);
  });

  it("R9: entradas defensivas (null, sin detalle, detalle no-array) no rompen el mapper", () => {
    expect(guiaDecisionErrorMessage(null)).toBe(
      "No se pudo completar la operación. Actualiza la página y vuelve a intentarlo.",
    );
    expect(guiaDecisionErrorMessage({ status: "forbidden" })).toBe(
      "No tienes permiso para esta acción.",
    );
    expect(guiaDecisionErrorMessage({ status: "conflict", detalle: "nope" })).toBe(
      "Alguna orden de la selección ya no admite esta acción. Actualiza la lista y vuelve a intentarlo.",
    );
  });
});

// El reporte que motivo esta tanda: asignar reparto a un mensajero que estaba recolectando
// devolvia "Alguna orden ya no está en un estado válido", que es falso —el estado era
// correcto— e inútil: no decia que hacer. Cada motivo que el backend sabe distinguir tiene
// ahora su frase, y todas terminan en una accion posible.
describe("cada motivo del backend llega al usuario con su causa y su salida", () => {
  it.each([
    ["mensajero con recoleccion pendiente (el bug reportado)",
     "el mensajero tiene una recoleccion en tienda pendiente: debe cerrarla antes de recibir reparto",
     /recolección en tienda sin confirmar/i],
    ["mensajero con reparto pendiente",
     "el mensajero tiene ordenes de reparto pendientes: una recoleccion en tienda exige ir sin carga",
     /órdenes de reparto pendientes/i],
    ["estado cambiado bajo los pies",
     "estado de origen no permitido: en_bodega_central",
     /ya cambió de estado/i],
    ["orden inexistente", "orden no existe", /ya no existe/i],
    ["orden borrada", "orden borrada", /fue eliminada/i],
    ["orden GAM que no se rutea a satelite",
     "orden GAM no se rutea a satelite", /zona central/i],
    ["orden no-GAM en la bodega central", "orden de zona no-GAM", /bodega satélite/i],
  ])("%s", (_caso, motivo, esperado) => {
    const mensaje = guiaDecisionErrorMessage(conflict(motivo));
    expect(mensaje).toMatch(esperado);
    // Ninguno cae ya en el generico, que es lo que hacia el mensaje impreciso.
    expect(mensaje).not.toMatch(/ya no admite esta acción/i);
  });
});
