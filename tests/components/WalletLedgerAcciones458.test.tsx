// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// =================================================================================================
// FICHA 458-B — revision m3: la superficie que la 458-B ya deja VISIBLE en `/wallet`.
// =================================================================================================
//
// TB.8 dio a tres filas del libro de la caja un `documento` nuevo, y `DocumentoCajaAcciones` (el
// `Record` total por tipo) les ofrece «Anular…» HOY, antes de la 458-C:
//   · la indemnización por un incidente (`indemnizacion`);
//   · las DOS líneas de un cobro por rechazo a una tienda, flete e IVA (`rechazo_tienda_cobro`).
// (El egreso administrativo sigue con «Reversar»: la columna lo resuelve antes, `WalletLedger`.)
//
// Lo que se mide: qué filas ofrecen «Anular…» y cuáles «Anulado»; que la acción es la ÚNICA
// (`anularMovimientoAction`) con el id de la PROPIA fila y el libro «caja», SIN monto; que las dos
// líneas del rechazo anulan el MISMO cobro (cada una manda SU id, el servidor enruta a la gestión);
// que un `no_anulable` se dice dentro del diálogo; y que ninguna otra action se llama.

const anularMovimientoMock = vi.fn();
const anularCobroMock = vi.fn();
const anularPagoMock = vi.fn();
const anularAporteMock = vi.fn();
const anularAjusteMock = vi.fn();
const anularAbonoMock = vi.fn();
const reversarMock = vi.fn();

