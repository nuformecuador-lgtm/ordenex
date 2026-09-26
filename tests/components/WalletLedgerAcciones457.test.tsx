// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// =================================================================================================
// FICHA 457 (T6.5, design §8.5; R41, R45, R48, R60) — EL PAGO DE UNA TIENDA A ORDENEX EN EL LIBRO
// =================================================================================================
//
// R41: «Anular…» (con motivo obligatorio) y, si lo tiene, «Ver comprobante» en la fila ORIGINAL de cada
// pago vigente; «Anulado» en los ya anulados; NADA en el contra-asiento. R60: tras anular, el módulo
// relee (tarjeta, libro, composición: `onDocumentoAnulado`). R45: rótulos desde Ordenex, dueño
// «Tienda», origen «Pago de una tienda a Ordenex», en la tabla, el filtro y la descarga. R48: ningún
// identificador ni valor técnico.
//
// Quién decide qué fila lleva documento es el SERVIDOR (`WalletService.tipoDeDocumentoOriginal`; la
// integración `abono-tienda-457.test.ts` «R41» mide qué filas lo reciben). Aquí se mide que la
// pantalla OBEDECE al campo y que la acción manda lo que el borde espera: `{ abonoId, motivo }`, SIN
// monto (R34).

const anularAbonoMock = vi.fn();
const comprobanteAbonoMock = vi.fn();
const anularCobroMock = vi.fn();
const anularPagoMock = vi.fn();
const anularAporteMock = vi.fn();
const anularAjusteMock = vi.fn();

