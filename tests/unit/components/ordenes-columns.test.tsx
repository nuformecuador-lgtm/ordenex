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