vi.mock("@/lib/actions/wallet-anulacion", () => ({
  anularMovimientoAction: (...a: unknown[]) => anularMovimientoMock(...a),
}));
vi.mock("@/lib/actions/abono-tienda", () => ({
  anularAbonoTiendaAction: (...a: unknown[]) => anularAbonoMock(...a),
  obtenerComprobanteAbonoAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  anularCobroTiendaAction: (...a: unknown[]) => anularCobroMock(...a),
}));
vi.mock("@/lib/actions/pago-por-cuenta-tienda", () => ({
  anularPagoPorCuentaTiendaAction: (...a: unknown[]) => anularPagoMock(...a),
  obtenerComprobantePagoPorCuentaAction: vi.fn(),
}));
vi.mock("@/lib/actions/aporte-capital", () => ({
  anularAporteCapitalAction: (...a: unknown[]) => anularAporteMock(...a),
  obtenerComprobanteAporteCapitalAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet", () => ({
  anularAjusteCajaAction: (...a: unknown[]) => anularAjusteMock(...a),
}));
vi.mock("@/lib/actions/wallet-egresos", () => ({
  reversarEgresoAdministrativoAction: (...a: unknown[]) => reversarMock(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
const successMock = vi.fn();
const errorMock = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { WalletLedger } from "@/app/(app)/wallet/_components/WalletLedger";

const GESTION_ID = "7d3e5f71-2b4c-4d6e-8f1a-3c5e7a9b1d2f";
const INCIDENTE_ID = "4b6d8f1a-3c5e-4a7c-9e1b-5d7f9a1c3e5b";

function fila(over: Partial<WalletMovimientoDTO>): WalletMovimientoDTO {
  return {
    id: "m-0000",
    tipo: "ingreso",
    categoria: "ingreso_flete_devolucion",
    monto: "1000.00",
    origenTipo: "gestion_orden",
    origenId: GESTION_ID,
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: "2026-09-24T18:00:00.000Z",
    dueno: "propio",
    documento: null,
    ...over,
  };
}

/** Las DOS líneas de caja del cobro por rechazo (flete e IVA), vigente. */
const RECHAZO_FLETE = fila({
  id: "m-rechazo-flete",
  descripcion: "Rechazo · Tienda Norte · flete",
  documento: { tipo: "rechazo_tienda_cobro", anulado: false, tieneComprobante: false },
});
const RECHAZO_IVA = fila({
  id: "m-rechazo-iva",
  categoria: "ingreso_iva_flete_devolucion",
  monto: "130.00",
  descripcion: "Rechazo · Tienda Norte · IVA",
  documento: { tipo: "rechazo_tienda_cobro", anulado: false, tieneComprobante: false },
});
/** La indemnización por un incidente, vigente. */
const INDEMNIZACION = fila({
  id: "m-indemnizacion",
  tipo: "egreso",
  categoria: "egreso_indemnizacion",
  monto: "700.00",
  origenTipo: "orden_incidente",
  origenId: INCIDENTE_ID,
  descripcion: "Indemnización · paquete dañado",
  fechaMovimiento: "2026-09-23T18:00:00.000Z",
  documento: { tipo: "indemnizacion", anulado: false, tieneComprobante: false },
});
/** Una indemnización ya ANULADA (lo decide el servidor, R71). */
const INDEMNIZACION_ANULADA = fila({
  id: "m-indemnizacion-anulada",
  tipo: "egreso",
  categoria: "egreso_indemnizacion",
  monto: "300.00",
  origenTipo: "orden_incidente",
  origenId: "9c1e3a5b-7d9f-4b1d-8f3a-5c7e9b1d3f5a",
  descripcion: "Indemnización · caja perdida",
  fechaMovimiento: "2026-09-22T18:00:00.000Z",
  documento: { tipo: "indemnizacion", anulado: true, tieneComprobante: false },
});
/** El reverso del flete por rechazo (contra-asiento): SIN documento, sin acciones. */
const REVERSO_FLETE = fila({
  id: "m-reverso-flete",
  tipo: "egreso",
  categoria: "egreso_reverso_flete_devolucion",
  descripcion: "Anulación · rechazo · Tienda Sur",
  fechaMovimiento: "2026-09-25T18:00:00.000Z",
});

const TODAS = [RECHAZO_FLETE, RECHAZO_IVA, INDEMNIZACION, INDEMNIZACION_ANULADA, REVERSO_FLETE];

function filaPorDescripcion(texto: RegExp): HTMLElement {
  return screen.getByRole("row", { name: texto });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("458-B m3 — qué filas nuevas ofrecen «Anular…» en /wallet", () => {
  it("«Anular…» en las dos líneas del rechazo y en la indemnización vigente; «Anulado» en la anulada; NADA en el reverso", () => {
    render(<WalletLedger movimientos={TODAS} />);
    for (const texto of [/Tienda Norte · flete/, /Tienda Norte · IVA/, /paquete dañado/]) {
      expect(within(filaPorDescripcion(texto)).getByRole("button", { name: /^Anular / }), String(texto)).toHaveTextContent(
        "Anular…",
      );
    }
    const anulada = filaPorDescripcion(/caja perdida/);
    expect(within(anulada).queryByRole("button", { name: /^Anular / })).toBeNull();
    expect(within(anulada).getByText("Anulado")).toBeInTheDocument();

    const reverso = filaPorDescripcion(/Anulación · rechazo/);
    expect(within(reverso).queryByRole("button", { name: /^Anular / })).toBeNull();
    expect(within(reverso).queryByText("Anulado")).toBeNull();
    // Ninguna ofrece «Ver comprobante»: ninguna lo tiene.
    expect(screen.queryAllByRole("button", { name: /^Ver comprobante/ })).toHaveLength(0);
  });
});

describe("458-B m3 — la anulación va por la acción ÚNICA con el id de la PROPIA fila", () => {
  it("indemnización: título, motivo obligatorio, {destino: caja + id de la fila, motivo} SIN monto; relee", async () => {
    anularMovimientoMock.mockResolvedValue({ status: "ok" });
    const onAnulado = vi.fn();
    const user = userEvent.setup();
    render(<WalletLedger movimientos={TODAS} onDocumentoAnulado={onAnulado} />);

    await user.click(within(filaPorDescripcion(/paquete dañado/)).getByRole("button", { name: /^Anular / }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Anular la indemnización por un incidente")).toBeInTheDocument();
    const confirmar = within(dialog).getByRole("button", { name: "Anular" });
    expect(confirmar).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "  No hubo daño ");
    await user.click(confirmar);

    await waitFor(() => expect(anularMovimientoMock).toHaveBeenCalledTimes(1));
    expect(anularMovimientoMock.mock.calls[0][0]).toEqual({
      destino: { libro: "caja", movimientoId: "m-indemnizacion" },
      motivo: "No hubo daño",
    });
    expect(JSON.stringify(anularMovimientoMock.mock.calls[0][0])).not.toContain("700");
    for (const otra of [anularCobroMock, anularPagoMock, anularAporteMock, anularAjusteMock, anularAbonoMock, reversarMock]) {
      expect(otra).not.toHaveBeenCalled();
    }
    await waitFor(() => expect(onAnulado).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith("Anulado. Se registró el movimiento contrario.");
  }, 20000);

  it.each([
    [/Tienda Norte · flete/, "m-rechazo-flete"],
    [/Tienda Norte · IVA/, "m-rechazo-iva"],
  ])("cobro por rechazo (%s): anula por la acción única con el id de SU línea", async (texto, id) => {
    anularMovimientoMock.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    render(<WalletLedger movimientos={TODAS} />);

    await user.click(within(filaPorDescripcion(texto)).getByRole("button", { name: /^Anular / }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Anular el cobro por rechazo a una tienda")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "No fue rechazo");
    await user.click(within(dialog).getByRole("button", { name: "Anular" }));

    await waitFor(() => expect(anularMovimientoMock).toHaveBeenCalledTimes(1));
    expect(anularMovimientoMock.mock.calls[0][0]).toEqual({
      destino: { libro: "caja", movimientoId: id },
      motivo: "No fue rechazo",
    });
    expect(anularCobroMock).not.toHaveBeenCalled();
  }, 20000);

  it("`ya_anulado` (la otra línea ya lo anuló) cierra con su aviso y relee", async () => {
    anularMovimientoMock.mockResolvedValue({ status: "ya_anulado" });
    const onAnulado = vi.fn();
    const user = userEvent.setup();
    render(<WalletLedger movimientos={TODAS} onDocumentoAnulado={onAnulado} />);

    await user.click(within(filaPorDescripcion(/Tienda Norte · IVA/)).getByRole("button", { name: /^Anular / }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "Duplicado");
    await user.click(within(dialog).getByRole("button", { name: "Anular" }));

    await waitFor(() => expect(successMock).toHaveBeenCalledWith("Ya estaba anulado; no se registró nada más."));
    await waitFor(() => expect(onAnulado).toHaveBeenCalledTimes(1));
  }, 20000);

  it("`no_anulable` (sin línea de caja) se dice DENTRO del diálogo, que no se cierra ni relee", async () => {
    anularMovimientoMock.mockResolvedValue({ status: "no_anulable", motivo: "sin_linea_de_caja" });
    const onAnulado = vi.fn();
    const user = userEvent.setup();
    render(<WalletLedger movimientos={TODAS} onDocumentoAnulado={onAnulado} />);

    await user.click(within(filaPorDescripcion(/Tienda Norte · flete/)).getByRole("button", { name: /^Anular / }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "x");
    await user.click(within(dialog).getByRole("button", { name: "Anular" }));

    const alerta = await within(dialog).findByRole("alert");
    expect(alerta.textContent).toMatch(/^Este cobro no se puede anular desde aquí: /);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onAnulado).not.toHaveBeenCalled();
  }, 20000);
});
