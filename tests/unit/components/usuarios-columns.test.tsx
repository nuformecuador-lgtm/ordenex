// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Column } from "@/components/shared/DataTable";
import { DataTable } from "@/components/shared/DataTable";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";
import { buildUsuariosColumns } from "@/app/(app)/configuracion/_components/usuarios-columns";

afterEach(() => {
  cleanup();
});

const ROW: UsuarioListItemDTO = {
  id: "u1",
  nombre: "Ana Pérez",
  email: "ana@example.com",
  rolValue: "mensajero",
  estado: "activo",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function build(overrides: Partial<Parameters<typeof buildUsuariosColumns>[0]> = {}) {
  const onEditar = vi.fn();
  const onCambiarEstado = vi.fn();
  const columns = buildUsuariosColumns({
    onEditar,
    onCambiarEstado,
    ...overrides,
  });
  return { columns, onEditar, onCambiarEstado };
}

describe("usuarios-columns — define columnas del listado (R14/R26)", () => {
  it("define columnas nombre/email/rol/estado sin exponer campos sensibles (R14)", () => {
    const { columns } = build();
    const ids = columns.map((c) => c.id);

    expect(ids).toEqual(["nombre", "email", "rol", "estado", "acciones"]);
    // Ninguna columna referencia el hash u otros campos sensibles (R14/R24).
    expect(ids).not.toContain("passwordHash");
    const serialized = JSON.stringify(columns.map((c) => c.id));
    expect(serialized.toLowerCase()).not.toContain("password");
  });

  it("renderiza rol con su etiqueta legible y estado como chip (R14)", () => {
    const { columns } = build();
    render(
      <DataTable columns={columns} data={[ROW]} rowKey="id" ariaLabel="Usuarios" />,
    );

    expect(screen.getByText("Mensajero")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    // El DTO de fila no incluye el hash: no aparece en el DOM.
    expect(screen.queryByText(/passwordHash/i)).not.toBeInTheDocument();
  });

  it("la acción de estado muestra Inactivar para un usuario activo y dispara el callback (R20)", async () => {
    const user = userEvent.setup();
    const { columns, onCambiarEstado } = build();
    render(
      <DataTable columns={columns} data={[ROW]} rowKey="id" ariaLabel="Usuarios" />,
    );

    const fila = screen.getByRole("row", { name: /Ana Pérez/ });
    await user.click(within(fila).getByRole("button", { name: "Inactivar" }));
    expect(onCambiarEstado).toHaveBeenCalledWith(ROW);
  });

  it("la acción de estado muestra Activar para un usuario inactivo (R21)", () => {
    const { columns } = build();
    const inactivo: UsuarioListItemDTO = { ...ROW, estado: "inactivo" };
    render(
      <DataTable
        columns={columns}
        data={[inactivo]}
        rowKey="id"
        ariaLabel="Usuarios"
      />,
    );
    expect(screen.getByRole("button", { name: "Activar" })).toBeInTheDocument();
  });

  it("deshabilita el botón de estado de la fila en curso", () => {
    const { columns } = build({ estadoPendienteId: "u1" });
    render(
      <DataTable columns={columns} data={[ROW]} rowKey="id" ariaLabel="Usuarios" />,
    );
    expect(screen.getByRole("button", { name: "Inactivar" })).toBeDisabled();
  });
});

// Tipado defensivo: las columnas son Column<UsuarioListItemDTO>[].
const _typed: Column<UsuarioListItemDTO>[] = buildUsuariosColumns({
  onEditar: () => {},
  onCambiarEstado: () => {},
});
void _typed;
