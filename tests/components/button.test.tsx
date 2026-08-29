// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { Button, buttonVariants } from "@/components/ui/button";

afterEach(() => cleanup());

describe("Button — variante brand-outline", () => {
  it("aplica fondo del background, borde y texto de marca (naranja sobre blanco)", () => {
    render(<Button variant="brand-outline">Descargar plantilla</Button>);

    const button = screen.getByRole("button", { name: "Descargar plantilla" });
    expect(button).toHaveClass("bg-background");
    expect(button).toHaveClass("border-brand");
    expect(button).toHaveClass("text-brand");
  });

  it("usa el hover suave de marca en lugar del neutro de `outline`", () => {
    render(<Button variant="brand-outline">Acción</Button>);
    expect(screen.getByRole("button")).toHaveClass("hover:bg-brand-soft");
  });

  it("respeta disabled (heredado de la base) y no queda operable", () => {
    render(
      <Button variant="brand-outline" disabled>
        Acción
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveClass("disabled:opacity-50");
    expect(button).toHaveClass("disabled:pointer-events-none");
  });

  /**
   * Feature 226 — el BORDE sigue siendo de marca; el ANILLO ya no.
   *
   * Esta variante pintaba `focus-visible:ring-brand/30`, que mide 1.38 en claro y 1.45 en oscuro
   * contra el fondo adyacente: muy por debajo del 3:1 que WCAG 1.4.11 pide a un indicador de
   * interfaz. No tenía arreglo por alfa: `--color-brand` es un token de PALETA, sin variante por
   * tema, y ni opaco llega a 3 en claro (2.81 sobre `--secondary`). Así que la variante deja de
   * pintar su propio anillo y hereda el de la clase base, que sí cumple.
   *
   * El caso NO se borra —borrarlo dejaría el foco de esta variante sin vigilar, que es lo que
   * había antes de la 208— sino que cambia de afirmación: sigue habiendo anillo, y ahora es el
   * que la guardia de contraste mide (`tests/unit/guards/contraste-tokens.guardia.test.ts`).
   */
  it("mantiene el foco visible: borde de marca y el anillo estándar, que sí cumple 1.4.11", () => {
    render(<Button variant="brand-outline">Acción</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("focus-visible:border-brand");
    expect(button).toHaveClass("focus-visible:ring-3");
    expect(button).toHaveClass("focus-visible:ring-ring");
    // El anillo con alfa que la 226 retiró no puede volver por la puerta de atrás.
    expect(button.className).not.toMatch(/ring-brand\/30/);
  });

  it("define estilos de dark mode, como el resto de variantes", () => {
    const classes = buttonVariants({ variant: "brand-outline" });
    expect(classes).toContain("dark:");
  });

  it("se combina con los tamaños existentes sin perder la variante", () => {
    render(
      <Button variant="brand-outline" size="sm">
        Acción
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveClass("text-brand");
    expect(button).toHaveClass("h-7");
  });
});

describe("Button — variantes existentes no cambian (regresión)", () => {
  it("`default` sigue siendo el sólido primario", () => {
    render(<Button>Guardar</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("bg-primary");
    expect(button).toHaveClass("text-primary-foreground");
    // No debe filtrarse el lenguaje de marca de brand-outline.
    expect(button).not.toHaveClass("border-brand");
  });

  it("`outline` sigue siendo el contorno neutro", () => {
    render(<Button variant="outline">Cancelar</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("border-border");
    expect(button).toHaveClass("bg-background");
    expect(button).not.toHaveClass("text-brand");
    expect(button).not.toHaveClass("border-brand");
  });

  it("la variante por defecto (sin prop) sigue siendo `default`", () => {
    render(<Button>Sin variante</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-primary");
  });
});

describe("Button — estado loading", () => {
  it("con loading: spinner presente, botón disabled y aria-busy expuesto", () => {
    render(<Button loading>Guardar</Button>);

    const button = screen.getByRole("button", { name: "Guardar" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    // El spinner es el único svg con animación de giro dentro del botón.
    expect(button.querySelector(".animate-spin")).not.toBeNull();
  });

  it("el giro respeta prefers-reduced-motion (motion-reduce:animate-none)", () => {
    render(<Button loading>Guardar</Button>);
    const spinner = screen.getByRole("button").querySelector(".animate-spin");
    expect(spinner).toHaveClass("motion-reduce:animate-none");
  });

  it("conserva el nombre accesible del contenido (el spinner es aria-hidden)", () => {
    render(<Button loading>Iniciar sesión</Button>);
    expect(
      screen.getByRole("button", { name: "Iniciar sesión" }),
    ).toBeInTheDocument();
  });

  it("sin loading: ni spinner ni aria-busy y el botón queda operable", () => {
    render(<Button>Guardar</Button>);
    const button = screen.getByRole("button", { name: "Guardar" });
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button.querySelector(".animate-spin")).toBeNull();
  });
});
