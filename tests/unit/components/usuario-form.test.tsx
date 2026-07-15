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

// Feature 24/R27: el select de zona lee la acción `listarZonas` (módulo aparte).
const listarZonasMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  listarZonas: (...args: unknown[]) => listarZonasMock(...args),
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

// Feature 24/R27: item de `listarZonas` (ZonaDTO); el form solo lee id + nombre.
const ZONAS = [
  { id: "z1", nombre: "Central" },
  { id: "z2", nombre: "Norte" },
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
  fulfillment: false,
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
  listarZonasMock.mockResolvedValue({
    status: "ok",
    items: [...ZONAS],
    page: 1,
    pageSize: 100,
    total: ZONAS.length,
  });
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

    // Feature 24/R27: mensajero requiere zona; se selecciona antes de enviar.
    await user.click(screen.getByRole("combobox", { name: "Zona" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", { name: "Central" }),
    );

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

    // Feature 24/R27: mensajero requiere zona; se selecciona antes de enviar.
    await user.click(screen.getByRole("combobox", { name: "Zona" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", { name: "Central" }),
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

// Feature 27: el switch "esta tienda tiene fulfillment" aparece solo para el rol
// `adminTienda` (decisión P3). Catálogo de roles que incluye ese rol.
const ROLES_FF = [
  { id: "rol-maestro", value: "maestro" },
  { id: "rol-mensajero", value: "mensajero" },
  { id: "rol-admin-tienda", value: "adminTienda" },
] as const;

const USUARIO_FF: UsuarioPublico = {
  ...USUARIO,
  rolId: "rol-admin-tienda",
  fulfillment: true,
};

describe("UsuarioForm — fulfillment (feature 27)", () => {
  it("muestra el switch de fulfillment al seleccionar rol adminTienda en crear (R5)", async () => {
    const user = userEvent.setup();
    listarRolesMock.mockResolvedValue({ status: "ok", roles: [...ROLES_FF] });
    renderIsolated(<UsuarioForm mode="crear" />);

    // Sin rol seleccionado (o rol distinto), el switch no está presente.
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    await waitFor(() => expect(listarRolesMock).toHaveBeenCalled());
    await user.click(screen.getByRole("combobox", { name: "Rol" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "adminTienda",
      }),
    );

    expect(
      screen.getByRole("switch", { name: "Esta tienda tiene fulfillment" }),
    ).toBeInTheDocument();
  }, 15000);

  it("el switch inicia en false al elegir adminTienda en crear (R7)", async () => {
    const user = userEvent.setup();
    listarRolesMock.mockResolvedValue({ status: "ok", roles: [...ROLES_FF] });
    renderIsolated(<UsuarioForm mode="crear" />);

    await waitFor(() => expect(listarRolesMock).toHaveBeenCalled());
    await user.click(screen.getByRole("combobox", { name: "Rol" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "adminTienda",
      }),
    );

    expect(
      screen.getByRole("switch", { name: "Esta tienda tiene fulfillment" }),
    ).toHaveAttribute("aria-checked", "false");
  }, 15000);

  it("oculta el switch y no envía fulfillment con rol != adminTienda (R6)", async () => {
    const user = userEvent.setup();
    listarRolesMock.mockResolvedValue({ status: "ok", roles: [...ROLES_FF] });
    crearUsuarioMock.mockResolvedValue({ status: "ok", usuario: { ...USUARIO } });

    const ref = createRef<UsuarioFormHandle>();
    renderIsolated(<UsuarioForm ref={ref} mode="crear" />);

    await user.type(screen.getByLabelText("Nombre"), "Nuevo Usuario");
    await user.type(screen.getByLabelText("Email"), "nuevo@example.com");
    await user.type(screen.getByLabelText("Teléfono"), "0988888888");
    await user.type(screen.getByLabelText("Número de documento"), "1712345678");
    await user.type(screen.getByLabelText("Contraseña"), "Abcd1234$xy");

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

    // Rol no-adminTienda: el switch permanece oculto (R6).
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    // Feature 24/R27: mensajero requiere zona; se selecciona antes de enviar.
    await user.click(screen.getByRole("combobox", { name: "Zona" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", { name: "Central" }),
    );

    await act(async () => {
      await ref.current!.submit();
    });

    expect(crearUsuarioMock).toHaveBeenCalledTimes(1);
    const enviado = crearUsuarioMock.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado).not.toHaveProperty("fulfillment");
  }, 15000);

  it("prefilla el switch con el valor actual al editar adminTienda (R11)", async () => {
    listarRolesMock.mockResolvedValue({ status: "ok", roles: [...ROLES_FF] });
    renderIsolated(<UsuarioForm mode="editar" usuario={USUARIO_FF} />);

    const sw = await screen.findByRole("switch", {
      name: "Esta tienda tiene fulfillment",
    });
    expect(sw).toHaveAttribute("aria-checked", "true");
  }, 15000);

  it("propaga el nuevo valor del switch al submit en editar (R12)", async () => {
    const user = userEvent.setup();
    listarRolesMock.mockResolvedValue({ status: "ok", roles: [...ROLES_FF] });
    actualizarUsuarioMock.mockResolvedValue({
      status: "ok",
      usuario: { ...USUARIO_FF },
    });

    const ref = createRef<UsuarioFormHandle>();
    renderIsolated(<UsuarioForm ref={ref} mode="editar" usuario={USUARIO_FF} />);

    const sw = await screen.findByRole("switch", {
      name: "Esta tienda tiene fulfillment",
    });
    expect(sw).toHaveAttribute("aria-checked", "true");

    // Alterna el switch a "no".
    await user.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "false");

    await act(async () => {
      await ref.current!.submit();
    });

    expect(actualizarUsuarioMock).toHaveBeenCalledTimes(1);
    const enviado = actualizarUsuarioMock.mock.calls[0][1] as {
      fulfillment?: boolean;
    };
    expect(enviado.fulfillment).toBe(false);
  }, 15000);
});

// Feature 24/R27: el select "Zona" aparece solo para `mensajero`/`adminSatelite`
// (mismo patrón que el switch de fulfillment para `adminTienda`). Sin zona el
// mensajero queda inasignable, por eso el campo se ofrece en creación/edición.
const ROLES_ZONA = [
  { id: "rol-maestro", value: "maestro" },
  { id: "rol-mensajero", value: "mensajero" },
  { id: "rol-admin-satelite", value: "adminSatelite" },
  { id: "rol-admin-tienda", value: "adminTienda" },
] as const;

const USUARIO_ZONA: UsuarioPublico = {
  ...USUARIO,
  rolId: "rol-mensajero",
  zonaId: "z2",
};

describe("UsuarioForm — zona (feature 24/R27)", () => {
  it("muestra el select Zona para mensajero/adminSatelite y lo oculta para maestro/adminTienda (R27)", async () => {
    const user = userEvent.setup();
    listarRolesMock.mockResolvedValue({ status: "ok", roles: [...ROLES_ZONA] });
    renderIsolated(<UsuarioForm mode="crear" />);

    // Sin rol seleccionado, el select de zona no está presente.
    expect(
      screen.queryByRole("combobox", { name: "Zona" }),
    ).not.toBeInTheDocument();

    await waitFor(() => expect(listarRolesMock).toHaveBeenCalled());

    // maestro: rol sin zona -> oculto.
    await user.click(screen.getByRole("combobox", { name: "Rol" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "maestro",
      }),
    );
    expect(
      screen.queryByRole("combobox", { name: "Zona" }),
    ).not.toBeInTheDocument();

    // mensajero: aparece.
    await user.click(screen.getByRole("combobox", { name: "Rol" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "mensajero",
      }),
    );
    expect(screen.getByRole("combobox", { name: "Zona" })).toBeInTheDocument();

    // adminSatelite: aparece.
    await user.click(screen.getByRole("combobox", { name: "Rol" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "adminSatelite",
      }),
    );
    expect(screen.getByRole("combobox", { name: "Zona" })).toBeInTheDocument();

    // adminTienda: rol sin zona -> oculto (aunque muestre el switch fulfillment).
    await user.click(screen.getByRole("combobox", { name: "Rol" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "adminTienda",
      }),
    );
    expect(
      screen.queryByRole("combobox", { name: "Zona" }),
    ).not.toBeInTheDocument();
  }, 20000);

  it("envía zonaId con el id elegido al crear un mensajero (R27)", async () => {
    const user = userEvent.setup();
    listarRolesMock.mockResolvedValue({ status: "ok", roles: [...ROLES_ZONA] });
    crearUsuarioMock.mockResolvedValue({ status: "ok", usuario: { ...USUARIO } });

    const ref = createRef<UsuarioFormHandle>();
    renderIsolated(<UsuarioForm ref={ref} mode="crear" />);

    await user.type(screen.getByLabelText("Nombre"), "Nuevo Mensajero");
    await user.type(screen.getByLabelText("Email"), "mensajero@example.com");
    await user.type(screen.getByLabelText("Teléfono"), "0988888888");
    await user.type(screen.getByLabelText("Número de documento"), "1712345678");
    await user.type(screen.getByLabelText("Contraseña"), "Abcd1234$xy");

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

    // Elige una zona del catálogo (Norte -> z2).
    await user.click(screen.getByRole("combobox", { name: "Zona" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Norte",
      }),
    );

    await act(async () => {
      await ref.current!.submit();
    });

    expect(crearUsuarioMock).toHaveBeenCalledTimes(1);
    const enviado = crearUsuarioMock.mock.calls[0][0] as {
      zonaId?: string | null;
    };
    expect(enviado.zonaId).toBe("z2");
  }, 20000);

  it("no incluye zonaId cuando el rol no lleva zona (maestro) (R27)", async () => {
    const user = userEvent.setup();
    listarRolesMock.mockResolvedValue({ status: "ok", roles: [...ROLES_ZONA] });
    crearUsuarioMock.mockResolvedValue({ status: "ok", usuario: { ...USUARIO } });

    const ref = createRef<UsuarioFormHandle>();
    renderIsolated(<UsuarioForm ref={ref} mode="crear" />);

    await user.type(screen.getByLabelText("Nombre"), "Nuevo Maestro");
    await user.type(screen.getByLabelText("Email"), "maestro@example.com");
    await user.type(screen.getByLabelText("Teléfono"), "0988888888");
    await user.type(screen.getByLabelText("Número de documento"), "1712345678");
    await user.type(screen.getByLabelText("Contraseña"), "Abcd1234$xy");

    await user.click(screen.getByRole("combobox", { name: "Tipo de documento" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "cedula",
      }),
    );

    await user.click(screen.getByRole("combobox", { name: "Rol" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "maestro",
      }),
    );

    // maestro no ofrece el select de zona.
    expect(
      screen.queryByRole("combobox", { name: "Zona" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      await ref.current!.submit();
    });

    expect(crearUsuarioMock).toHaveBeenCalledTimes(1);
    const enviado = crearUsuarioMock.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado).not.toHaveProperty("zonaId");
  }, 20000);

  it("prefilla el select de zona con usuario.zonaId al editar un mensajero (R27)", async () => {
    listarRolesMock.mockResolvedValue({ status: "ok", roles: [...ROLES_ZONA] });
    renderIsolated(<UsuarioForm mode="editar" usuario={USUARIO_ZONA} />);

    // El trigger muestra el nombre de la zona cuyo id coincide con usuario.zonaId.
    const zonaTrigger = await screen.findByRole("combobox", { name: "Zona" });
    await waitFor(() => expect(zonaTrigger).toHaveTextContent("Norte"));
  }, 15000);
});
