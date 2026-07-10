// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";
import type { UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";

const listarUsuariosMock = vi.fn();
const cambiarEstadoUsuarioMock = vi.fn();
const obtenerUsuarioMock = vi.fn();
const crearUsuarioMock = vi.fn();
const actualizarUsuarioMock = vi.fn();
const listarTiposIdentificacionMock = vi.fn();
vi.mock("@/lib/actions/usuarios", () => ({
  listarUsuarios: (...a: unknown[]) => listarUsuariosMock(...a),
  cambiarEstadoUsuario: (...a: unknown[]) => cambiarEstadoUsuarioMock(...a),
  obtenerUsuario: (...a: unknown[]) => obtenerUsuarioMock(...a),
  crearUsuario: (...a: unknown[]) => crearUsuarioMock(...a),
  actualizarUsuario: (...a: unknown[]) => actualizarUsuarioMock(...a),
  listarTiposIdentificacion: (...a: unknown[]) =>
    listarTiposIdentificacionMock(...a),
}));

import { UsuariosModule } from "@/app/(app)/configuracion/_components/UsuariosModule";

const ITEM: UsuarioListItemDTO = {
  id: "u1",
  nombre: "Ana Pérez",
  email: "ana@example.com",
  rolValue: "mensajero",
  estado: "activo",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const USUARIO: UsuarioPublico = {
  id: "u1",
  nombre: "Ana Pérez",
  email: "ana@example.com",
  telefono: "0999999999",
  estado: "activo",
  cedula: "1712345678",
  tipoIdentificacionId: "t1",
  rolId: "rol-mensajero",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const INITIAL = { items: [ITEM], total: 1, pageSize: 25 };

function renderModule(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarUsuariosMock.mockResolvedValue({
    status: "ok",
    items: [ITEM],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  listarTiposIdentificacionMock.mockResolvedValue({ status: "ok", tipos: [] });
  obtenerUsuarioMock.mockResolvedValue({ status: "ok", usuario: USUARIO });
});

afterEach(() => {
  cleanup();
});

describe("UsuariosModule — listado y paginación (R26)", () => {
  it("lista en DataTable con paginación (R26)", async () => {
    renderModule(<UsuariosModule initialData={INITIAL} />);

    expect(screen.getByRole("table", { name: "Usuarios" })).toBeInTheDocument();
    expect(await screen.findByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Paginación" }),
    ).toBeInTheDocument();
  });
});

describe("UsuariosModule — crear/editar en Modal (R27)", () => {
  it("el botón Crear abre el Modal async con el formulario", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Crear usuario" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Crear usuario")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Guardar" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Nombre")).toBeInTheDocument();
  });

  it("Editar carga el usuario y abre el Modal en modo edición", async () => {
    const user = userEvent.setup();
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Editar" }));

    await waitFor(() => expect(obtenerUsuarioMock).toHaveBeenCalledWith("u1"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Editar usuario")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email")).toBeDisabled();
  });
});

describe("UsuariosModule — activar/inactivar y feedback (R20/R21/R28)", () => {
  it("el botón Inactivar cambia el estado y muestra toast de éxito (R20/R28)", async () => {
    const user = userEvent.setup();
    cambiarEstadoUsuarioMock.mockResolvedValue({
      status: "ok",
      usuario: { ...USUARIO, estado: "inactivo" },
    });
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));

    await waitFor(() =>
      expect(cambiarEstadoUsuarioMock).toHaveBeenCalledWith("u1", {
        estado: "inactivo",
      }),
    );
    expect(await screen.findByText("Usuario inactivado")).toBeInTheDocument();
  });

  it("un error del backend muestra toast de error (R28)", async () => {
    const user = userEvent.setup();
    cambiarEstadoUsuarioMock.mockResolvedValue({ status: "not_found" });
    renderModule(<UsuariosModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Inactivar" }));

    expect(
      (await screen.findAllByText("El usuario no existe.")).length,
    ).toBeGreaterThan(0);
  });
});
