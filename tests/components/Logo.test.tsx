// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Logo } from "@/components/shared/Logo";

describe("components/shared/Logo — wordmark compartido (feature 86, R6)", () => {
  it("renderiza el wordmark textual 'Ordenex'", () => {
    render(<Logo />);
    expect(screen.getByText("Ordenex")).toBeInTheDocument();
  });

  it("aplica el estilo base del wordmark (font-heading)", () => {
    render(<Logo />);
    expect(screen.getByText("Ordenex")).toHaveClass("font-heading");
  });

  it("aplica una className pasada por prop (contexto navy vs claro)", () => {
    render(<Logo className="text-white" />);
    expect(screen.getByText("Ordenex")).toHaveClass("text-white");
  });
});
