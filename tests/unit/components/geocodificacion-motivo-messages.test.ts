import { describe, it, expect } from "vitest";

import {
  geocodificacionMotivoMessage,
  mensajeDireccionPorMotivo,
  MSG_DIRECCION_NO_ENCONTRADA,
  MSG_DIRECCION_EN_VALIDACION,
} from "@/app/(app)/_components/geocodificacion-motivo-messages";

// Feature 368 (T2, R11) — `mensajeDireccionPorMotivo` traduce UN motivo del gate de
// asignabilidad por coordenadas (feature 92) a su mensaje, sin agregar: es el mensaje
// POR ORDEN que necesita el éxito parcial, a diferencia de `geocodificacionMotivoMessage`
// (que agrega TODOS los motivos de un lote en un único mensaje "ganador").

describe("mensajeDireccionPorMotivo (368/R11) — mensaje de UN motivo, sin agregar", () => {
  it.each([
    ["direccion_no_geocodificable", MSG_DIRECCION_NO_ENCONTRADA],
    ["geocodificacion_agotada", MSG_DIRECCION_NO_ENCONTRADA],
    ["geocodificacion_en_curso", MSG_DIRECCION_EN_VALIDACION],
    ["geocodificacion_encolada", MSG_DIRECCION_EN_VALIDACION],
    ["geocodificacion_no_encolable", MSG_DIRECCION_EN_VALIDACION],
  ])("motivo %s -> %s", (motivo, esperado) => {
    expect(mensajeDireccionPorMotivo(motivo)).toBe(esperado);
  });

  it.each(["zona_ajena", "estado_invalido: en_reparto", "motivo_que_nadie_mapea"])(
    "motivo NO reconocido del gate (%s) -> null",
    (motivo) => {
      expect(mensajeDireccionPorMotivo(motivo)).toBeNull();
    },
  );
});

// No-regresión (T2.3): `geocodificacionMotivoMessage`, la función agregada existente que
// consumen los dos mappers de error, sigue comportándose igual — ambas funciones comparten
// el mismo `MOTIVO_A_MENSAJE` interno, y esta suite prueba que compartirlo no le cambió nada.
describe("geocodificacionMotivoMessage — no-regresión tras añadir mensajeDireccionPorMotivo", () => {
  it("un único motivo definitivo sigue devolviendo 'Dirección no encontrada'", () => {
    expect(
      geocodificacionMotivoMessage({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo: "direccion_no_geocodificable" }],
      }),
    ).toBe(MSG_DIRECCION_NO_ENCONTRADA);
  });

  it("un único motivo transitorio sigue devolviendo el mensaje EN VALIDACIÓN", () => {
    expect(
      geocodificacionMotivoMessage({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo: "geocodificacion_encolada" }],
      }),
    ).toBe(MSG_DIRECCION_EN_VALIDACION);
  });

  it("mezcla de definitivo y transitorio en el mismo detalle sigue agregando al DEFINITIVO", () => {
    expect(
      geocodificacionMotivoMessage({
        status: "conflict",
        detalle: [
          { ordenId: "o1", motivo: "geocodificacion_encolada" },
          { ordenId: "o2", motivo: "geocodificacion_agotada" },
        ],
      }),
    ).toBe(MSG_DIRECCION_NO_ENCONTRADA);
  });

  it("sin ningún motivo del gate sigue devolviendo null", () => {
    expect(
      geocodificacionMotivoMessage({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo: "zona_ajena" }],
      }),
    ).toBeNull();
  });
});
