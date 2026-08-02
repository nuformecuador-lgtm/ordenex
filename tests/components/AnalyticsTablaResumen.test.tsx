// @vitest-environment jsdom
//
// TablaResumen del paquete de analitica (feature 130): R22, R23, R38.
// Q4 la mantuvo en esta feature con una condicion explicita: tiene que APORTAR
// algo real (formato por unidad + fila de totales) o seria un archivo de mas.
// Estos tests son esa condicion escrita.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { TablaResumen } from "@/components/private/analytics/TablaResumen";
import { formatearValor } from "@/components/private/analytics/formato";

const VACIO = { titulo: "Sin datos en el rango", descripcion: "Prueba con otro rango" };

/** Ver la nota de `AnalyticsKpiCard.test.tsx`: `Intl` usa espacio duro en es-CR. */
const norm = (texto: string) => texto.replace(/\s/g, " ");

const COLUMNAS = [
  { id: "entregas", etiqueta: "Entregas", unidad: "conteo" as const },
  { id: "cobrado", etiqueta: "Cobrado", unidad: "moneda" as const },
];

const FILAS = [
  { id: "z1", categoria: "Zona 1", valores: { entregas: 10, cobrado: 1000 } },
  { id: "z2", categoria: "Zona 2", valores: { entregas: 5, cobrado: null } },
];

afterEach(() => {
  cleanup();
});

describe("TablaResumen (R22, R23, R38)", () => {
  it("se apoya en DataTable: hereda skeleton, vacio y error", () => {
    const { rerender } = render(
      <TablaResumen
        titulo="Resumen por zona"
        encabezadoCategoria="Zona"
        columnas={COLUMNAS}
        filas={[]}
        vacio={VACIO}
      />,
    );
    expect(screen.getByText(VACIO.titulo)).toBeInTheDocument();

    rerender(
      <TablaResumen
        titulo="Resumen por zona"
        encabezadoCategoria="Zona"
        columnas={COLUMNAS}
        filas={FILAS}
        vacio={VACIO}
        cargando
      />,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);

    rerender(
      <TablaResumen
        titulo="Resumen por zona"
        encabezadoCategoria="Zona"
        columnas={COLUMNAS}
        filas={FILAS}
        vacio={VACIO}
        error="No se pudo consultar"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo consultar");
  });

  it("no emite un table propio: usa el unico del repo, con su caption", () => {
    render(
      <TablaResumen
        titulo="Resumen por zona"
        encabezadoCategoria="Zona"
        columnas={COLUMNAS}
        filas={FILAS}
        vacio={VACIO}
      />,
    );

    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByRole("table", { name: "Resumen por zona" })).toBeInTheDocument();
  });

  it("formatea cada columna por su MetricaUnidad sin que el llamador pase formateadores", () => {
    render(
      <TablaResumen
        titulo="Resumen por zona"
        encabezadoCategoria="Zona"
        columnas={COLUMNAS}
        filas={FILAS}
        vacio={VACIO}
      />,
    );

    expect(screen.getByText(norm(formatearValor(1000, "moneda")))).toBeInTheDocument();
    expect(screen.getByText(norm(formatearValor(10, "conteo")))).toBeInTheDocument();
    // El ausente se marca, no se convierte en cero (R11 aplicado a la tabla).
    expect(screen.getAllByText(norm(formatearValor(null, "moneda"))).length).toBeGreaterThan(0);
  });

  it("la fila de totales se distingue de las filas de datos", () => {
    render(
      <TablaResumen
        titulo="Resumen por zona"
        encabezadoCategoria="Zona"
        columnas={COLUMNAS}
        filas={FILAS}
        totales={{ etiqueta: "Total" }}
        vacio={VACIO}
      />,
    );

    const total = screen.getByText("Total").closest("tr");
    const dato = screen.getByText("Zona 1").closest("tr");
    expect(total).not.toBeNull();
    expect(total?.className).toContain("font-semibold");
    expect(dato?.className).not.toContain("font-semibold");
    // El total se calcula, no se copia: 10 + 5 = 15 y 1000 + ausente = 1000.
    expect(screen.getByText(norm(formatearValor(15, "conteo")))).toBeInTheDocument();
  });

  it("sin la prop de totales no hay fila de totales", () => {
    render(
      <TablaResumen
        titulo="Resumen por zona"
        encabezadoCategoria="Zona"
        columnas={COLUMNAS}
        filas={FILAS}
        vacio={VACIO}
      />,
    );

    expect(screen.queryByText("Total")).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(3); // cabecera + 2 datos
  });
});
