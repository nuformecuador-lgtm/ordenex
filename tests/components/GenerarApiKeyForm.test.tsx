// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";

// Feature 108/T2 — formulario de alta con URL de webhook OPCIONAL. Se mockea
// `generarApiKey` para verificar que la validación de cliente decide si se invoca.
const generarApiKeyMock = vi.fn();
vi.mock("@/lib/actions/api-keys", () => ({
  generarApiKey: (...a: unknown[]) => generarApiKeyMock(...a),
}));

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
});

afterEach(() => {
  cleanup();
});

describe("GenerarApiKeyForm — campo de webhook opcional (feature 108)", () => {
  it("R1/R20: muestra el campo opcional de URL de webhook con label accesible", () => {
    render(<GenerarApiKeyForm />);

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
    render(<GenerarApiKeyForm ref={ref} />);

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
    render(<GenerarApiKeyForm ref={ref} />);

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
    render(<GenerarApiKeyForm ref={ref} />);

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
