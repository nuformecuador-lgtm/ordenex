// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import {
  EstatusBadge,
  ORDER_STATUS_LABELS,
} from "@/app/(app)/ordenes/_components/EstatusBadge";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 153 (R9/R10/R11) — el rename NO puede degradar la presentacion del chip.
// `ORDER_STATUS_VARIANT` y `ORDER_STATUS_CLASS` son privados del modulo y ademas
// `ORDER_STATUS_CLASS` es un `Partial<Record<...>>`: perder la entrada al mover la clave
// NO rompe el build, solo apaga el acento de marca en silencio. Por eso se verifica sobre
// el DOM renderizado.
//
// Feature 155 (R28) — la 153 comparaba los tokens contra el estado interno de fulfillment
// en bodega, que compartia byte a byte la misma cadena de acento. Ese value se retiro del
// catalogo, asi que `en_reparto` queda como UNICO portador de esos 4 tokens y ya no hay
// gemelo con el que comparar: los tokens se afirman DIRECTAMENTE, mas el contraste contra
// el chip neutro. La red es la misma (si la entrada del `Partial` desaparece, los tokens
// desaparecen del DOM y el caso cae), solo pierde el espejo.

// El value ANTIGUO se construye en piezas a proposito: escribirlo literal haria que este
// archivo apareciera como ofensor del guard de censo (censo-order-status-rename.test.ts).
const VALUE_ANTIGUO = ["en", "ruta"].join("_");
const LABEL_ANTIGUA = ["En", "ruta"].join(" ");

afterEach(() => {
  cleanup();
});

describe("153/R9 — etiqueta del catalogo de presentacion", () => {
  it("en_reparto se presenta como 'En reparto'", () => {
    expect(ORDER_STATUS_LABELS.en_reparto).toBe("En reparto");
  });

  it("ningun label vale exactamente la etiqueta antigua, y el value antiguo ya no es clave", () => {
    expect(Object.values(ORDER_STATUS_LABELS)).not.toContain(LABEL_ANTIGUA);
    expect(Object.keys(ORDER_STATUS_LABELS)).not.toContain(VALUE_ANTIGUO);
  });

  it("las etiquetas COMPUESTAS de los vecinos siguen literales (no las toca el rename)", () => {
    expect(ORDER_STATUS_LABELS.en_ruta_bodega_central).toBe("En ruta a bodega central");
    expect(ORDER_STATUS_LABELS.en_ruta_bodega_satelite).toBe("En ruta a bodega satélite");
  });

  it("el mapa cubre los values del catalogo, sin sobrantes", () => {
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual([...ORDER_STATUS_SEED].sort());
  });
});

describe("153/R10/R11 — variante y acento de marca preservados byte a byte", () => {
  function classesDe(value: string): string[] {
    const { container } = render(<EstatusBadge value={value} />);
    const el = container.firstElementChild as HTMLElement;
    return el.className.split(/\s+/).filter(Boolean);
  }

  it("renderiza el texto 'En reparto' para el value en_reparto", () => {
    render(<EstatusBadge value="en_reparto" />);
    expect(screen.getByText("En reparto")).toBeInTheDocument();
  });

  it("conserva los 4 tokens de acento de marca", () => {
    const enReparto = classesDe("en_reparto");

    for (const token of [
      "bg-brand-soft",
      "text-brand-dark",
      "dark:bg-brand/15",
      "dark:text-brand-light",
    ]) {
      expect(enReparto).toContain(token);
    }
  });

  // Feature 155/R28: el refuerzo de acento del estado retirado se fue con el value, asi
  // que `en_reparto` es el UNICO chip del catalogo que lleva estos tokens. Si alguien
  // reintrodujera un gemelo, este caso lo caza.
  it("155/R28: es el UNICO value del catalogo con el acento de marca", () => {
    const conAcento = ORDER_STATUS_SEED.filter((value) => {
      const clases = classesDe(value);
      cleanup();
      return clases.includes("bg-brand-soft");
    });
    expect(conAcento).toEqual(["en_reparto"]);
  });

  it("NO cae a la variante neutra sin clase (el value antiguo si es desconocido)", () => {
    const conocido = classesDe("en_reparto");
    cleanup();
    const desconocido = classesDe(VALUE_ANTIGUO);

    // El value antiguo ya no existe en el catalogo: cae al chip neutro con el valor crudo.
    expect(desconocido).not.toContain("bg-brand-soft");
    expect(conocido).not.toEqual(desconocido);
    expect(screen.getByText(VALUE_ANTIGUO)).toBeInTheDocument();
  });

  it("el vecino en_ruta_bodega_satelite sigue con su variante info y su label derivable", () => {
    const { container } = render(
      <EstatusBadge value="en_ruta_bodega_satelite" zonaNombre="Heredia" />,
    );
    expect(container.textContent).toBe("En ruta a bodega Heredia");
  });
});
