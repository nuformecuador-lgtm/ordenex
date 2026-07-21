// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inbox } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";

// EmptyState (DESIGN.md, «Componentes → EmptyState»): icono opcional + título que ENSEÑA el
// próximo paso + descripción + CTA opcionales. Pieza de presentación pura: se prueban las
// cuatro piezas (título/descripción/CTA/icono) y su ausencia condicional.

afterEach(() => {
  cleanup();
});

describe("EmptyState", () => {
  it("renderiza el título (mensaje principal) siempre", () => {
    render(<EmptyState title="No hay zonas" />);
    expect(screen.getByText("No hay zonas")).toBeInTheDocument();
  });

  it("renderiza la descripción que enseña el próximo paso cuando se pasa", () => {
    render(
      <EmptyState
        title="No hay zonas"
        description="Crea la primera zona para agrupar los distritos de reparto."
      />,
    );
    expect(
      screen.getByText(
        "Crea la primera zona para agrupar los distritos de reparto.",
      ),
    ).toBeInTheDocument();
  });

  it("no renderiza descripción cuando no se pasa (solo el título)", () => {
    const { container } = render(<EmptyState title="No hay usuarios" />);
    // Un único párrafo: el título. Sin descripción ni bloques extra.
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("renderiza la CTA (acción) y responde al click", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="No hay usuarios"
        action={<button onClick={onClick}>Crear usuario</button>}
      />,
    );

    const cta = screen.getByRole("button", { name: "Crear usuario" });
    expect(cta).toBeInTheDocument();
    await user.click(cta);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("no renderiza CTA cuando no se pasa `action`", () => {
    render(<EmptyState title="No hay usuarios" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renderiza el icono (lucide) como decorativo (aria-hidden) cuando se pasa", () => {
    const { container } = render(<EmptyState title="No hay órdenes" icon={Inbox} />);
    // El icono se pinta como <svg> dentro de un contenedor aria-hidden (decorativo:
    // el significado lo dan el título/descripción, no el icono).
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    const wrapper = container.querySelector('[aria-hidden="true"]');
    expect(wrapper).toBeInTheDocument();
    expect(wrapper).toContainElement(svg as unknown as HTMLElement);
  });

  it("no renderiza icono cuando no se pasa", () => {
    const { container } = render(<EmptyState title="No hay órdenes" />);
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });
});
