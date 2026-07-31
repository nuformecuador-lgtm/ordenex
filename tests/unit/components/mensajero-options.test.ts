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

  it("un cierre abierto lo deshabilita y lo dice", () => {
    const opciones = toMensajeroOptions(MENSAJEROS, new Set(["m2"]));

    expect(opciones[1]).toEqual({
      value: "m2",
      label: "Beto (cierre abierto)",
      disabled: true,
    });
    expect(opciones[0].disabled).toBe(false);
  });

  // Feature 157: el motivo lo pone CADA modal, porque no es el mismo en los dos sentidos
  // — al asignar una recolección estorba el reparto, y al asignar reparto estorba una
  // recolección sin confirmar—.
  it("un motivo de dedicación lo deshabilita con SU texto", () => {
    const opciones = toMensajeroOptions(
      MENSAJEROS,
      new Set(),
      new Map([["m3", "tiene reparto pendiente"]]),
    );

    expect(opciones[2]).toEqual({
      value: "m3",
      label: "Carla (tiene reparto pendiente)",
      disabled: true,
    });
  });

  it("el cierre GANA sobre la dedicación: es lo que hay que resolver primero", () => {
    const opciones = toMensajeroOptions(
      MENSAJEROS,
      new Set(["m1"]),
      new Map([["m1", "tiene reparto pendiente"]]),
    );

    expect(opciones[0].label).toBe("Ana (cierre abierto)");
  });
});
