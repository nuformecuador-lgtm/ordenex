// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type ReactElement } from "react";
import { SWRConfig } from "swr";

// Feature 108/T2 — formulario de alta con URL de webhook OPCIONAL. Se mockea
// `generarApiKey` para verificar que la validación de cliente decide si se invoca.
const generarApiKeyMock = vi.fn();
vi.mock("@/lib/actions/api-keys", () => ({
  generarApiKey: (...a: unknown[]) => generarApiKeyMock(...a),
}));

// Feature 307 — el selector de "Tienda destino" se puebla con la Server Action que YA
// existía (`listarAdminTiendas`, de la 302). Se mockea: aquí se verifica la pantalla,
// no la autorización (que el service ya cubre).
const listarAdminTiendasMock = vi.fn();
vi.mock("@/lib/actions/usuarios-por-rol", () => ({
  listarAdminTiendas: (...a: unknown[]) => listarAdminTiendasMock(...a),
  listarUsuariosPorRol: vi.fn(),
}));

const TIENDA_NORTE = { id: "3f2b1a09-8c7d-4e6f-9a0b-1c2d3e4f5a6b", nombre: "Tienda Norte" };
const TIENDA_SUR = { id: "8c7d6e5f-4a3b-4c2d-9e1f-0a9b8c7d6e5f", nombre: "Tienda Sur" };

/** Cada render estrena caché SWR: el catálogo de un test no se filtra al siguiente. */
function renderForm(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {ui}
    </SWRConfig>,
  );
}

/** El desplegable de tienda destino. */
function selectorTienda(): HTMLElement {
  return screen.getByRole("combobox", { name: "Tienda destino" });
}

/** Espera a que el catálogo llegue y el desplegable deje de estar deshabilitado. */
async function esperarCatalogo() {
  await waitFor(() => expect(selectorTienda()).not.toBeDisabled());
}

/** Abre el desplegable y elige la opción con ese texto. */
async function elegirTienda(
  user: ReturnType<typeof userEvent.setup>,
  nombre: string | RegExp,
) {
  await esperarCatalogo();
  await user.click(selectorTienda());
  await user.click(await screen.findByRole("option", { name: nombre }));
}

import {
  GenerarApiKeyForm,
  type GenerarApiKeyFormHandle,
} from "@/app/(app)/configuracion/api/_components/GenerarApiKeyForm";

const OK = {
  status: "ok" as const,
  apiKey: {
    id: "k2",
    identificador: "nueva",
    keyPrefix: "ordx_zz99yy8",
    usuarioId: "u2",
    createdAt: new Date("2026-02-02T10:00:00Z"),
  },
  plainKey: "ordx_plain_secret_value_1234567890",
};

beforeEach(() => {
  vi.clearAllMocks();
  generarApiKeyMock.mockResolvedValue(OK);
  listarAdminTiendasMock.mockResolvedValue({
    status: "ok",
    usuarios: [TIENDA_NORTE, TIENDA_SUR],
  });
});

afterEach(() => {
  cleanup();
});

