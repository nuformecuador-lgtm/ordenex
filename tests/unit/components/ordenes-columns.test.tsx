// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import { DataTable } from "@/components/shared/DataTable";
import { ordenesColumns } from "@/app/(app)/ordenes/_components/ordenes-columns";
import type { OrdenListItemDTO } from "@/lib/types/orden";

afterEach(() => {
  cleanup();
});

function makeOrden(
  overrides: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: 1000,
    numRemision: "REM-000",
    estatusId: "est-id",
    estatusValue: undefined,
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("ordenesColumns — R30 (numGuia nullable en el listado)", () => {
  it("muestra 'Pendiente' cuando numGuia es null (orden aún sin guía)", () => {
    const orden = makeOrden({ id: "o1", numGuia: null, numRemision: "REM-001" });
    render(
      <DataTable columns={ordenesColumns} data={[orden]} rowKey="id" ariaLabel="Órdenes" />,
    );

    const fila = screen.getByRole("row", { name: /REM-001/ });
    expect(within(fila).getByText("Pendiente")).toBeInTheDocument();
    expect(within(fila).queryByText("null")).toBeNull();
  });

  it("muestra el número de guía cuando ya fue asignado (no null)", () => {
    const orden = makeOrden({ id: "o1", numGuia: 4321, numRemision: "REM-002" });
    render(
      <DataTable columns={ordenesColumns} data={[orden]} rowKey="id" ariaLabel="Órdenes" />,
    );

    const fila = screen.getByRole("row", { name: /REM-002/ });
    expect(within(fila).getByText("4321")).toBeInTheDocument();
    expect(within(fila).queryByText("Pendiente")).toBeNull();
  });
});

describe("ordenesColumns — feature 30 (R14: columna de zona)", () => {
  it("R14: renderiza el nombre de la zona (zonaNombre) en la fila", () => {
    const orden = makeOrden({
      id: "o1",
      numRemision: "REM-Z1",
      zonaNombre: "Limón",
    });
    render(
      <DataTable columns={ordenesColumns} data={[orden]} rowKey="id" ariaLabel="Órdenes" />,
    );

    // Encabezado de la columna presente.
    expect(
      screen.getByRole("columnheader", { name: "Zona" }),
    ).toBeInTheDocument();
    const fila = screen.getByRole("row", { name: /REM-Z1/ });
    expect(within(fila).getByText("Limón")).toBeInTheDocument();
  });
});

describe("ordenesColumns — feature 30 (R15: estado ruteado legible por zona)", () => {
  it("R15: una fila en_ruta_bodega_satelite se lee 'En ruta a bodega <zona>' con el nombre real", () => {
    const orden = makeOrden({
      id: "o1",
      numRemision: "REM-S1",
      estatusValue: "en_ruta_bodega_satelite",
      zonaNombre: "Guápiles",
    });
    render(
      <DataTable columns={ordenesColumns} data={[orden]} rowKey="id" ariaLabel="Órdenes" />,
    );

    const fila = screen.getByRole("row", { name: /REM-S1/ });
    expect(
      within(fila).getByText("En ruta a bodega Guápiles"),
    ).toBeInTheDocument();
    // No debe caer al label estático genérico "satélite".
    expect(
      within(fila).queryByText("En ruta a bodega satélite"),
    ).toBeNull();
  });
});
