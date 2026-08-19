// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { EstatusBadge, ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 154 (R29/R30/R31) — presentacion de los DOS estados nuevos.
// `ORDER_STATUS_VARIANT` y `ORDER_STATUS_CLASS` son privados del modulo, asi que la VARIANTE se
// verifica sobre el DOM renderizado y POR COMPARACION con el estado que el gate uso de criterio
// (Q5, confirmada por el humano el 2026-07-29):
//   - `por_recolectar_en_tienda` es un estado de ESPERA -> mismo chip que `por_devolver` (warning)
//   - `incidente` es un cierre en error       -> mismo chip que `rechazada` (danger)
// Ninguno lleva refuerzo de acento de marca, asi que la igualdad de clases con su gemelo debe
// ser EXACTA (si alguien le añadiera un `ORDER_STATUS_CLASS`, este test lo caza).

afterEach(() => {
  cleanup();
});

function classesDe(value: string): string[] {
  const { container } = render(<EstatusBadge value={value} />);
  const el = container.firstElementChild as HTMLElement;
  return el.className.split(/\s+/).filter(Boolean);
}

describe("154/R29 — por_recolectar_en_tienda se presenta con etiqueta y variante propias", () => {
  it("la etiqueta legible en español es “Por recolectar en tienda”", () => {
    expect(ORDER_STATUS_LABELS.por_recolectar_en_tienda).toBe("Por recolectar en tienda");
    render(<EstatusBadge value="por_recolectar_en_tienda" />);
    expect(screen.getByText("Por recolectar en tienda")).toBeInTheDocument();
  });

  it("usa la variante de ESPERA: mismo chip que `por_devolver` (warning), sin acento de marca", () => {
    const nuevo = classesDe("por_recolectar_en_tienda");
    cleanup();
    const espera = classesDe("por_devolver");
    expect(nuevo).toEqual(espera);
    expect(nuevo).not.toContain("bg-brand-soft");
  });

  it("NO comparte chip con un cierre en error (`rechazada`)", () => {
    const nuevo = classesDe("por_recolectar_en_tienda");
    cleanup();
    const error = classesDe("rechazada");
    expect(nuevo).not.toEqual(error);
  });
});

describe("154/R30 — incidente se presenta con etiqueta y variante propias", () => {
  it("la etiqueta legible en español es “Incidente”", () => {
    expect(ORDER_STATUS_LABELS.incidente).toBe("Incidente");
    render(<EstatusBadge value="incidente" />);
    expect(screen.getByText("Incidente")).toBeInTheDocument();
  });

  it("usa la variante de ERROR: mismo chip que `rechazada` (danger), sin acento de marca", () => {
    const nuevo = classesDe("incidente");
    cleanup();
    const rechazada = classesDe("rechazada");
    expect(nuevo).toEqual(rechazada);
    expect(nuevo).not.toContain("bg-brand-soft");
  });
});

describe("154/R31 — un estatus fuera del catalogo del build no rompe la vista", () => {
  it("muestra el value CRUDO con la variante neutra", () => {
    const desconocido = classesDe("estado_del_futuro");
    expect(screen.getByText("estado_del_futuro")).toBeInTheDocument();
    cleanup();
    // Neutro = ni el chip de espera ni el de error; y sin refuerzo de marca.
    const espera = classesDe("por_recolectar_en_tienda");
    cleanup();
    const error = classesDe("incidente");
    expect(desconocido).not.toEqual(espera);
    expect(desconocido).not.toEqual(error);
    expect(desconocido).not.toContain("bg-brand-soft");
  });
});

describe("154 — el mapa de presentacion sigue cubriendo el catalogo EXACTO", () => {
  // Feature 155/R28: el catalogo baja de 20 a 19 values (primera BAJA de su historia:
  // se retira el estado interno de fulfillment en bodega). El conteo se mantiene escrito
  // a mano a proposito: es la red que caza un sobrante en el mapa de presentacion, que el
  // `Record<OrderStatusValue, ...>` solo caza si FALTA una clave, no si sobra en runtime.
  it("tiene una etiqueta por cada uno de los 19 values, sin sobrantes", () => {
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual([...ORDER_STATUS_SEED].sort());
    expect(Object.keys(ORDER_STATUS_LABELS)).toHaveLength(21); // +1: feature 157 (recolectando); +1: feature 239 (devolucion_por_confirmar, 2026-08-19)
  });
});
