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
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";

// Feature 105/T4 — celda orquestadora del modal de gestión de la suscripción.
// Se mockean las 4 Server Actions del contrato de la 104.
const obtenerWebhookMock = vi.fn();
const registrarWebhookMock = vi.fn();
const desactivarWebhookMock = vi.fn();
const rotarSecretoWebhookMock = vi.fn();
vi.mock("@/lib/actions/webhooks", () => ({
  obtenerWebhook: (...a: unknown[]) => obtenerWebhookMock(...a),
  registrarWebhook: (...a: unknown[]) => registrarWebhookMock(...a),
  desactivarWebhook: (...a: unknown[]) => desactivarWebhookMock(...a),
  rotarSecretoWebhook: (...a: unknown[]) => rotarSecretoWebhookMock(...a),
}));

import { WebhookAccionCell } from "@/app/(app)/configuracion/api/_components/WebhookAccionCell";

const OWNER = "u1";
const IDENT = "integracion-erp";
const URL_ACTIVA = "https://hook.example.com/callback";
const NUEVA_URL = "https://nueva.example.com/hook";
const SECRET = "whk_9f8e7d6c5b4a3210FEDCBA9876543210deadbeefcafef00d";

const OK_ACTIVA = {
  status: "ok" as const,
  webhook: { url: URL_ACTIVA, activa: true },
};
const OK_VACIO = { status: "ok" as const, webhook: null };

function renderCell(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/** Abre el modal de gestión y espera a que el estado cargue. */
async function abrir(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: `Editar webhook de ${IDENT}` }),
  );
  await screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  obtenerWebhookMock.mockResolvedValue(OK_VACIO);
  registrarWebhookMock.mockResolvedValue({ status: "actualizada" });
  desactivarWebhookMock.mockResolvedValue({ status: "ok" });
  rotarSecretoWebhookMock.mockResolvedValue({ status: "ok", secret: SECRET });
});

afterEach(() => {
  cleanup();
});

describe("WebhookAccionCell — rótulo del botón (feature 108: R15, R16)", () => {
  it("R15: el botón de la fila se rotula 'Editar' (no 'Webhook')", () => {
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    const boton = screen.getByRole("button", {
      name: `Editar webhook de ${IDENT}`,
    });
    expect(boton).toHaveTextContent("Editar");
    expect(
      screen.queryByRole("button", { name: `Gestionar webhook de ${IDENT}` }),
    ).toBeNull();
  });

  it("R16: 'Editar' abre el modal y lee el estado con obtenerWebhook", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await user.click(
      screen.getByRole("button", { name: `Editar webhook de ${IDENT}` }),
    );

    await screen.findByRole("dialog");
    expect(obtenerWebhookMock).toHaveBeenCalledWith({ ownerUsuarioId: OWNER });
  });
});

describe("WebhookAccionCell — lectura del estado (R3, R4, R5)", () => {
  it("R3: owner con suscripción activa muestra la URL y el estado activa (vía obtenerWebhook)", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);

    expect(obtenerWebhookMock).toHaveBeenCalledWith({ ownerUsuarioId: OWNER });
    expect(await screen.findByText(URL_ACTIVA)).toBeInTheDocument();
    expect(screen.getByText(/activa/i)).toBeInTheDocument();
  });

  it("R4: owner sin suscripción indica 'sin webhook' y ofrece registrar", async () => {
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);

    expect(
      await screen.findByText(/No hay webhook registrado/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar" })).toBeInTheDocument();
  });

  it("R5: la lectura del estado (obtenerWebhook) nunca renderiza el secreto", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    expect(document.body.textContent).not.toContain(SECRET);
    expect(
      screen.queryByLabelText("Secreto de webhook generado"),
    ).toBeNull();
  });
});

