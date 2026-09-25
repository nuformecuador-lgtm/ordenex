// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// =================================================================================================
// FICHA 459 (T B.16 / T C.6, design §7.3 y §9.4) — LAS ACCIONES DEL LIBRO DE LA CAJA
// =================================================================================================
//
// R66: «Anular…» SOLO en la fila ORIGINAL vigente de un pago por cuenta o de un saldo inicial o
// aporte; «Anulado» si ya lo está; NADA en los contra-asientos ni en las salidas de los cobros
// reclasificados. R67: «Ver comprobante» donde lo haya. R65: tras anular, el módulo relee.
// R87: la salida de un cobro reclasificado se lee con su origen legible y SIN acciones.
// R100: ningún identificador interno en pantalla ni en la descarga.
//
// Quién decide qué fila tiene documento es el SERVIDOR (`WalletMovimientoDTO.documento`, resuelto
// en `WalletService`; su test de servicio mide qué filas lo reciben y cuántas consultas cuesta).
// Aquí se mide que la pantalla OBEDECE al campo y que sus dos acciones mandan lo que el borde
// espera.

const anularPagoMock = vi.fn();
const comprobantePagoMock = vi.fn();
const anularAporteMock = vi.fn();
const comprobanteAporteMock = vi.fn();

vi.mock("@/lib/actions/pago-por-cuenta-tienda", () => ({
  anularPagoPorCuentaTiendaAction: (...a: unknown[]) => anularPagoMock(...a),
  obtenerComprobantePagoPorCuentaAction: (...a: unknown[]) => comprobantePagoMock(...a),
}));
vi.mock("@/lib/actions/aporte-capital", () => ({
  anularAporteCapitalAction: (...a: unknown[]) => anularAporteMock(...a),
  obtenerComprobanteAporteCapitalAction: (...a: unknown[]) => comprobanteAporteMock(...a),
}));
vi.mock("@/lib/actions/wallet-egresos", () => ({
  reversarEgresoAdministrativoAction: vi.fn(),
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
import {
  COLUMNAS_DESCARGA_WALLET_CAJA,
  filaDescargaMovimientoCaja,
} from "@/app/(app)/wallet/_components/wallet-ledger-descarga-columnas";

const PAGO_ID = "0b6c1f7e-7a44-4b43-9c1a-5e0f2d9a1c11";
const APORTE_ID = "9f2e3d4c-1b2a-4c3d-8e9f-0a1b2c3d4e5f";
const COBRO_ID = "ecf6c289-9799-4558-be6d-ce5f8a12f5cd";

function fila(over: Partial<WalletMovimientoDTO>): WalletMovimientoDTO {
  return {
    id: "m-0000",
    tipo: "egreso",
    categoria: "egreso_pago_por_cuenta_tienda",
    monto: "10000.00",
    origenTipo: "pago_por_cuenta_tienda",
    origenId: PAGO_ID,
    descripcion: "Tienda Norte · A Facebook · Pauta · SINPE · REF-1",
    registradoPor: null,
    fechaMovimiento: "2026-09-20T12:00:00.000Z",
    dueno: "terceros",
    documento: null,
    ...over,
  };
}

/** La fila ORIGINAL de un pago por cuenta vigente con comprobante. */
const PAGO_VIGENTE = fila({
  id: "m-pago",
  documento: { tipo: "pago_por_cuenta_tienda", anulado: false, tieneComprobante: true },
});
/** La fila ORIGINAL de un pago por cuenta ya anulado, sin comprobante. */
const PAGO_ANULADO = fila({
  id: "m-pago-anulado",
  fechaMovimiento: "2026-09-18T12:00:00.000Z",
  descripcion: "Tienda Sur · A Jet Cargo · Envío · Efectivo",
  documento: { tipo: "pago_por_cuenta_tienda", anulado: true, tieneComprobante: false },
});
/** Su contra-asiento: mismo origen, otra categoría, SIN documento. */
const CONTRA_ASIENTO = fila({
  id: "m-reverso",
  tipo: "ingreso",
  categoria: "ingreso_reverso_pago_por_cuenta_tienda",
  fechaMovimiento: "2026-09-19T12:00:00.000Z",
  descripcion: "Anulación · Tienda Sur · A Jet Cargo · Envío · Efectivo",
});
/** La salida de un cobro reclasificado (bloque C): misma categoría, origen del cobro, SIN documento. */
const RECLASIFICADO = fila({
  id: "m-reclasificado",
  origenTipo: "cobro_manual_reclasificado",
  origenId: COBRO_ID,
  fechaMovimiento: "2026-09-10T12:00:00.000Z",
  descripcion: "Nuform · pago FACEBOOK",
});
/** El saldo inicial vigente, sin comprobante. */
const SALDO_INICIAL = fila({
  id: "m-aporte",
  tipo: "ingreso",
  categoria: "ingreso_aporte_capital",
  origenTipo: "aporte_capital",
  origenId: APORTE_ID,
  monto: "2500000.50",
  dueno: "capital",
  fechaMovimiento: "2026-08-25T06:00:00.000Z",
  descripcion: "Saldo inicial · Arranque",
  documento: { tipo: "aporte_capital", anulado: false, tieneComprobante: false },
});

const TODAS = [PAGO_VIGENTE, PAGO_ANULADO, CONTRA_ASIENTO, RECLASIFICADO, SALDO_INICIAL];

function filaPorDescripcion(texto: RegExp): HTMLElement {
  return screen.getByRole("row", { name: texto });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("FICHA 459 — qué filas ofrecen acciones (R66/R67)", () => {
  it("R66: «Anular…» solo en los originales VIGENTES; «Anulado» en el ya anulado", () => {
    render(<WalletLedger movimientos={TODAS} />);

    const pago = filaPorDescripcion(/A Facebook · Pauta/);
    expect(within(pago).getByRole("button", { name: /^Anular / })).toHaveTextContent("Anular…");

    const anulado = filaPorDescripcion(/^(?!.*Anulación).*A Jet Cargo/);
    expect(within(anulado).queryByRole("button", { name: /^Anular / })).toBeNull();
    expect(within(anulado).getByText("Anulado")).toBeInTheDocument();

    const aporte = filaPorDescripcion(/Saldo inicial · Arranque/);
    expect(within(aporte).getByRole("button", { name: /^Anular / })).toHaveTextContent("Anular…");
  });

  it("R66: NADA en el contra-asiento ni en la salida de un cobro reclasificado", () => {
    render(<WalletLedger movimientos={TODAS} />);

    for (const texto of [/Anulación · Tienda Sur/, /pago FACEBOOK/]) {
      const f = filaPorDescripcion(texto);
      expect(within(f).queryAllByRole("button"), String(texto)).toHaveLength(0);
      expect(within(f).queryByText("Anulado")).toBeNull();
      expect(within(f).queryByText("Ver comprobante")).toBeNull();
    }
  });

  it("R67: «Ver comprobante» solo donde el documento lo tiene", () => {
    render(<WalletLedger movimientos={TODAS} />);
    expect(
      within(filaPorDescripcion(/A Facebook · Pauta/)).getByRole("button", {
        name: /^Ver comprobante/,
      }),
    ).toBeInTheDocument();
    expect(
      within(filaPorDescripcion(/Saldo inicial · Arranque/)).queryByRole("button", {
        name: /^Ver comprobante/,
      }),
    ).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Ver comprobante/ })).toHaveLength(1);
  });

  it("cada botón se identifica con SU fila (concepto, fecha, importe), no con un «Anular» repetido", () => {
    render(<WalletLedger movimientos={TODAS} />);
    expect(
      screen.getByRole("button", {
        name: "Anular Pago por cuenta de una tienda del 2026-09-20 por ₡10.000",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Anular Saldo inicial o aporte de capital del 2026-08-25 por ₡2.500.000,50",
      }),
    ).toBeInTheDocument();
  });
});

describe("FICHA 459 — anular desde el libro (R46/R49/R65/R74)", () => {
  it("pago por cuenta: motivo obligatorio, manda {pagoId, motivo} y el módulo relee", async () => {
    anularPagoMock.mockResolvedValue({ status: "ok", saldo: {} });
    const onAnulado = vi.fn();
    const user = userEvent.setup();
    render(<WalletLedger movimientos={TODAS} onDocumentoAnulado={onAnulado} />);

    await user.click(
      within(filaPorDescripcion(/A Facebook · Pauta/)).getByRole("button", { name: /^Anular / }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Anular el pago por cuenta de una tienda"),
    ).toBeInTheDocument();
    const confirmar = within(dialog).getByRole("button", { name: "Anular" });
    // R49 — sin motivo no se puede confirmar.
    expect(confirmar).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "  Pagado dos veces ");
    await user.click(confirmar);

    await waitFor(() => expect(anularPagoMock).toHaveBeenCalledTimes(1));
    // R37: sin monto; el motivo recortado; el id es el del DOCUMENTO (el origen de la fila).
    expect(anularPagoMock.mock.calls[0][0]).toEqual({ pagoId: PAGO_ID, motivo: "Pagado dos veces" });
    expect(anularAporteMock).not.toHaveBeenCalled();
    await waitFor(() => expect(onAnulado).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith("Anulado. Se registró el movimiento contrario.");
  }, 20000);

  it("saldo inicial: manda {aporteId, motivo} a SU action", async () => {
    anularAporteMock.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    render(<WalletLedger movimientos={TODAS} onDocumentoAnulado={vi.fn()} />);

    await user.click(
      within(filaPorDescripcion(/Saldo inicial · Arranque/)).getByRole("button", {
        name: /^Anular /,
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "Era otra cifra");
    await user.click(within(dialog).getByRole("button", { name: "Anular" }));

    await waitFor(() => expect(anularAporteMock).toHaveBeenCalledTimes(1));
    expect(anularAporteMock.mock.calls[0][0]).toEqual({
      aporteId: APORTE_ID,
      motivo: "Era otra cifra",
    });
    expect(anularPagoMock).not.toHaveBeenCalled();
  }, 20000);

  it("R50: «ya estaba anulado» también cierra y relee; «no encontrado» se dice y no cierra", async () => {
    anularPagoMock.mockResolvedValueOnce({ status: "ya_anulado" });
    const onAnulado = vi.fn();
    const user = userEvent.setup();
    render(<WalletLedger movimientos={[PAGO_VIGENTE]} onDocumentoAnulado={onAnulado} />);

    await user.click(screen.getByRole("button", { name: /^Anular / }));
    let dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "x");
    await user.click(within(dialog).getByRole("button", { name: "Anular" }));
    await waitFor(() => expect(onAnulado).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith("Ya estaba anulado; no se registró nada más.");

    anularPagoMock.mockResolvedValueOnce({ status: "no_encontrado" });
    await user.click(screen.getByRole("button", { name: /^Anular / }));
    dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "x");
    await user.click(within(dialog).getByRole("button", { name: "Anular" }));
    expect(await within(dialog).findByText("No se encontró ese registro.")).toBeInTheDocument();
    expect(onAnulado).toHaveBeenCalledTimes(1);
  }, 20000);
});

describe("FICHA 459 — ver el comprobante (R57/R67)", () => {
  it("pide el enlace temporal con el id del documento y lo abre en otra pestaña", async () => {
    comprobantePagoMock.mockResolvedValue({ status: "ok", url: "https://almacen.example/firmada" });
    const pestana = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(pestana as unknown as Window);
    const user = userEvent.setup();
    render(<WalletLedger movimientos={TODAS} />);

    await user.click(screen.getByRole("button", { name: /^Ver comprobante/ }));

    await waitFor(() => expect(pestana.location.href).toBe("https://almacen.example/firmada"));
    expect(comprobantePagoMock).toHaveBeenCalledWith({ pagoId: PAGO_ID });
    expect(pestana.opener).toBeNull();
    // El enlace no se pinta en la pantalla.
    expect(document.body.textContent ?? "").not.toContain("almacen.example");
    open.mockRestore();
  });

  it("sin comprobante lo dice y cierra la pestaña vacía", async () => {
    comprobantePagoMock.mockResolvedValue({ status: "sin_comprobante" });
    const pestana = { opener: {}, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(pestana as unknown as Window);
    const user = userEvent.setup();
    render(<WalletLedger movimientos={[PAGO_VIGENTE]} />);

    await user.click(screen.getByRole("button", { name: /^Ver comprobante/ }));
    await waitFor(() => expect(errorMock).toHaveBeenCalledWith("Este registro no tiene comprobante."));
    expect(pestana.close).toHaveBeenCalled();
    open.mockRestore();
  });
});

describe("FICHA 459 — el cobro reclasificado en el libro y en su descarga (T C.6, R87)", () => {
  it("se lee con el concepto del pago por cuenta, dueño «Tienda» y el origen legible", () => {
    render(<WalletLedger movimientos={[RECLASIFICADO]} />);
    const f = filaPorDescripcion(/pago FACEBOOK/);
    expect(within(f).getByText("Pago por cuenta de una tienda")).toBeInTheDocument();
    expect(
      within(f).getByText("Cobro reclasificado como pago por cuenta · Nuform · pago FACEBOOK"),
    ).toBeInTheDocument();
    expect(within(f).getByText("Tienda")).toBeInTheDocument();
  });

  it("la descarga lleva el MISMO origen legible, las mismas columnas y ningún id", () => {
    const f = filaDescargaMovimientoCaja(RECLASIFICADO);
    expect(f.origen).toBe("Cobro reclasificado como pago por cuenta · Nuform · pago FACEBOOK");
    expect(f.categoria).toBe("Pago por cuenta de una tienda");
    expect(f.dueno).toBe("Tienda");
    expect(Object.keys(f).sort()).toEqual(COLUMNAS_DESCARGA_WALLET_CAJA.map((c) => c.clave).sort());
  });
});

describe("FICHA 459 — ningún identificador interno en pantalla ni en la descarga (R58/R100)", () => {
  it("la tabla no pinta ids de documento, de movimiento ni de cobro", () => {
    render(<WalletLedger movimientos={TODAS} />);
    const texto = document.body.textContent ?? "";
    for (const id of [PAGO_ID, APORTE_ID, COBRO_ID, ...TODAS.map((m) => m.id)]) {
      expect(texto).not.toContain(id);
    }
    // Tampoco en los nombres accesibles.
    for (const nodo of document.querySelectorAll("[aria-label]")) {
      const nombre = nodo.getAttribute("aria-label") ?? "";
      for (const id of [PAGO_ID, APORTE_ID, COBRO_ID]) expect(nombre).not.toContain(id);
    }
  });

  it("la descarga no gana columnas por el documento: ni `documento`, ni ids, ni ruta", () => {
    for (const m of TODAS) {
      const f = filaDescargaMovimientoCaja(m);
      expect(Object.keys(f).sort()).toEqual(
        COLUMNAS_DESCARGA_WALLET_CAJA.map((c) => c.clave).sort(),
      );
      const valores = Object.values(f).join(" | ");
      for (const id of [PAGO_ID, APORTE_ID, COBRO_ID, m.id]) expect(valores).not.toContain(id);
      expect(valores).not.toMatch(/comprobante|anulado":|tieneComprobante/i);
    }
  });
});
