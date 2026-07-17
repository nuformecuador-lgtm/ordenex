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

  it("mantiene el foco visible con anillo de marca", () => {
    render(<Button variant="brand-outline">Acción</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("focus-visible:border-brand");
    expect(button).toHaveClass("focus-visible:ring-brand/30");
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
