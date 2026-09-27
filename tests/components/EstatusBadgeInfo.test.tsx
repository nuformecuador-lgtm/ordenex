// @vitest-environment jsdom
// FICHA 456 (T2.3, design §8; R9, R32) — `EstatusBadge` para los 20 estados: el MISMO nombre y las
// MISMAS clases del `Badge` que antes (se comparan contra el `Badge` pintado a mano con la variante
// que tenía cada estado), y el botón de información a su lado. Un retirado, sin botón.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { EstatusBadge } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

afterEach(() => cleanup());

/** Los nombres de la tabla §0.1 de la 455, escritos A MANO (literal de contrato, no la fuente). */
const NOMBRE: Record<string, string> = {
  entregado: "Entregado",
  novedad: "Novedad",
  devolviendo_a_tienda: "Devolviendo a tienda",
  reprogramado: "Reprogramado",
  en_ruta_bodega_central: "En ruta a bodega central",
  en_bodega_central: "En bodega central",
  en_preparacion: "En preparación",
  mensajero_recogiendo_en_bodega: "Mensajero recogiendo en la bodega",
  en_ruta_bodega_satelite: "En ruta a bodega satélite",
  en_reparto: "En reparto",
  devolucion_a_origen_por_rechazo: "Devolución a origen por rechazo",
  en_bodega_satelite: "En bodega satélite",
  devuelta_a_tienda: "Devuelta a tienda",
  novedad_interna: "Novedad interna",
  por_devolver_a_bodega_central: "Por devolver a bodega central",
  devolviendo_a_bodega_central: "Devolviendo a bodega central",
  por_devolver_a_tienda: "Por devolver a tienda",
  por_recolectar_en_tienda: "Por recolectar en tienda",
  incidente: "Incidente",
  recolectando: "Recolectando",
};

describe("456 · EstatusBadge con botón de información (R9, R32)", () => {
  it.each(ORDER_STATUS_SEED.map((c) => [c] as const))("%s: nombre intacto en el `Badge` y botón al lado", (codigo) => {
    const { container } = render(<EstatusBadge value={codigo} />);
    const badge = container.querySelector('[data-slot="badge"]') as HTMLElement;
    expect(badge.textContent).toBe(NOMBRE[codigo]);
    // El botón NO está dentro del `Badge` (hermano): el chip conserva su texto y su nombre.
    const b = screen.getByRole("button", { name: `Qué significa «${NOMBRE[codigo]}»` });
    expect(badge.contains(b)).toBe(false);
    expect(badge.parentElement?.contains(b)).toBe(true);
  });

  it("R32 — clases del `Badge`: las variantes de siempre (muestra por familia)", () => {
    const clasesDe = (v: string) => {
      const { container } = render(<EstatusBadge value={v} />);
      const c = (container.querySelector('[data-slot="badge"]') as HTMLElement).className;
      cleanup();
      return c;
    };
    expect(clasesDe("entregado")).toContain("bg-success-soft");
    expect(clasesDe("incidente")).toContain("bg-danger-soft");
    expect(clasesDe("novedad")).toContain("bg-warning-soft");
    expect(clasesDe("en_reparto")).toContain("bg-brand-soft");
    expect(clasesDe("en_ruta_bodega_satelite")).toContain("bg-info-soft");
  });

  it("R15 — un retirado conserva su nombre de la 455 y NO lleva botón", () => {
    render(<EstatusBadge value="ayuda_tienda" />);
    expect(screen.getByText("Ayuda solicitada a la tienda (estado retirado)")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
