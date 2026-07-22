// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";

import type {
  RegistrarWebhookFormHandle,
} from "@/app/(app)/configuracion/api/_components/RegistrarWebhookForm";

// Feature 105/T3 (R6, R9, R10, R11) — formulario de registro/edición de la URL.
// Se mockea la Server Action; la validación de cliente reusa el schema + https.
const registrarWebhookMock = vi.fn();
vi.mock("@/lib/actions/webhooks", () => ({
  registrarWebhook: (...a: unknown[]) => registrarWebhookMock(...a),
}));

import { RegistrarWebhookForm } from "@/app/(app)/configuracion/api/_components/RegistrarWebhookForm";

const OWNER = "u1";

function renderForm(initialUrl?: string) {
  const ref = createRef<RegistrarWebhookFormHandle>();
  render(
    <RegistrarWebhookForm
      ref={ref}
      ownerUsuarioId={OWNER}
      initialUrl={initialUrl}
    />,
  );
  return ref;
}

beforeEach(() => {
  vi.clearAllMocks();
  registrarWebhookMock.mockResolvedValue({ status: "actualizada" });
});

afterEach(() => {
  cleanup();
});

describe("RegistrarWebhookForm (R6, R9, R10, R11)", () => {
  it("R6: una URL no-https se bloquea en cliente y NO invoca la Server Action", async () => {
    const user = userEvent.setup();
    const ref = renderForm();

    await user.type(
      screen.getByLabelText("URL de callback"),
      "http://inseguro.example.com/cb",
    );

    const res = await ref.current!.submit();

    expect(res.status).toBe("validation_error");
    expect(registrarWebhookMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/debe ser una URL https válida/i),
    ).toBeInTheDocument();
  });

  it("R6: una URL https válida sí invoca la Server Action", async () => {
    const user = userEvent.setup();
    const ref = renderForm();

    await user.type(
      screen.getByLabelText("URL de callback"),
      "https://seguro.example.com/cb",
    );
    await ref.current!.submit();

    expect(registrarWebhookMock).toHaveBeenCalledWith({
      ownerUsuarioId: OWNER,
      url: "https://seguro.example.com/cb",
    });
  });

  it("R9: validation_error pinta fieldErrors (url) y no cierra", async () => {
    registrarWebhookMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { url: ["La URL ya está registrada por otro owner"] },
    });
    const user = userEvent.setup();
    const ref = renderForm();

    await user.type(
      screen.getByLabelText("URL de callback"),
      "https://seguro.example.com/cb",
    );
    const res = await ref.current!.submit();

    expect(res.status).toBe("validation_error");
    expect(
      await screen.findByText("La URL ya está registrada por otro owner"),
    ).toBeInTheDocument();
  });

  it("R10: owner_invalido muestra aviso de cuenta no válida y no cierra", async () => {
    registrarWebhookMock.mockResolvedValue({ status: "owner_invalido" });
    const user = userEvent.setup();
    const ref = renderForm();

    await user.type(
      screen.getByLabelText("URL de callback"),
      "https://seguro.example.com/cb",
    );
    const res = await ref.current!.submit();

    expect(res.status).toBe("owner_invalido");
    expect(
      await screen.findByText(/no es una cuenta de API válida/i),
    ).toBeInTheDocument();
  });

  it("R11: config_error muestra 'configuración pendiente del servidor' sin exponer internals", async () => {
    registrarWebhookMock.mockResolvedValue({ status: "config_error" });
    const user = userEvent.setup();
    const ref = renderForm();

    await user.type(
      screen.getByLabelText("URL de callback"),
      "https://seguro.example.com/cb",
    );
    const res = await ref.current!.submit();

    expect(res.status).toBe("config_error");
    const aviso = await screen.findByText(
      /configuración de webhooks del servidor está pendiente/i,
    );
    expect(aviso).toBeInTheDocument();
    // No expone nombres de variables de entorno ni trazas.
    expect(document.body.textContent).not.toMatch(/WEBHOOK_SECRET_ENC_KEY/);
    expect(document.body.textContent?.toLowerCase()).not.toContain("env");
  });
});
