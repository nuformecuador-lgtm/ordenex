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

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { KpiValorAnimado } from "@/components/shared/KpiValorAnimado";
import { formatMonto, monedaConfig } from "@/lib/config/moneda";

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
        norm(new Intl.NumberFormat(monedaConfig.locale, { maximumFractionDigits: 0 }).format(3500)),
      ),
    ).toBeInTheDocument();
  });

  it("el valor en moneda usa lib/config/moneda y el archivo no tiene simbolo literal", () => {
    render(<KpiValorAnimado value={3500} moneda />);

    // El esperado se DERIVA de la configuracion: si manana cambia la moneda, el
    // test sigue midiendo el requisito y no el colon de hoy.
    expect(screen.getByText(norm(formatMonto(3500)))).toBeInTheDocument();

    const fuente = readFileSync(
      path.join(process.cwd(), "components", "shared", "KpiValorAnimado.tsx"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    expect(fuente).not.toMatch(/["'`][^"'`]*[₡$€£][^"'`]*["'`]/);
    expect(fuente).not.toMatch(/\b(?:CRC|USD|EUR)\b/);
    expect(fuente).not.toMatch(/["']es-[A-Z]{2}["']/);
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
        norm(new Intl.NumberFormat(monedaConfig.locale, { maximumFractionDigits: 0 }).format(1500)),
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
