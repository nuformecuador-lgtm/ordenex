// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import { UUID_MENSAJERO, UUID_MOV, estado, fila } from "@/tests/fixtures/estado-cuenta";

// =================================================================================================
// FICHA 458-D (T D.3; R29, R30, R70) — EL ESTADO DE CUENTA DE UN MENSAJERO.
//
//  - R29: «Ordenex le paga al mensajero» es el reparto de la 205 con su previsualización de hoy.
//  - R70 (P6): un pago se ANULA desde su estado de cuenta, por el panel «Ver». La acción única manda SOLO
//    el destino de la fila y el motivo (sin monto); el servidor la enruta a `anularPagoAction`, la MISMA
//    que usa `/cierres-admin` (`PagoMensajeroSeccion`, sin cambios; su test sigue verde).
//  - R30: tras anular se relee ESTA cuenta.
// Sustituye a `tests/components/DesglosePagosMensajero.test.tsx` («R3 — se paga desde acá»).
// =================================================================================================

const verEstadoCuentaMock = vi.fn();
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: (...a: unknown[]) => verEstadoCuentaMock(...a),
}));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn(async () => ({ status: "forbidden" })) }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
const anularMock = vi.fn();
vi.mock("@/lib/actions/wallet-anulacion", () => ({
  anularMovimientoAction: (...a: unknown[]) => anularMock(...a),
}));
const previsualizarMock = vi.fn();
vi.mock("@/lib/actions/liquidacion", () => ({
  previsualizarRepartoMensajeroAction: (...a: unknown[]) => previsualizarMock(...a),
  registrarRepartoMensajeroAction: vi.fn(),
}));

import { EstadoCuentaMensajero } from "@/app/(app)/wallet/mensajeros/_components/EstadoCuentaMensajero";

const PAGO = fila({
  n: 5,
  libro: "mensajero",
  fecha: "2026-09-15",
  categoria: "liquidacion",
  origenTipo: "pago_mensajero",
  chip: "pagos",
  abono: null,
  cargo: "5000.00",
  saldoCorrido: "0.00",
  registro: { nombre: "Ana Admin", automatico: null },
  anulable: true,
  naceDeUnCierre: false,
});

const INICIAL = estado({ tipo: "mensajero", nombre: "Mario Mensajero", filas: [PAGO], total: 1, saldoActual: "0.00", signo: "cero", sentido: "en_cero" });

function montar() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <EstadoCuentaMensajero inicial={INICIAL} puedeRegistrar />
      </ToastProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  verEstadoCuentaMock.mockResolvedValue({ status: "ok", estado: INICIAL });
  previsualizarMock.mockResolvedValue({
    status: "ok",
    previsualizacion: {
      mensajeroNombre: "Mario Mensajero",
      imputable: "5000.00",
      imputableTotal: "5000.00",
      cuentaPorPagar: "5000.00",
      deudaNoImputable: { hay: false, monto: "0.00" },
      recorte: { aplicado: false, tope: 50, enVentana: 1, fuera: 0, montoFuera: "0.00" },
      imputaciones: [],
      sobrante: "0.00",
      excede: false,
      excluidos: [],
    },
  });
  anularMock.mockResolvedValue({ status: "ok", camino: "liquidacion_pago" });
});
afterEach(() => cleanup());

describe("R29 — «Ordenex le paga al mensajero» (el reparto de la 205)", () => {
  it("vive en las acciones de SU estado de cuenta y pide la previsualización de ESTE mensajero", async () => {
    montar();
    const acciones = screen.getByRole("region", { name: "Acciones sobre la cuenta de Mario Mensajero" });
    const bloque = within(acciones).getByRole("region", { name: "Pago al mensajero: Mario Mensajero" });
    await waitFor(() =>
      expect(within(bloque).getByRole("button", { name: "Ordenex le paga al mensajero" })).toBeEnabled(),
    );
    expect(previsualizarMock).toHaveBeenCalledWith({ mensajeroId: UUID_MENSAJERO });
  });
});

describe("R70 — anular un pago desde la wallet, con la misma acción de servidor", () => {
  it("«Ver» → «Anular…» manda SOLO el destino de la fila y el motivo; luego relee ESTA cuenta", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: "Ver Liquidación del 2026-09-15 por ₡5.000" }));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: "Anular…" }));
    const dialogos = await screen.findAllByRole("dialog");
    const anular = dialogos[dialogos.length - 1];
    await user.type(within(anular).getByLabelText(/Motivo de la anulación/), "Se pagó por error");
    const lecturasAntes = verEstadoCuentaMock.mock.calls.length;
    await user.click(within(anular).getByRole("button", { name: "Anular" }));

    await waitFor(() => expect(anularMock).toHaveBeenCalledTimes(1));
    expect(anularMock).toHaveBeenCalledWith({
      destino: { libro: "mensajero", movimientoId: UUID_MOV(5) },
      motivo: "Se pagó por error",
    });
    // R30: la cuenta de ESTE mensajero se vuelve a leer, y solo ella.
    await waitFor(() => expect(verEstadoCuentaMock.mock.calls.length).toBeGreaterThan(lecturasAntes));
    for (const [input] of verEstadoCuentaMock.mock.calls.slice(lecturasAntes)) {
      expect((input as { cuenta: unknown }).cuenta).toEqual({ tipo: "mensajero", id: UUID_MENSAJERO });
    }
  }, 20000);

  it("un pago ya anulado no ofrece «Anular…»", async () => {
    const user = userEvent.setup();
    verEstadoCuentaMock.mockResolvedValue({
      status: "ok",
      estado: { ...INICIAL, filas: [{ ...PAGO, anulable: false, anulacion: { motivo: "x", por: "Ana", fecha: "2026-09-16", hora: "10:30" } }] },
    });
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <EstadoCuentaMensajero
            inicial={{ ...INICIAL, filas: [{ ...PAGO, anulable: false, anulacion: { motivo: "x", por: "Ana", fecha: "2026-09-16", hora: "10:30" } }] }}
            puedeRegistrar
          />
        </ToastProvider>
      </SWRConfig>,
    );
    await user.click(screen.getByRole("button", { name: "Ver Liquidación del 2026-09-15 por ₡5.000" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).queryByRole("button", { name: "Anular…" })).toBeNull();
  });
});
