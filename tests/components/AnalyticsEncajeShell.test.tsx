// @vitest-environment jsdom
//
// Encaje del paquete de analitica en el shell de la 129 (feature 130): R24, R25.
//
// El contenedor real del slot `operativo` es una `<section className="flex flex-col gap-4">`
// (`AnaliticaShell.tsx`), es decir una COLUMNA FLEX: un componente con ancho fijo
// en pixeles se rompe ahi. Se monta cada pieza dentro de ese contenedor exacto en
// vez de describirlo en un comentario.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { GraficaBarras } from "@/components/private/analytics/GraficaBarras";
import { GraficaDonut } from "@/components/private/analytics/GraficaDonut";
import { GraficaLineas } from "@/components/private/analytics/GraficaLineas";
import { KpiCard } from "@/components/private/analytics/KpiCard";
import { TablaResumen } from "@/components/private/analytics/TablaResumen";

vi.mock("@/components/private/analytics/lienzo/BarrasLienzo", () => ({
  default: () => <div data-testid="lienzo-barras" />,
}));
vi.mock("@/components/private/analytics/lienzo/LineasLienzo", () => ({
  default: () => <div data-testid="lienzo-lineas" />,
}));
vi.mock("@/components/private/analytics/lienzo/DonutLienzo", () => ({
  default: () => <div data-testid="lienzo-donut" />,
}));

const VACIO = {
  titulo: "Sin entregas en el rango consultado",
  descripcion: "Amplia el rango o quita algun filtro",
};

const SERIES = [
  { id: "a", etiqueta: "Serie a", puntos: [{ categoria: "lun", valor: 3 }] },
];

/** El contenedor real del slot `operativo` del shell de la 129. */
function SlotOperativo({ children }: { children: React.ReactNode }) {
  return (
    <section aria-label="Panel operativo" className="flex flex-col gap-4">
      {children}
    </section>
  );
}

/** Ancho o alto fijos en pixeles, en cualquiera de sus formas de Tailwind. */
const PIXELES = /\b(?:w|h|min-w|min-h|max-w|max-h)-\[\d+px\]/;

afterEach(() => {
  cleanup();
});

describe("encaje en el slot operativo del shell (R24)", () => {
  it("renderiza dentro de una section flex-col gap-4 sin fijar ancho ni alto en pixeles", () => {
    const { container } = render(
      <SlotOperativo>
        <GraficaBarras titulo="Barras" series={SERIES} unidad="conteo" vacio={VACIO} />
        <GraficaLineas titulo="Lineas" series={SERIES} unidad="conteo" vacio={VACIO} />
        <GraficaDonut titulo="Donut" series={SERIES} unidad="conteo" vacio={VACIO} />
        <KpiCard etiqueta="Entregas" valor={3} unidad="conteo" />
        <TablaResumen
          titulo="Resumen"
          encabezadoCategoria="Zona"
          columnas={[{ id: "c", etiqueta: "Entregas", unidad: "conteo" }]}
          filas={[{ id: "z", categoria: "Zona 1", valores: { c: 3 } }]}
          vacio={VACIO}
        />
      </SlotOperativo>,
    );

    expect(screen.getByRole("region", { name: "Barras" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Lineas" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Donut" })).toBeInTheDocument();

    const clases = Array.from(container.querySelectorAll("*"))
      .flatMap((nodo) => Array.from(nodo.classList))
      .join(" ");
    expect(clases).not.toMatch(PIXELES);
  });

  it("acepta una clase adicional del llamador sin perder la suya", () => {
    render(
      <SlotOperativo>
        <GraficaBarras
          titulo="Barras"
          series={SERIES}
          unidad="conteo"
          vacio={VACIO}
          className="md:col-span-2"
        />
      </SlotOperativo>,
    );

    const region = screen.getByRole("region", { name: "Barras" });
    expect(region.className).toContain("md:col-span-2");
    expect(region.className).toContain("flex");
  });
});

describe("el vacio de la grafica no es el vacio del shell (R25)", () => {
  it("el vacio de la grafica habla del rango sin datos, no de una entrega posterior", () => {
    render(
      <SlotOperativo>
        <GraficaBarras titulo="Barras" series={[]} unidad="conteo" vacio={VACIO} />
      </SlotOperativo>,
    );

    expect(screen.getByText(VACIO.titulo)).toBeInTheDocument();
    expect(screen.getByText(VACIO.descripcion)).toBeInTheDocument();
    expect(screen.queryByText(/entrega posterior/i)).toBeNull();
    expect(screen.queryByText(/llega en una entrega/i)).toBeNull();
  });
});
