import { describe, it, expect } from "vitest";
import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGEN_TIPOS_CON_GESTION,
} from "@/lib/types/orden-historial";
import { TRANSICIONES } from "@/lib/types/order-status-transiciones";

// Feature 149 — T1.2 (R25/R26): el nuevo tipo de origen `deshacer_asignacion` existe como
// familia PROPIA y queda FUERA del conjunto de origenes "con gestion". El criterio (documentado
// en `lib/types/orden-historial.ts`) es doble: (i) nunca enlaza una gestion y (ii) su destino
// nunca es `devuelta`, asi que jamas altera el conteo de intentos de devolucion.

const DESHACER = "deshacer_asignacion";

describe("R25 — `deshacer_asignacion` es un tipo de origen PROPIO del historial", () => {
  it("esta en ORDEN_HISTORIAL_ORIGEN_TIPO_SEED", () => {
    expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toContain(DESHACER);
  });

  it("es distinguible de las familias de asignacion/ruteo/ajuste ya existentes", () => {
    for (const otro of [
      "asignacion_bodega",
      "asignacion_satelite",
      "ruteo_satelite",
      "generacion_guia",
      "ajuste_estado",
      "deshacer_gestion",
    ]) {
      expect(DESHACER).not.toBe(otro);
      expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toContain(otro);
    }
  });

  it("el SEED no tiene duplicados (el valor se añadio una sola vez)", () => {
    const unicos = new Set<string>(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED);
    expect(unicos.size).toBe(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.length);
  });
});

describe("R26 — `deshacer_asignacion` NO entra en ORIGEN_TIPOS_CON_GESTION", () => {
  it("no figura en la familia de origenes que enlazan una gestion", () => {
    expect(ORIGEN_TIPOS_CON_GESTION).not.toContain(DESHACER);
  });

  it("la familia sigue teniendo EXACTAMENTE dos valores (gestion / deshacer_gestion)", () => {
    expect([...ORIGEN_TIPOS_CON_GESTION]).toEqual(["gestion", "deshacer_gestion"]);
  });

  it("ninguna arista declarada con via `deshacer_asignacion` tiene destino `devuelta`", () => {
    const destinos = Object.values(TRANSICIONES)
      .flatMap((ds) => ds as readonly { to: string; via: string }[])
      .filter((d) => d.via === DESHACER)
      .map((d) => d.to);
    expect(destinos.length).toBeGreaterThan(0);
    // Feature 157 (ampliacion): la familia gana un tercer destino — la reversion de una
    // recoleccion devuelve la orden a la espera en la tienda—. Sigue cumpliendo lo que este
    // guard protege: los destinos de `deshacer_asignacion` son sitios donde la orden ESPERA a
    // que alguien la tome, nunca `devuelta`, que la metería en el criterio de intentos (160).
    expect([...new Set(destinos)].sort()).toEqual([
      "en_bodega_central",
      "en_bodega_satelite",
      "por_recolectar_en_tienda",
    ]);
    expect(destinos).not.toContain("devuelta");
  });
});