describe("WebhookAccionCell — registrar / editar (R7b, R12, R16, R18)", () => {
  it("R7b: registrar con resultado 'actualizada' NO abre el modal de secreto; confirma y refresca", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    registrarWebhookMock.mockResolvedValue({ status: "actualizada" });
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    await user.click(screen.getByRole("button", { name: "Guardar URL" }));

    await waitFor(() =>
      expect(obtenerWebhookMock).toHaveBeenCalledTimes(2),
    ); // R18: re-lectura tras la mutación
    expect(
      screen.queryByLabelText("Secreto de webhook generado"),
    ).toBeNull(); // R7b: sin secreto al editar la URL
  });

  it("R12: forbidden muestra mensaje claro y no cierra destructivamente", async () => {
    registrarWebhookMock.mockResolvedValue({ status: "forbidden" });
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(/No hay webhook registrado/i);

    await user.type(screen.getByLabelText("URL de callback"), NUEVA_URL);
    await user.click(screen.getByRole("button", { name: "Registrar" }));

    expect(
      await screen.findByText(/No tienes permiso para esta acción/i),
    ).toBeInTheDocument();
    // El modal de gestión sigue abierto (no se pierde lo ingresado).
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("URL de callback")).toHaveValue(NUEVA_URL);
  });

  it("R16: mientras registrar está en curso, un segundo envío no dispara otra llamada", async () => {
    let resolver!: (v: { status: "actualizada" }) => void;
    registrarWebhookMock.mockImplementation(
      () => new Promise((res) => (resolver = res)),
    );
    obtenerWebhookMock.mockResolvedValue(OK_VACIO);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(/No hay webhook registrado/i);

    await user.type(screen.getByLabelText("URL de callback"), NUEVA_URL);
    const btn = screen.getByRole("button", { name: "Registrar" });
    await user.click(btn);
    await user.click(btn);

    expect(registrarWebhookMock).toHaveBeenCalledTimes(1);
    resolver({ status: "actualizada" });
  });

  it("R18: registrar 'creada' abre el revelado y re-lee el estado del owner", async () => {
    registrarWebhookMock.mockResolvedValue({ status: "creada", secret: SECRET });
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(/No hay webhook registrado/i);

    await user.type(screen.getByLabelText("URL de callback"), NUEVA_URL);
    await user.click(screen.getByRole("button", { name: "Registrar" }));

    // R7: revela el secreto de la ALTA una vez.
    expect(
      await screen.findByLabelText("Secreto de webhook generado"),
    ).toHaveValue(SECRET);
    // R18: re-lectura del estado tras la mutación.
    await waitFor(() => expect(obtenerWebhookMock).toHaveBeenCalledTimes(2));
  });
});

describe("WebhookAccionCell — dar de baja (R13, R14, R15)", () => {
  it("R13: dar de baja pide confirmación antes de invocar desactivarWebhook", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    await user.click(screen.getByRole("button", { name: "Dar de baja" }));

    expect(
      await screen.findByText("Dar de baja el webhook"),
    ).toBeInTheDocument();
    expect(desactivarWebhookMock).not.toHaveBeenCalled();
  });

  it("R14: desactivar ok refleja 'sin webhook activo' sin recargar la página", async () => {
    obtenerWebhookMock
      .mockResolvedValueOnce(OK_ACTIVA)
      .mockResolvedValue(OK_VACIO);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    await user.click(screen.getByRole("button", { name: "Dar de baja" }));
    await user.click(screen.getByRole("button", { name: "Sí, dar de baja" }));

    expect(desactivarWebhookMock).toHaveBeenCalledWith({ ownerUsuarioId: OWNER });
    expect(
      await screen.findByText(/No hay webhook registrado/i),
    ).toBeInTheDocument();
  });

  it("R15: sin suscripción activa NO se ofrece la acción de dar de baja", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_VACIO);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(/No hay webhook registrado/i);

    expect(
      screen.queryByRole("button", { name: "Dar de baja" }),
    ).toBeNull();
  });
});

describe("WebhookAccionCell — rotar secreto (R19, R20, R21)", () => {
  it("R19: 'Rotar secreto' solo se ofrece con suscripción activa", async () => {
    const user = userEvent.setup();

    // Sin suscripción: no se ofrece.
    obtenerWebhookMock.mockResolvedValue(OK_VACIO);
    const { unmount } = renderCell(
      <WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />,
    );
    await abrir(user);
    await screen.findByText(/No hay webhook registrado/i);
    expect(
      screen.queryByRole("button", { name: "Rotar secreto" }),
    ).toBeNull();
    unmount();
    cleanup();

    // Con suscripción activa: se ofrece.
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);
    await abrir(user);
    await screen.findByText(URL_ACTIVA);
    expect(
      screen.getByRole("button", { name: "Rotar secreto" }),
    ).toBeInTheDocument();
  });

  it("R20: rotar pide confirmación advirtiendo que invalida el secreto anterior", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    await user.click(screen.getByRole("button", { name: "Rotar secreto" }));

    const confirm = await screen.findByText("Rotar el secreto del webhook");
    expect(confirm).toBeInTheDocument();
    expect(
      screen.getByText(/invalida el secreto anterior/i),
    ).toBeInTheDocument();
    expect(rotarSecretoWebhookMock).not.toHaveBeenCalled();
  });

  it("R21: rotarSecretoWebhook ok abre el revelado con el secreto NUEVO una sola vez", async () => {
    obtenerWebhookMock.mockResolvedValue(OK_ACTIVA);
    rotarSecretoWebhookMock.mockResolvedValue({ status: "ok", secret: SECRET });
    const user = userEvent.setup();
    renderCell(<WebhookAccionCell ownerUsuarioId={OWNER} identificador={IDENT} />);

    await abrir(user);
    await screen.findByText(URL_ACTIVA);

    await user.click(screen.getByRole("button", { name: "Rotar secreto" }));
    await user.click(screen.getByRole("button", { name: "Sí, rotar secreto" }));

    expect(rotarSecretoWebhookMock).toHaveBeenCalledWith({
      ownerUsuarioId: OWNER,
    });
    expect(
      await screen.findByLabelText("Secreto de webhook generado"),
    ).toHaveValue(SECRET);
  });
});