vi.mock("@/lib/actions/abono-tienda", () => ({
  anularAbonoTiendaAction: (...a: unknown[]) => anularAbonoMock(...a),
  obtenerComprobanteAbonoAction: (...a: unknown[]) => comprobanteAbonoMock(...a),
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
import { opcionesDeConceptos } from "@/components/shared/wallet/conceptos-filtro";
import { CATEGORIA_LABEL as CATEGORIA_LABEL_458, CATEGORIA_TODAS_OPTION } from "@/app/(app)/wallet/_components/wallet-labels";

/** Los DOCUMENTOS (el `origenId` de cada fila): uuids que NUNCA se pintan. */
const ABONO_ID = "5b7d9f1a-3c5e-4a7b-9d1f-3a5c7e9b1d2f";
const ABONO_SIN_COMPROBANTE_ID = "7d9f1b3c-5e7a-4c9d-8f1a-5c7e9b1d3f4a";
const ABONO_ANULADO_ID = "9f1b3d5e-7a9c-4e1f-8a3c-7e9b1d3f5a6b";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function fila(over: Partial<WalletMovimientoDTO>): WalletMovimientoDTO {
  return {
    id: "m-0000",
    tipo: "ingreso",
    categoria: "ingreso_abono_tienda",
    monto: "4000.00",
    origenTipo: "abono_tienda",
    origenId: ABONO_ID,
    descripcion: "Tienda Norte · Pago de los fletes · SINPE · 123456",
    registradoPor: null,
    fechaMovimiento: "2026-09-24T06:00:00.000Z",
    dueno: "terceros",
    documento: null,
    ...over,
  };
}

/** El pago VIGENTE con comprobante. */
const ABONO_VIGENTE = fila({
  id: "e1a2b3c4-1111-4111-8111-111111111111",
  documento: { tipo: "abono_tienda", anulado: false, tieneComprobante: true },
});
/** Otro pago vigente, SIN comprobante. */
const ABONO_SIN_COMPROBANTE = fila({
  id: "e1a2b3c4-2222-4222-8222-222222222222",
  origenId: ABONO_SIN_COMPROBANTE_ID,
  monto: "150.50",
  descripcion: "Tienda Sur · Abono · Efectivo",
  fechaMovimiento: "2026-09-20T06:00:00.000Z",
  documento: { tipo: "abono_tienda", anulado: false, tieneComprobante: false },
});
/** Un pago ya ANULADO (con comprobante: sigue pudiendo verse). */
const ABONO_ANULADO = fila({
  id: "e1a2b3c4-3333-4333-8333-333333333333",
  origenId: ABONO_ANULADO_ID,
  monto: "1000.00",
  descripcion: "Tienda Este · Pago equivocado · Efectivo",
  fechaMovimiento: "2026-09-18T06:00:00.000Z",
  documento: { tipo: "abono_tienda", anulado: true, tieneComprobante: true },
});
/** Su contra-asiento: egreso de terceros, MISMO origen, SIN documento (R41). */
const REVERSO = fila({
  id: "e1a2b3c4-4444-4444-8444-444444444444",
  tipo: "egreso",
  categoria: "egreso_reverso_abono_tienda",
  origenId: ABONO_ANULADO_ID,
  monto: "1000.00",
  descripcion: "Anulación · Tienda Este · Pago equivocado · Efectivo",
  fechaMovimiento: "2026-09-25T06:00:00.000Z",
});

const TODAS = [ABONO_VIGENTE, ABONO_SIN_COMPROBANTE, ABONO_ANULADO, REVERSO];

function filaPor(texto: RegExp): HTMLElement {
  return screen.getByRole("row", { name: texto });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("457/R41 — qué filas del pago ofrecen acciones", () => {
  it("«Anular…» en los pagos VIGENTES; «Ver comprobante» solo en los que lo tienen; «Anulado» en el anulado", () => {
    render(<WalletLedger movimientos={TODAS} />);

    const vigente = filaPor(/Pago de los fletes/);
    expect(within(vigente).getByRole("button", { name: /^Anular / })).toHaveTextContent("Anular…");
    expect(within(vigente).getByRole("button", { name: /^Ver comprobante/ })).toBeInTheDocument();

    const sinComprobante = filaPor(/Tienda Sur · Abono/);
    expect(within(sinComprobante).getByRole("button", { name: /^Anular / })).toHaveTextContent("Anular…");
    expect(within(sinComprobante).queryByRole("button", { name: /^Ver comprobante/ })).toBeNull();

    const anulado = filaPor(/^(?!.*Anulación).*Pago equivocado/);
    expect(within(anulado).queryByRole("button", { name: /^Anular / })).toBeNull();
    expect(within(anulado).getByText("Anulado")).toBeInTheDocument();
  });

  it("NADA en el contra-asiento: ni botones ni «Anulado»", () => {
    render(<WalletLedger movimientos={TODAS} />);
    const reverso = filaPor(/Anulación · Tienda Este/);
    expect(within(reverso).queryAllByRole("button")).toHaveLength(0);
    expect(within(reverso).queryByText("Anulado")).toBeNull();
  });

  it("cada botón se identifica con SU fila (concepto, fecha CR, importe)", () => {
    render(<WalletLedger movimientos={TODAS} />);
    expect(
      screen.getByRole("button", { name: "Anular Una tienda le paga a Ordenex del 2026-09-24 por ₡4.000" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Anular Una tienda le paga a Ordenex del 2026-09-20 por ₡150,50" }),
    ).toBeInTheDocument();
  });
});

describe("457/R41/R60 — anular un pago desde el libro", () => {
  it("motivo obligatorio; manda {abonoId, motivo} SIN monto a la action del pago; el módulo relee", async () => {
    anularAbonoMock.mockResolvedValue({
      status: "ok",
      saldo: { creditos: "0.00", debitos: "4000.00", saldo: "-4000.00", signo: "negativo" },
    });
    const onAnulado = vi.fn();
    const user = userEvent.setup();
    render(<WalletLedger movimientos={TODAS} onDocumentoAnulado={onAnulado} />);

    await user.click(within(filaPor(/Pago de los fletes/)).getByRole("button", { name: /^Anular / }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Anular el pago de una tienda a Ordenex")).toBeInTheDocument();
    const confirmar = within(dialog).getByRole("button", { name: "Anular" });
    expect(confirmar).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "  Referencia equivocada ");
    await user.click(confirmar);

    await waitFor(() => expect(anularAbonoMock).toHaveBeenCalledTimes(1));
    // R34: sin monto; el motivo recortado; el id es el del DOCUMENTO (el origen de la fila).
    expect(anularAbonoMock.mock.calls[0][0]).toEqual({ abonoId: ABONO_ID, motivo: "Referencia equivocada" });
    expect(Object.keys(anularAbonoMock.mock.calls[0][0] as object).sort()).toEqual(["abonoId", "motivo"]);
    for (const otra of [anularCobroMock, anularPagoMock, anularAporteMock, anularAjusteMock]) {
      expect(otra).not.toHaveBeenCalled();
    }
    await waitFor(() => expect(onAnulado).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith("Anulado. Se registró el movimiento contrario.");
  }, 20000);

  it("«ya estaba anulado» también cierra y relee, sin toast de error", async () => {
    anularAbonoMock.mockResolvedValue({ status: "ya_anulado" });
    const onAnulado = vi.fn();
    const user = userEvent.setup();
    render(<WalletLedger movimientos={[ABONO_VIGENTE]} onDocumentoAnulado={onAnulado} />);

    await user.click(screen.getByRole("button", { name: /^Anular / }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "x");
    await user.click(within(dialog).getByRole("button", { name: "Anular" }));

    await waitFor(() => expect(onAnulado).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith("Ya estaba anulado; no se registró nada más.");
    expect(errorMock).not.toHaveBeenCalled();
  }, 20000);

  it("«no encontrado» se dice dentro del diálogo", async () => {
    anularAbonoMock.mockResolvedValue({ status: "no_encontrado" });
    const user = userEvent.setup();
    render(<WalletLedger movimientos={[ABONO_VIGENTE]} onDocumentoAnulado={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^Anular / }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "x");
    await user.click(within(dialog).getByRole("button", { name: "Anular" }));
    expect(await within(dialog).findByText("No se encontró ese registro.")).toBeInTheDocument();
  }, 20000);
});

describe("457/R41 — ver el comprobante del pago", () => {
  it("pide el enlace temporal con el id del DOCUMENTO y lo abre en otra pestaña", async () => {
    comprobanteAbonoMock.mockResolvedValue({ status: "ok", url: "https://almacen.example/firmada" });
    const pestana = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(pestana as unknown as Window);
    const user = userEvent.setup();
    render(<WalletLedger movimientos={[ABONO_VIGENTE]} />);

    await user.click(screen.getByRole("button", { name: /^Ver comprobante/ }));

    await waitFor(() => expect(pestana.location.href).toBe("https://almacen.example/firmada"));
    expect(comprobanteAbonoMock).toHaveBeenCalledWith({ abonoId: ABONO_ID });
    expect(pestana.opener).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("almacen.example");
    open.mockRestore();
  });
});

const ESPERADO = [
  {
    caso: "el pago",
    movimiento: ABONO_VIGENTE,
    concepto: "Una tienda le paga a Ordenex",
    tipo: "Ingreso",
    origen: "Pago de una tienda a Ordenex · Tienda Norte · Pago de los fletes · SINPE · 123456",
    dueno: "Tienda",
  },
  {
    caso: "su anulación",
    movimiento: REVERSO,
    concepto: "Pago de una tienda a Ordenex anulado",
    tipo: "Egreso",
    origen: "Pago de una tienda a Ordenex · Anulación · Tienda Este · Pago equivocado · Efectivo",
    dueno: "Tienda",
  },
];

describe("457/R45 — concepto, tipo, origen y dueño en la tabla, el filtro y la descarga", () => {
  it.each(ESPERADO)("tabla — $caso: «$concepto» · $tipo · «$origen» · «$dueno»", (e) => {
    render(<WalletLedger movimientos={[e.movimiento]} />);
    const f = screen.getAllByRole("row")[1];
    expect(within(f).getByText(e.concepto)).toBeInTheDocument();
    expect(within(f).getByText(e.tipo)).toBeInTheDocument();
    expect(within(f).getByText(e.origen)).toBeInTheDocument();
    expect(within(f).getByText(e.dueno)).toBeInTheDocument();
    // R48: ningún valor crudo del enum se asoma en la fila.
    expect(f.textContent ?? "").not.toMatch(/[a-z]+_[a-z_]+/);
  });

  it.each(ESPERADO)("descarga — $caso: las mismas palabras que la tabla, sin columnas de más", (e) => {
    const d = filaDescargaMovimientoCaja(e.movimiento);
    expect(d.categoria).toBe(e.concepto);
    expect(d.tipo).toBe(e.tipo);
    expect(d.origen).toBe(e.origen);
    expect(d.dueno).toBe(e.dueno);
    expect(d.monto).toBe(e.movimiento.monto);
    expect(Object.keys(d).sort()).toEqual(COLUMNAS_DESCARGA_WALLET_CAJA.map((c) => c.clave).sort());
  });

  it("el filtro por concepto del libro ofrece los dos conceptos con su nombre desde Ordenex", () => {
    // 458-A (TA.3): las opciones son los conceptos CON movimientos (aquí, uno de cada uno).
    const lista = opcionesDeConceptos(
      ["ingreso_abono_tienda","egreso_reverso_abono_tienda"].map((categoria) => ({ categoria, movimientos: 1 })),
      CATEGORIA_LABEL_458,
      "",
      CATEGORIA_TODAS_OPTION,
    );
    const opciones = new Map(lista.map((o) => [o.value, o.label.replace(/ \(1\)$/, "")]));
    expect(opciones.get("ingreso_abono_tienda")).toBe("Una tienda le paga a Ordenex");
    expect(opciones.get("egreso_reverso_abono_tienda")).toBe("Pago de una tienda a Ordenex anulado");
  });
});

describe("457/R48 — ningún identificador interno en pantalla ni en la descarga", () => {
  it("la tabla no pinta el id del documento ni el del movimiento, tampoco en los nombres accesibles", () => {
    render(<WalletLedger movimientos={TODAS} />);
    const texto = document.body.textContent ?? "";
    const ids = [ABONO_ID, ABONO_SIN_COMPROBANTE_ID, ABONO_ANULADO_ID, ...TODAS.map((m) => m.id)];
    for (const id of ids) expect(texto).not.toContain(id);
    for (const nodo of document.querySelectorAll("[aria-label]")) {
      const nombre = nodo.getAttribute("aria-label") ?? "";
      for (const id of ids) expect(nombre).not.toContain(id);
    }
    expect(texto).not.toMatch(UUID);
    expect(texto).not.toMatch(/abono_tienda|ingreso_abono|egreso_reverso/);
  });

  it("la descarga no lleva ningún uuid ni campo del documento", () => {
    for (const m of TODAS) {
      const valores = Object.values(filaDescargaMovimientoCaja(m)).join(" | ");
      expect(valores).not.toMatch(UUID);
      expect(valores).not.toMatch(/tieneComprobante|documento|abono_tienda/i);
    }
  });
});
