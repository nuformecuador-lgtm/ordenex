// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Logo } from "@/components/shared/Logo";

describe("components/shared/Logo — wordmark compartido (feature 86, R6)", () => {
  it("renderiza el wordmark textual 'Ordenex'", () => {
    const { container } = render(<Logo />);
    expect(container.textContent).toBe("Ordenex");
  });

  it("aplica el estilo base del wordmark (font-heading) en el wordmark completo", () => {
    const { container } = render(<Logo />);
    const wordmark = container.firstElementChild;
    expect(wordmark).toHaveClass("font-heading");
  });

  it("pinta 'ex' con el naranja de marca (identidad partida)", () => {
    render(<Logo />);
    expect(screen.getByText("ex")).toHaveClass("text-brand");
  });

  it("'Orden' hereda el color del contexto vía className (navy vs claro)", () => {
    const { container } = render(<Logo className="text-white" />);
    expect(container.firstElementChild).toHaveClass("text-white");
  });
});
