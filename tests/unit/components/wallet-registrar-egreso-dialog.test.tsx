// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";

// Feature 45 (T12, R22a/R4/R5/R19) — tests del diálogo de EGRESO administrativo manual.
// La action se mockea (no se toca el backend real). Verifica: el selector de tipo ofrece
// SOLO {gasto variable, sueldo} (sin "gasto fijo"); el submit envía el tipo/monto/descripción
// correctos; la validación de cliente bloquea monto ≤ 0 y descripción vacía sin llamar la action.

const registrarMock = vi.fn();
vi.mock("@/lib/actions/wallet-egresos", () => ({
  registrarEgresoAdministrativoAction: (...a: unknown[]) => registrarMock(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { RegistrarEgresoAdministrativoDialog } from "@/app/(app)/wallet/_components/RegistrarEgresoAdministrativoDialog";

function renderDialog(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("RegistrarEgresoAdministrativoDialog — tipos ofrecidos (R19/R22a)", () => {
  it("el selector de tipo ofrece SOLO {gasto variable, sueldo}, sin gasto fijo", async () => {
    const user = userEvent.setup();
    renderDialog(<RegistrarEgresoAdministrativoDialog />);

    await user.click(screen.getByRole("button", { name: "Registrar egreso" }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("combobox", { name: "Tipo de egreso" }));
    const lista = await screen.findByRole("listbox");
    expect(within(lista).getByRole("option", { name: "Gasto variable" })).toBeInTheDocument();
    expect(within(lista).getByRole("option", { name: "Sueldo" })).toBeInTheDocument();
    // "Gasto fijo" NO se ofrece a mano: lo emite el cron.
    expect(within(lista).queryByRole("option", { name: "Gasto fijo" })).not.toBeInTheDocument();
  }, 15000);
});

describe("RegistrarEgresoAdministrativoDialog — submit (R2/R22a)", () => {
  it("registra un gasto variable con el tipo, monto y descripción enviados", async () => {
    const user = userEvent.setup();
    registrarMock.mockResolvedValue({ status: "ok", movimiento: { id: "m1" } });
    renderDialog(<RegistrarEgresoAdministrativoDialog />);

    await user.click(screen.getByRole("button", { name: "Registrar egreso" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Monto"), "125.50");
    await user.type(within(dialog).getByLabelText("Concepto del gasto"), "Suministros");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    expect(registrarMock).toHaveBeenCalledTimes(1);
    expect(registrarMock.mock.calls[0][0]).toEqual({
      tipoEgreso: "gasto_variable",
      monto: "125.50",
      descripcion: "Suministros",
    });
  }, 15000);

  it("al elegir Sueldo cambia el label y envía tipoEgreso=sueldo", async () => {
    const user = userEvent.setup();
    registrarMock.mockResolvedValue({ status: "ok", movimiento: { id: "m2" } });
    renderDialog(<RegistrarEgresoAdministrativoDialog />);

    await user.click(screen.getByRole("button", { name: "Registrar egreso" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("combobox", { name: "Tipo de egreso" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", { name: "Sueldo" }),
    );

    // El label de la descripción se adapta al sueldo (trabajador + periodo, texto libre).
    const descripcion = within(dialog).getByLabelText("Trabajador y periodo");
    await user.type(within(dialog).getByLabelText("Monto"), "800.00");
    await user.type(descripcion, "Juan Pérez — julio 2026");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    expect(registrarMock).toHaveBeenCalledTimes(1);
    expect(registrarMock.mock.calls[0][0]).toEqual({
      tipoEgreso: "sueldo",
      monto: "800.00",
      descripcion: "Juan Pérez — julio 2026",
    });
  }, 15000);
});

describe("RegistrarEgresoAdministrativoDialog — validación de cliente (R4/R5)", () => {
  it("no llama la action si el monto es 0 o la descripción está vacía", async () => {
    const user = userEvent.setup();
    renderDialog(<RegistrarEgresoAdministrativoDialog />);

    await user.click(screen.getByRole("button", { name: "Registrar egreso" }));
    const dialog = await screen.findByRole("dialog");

    // Monto 0 y descripción vacía → bloqueado en cliente.
    await user.type(within(dialog).getByLabelText("Monto"), "0");
    await user.click(within(dialog).getByRole("button", { name: "Registrar" }));

    expect(registrarMock).not.toHaveBeenCalled();
    expect(
      within(dialog).getByText("El monto debe ser un número mayor que 0."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("La descripción es obligatoria.")).toBeInTheDocument();
  }, 15000);
});
