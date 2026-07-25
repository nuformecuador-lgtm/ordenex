// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { RevelarWebhookSecretoModal } from "@/app/(app)/configuracion/api/_components/RevelarWebhookSecretoModal";

// Feature 105/T2 (R7, R8, R17) — modal de revelado del secreto del webhook, espejo
// de `RevelarApiKeyModal`. Secreto en claro UNA vez, cierre bloqueado hasta el
// checkbox, sin fugas a console/storage.

const SECRET = "whk_9f8e7d6c5b4a3210FEDCBA9876543210deadbeefcafef00d";

function renderUI(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/** Anfitrión mínimo que sostiene el secreto en estado y lo borra al cerrar (R8/R17). */
function Host() {
  const [secreto, setSecreto] = useState<string | null>(SECRET);
  if (secreto === null) return <div data-testid="cerrado" />;
  return (
    <RevelarWebhookSecretoModal
      secret={secreto}
      identificador="integracion-erp"
      onClose={() => setSecreto(null)}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("RevelarWebhookSecretoModal (R7, R8, R17)", () => {
  it("R7: muestra el secreto en claro y el aviso de única vez", () => {
    renderUI(
      <RevelarWebhookSecretoModal
        secret={SECRET}
        identificador="integracion-erp"
        onClose={() => {}}
      />,
    );

    expect(screen.getByLabelText("Secreto de webhook generado")).toHaveValue(
      SECRET,
    );
    expect(
      screen.getByText(/única vez que verás este secreto/i),
    ).toBeInTheDocument();
    // El aviso es un `role="alert"`.
    expect(screen.getByRole("alert")).toHaveTextContent(
      /única vez que verás este secreto/i,
    );
  });

  it("R8: Cerrar deshabilitado sin checkbox; Escape/overlay no cierran; tras cerrar el secreto sale del DOM", async () => {
    const user = userEvent.setup();
    renderUI(<Host />);

    const cerrar = screen.getByRole("button", { name: "Cerrar" });
    expect(cerrar).toBeDisabled();

    // Escape no cierra mientras el secreto está visible.
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("Secreto de webhook generado")).toBeInTheDocument();

    // Click en el overlay tampoco cierra.
    await user.click(screen.getByTestId("modal-backdrop"));
    expect(screen.getByLabelText("Secreto de webhook generado")).toBeInTheDocument();

    // Marcar el checkbox habilita el ÚNICO botón de cierre.
    await user.click(
      screen.getByRole("checkbox", {
        name: "Ya guardé el secreto en un lugar seguro",
      }),
    );
    expect(cerrar).toBeEnabled();

    await user.click(cerrar);
    await waitFor(() =>
      expect(
        screen.queryByLabelText("Secreto de webhook generado"),
      ).toBeNull(),
    );
    // Tras cerrar, el secreto no está en el DOM y no hay acción para recuperarlo.
    expect(document.body.textContent).not.toContain(SECRET);
    expect(
      screen.queryByRole("button", { name: "Copiar secreto de webhook" }),
    ).toBeNull();
  });

  it("R17: durante mostrar→copiar→cerrar el secreto no llega a console ni a storage", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "debug").mockImplementation(() => {}),
    ];
    const localSet = vi.spyOn(Storage.prototype, "setItem");

    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    renderUI(<Host />);

    await user.click(
      screen.getByRole("button", { name: "Copiar secreto de webhook" }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Ya guardé el secreto en un lugar seguro",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    const containsSecret = (calls: unknown[][]) =>
      calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes(SECRET)),
      );

    for (const spy of spies) {
      expect(containsSecret(spy.mock.calls)).toBe(false);
    }
    expect(containsSecret(localSet.mock.calls)).toBe(false);

    for (const spy of spies) spy.mockRestore();
    localSet.mockRestore();
  });
});
