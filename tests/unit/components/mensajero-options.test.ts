import { describe, it, expect } from "vitest";

import { toMensajeroOptions } from "@/app/(app)/ordenes/_components/mensajero-options";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

// Un mensajero que no se puede elegir se muestra DESHABILITADO y con el motivo, no
// desaparece de la lista: el maestro sabe que existe y por qué no puede elegirlo ahora.
// Ocultarlo lo dejaría preguntándose dónde está alguien que sabe que trabaja hoy.

const MENSAJEROS: MensajeroLiteDTO[] = [
  { id: "m1", nombre: "Ana" },
  { id: "m2", nombre: "Beto" },
  { id: "m3", nombre: "Carla" },
];

describe("toMensajeroOptions", () => {
  it("sin restricciones, todos elegibles y con su nombre limpio", () => {
    expect(toMensajeroOptions(MENSAJEROS)).toEqual([
      { value: "m1", label: "Ana", disabled: false },
      { value: "m2", label: "Beto", disabled: false },
      { value: "m3", label: "Carla", disabled: false },
    ]);
  });

  // Pedido humano 2026-08-18 — EL CIERRE ABIERTO YA NO DESHABILITA. Antes habia aqui dos tests
  // (uno que lo deshabilitaba y otro que le daba prioridad sobre la dedicacion) y se van con la
  // regla: el service dejo de rechazar por cierre, asi que el selector que lo prohibiera
  // mentiria. Queda este, que fija lo contrario — que tener un cierre no cambia nada.
  it("tener un cierre abierto ya no deshabilita a nadie", () => {
    // El id del mensajero con cierre no viaja siquiera: la funcion ya no acepta ese parametro.
    expect(toMensajeroOptions(MENSAJEROS)).toEqual([
      { value: "m1", label: "Ana", disabled: false },
      { value: "m2", label: "Beto", disabled: false },
      { value: "m3", label: "Carla", disabled: false },
    ]);
  });

  // Feature 157: el motivo lo pone CADA modal, porque no es el mismo en los dos sentidos
  // — al asignar una recoleccion estorba el reparto, y al asignar reparto estorba una
  // recoleccion sin confirmar—. Esta regla SIGUE viva: el service la revalida.
  it("un motivo de dedicacion lo deshabilita con SU texto", () => {
    const opciones = toMensajeroOptions(
      MENSAJEROS,
      new Map([["m3", "tiene reparto pendiente"]]),
    );

    expect(opciones[2]).toEqual({
      value: "m3",
      label: "Carla (tiene reparto pendiente)",
      disabled: true,
    });
    expect(opciones[0].disabled).toBe(false);
  });
});
