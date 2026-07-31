// @vitest-environment jsdom
//
// `components/shared/KpiValorAnimado` — el test propio que NO tenia (feature 130,
// R37). Hasta hoy su unica red eran los tests de sus dos consumidores
// (`MisAsignacionesPage` y `CierresAdminModule`), es decir cobertura indirecta de
// otras dos pantallas. Este archivo se escribio ANTES de tocar el componente,
// contra su comportamiento de entonces: un test escrito despues del cambio solo
// certifica el cambio, no lo que habia.
//
// `react-countup` esta mockeado globalmente (`tests/setup/jest-dom.ts`) y renderiza
// `formattingFn(end)`: lo que se verifica aqui es la CIFRA que el KPI muestra, no
// que la anime.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { KpiValorAnimado } from "@/components/shared/KpiValorAnimado";

/** `Intl` usa espacio duro (U+00A0); testing-library normaliza el DOM, no el esperado. */
const norm = (texto: string) => texto.replace(/\s/g, " ");

afterEach(() => {
  cleanup();
});

describe("KpiValorAnimado (R35, R37)", () => {
  it("sin moneda muestra el entero con separadores de miles y sin decimales", () => {
    render(<KpiValorAnimado value={3500} />);

    expect(
      screen.getByText(
        norm(new Intl.NumberFormat("es-CR", { maximumFractionDigits: 0 }).format(3500)),
      ),
    ).toBeInTheDocument();
  });

  it("con moneda antepone el simbolo al valor", () => {
    render(<KpiValorAnimado value={3500} moneda />);

    expect(screen.getByText((contenido) => contenido.includes("3"))).toBeInTheDocument();
    expect(document.body.textContent).toContain("₡");
  });

  it("un valor nulo, indefinido o no numerico se muestra como cero y no rompe", () => {
    const { rerender } = render(<KpiValorAnimado value={null} />);
    expect(screen.getByText("0")).toBeInTheDocument();

    rerender(<KpiValorAnimado value={undefined} />);
    expect(screen.getByText("0")).toBeInTheDocument();

    rerender(<KpiValorAnimado value="no es un numero" />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("acepta un valor numerico en texto", () => {
    render(<KpiValorAnimado value="1500" />);

    expect(
      screen.getByText(
        norm(new Intl.NumberFormat("es-CR", { maximumFractionDigits: 0 }).format(1500)),
      ),
    ).toBeInTheDocument();
  });

  it("conserva su clase base y admite una clase adicional", () => {
    const { container } = render(<KpiValorAnimado value={1} className="text-lg" />);

    const span = container.querySelector("span");
    expect(span?.className).toContain("tabular-nums");
    expect(span?.className).toContain("text-lg");
  });
});
