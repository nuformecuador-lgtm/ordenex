// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Column } from "@/components/shared/DataTable";
import { DataTable } from "@/components/shared/DataTable";
import type { ZonaDTO } from "@/lib/types/zona";
import { buildZonasColumns } from "@/app/(app)/configuracion/_components/zonas-columns";

afterEach(() => {
  cleanup();
});

const ROW: ZonaDTO = {
  id: "z1",
  nombre: "Zona Sur",
  cobroVehiculo: false,
  distritosCount: 7,
  esCentral: false,
};

function build() {
  const onEditar = vi.fn();
  const columns = buildZonasColumns({ onEditar });
  return { columns, onEditar };
}

describe("zonas-columns — define columnas del listado (feature 54)", () => {
  it("define columnas nombre/distritos/central/acciones (sin columnas de pago)", () => {
    const { columns } = build();
    const ids = columns.map((c) => c.id);
    expect(ids).toEqual(["nombre", "distritos", "central", "acciones"]);
  });

  it("mapea el DTO: nombre y distritosCount", () => {
    const { columns } = build();
    render(
      <DataTable columns={columns} data={[ROW]} rowKey="id" ariaLabel="Zonas" />,
    );

    expect(screen.getByText("Zona Sur")).toBeInTheDocument();
    // distritosCount se muestra tal cual.
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("renderiza el badge central cuando esCentral es true y un guion cuando es false", () => {
    const { columns } = build();
    const central: ZonaDTO = {
      ...ROW,
      id: "z2",
      nombre: "Central",
      esCentral: true,
    };
    render(
      <DataTable
        columns={columns}
        data={[ROW, central]}
        rowKey="id"
        ariaLabel="Zonas"
      />,
    );

    // La fila central muestra el chip; la fila no-central muestra el guion.
    expect(screen.getByText("Central / GAM")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("la acción Editar dispara el callback con la zona de la fila (R31)", async () => {
    const user = userEvent.setup();
    const { columns, onEditar } = build();
    render(
      <DataTable columns={columns} data={[ROW]} rowKey="id" ariaLabel="Zonas" />,
    );

    const fila = screen.getByRole("row", { name: /Zona Sur/ });
    await user.click(within(fila).getByRole("button", { name: "Editar" }));
    expect(onEditar).toHaveBeenCalledWith(ROW);
  });
});

// Tipado defensivo: las columnas son Column<ZonaDTO>[].
const _typed: Column<ZonaDTO>[] = buildZonasColumns({ onEditar: () => {} });
void _typed;
