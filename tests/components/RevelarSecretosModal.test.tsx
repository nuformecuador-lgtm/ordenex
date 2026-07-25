// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { RevelarSecretosModal } from "@/app/(app)/configuracion/api/_components/RevelarSecretosModal";

const PLAIN_KEY = "ordx_ab12cd3EF456ghIJ789klMN012opQR345stUV678wx";
const WEBHOOK_SECRET = "whk_9f8e7d6c5b4a3210FEDCBA9876543210deadbeefcafef00d";

/** Envuelve el modal con estado de cierre para probar el descarte de secretos. */
function Host({
  webhookSecret = null,
  webhookFallo = null,
}: {
  webhookSecret?: string | null;
  webhookFallo?: string | null;
}) {
  const [abierto, setAbierto] = useState(true);
  if (!abierto) return <p>cerrado</p>;
  return (
    <ToastProvider>
      <RevelarSecretosModal
        plainKey={PLAIN_KEY}
        identificador="integracion-erp"
        webhookSecret={webhookSecret}
        webhookFallo={webhookFallo}
        onClose={() => setAbierto(false)}
      />
    </ToastProvider>
  );
}

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
});

describe("RevelarSecretosModal — revelado combinado (R8, R9, R10)", () => {
  it("R8: con webhook creado revela clave y secreto de webhook en un solo modal", () => {
    render(<Host webhookSecret={WEBHOOK_SECRET} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("Clave de API generada")).toHaveValue(
      PLAIN_KEY,
    );
    expect(screen.getByLabelText("Secreto de webhook generado")).toHaveValue(
      WEBHOOK_SECRET,
    );
    // Un único botón de cierre para ambos secretos.
    expect(screen.getAllByRole("button", { name: "Cerrar" })).toHaveLength(1);
  });

  it("R9: el cierre exige el único checkbox y no re-muestra secretos", async () => {
    const user = userEvent.setup();
    render(<Host webhookSecret={WEBHOOK_SECRET} />);

    const cerrar = screen.getByRole("button", { name: "Cerrar" });
    expect(cerrar).toBeDisabled();

    // Escape no cierra mientras los secretos están visibles.
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("Clave de API generada")).toBeInTheDocument();

    // Un único checkbox habilita el único cierre para ambos secretos.
    const checks = screen.getAllByRole("checkbox");
    expect(checks).toHaveLength(1);
    await user.click(checks[0]);
    expect(cerrar).toBeEnabled();

    await user.click(cerrar);

    await waitFor(() =>
      expect(screen.queryByLabelText("Clave de API generada")).toBeNull(),
    );
    // Cerrado: no hay acción para volver a mostrar ningún secreto.
    expect(
      screen.queryByLabelText("Secreto de webhook generado"),
    ).toBeNull();
    expect(document.body.textContent).not.toContain(PLAIN_KEY);
    expect(document.body.textContent).not.toContain(WEBHOOK_SECRET);
  });

  it("R10: al cerrar, ambos secretos se descartan del DOM (solo estado local)", async () => {
    const localSet = vi.spyOn(Storage.prototype, "setItem");
    const logs = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
    ];
    const user = userEvent.setup();
    render(<Host webhookSecret={WEBHOOK_SECRET} />);

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    await waitFor(() =>
      expect(screen.queryByLabelText("Clave de API generada")).toBeNull(),
    );

    const contiene = (calls: unknown[][]) =>
      calls.some((args) =>
        args.some(
          (a) =>
            typeof a === "string" &&
            (a.includes(PLAIN_KEY) || a.includes(WEBHOOK_SECRET)),
        ),
      );
    expect(contiene(localSet.mock.calls)).toBe(false);
    for (const l of logs) expect(contiene(l.mock.calls)).toBe(false);

    localSet.mockRestore();
    for (const l of logs) l.mockRestore();
  });

  it("R11/R12: en fallo parcial muestra la clave y un aviso, sin sección de secreto de webhook", () => {
    render(
      <Host
        webhookFallo="La API key se creó, pero el webhook no quedó registrado. Puedes registrarlo con el botón Editar de la fila."
      />,
    );

    expect(screen.getByLabelText("Clave de API generada")).toHaveValue(
      PLAIN_KEY,
    );
    // Sin secreto de webhook: no hay sección de secreto.
    expect(
      screen.queryByLabelText("Secreto de webhook generado"),
    ).toBeNull();
    const aviso = screen.getByText(/el webhook no quedó registrado/i);
    expect(aviso.closest("[role='alert']")).not.toBeNull();
  });
});
