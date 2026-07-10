// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef, act } from "react";
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

import type { UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";

// Actions mockeadas (no se toca el backend real).
const crearUsuarioMock = vi.fn();
const actualizarUsuarioMock = vi.fn();
const listarTiposIdentificacionMock = vi.fn();
const listarRolesMock = vi.fn();
vi.mock("@/lib/actions/usuarios", () => ({
  crearUsuario: (...args: unknown[]) => crearUsuarioMock(...args),
  actualizarUsuario: (...args: unknown[]) => actualizarUsuarioMock(...args),
  listarTiposIdentificacion: (...args: unknown[]) =>
    listarTiposIdentificacionMock(...args),
  listarRoles: (...args: unknown[]) => listarRolesMock(...args),
}));

import {
  UsuarioForm,
  type UsuarioFormHandle,
} from "@/app/(app)/configuracion/_components/UsuarioForm";

const TIPOS = [
  { id: "t1", value: "cedula" },
  { id: "t2", value: "ruc" },
];

// El `id` es el UUID del catálogo `rol` (lo que el backend espera en `rolId`);
// el `value` es el nombre legible del rol.
const ROLES = [
  { id: "rol-maestro", value: "maestro" },
  { id: "rol-mensajero", value: "mensajero" },
] as const;

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

/** Envuelve en un SWRConfig con cache aislada por test. */
function renderIsolated(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {ui}
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarTiposIdentificacionMock.mockResolvedValue({ status: "ok", tipos: TIPOS });
  listarRolesMock.mockResolvedValue({ status: "ok", roles: [...ROLES] });
});

afterEach(() => {
  cleanup();
});

describe("UsuarioForm — edición (R16)", () => {
  it("modo editar bloquea email y cedula (R16)", () => {
    renderIsolated(<UsuarioForm mode="editar" usuario={USUARIO} />);

    const email = screen.getByLabelText("Email");
    const cedula = screen.getByLabelText("Número de documento");
    expect(email).toBeDisabled();
    expect(cedula).toBeDisabled();

    // Los campos editables siguen habilitados.
    expect(screen.getByLabelText("Nombre")).not.toBeDisabled();
    expect(screen.getByLabelText("Teléfono")).not.toBeDisabled();
    // No hay bloque de contraseña en edición (reset fuera de alcance).
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
  });

  it("preselecciona el rol cuya id coincide con usuario.rolId (prefill por UUID)", async () => {
    renderIsolated(<UsuarioForm mode="editar" usuario={USUARIO} />);

    // USUARIO.rolId es el UUID "rol-mensajero"; el trigger muestra su etiqueta.
    const rolTrigger = screen.getByRole("combobox", { name: "Rol" });
    await waitFor(() => expect(rolTrigger).toHaveTextContent("mensajero"));
  });
});

describe("UsuarioForm — selects (R29)", () => {
  it("puebla el select de rol desde listarRoles con id como value (R29)", async () => {
    const user = userEvent.setup();
    crearUsuarioMock.mockResolvedValue({ status: "ok", usuario: { ...USUARIO } });

    const ref = createRef<UsuarioFormHandle>();
    renderIsolated(<UsuarioForm ref={ref} mode="crear" />);

    // Rol desde la acción listarRoles: opciones etiquetadas con el nombre legible.
    await waitFor(() => expect(listarRolesMock).toHaveBeenCalled());
    await user.click(screen.getByRole("combobox", { name: "Rol" }));
    const rolList = await screen.findByRole("listbox");
    expect(within(rolList).getByRole("option", { name: "maestro" })).toBeInTheDocument();
    await user.click(within(rolList).getByRole("option", { name: "mensajero" }));

    // Tipo de documento desde la acción listarTiposIdentificacion.
    await waitFor(() => expect(listarTiposIdentificacionMock).toHaveBeenCalled());
    await user.click(screen.getByRole("combobox", { name: "Tipo de documento" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "cedula",
      }),
    );

    // Completa el resto del set base y envía.
    await user.type(screen.getByLabelText("Nombre"), "Nuevo Usuario");
    await user.type(screen.getByLabelText("Email"), "nuevo@example.com");
    await user.type(screen.getByLabelText("Teléfono"), "0988888888");
    await user.type(screen.getByLabelText("Número de documento"), "1712345678");
    await user.type(screen.getByLabelText("Contraseña"), "Abcd1234$xy");

    await act(async () => {
      await ref.current!.submit();
    });

    // El payload envía el UUID del catálogo como rolId, no el RolValue "mensajero".
    expect(crearUsuarioMock).toHaveBeenCalledTimes(1);
    const enviado = crearUsuarioMock.mock.calls[0][0] as { rolId: string };
    expect(enviado.rolId).toBe("rol-mensajero");
  }, 15000);
});

describe("UsuarioForm — modo de contraseña (R36)", () => {
  it("toggle generar oculta el input y muestra la password una vez tras crear (R36/R33)", async () => {
    const user = userEvent.setup();
    crearUsuarioMock.mockResolvedValue({
      status: "ok",
      usuario: { ...USUARIO },
      generatedPassword: "Abcd1234$",
    });

    const ref = createRef<UsuarioFormHandle>();
    renderIsolated(<UsuarioForm ref={ref} mode="crear" />);

    // En modo manual (default) el input de contraseña es visible.
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();

    // Al elegir "Generar automáticamente" el input se oculta.
    await user.click(screen.getByRole("radio", { name: /Generar/ }));
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();

    // Completa el set base requerido por el schema.
    await user.type(screen.getByLabelText("Nombre"), "Nuevo Usuario");
    await user.type(screen.getByLabelText("Email"), "nuevo@example.com");
    await user.type(screen.getByLabelText("Teléfono"), "0988888888");
    await user.type(screen.getByLabelText("Número de documento"), "1712345678");

    await user.click(screen.getByRole("combobox", { name: "Tipo de documento" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "cedula",
      }),
    );

    await user.click(screen.getByRole("combobox", { name: "Rol" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "mensajero",
      }),
    );

    let result: unknown;
    await act(async () => {
      result = await ref.current!.submit();
    });

    expect(crearUsuarioMock).toHaveBeenCalledTimes(1);
    const enviado = crearUsuarioMock.mock.calls[0][0] as { passwordMode: string };
    expect(enviado.passwordMode).toBe("generate");
    expect(result).toMatchObject({ status: "ok" });

    // La contraseña generada se muestra una sola vez, con botón copiar y aviso.
    expect(screen.getByDisplayValue("Abcd1234$")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copiar contraseña" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no se volverá a mostrar/i)).toBeInTheDocument();
  }, 20000);

  it("modo manual con contraseña débil devuelve validation_error sin llamar a la acción (R5/R6)", async () => {
    const ref = createRef<UsuarioFormHandle>();
    const user = userEvent.setup();
    renderIsolated(<UsuarioForm ref={ref} mode="crear" />);

    await user.type(screen.getByLabelText("Nombre"), "Nuevo");
    await user.type(screen.getByLabelText("Email"), "nuevo@example.com");
    await user.type(screen.getByLabelText("Teléfono"), "0988888888");
    await user.type(screen.getByLabelText("Número de documento"), "1712345678");
    await user.type(screen.getByLabelText("Contraseña"), "weak");

    let result: { status?: string } = {};
    await act(async () => {
      result = (await ref.current!.submit()) as { status?: string };
    });

    expect(result.status).toBe("validation_error");
    expect(crearUsuarioMock).not.toHaveBeenCalled();
  });
});
