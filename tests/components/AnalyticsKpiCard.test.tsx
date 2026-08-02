// @vitest-environment jsdom
//
// KpiCard del paquete de analitica (feature 130): R12-R15.
// El valor esperado se deriva de `lib/config/moneda.ts`, nunca de un literal
// "₡3.500,00" escrito a mano: si manana cambia la configuracion, el test debe
// seguir midiendo el requisito y no la moneda de hoy.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { KpiCard } from "@/components/private/analytics/KpiCard";
import { formatearValor } from "@/components/private/analytics/formato";
import { SIN_MONTO, monedaConfig } from "@/lib/config/moneda";

const VARIACION_TEXTO = { sube: "Sube", baja: "Baja", igual: "Sin cambio" };

/**
 * `Intl` separa los miles con ESPACIO DURO (U+00A0) en `es-CR`, y testing-library
 * normaliza los espacios del DOM pero NO los del texto esperado. Sin esto, el test
 * fallaria por un caracter invisible y no por el requisito.
 */
const norm = (texto: string) => texto.replace(/\s/g, " ");

afterEach(() => {
  cleanup();
});

describe("KpiCard (R12-R15)", () => {
  it.each(["conteo", "porcentaje", "moneda", "segundos"] as const)(
    "muestra etiqueta y valor formateado por unidad: %s",
    (unidad) => {
      render(<KpiCard etiqueta="Entregas" valor={3500} unidad={unidad} />);

      expect(screen.getByText("Entregas")).toBeInTheDocument();
      expect(screen.getByText(norm(formatearValor(3500, unidad)))).toBeInTheDocument();
    },
  );

  it("el valor en moneda usa el formato configurado, sin simbolo hardcodeado", () => {
    render(<KpiCard etiqueta="Ingresos" valor={3500} unidad="moneda" />);

    const esperado = new Intl.NumberFormat(monedaConfig.locale, {
      style: "currency",
      currency: monedaConfig.currency,
    }).format(3500);
    expect(screen.getByText(norm(esperado))).toBeInTheDocument();
  });

  it("un valor nulo muestra el marcador de dato ausente y no cero", () => {
    render(<KpiCard etiqueta="Entregas" valor={null} unidad="conteo" />);

    expect(screen.getByText(SIN_MONTO)).toBeInTheDocument();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("la variacion dice su signo con texto, no solo con color", () => {
    const { rerender } = render(
      <KpiCard
        etiqueta="Entregas"
        valor={10}
        unidad="conteo"
        variacion={{ delta: 3, etiqueta: "vs. periodo anterior", texto: VARIACION_TEXTO }}
      />,
    );
    expect(screen.getByText(/Sube 3 vs\. periodo anterior/)).toBeInTheDocument();

    rerender(
      <KpiCard
        etiqueta="Entregas"
        valor={10}
        unidad="conteo"
        variacion={{ delta: -3, etiqueta: "vs. periodo anterior", texto: VARIACION_TEXTO }}
      />,
    );
    expect(screen.getByText(/Baja 3 vs\. periodo anterior/)).toBeInTheDocument();

    rerender(
      <KpiCard
        etiqueta="Entregas"
        valor={10}
        unidad="conteo"
        variacion={{ delta: 0, etiqueta: "vs. periodo anterior", texto: VARIACION_TEXTO }}
      />,
    );
    expect(screen.getByText(/Sin cambio 0 vs\. periodo anterior/)).toBeInTheDocument();
  });

  it("la variacion usa los tokens semanticos -strong, no la escala cruda", () => {
    const { container } = render(
      <KpiCard
        etiqueta="Entregas"
        valor={10}
        unidad="conteo"
        variacion={{ delta: 3, etiqueta: "vs. anterior", texto: VARIACION_TEXTO }}
      />,
    );

    expect(container.querySelector(".text-success-strong")).not.toBeNull();
  });

  it("hereda los estados de carga y error con la misma precedencia que las graficas", () => {
    const { rerender } = render(
      <KpiCard etiqueta="Entregas" valor={10} unidad="conteo" cargando />,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByText("10")).toBeNull();

    rerender(<KpiCard etiqueta="Entregas" valor={10} unidad="conteo" cargando error="Falla" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Falla");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("no anima: el KpiCard no monta react-countup ni clases de animacion", () => {
    const { container } = render(<KpiCard etiqueta="Entregas" valor={10} unidad="conteo" />);

    const clases = Array.from(container.querySelectorAll("*"))
      .flatMap((nodo) => Array.from(nodo.classList))
      .join(" ");
    expect(clases).not.toMatch(/\banimate-/);
  });
});
