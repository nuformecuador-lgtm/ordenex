// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import type { PagoRegistradoDTO } from "@/lib/types/liquidacion";
import { FORMA_UUID, UUID_TIENDA } from "@/tests/fixtures/estado-cuenta";

// =================================================================================================
// FICHA 458-D (T D.2/T D.8; 172 R4, R33, R50, R53, R70–R76; 458 R30) — LOS PAGOS DE ORDENEX A LA TIENDA
// EN SU ESTADO DE CUENTA.
//
// Vivían en el desglose desplegable (`PagoTiendaAcciones`, retirado). Se conservan en el estado de cuenta
// de la tienda porque dicen lo que el extracto todavía no dice de un pago —método, referencia— y porque
// su anulación es la de la 172 (`anularPagoAction`, la misma de `/cierres-admin`):
//  - R50: la lista pide SOLO los pagos de ESTA tienda;
//  - R4/R81: sin permiso no hay control de anular (falla cerrado);
//  - R70/R76: anular manda el pago y el motivo, sin monto;
//  - R33/R30: tras anular se relee la lista de ESTA tienda y su estado de cuenta, y el aviso pinta el
//    saldo del SERVIDOR tal cual, aunque sea negativo (R71/R14).
// Sustituye, en lo que decían de la lista de pagos, a `tests/integration/wallet-tiendas-pago.test.tsx`.
// =================================================================================================

const listarPagosMock = vi.fn();
const anularPagoMock = vi.fn();
vi.mock("@/lib/actions/liquidacion", () => ({
  listarPagosDeTiendaAction: (...a: unknown[]) => listarPagosMock(...a),
  anularPagoAction: (...a: unknown[]) => anularPagoMock(...a),
}));

import { PagosTiendaEstadoCuenta } from "@/app/(app)/wallet/tiendas/_components/PagosTiendaEstadoCuenta";

const PAGO_ID = "7c6b5a49-3827-4165-9f4e-3d2c1b0a9f8e";
const PAGO: PagoRegistradoDTO = {
  id: PAGO_ID,
  monto: "4000.00",
  metodo: "sinpe",
  referencia: "123456",
  nota: "Quincena",
  fechaPago: "2026-09-20",
  registradoPorNombre: "Ana Admin",
  registradoAt: "2026-09-20T16:00:00.000Z",
  anulacion: null,
  esDeReparto: false,
};

function montar(puedeAnular = true) {
  const onCambio = vi.fn(async () => undefined);
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <PagosTiendaEstadoCuenta tiendaId={UUID_TIENDA} tiendaNombre="Tania Tienda" puedeAnular={puedeAnular} onCambio={onCambio} />
      </ToastProvider>
    </SWRConfig>,
  );
  return onCambio;
}

beforeEach(() => {
  vi.clearAllMocks();
  listarPagosMock.mockResolvedValue({ status: "ok", pagos: [PAGO] });
  anularPagoMock.mockResolvedValue({ status: "ok", restante: "-15000.00" });
});
afterEach(() => cleanup());

describe("172 R50 — los pagos de ESTA tienda, en su estado de cuenta", () => {
  it("pide SOLO los de esta tienda y los enseña con su método y su referencia, sin ids", async () => {
    montar();
    const region = screen.getByRole("region", { name: "Pagos de Ordenex a Tania Tienda" });
    await waitFor(() => expect(listarPagosMock).toHaveBeenCalledWith({ tiendaId: UUID_TIENDA }));
    expect(await within(region).findByText("123456")).toBeInTheDocument();
    expect(region.textContent ?? "").not.toMatch(FORMA_UUID);
  });
});

describe("172 R4/R81 — anular es un permiso", () => {
  it("sin permiso no hay control de anular", async () => {
    montar(false);
    await waitFor(() => expect(listarPagosMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /^Anular el pago/ })).toBeNull();
  });
});

describe("172 R70/R76 + 458 R30 — anular manda el pago y el motivo, y relee ESTA tienda", () => {
  it("sin monto; relee la lista y el estado de cuenta; el aviso pinta el saldo del servidor, negativo", async () => {
    const user = userEvent.setup();
    const onCambio = montar();
    await user.click(await screen.findByRole("button", { name: /^Anular el pago de ₡4\.000 del 2026-09-20/ }));
    const dialogo = await screen.findByRole("dialog");
    await user.type(within(dialogo).getByLabelText(/Motivo de la anulación/), "Se pagó dos veces");
    const lecturasAntes = listarPagosMock.mock.calls.length;
    await user.click(within(dialogo).getByRole("button", { name: "Anular pago" }));
    await waitFor(() => expect(anularPagoMock).toHaveBeenCalledWith({ pagoId: PAGO_ID, motivo: "Se pagó dos veces" }));
    await waitFor(() => expect(onCambio).toHaveBeenCalled());
    await waitFor(() => expect(listarPagosMock.mock.calls.length).toBeGreaterThan(lecturasAntes));
    for (const [input] of listarPagosMock.mock.calls) expect(input).toEqual({ tiendaId: UUID_TIENDA });
    expect(await screen.findByText("Pago anulado. El saldo de la tienda quedó en -₡15.000.")).toBeInTheDocument();
  }, 20000);
});
