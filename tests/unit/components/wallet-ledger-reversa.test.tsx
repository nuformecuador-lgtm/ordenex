// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// Feature 45 (T12, R13/R14/R22c/R32) — tests de la acción "Reversar" del libro. La action se
// mockea (no se toca el backend real). Verifica: la reversa se ofrece SOLO en egresos
// administrativos (`origen_tipo=gasto` ∧ `tipo=egreso`, incluye los del cron); ingresos y otros
// egresos NO la muestran; al confirmar, dispara la action con el id del egreso.

const reversarMock = vi.fn();
vi.mock("@/lib/actions/wallet-egresos", () => ({
  reversarEgresoAdministrativoAction: (...a: unknown[]) => reversarMock(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { WalletLedger } from "@/app/(app)/wallet/_components/WalletLedger";

const EGRESO_MANUAL: WalletMovimientoDTO = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  tipo: "egreso",
  categoria: "egreso_gasto_variable",
  monto: "125.50",
  origenTipo: "gasto",
  origenId: null,
  descripcion: "Suministros",
  registradoPor: "maestro-1",
  fechaMovimiento: "2026-07-12T10:00:00.000Z",
  dueno: "propio", // feature 231 (R31)
};

// Egreso generado por el cron: origen_tipo=gasto, registrado_por=null → también reversable.
const EGRESO_CRON: WalletMovimientoDTO = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  tipo: "egreso",
  categoria: "egreso_gasto_fijo",
  monto: "300.00",
  origenTipo: "gasto",
  origenId: "plantilla-1:2026-07",
  descripcion: "Alquiler — 2026-07",
  registradoPor: null,
  fechaMovimiento: "2026-07-01T06:00:00.000Z",
  dueno: "propio", // feature 231 (R31)
};

const INGRESO_FLETE: WalletMovimientoDTO = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  tipo: "ingreso",
  categoria: "ingreso_flete",
  monto: "1500.00",
  origenTipo: "cierre_dia",
  origenId: "cierre-1",
  descripcion: null,
  registradoPor: null,
  fechaMovimiento: "2026-07-12T10:00:00.000Z",
  dueno: "propio", // feature 231 (R31)
};

// Egreso NO administrativo (pago a mensajero, origen_tipo distinto de gasto) → sin reversa.
const EGRESO_MENSAJERO: WalletMovimientoDTO = {
  id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  tipo: "egreso",
  categoria: "egreso_pago_mensajero",
  monto: "80.00",
  origenTipo: "pago_mensajero",
  origenId: "pago-1",
  descripcion: null,
  registradoPor: "maestro-1",
  fechaMovimiento: "2026-07-12T10:00:00.000Z",
  dueno: "propio", // feature 231 (R31)
};

function renderLedger(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("WalletLedger — visibilidad de Reversar (R22c/R32)", () => {
  it("muestra Reversar en egresos administrativos (manual y del cron)", () => {
    renderLedger(<WalletLedger movimientos={[EGRESO_MANUAL, EGRESO_CRON]} />);

    const filaManual = screen.getByRole("row", { name: /Suministros/ });
    const filaCron = screen.getByRole("row", { name: /Alquiler/ });
    expect(within(filaManual).getByRole("button", { name: "Reversar" })).toBeInTheDocument();
    expect(within(filaCron).getByRole("button", { name: "Reversar" })).toBeInTheDocument();
  });

  it("NO muestra Reversar en ingresos ni en egresos no administrativos", () => {
    renderLedger(<WalletLedger movimientos={[INGRESO_FLETE, EGRESO_MENSAJERO]} />);

    const filaIngreso = screen.getByRole("row", { name: /Flete/ });
    const filaMensajero = screen.getByRole("row", { name: /Pago a mensajero/ });
    expect(within(filaIngreso).queryByRole("button", { name: "Reversar" })).not.toBeInTheDocument();
    expect(within(filaMensajero).queryByRole("button", { name: "Reversar" })).not.toBeInTheDocument();
  });
});

describe("WalletLedger — confirmar reversa (R13)", () => {
  it("al confirmar dispara la action con el id del egreso", async () => {
    const user = userEvent.setup();
    reversarMock.mockResolvedValue({ status: "ok" });
    renderLedger(<WalletLedger movimientos={[EGRESO_MANUAL]} />);

    const fila = screen.getByRole("row", { name: /Suministros/ });
    await user.click(within(fila).getByRole("button", { name: "Reversar" }));

    // Modal de confirmación.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Reversar egreso")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Reversar" }));

    await waitFor(() => expect(reversarMock).toHaveBeenCalledTimes(1));
    expect(reversarMock.mock.calls[0][0]).toEqual({ movimientoId: EGRESO_MANUAL.id });
  }, 15000);
});