describe("GenerarApiKeyForm — campo de webhook opcional (feature 108)", () => {
  it("R1/R20: muestra el campo opcional de URL de webhook con label accesible", () => {
    renderForm(<GenerarApiKeyForm />);

    // R1: existe el campo además del identificador.
    expect(screen.getByLabelText("Identificador")).toBeInTheDocument();
    // R20: el campo de URL tiene etiqueta accesible asociada.
    const url = screen.getByLabelText("URL de webhook (callback)");
    expect(url).toBeInTheDocument();
    expect(url).toHaveAttribute("type", "url");
  });

  it("R3: con URL vacía valida solo el identificador y no bloquea el envío", async () => {
    const ref = createRef<GenerarApiKeyFormHandle>();
    const user = userEvent.setup();
    renderForm(<GenerarApiKeyForm ref={ref} />);

    await user.type(screen.getByLabelText("Identificador"), "integracion");

    const out = await act(async () => ref.current!.submit());

    expect(generarApiKeyMock).toHaveBeenCalledWith({
      identificador: "integracion",
    });
    expect(out.keyResult.status).toBe("ok");
    expect(out.webhookUrl).toBe("");
  });

  it("R3: propaga la URL https válida al anfitrión tras un alta ok", async () => {
    const ref = createRef<GenerarApiKeyFormHandle>();
    const user = userEvent.setup();
    renderForm(<GenerarApiKeyForm ref={ref} />);

    await user.type(screen.getByLabelText("Identificador"), "integracion");
    await user.type(
      screen.getByLabelText("URL de webhook (callback)"),
      "https://hook.example.com/cb",
    );

    const out = await act(async () => ref.current!.submit());

    expect(generarApiKeyMock).toHaveBeenCalledTimes(1);
    expect(out.webhookUrl).toBe("https://hook.example.com/cb");
  });

  it("R3/R4/R20: URL no-https marca error accesible y NO invoca generarApiKey", async () => {
    const ref = createRef<GenerarApiKeyFormHandle>();
    const user = userEvent.setup();
    renderForm(<GenerarApiKeyForm ref={ref} />);

    await user.type(screen.getByLabelText("Identificador"), "integracion");
    await user.type(
      screen.getByLabelText("URL de webhook (callback)"),
      "http://inseguro.example.com/cb",
    );

    const out = await act(async () => ref.current!.submit());

    // R4: no se invoca la Server Action con una URL inválida.
    expect(generarApiKeyMock).not.toHaveBeenCalled();
    expect(out.keyResult.status).toBe("validation_error");
    expect(out.webhookUrl).toBe("");
    // R20: el error se anuncia de forma accesible (role="alert").
    const alerta = await screen.findByText(
      /URL de callback debe ser una URL https/i,
    );
    expect(alerta).toBeInTheDocument();
    expect(alerta.closest("[role='alert']")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Feature 307 — selector de "Tienda destino" (pone en pantalla lo que la 302 permitió)
// ---------------------------------------------------------------------------
describe("GenerarApiKeyForm — tienda destino (feature 307)", () => {
  it("ofrece un desplegable de tienda destino poblado con las tiendas registradas", async () => {
    const user = userEvent.setup();
    renderForm(<GenerarApiKeyForm />);

    await esperarCatalogo();
    await user.click(selectorTienda());

    const opciones = screen.getAllByRole("option").map((o) => o.textContent?.trim());
    expect(opciones).toContain("Tienda Norte");
    expect(opciones).toContain("Tienda Sur");
  });

  it("explica que las órdenes de la clave serán de la tienda elegida, y lo enlaza al campo", async () => {
    renderForm(<GenerarApiKeyForm />);
    await esperarCatalogo();

    const ayuda = screen.getByText(/las órdenes que cargue esta clave serán de esa tienda/i);
    expect(ayuda).toBeInTheDocument();
    // Accesible: el desplegable apunta a la ayuda por `aria-describedby`.
    expect(selectorTienda().getAttribute("aria-describedby")).toContain(ayuda.id);
  });

  it("con tienda elegida envía SU id a la Server Action", async () => {
    const ref = createRef<GenerarApiKeyFormHandle>();
    const user = userEvent.setup();
    renderForm(<GenerarApiKeyForm ref={ref} />);

    await user.type(screen.getByLabelText("Identificador"), "integracion");
    await elegirTienda(user, "Tienda Norte");

    const out = await act(async () => ref.current!.submit());

    expect(generarApiKeyMock).toHaveBeenCalledWith({
      identificador: "integracion",
      tiendaDestinoId: TIENDA_NORTE.id,
    });
    expect(out.keyResult.status).toBe("ok");
  });

  it("SIN elegir tienda NO falla la validación: se genera sin tienda destino", async () => {
    const ref = createRef<GenerarApiKeyFormHandle>();
    const user = userEvent.setup();
    renderForm(<GenerarApiKeyForm ref={ref} />);

    await user.type(screen.getByLabelText("Identificador"), "integracion");
    await esperarCatalogo();

    const out = await act(async () => ref.current!.submit());

    // La cadena vacía del `<select>` es "ninguna", no "un uuid inválido".
    expect(out.keyResult.status).toBe("ok");
    expect(generarApiKeyMock).toHaveBeenCalledTimes(1);
    const enviado = generarApiKeyMock.mock.calls[0]![0] as {
      identificador: string;
      tiendaDestinoId?: string;
    };
    expect(enviado.identificador).toBe("integracion");
    expect(enviado.tiendaDestinoId).toBeUndefined();
    // Y no se pinta error alguno bajo el campo.
    expect(screen.queryByText(/uuid/i)).toBeNull();
  });

  it("la elección se puede DESHACER: volver a 'ninguna' vuelve al alta de siempre", async () => {
    const ref = createRef<GenerarApiKeyFormHandle>();
    const user = userEvent.setup();
    renderForm(<GenerarApiKeyForm ref={ref} />);

    await user.type(screen.getByLabelText("Identificador"), "integracion");
    await elegirTienda(user, "Tienda Norte");
    await elegirTienda(user, /Ninguna/i);

    await act(async () => ref.current!.submit());

    const enviado = generarApiKeyMock.mock.calls[0]![0] as { tiendaDestinoId?: string };
    expect(enviado.tiendaDestinoId).toBeUndefined();
  });

  it("pinta bajo el campo el error de tienda destino que devuelve el backend", async () => {
    generarApiKeyMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { tiendaDestinoId: ["La tienda destino no existe"] },
    });
    const ref = createRef<GenerarApiKeyFormHandle>();
    const user = userEvent.setup();
    renderForm(<GenerarApiKeyForm ref={ref} />);

    await user.type(screen.getByLabelText("Identificador"), "integracion");
    await elegirTienda(user, "Tienda Norte");
    await act(async () => ref.current!.submit());

    const alerta = await screen.findByText("La tienda destino no existe");
    expect(alerta.closest("[role='alert']")).not.toBeNull();
    expect(selectorTienda()).toHaveAttribute("aria-invalid", "true");
  });

  it("si el catálogo no llega, el campo se apaga pero el alta sigue funcionando", async () => {
    listarAdminTiendasMock.mockResolvedValue({ status: "forbidden" });
    const ref = createRef<GenerarApiKeyFormHandle>();
    const user = userEvent.setup();
    renderForm(<GenerarApiKeyForm ref={ref} />);

    await user.type(screen.getByLabelText("Identificador"), "integracion");
    await waitFor(() => expect(selectorTienda()).toBeDisabled());

    const out = await act(async () => ref.current!.submit());
    expect(out.keyResult.status).toBe("ok");
  });
});
