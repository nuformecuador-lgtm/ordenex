// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// =================================================================================================
// FICHA 461 (T C.5, design §5.4/§9, R20/R21/R37/R42/R52) — LA LÍNEA DEL COBRO EN EL LIBRO DE LA CAJA
// =================================================================================================
//
// R20: «Anular…» (con motivo obligatorio) en la línea ORIGINAL de cada cobro vigente —propia o
// completada por la migración de datos (R37)—; «Anulado» en las ya anuladas; NADA en el reverso, en
// la salida de un cobro reclasificado ni en las líneas del cierre. R21: tras anular, el módulo relee.
// R17: `no_anulable` se dice con su motivo. R42: los rótulos son los nombres desde Ordenex, en la
// tabla y en la descarga, con dueño «Ordenex». R52: ningún identificador interno en pantalla ni en el
// archivo.
//
// Quién decide qué fila tiene documento es el SERVIDOR (`WalletMovimientoDTO.documento`, resuelto en
// `WalletService`; `cobro-tienda-461.test.ts` mide qué filas lo reciben). Aquí se mide que la pantalla
// OBEDECE al campo y que la acción manda lo que el borde espera: `{ cobroId, motivo }`, sin monto.
//
// Y la P3 de la auditoría de la wallet: un gasto o sueldo registrado a mano cuyo reverso ya existe
// dice «Reversado» en vez de ofrecer «Reversar».

const anularCobroMock = vi.fn();
const anularPagoMock = vi.fn();
const anularAporteMock = vi.fn();
const anularAjusteMock = vi.fn();
const reversarMock = vi.fn();

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
const infoMock = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: infoMock,
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { WalletLedger } from "@/app/(app)/wallet/_components/WalletLedger";
import {
  COLUMNAS_DESCARGA_WALLET_CAJA,
  filaDescargaMovimientoCaja,
} from "@/app/(app)/wallet/_components/wallet-ledger-descarga-columnas";
import { CATEGORIA_OPTIONS } from "@/app/(app)/wallet/_components/wallet-labels";

/** Los DÉBITOS de la tienda (el `origenId` de cada línea de caja del cobro): uuids que NUNCA se pintan. */
const COBRO_ID = "3f1c2a7e-9b41-4d6e-8c2f-0a5b7d9e1f23";
const COBRO_COMPLETADO_ID = "8a4d6f2b-1c3e-4f5a-9b7d-2e6c8a0f4b91";
const COBRO_ANULADO_ID = "c5e7a9b1-3d5f-4a7c-8e9b-1f3d5a7c9e2b";
const COBRO_RECLASIFICADO_ID = "e2b4d6f8-5a7c-4e9b-8d1f-3a5c7e9b1d4f";
const EGRESO_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const EGRESO_SIN_REVERSO_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

function fila(over: Partial<WalletMovimientoDTO>): WalletMovimientoDTO {
  return {
    id: "m-0000",
    tipo: "ingreso",
    categoria: "ingreso_cobro_tienda",
    monto: "42000.00",
    origenTipo: "cobro_tienda",
    origenId: COBRO_ID,
    descripcion: "Tienda Norte · Material de despacho",
    registradoPor: null,
    fechaMovimiento: "2026-09-25T15:00:00.000Z",
    dueno: "propio",
    documento: null,
    ...over,
  };
}

/** La línea de caja de un cobro VIGENTE escrito por el servicio (origen `cobro_tienda`). */
const COBRO_VIGENTE = fila({
  id: "m-cobro",
  documento: { tipo: "cobro_tienda", anulado: false, tieneComprobante: false },
});
/** La línea COMPLETADA por la migración de datos (origen `cobro_tienda_completado`), vigente (R37). */
const COBRO_COMPLETADO = fila({
  id: "m-completado",
  origenTipo: "cobro_tienda_completado",
  origenId: COBRO_COMPLETADO_ID,
  monto: "2500.50",
  descripcion: "Tienda Sur · Bolsas",
  fechaMovimiento: "2026-09-10T15:00:00.000Z",
  documento: { tipo: "cobro_tienda", anulado: false, tieneComprobante: false },
});
/** La línea de un cobro ya ANULADO. */
const COBRO_ANULADO = fila({
  id: "m-anulado",
  origenId: COBRO_ANULADO_ID,
  monto: "1000.00",
  descripcion: "Tienda Este · Etiquetas",
  fechaMovimiento: "2026-09-20T15:00:00.000Z",
  documento: { tipo: "cobro_tienda", anulado: true, tieneComprobante: false },
});
/** Su reverso: egreso propio de liquidez «cargo», SIN documento (R20). */
const REVERSO = fila({
  id: "m-reverso",
  tipo: "egreso",
  categoria: "egreso_reverso_cobro_tienda",
  origenId: COBRO_ANULADO_ID,
  monto: "1000.00",
  descripcion: "Anulación · Tienda Este · Etiquetas",
  fechaMovimiento: "2026-09-24T15:00:00.000Z",
});
/** La salida de un cobro RECLASIFICADO por la 459: otra categoría, otro origen, SIN documento (R20). */
const RECLASIFICADO = fila({
  id: "m-reclasificado",
  tipo: "egreso",
  categoria: "egreso_pago_por_cuenta_tienda",
  origenTipo: "cobro_manual_reclasificado",
  origenId: COBRO_RECLASIFICADO_ID,
  dueno: "terceros",
  descripcion: "Nuform · pago FACEBOOK",
  fechaMovimiento: "2026-09-01T15:00:00.000Z",
});
/** Una línea automática del cierre: sin documento, sin acciones. */
const FLETE_DEL_CIERRE = fila({
  id: "m-flete",
  categoria: "ingreso_flete",
  origenTipo: "cierre_dia",
  origenId: "11111111-1111-4111-8111-111111111111",
  monto: "2800.00",
  descripcion: null,
  fechaMovimiento: "2026-09-22T15:00:00.000Z",
});

const TODAS = [COBRO_VIGENTE, COBRO_COMPLETADO, COBRO_ANULADO, REVERSO, RECLASIFICADO, FLETE_DEL_CIERRE];

function filaPorDescripcion(texto: RegExp): HTMLElement {
  return screen.getByRole("row", { name: texto });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("461 — qué líneas del cobro ofrecen acciones (R20/R37)", () => {
  it("«Anular…» en la línea propia VIGENTE y en la COMPLETADA por la migración; «Anulado» en la anulada", () => {
    render(<WalletLedger movimientos={TODAS} />);

    const propia = filaPorDescripcion(/Material de despacho/);
    expect(within(propia).getByRole("button", { name: /^Anular / })).toHaveTextContent("Anular…");

    const completada = filaPorDescripcion(/Bolsas/);
    expect(within(completada).getByRole("button", { name: /^Anular / })).toHaveTextContent("Anular…");

    const anulada = filaPorDescripcion(/^(?!.*Anulación).*Etiquetas/);
    expect(within(anulada).queryByRole("button", { name: /^Anular / })).toBeNull();
    expect(within(anulada).getByText("Anulado")).toBeInTheDocument();
  });

  it("NADA en el reverso, en la salida reclasificada ni en la línea del cierre", () => {
    render(<WalletLedger movimientos={TODAS} />);
    for (const texto of [/Anulación · Tienda Este/, /pago FACEBOOK/]) {
      const f = filaPorDescripcion(texto);
      expect(within(f).queryAllByRole("button"), String(texto)).toHaveLength(0);
      expect(within(f).queryByText("Anulado")).toBeNull();
    }
    // La línea del cierre lleva el botón de DESPLEGAR sus órdenes (ficha 344), que no es una acción
    // sobre el dinero: lo que R20 prohíbe ahí es «Anular…» y «Anulado».
    const cierre = filaPorDescripcion(/Flete cobrado a la tienda/);
    expect(within(cierre).queryByRole("button", { name: /^Anular / })).toBeNull();
    expect(within(cierre).queryByText("Anulado")).toBeNull();
    expect(within(cierre).queryByRole("button", { name: "Reversar" })).toBeNull();
  });

  it("un cobro nunca ofrece «Ver comprobante»: no lo tiene", () => {
    render(<WalletLedger movimientos={TODAS} />);
    expect(screen.queryAllByRole("button", { name: /^Ver comprobante/ })).toHaveLength(0);
  });

  it("cada botón se identifica con SU fila (concepto, fecha CR, importe), no con un «Anular» repetido", () => {
    render(<WalletLedger movimientos={TODAS} />);
    expect(
      screen.getByRole("button", {
        name: "Anular Ordenex le cobra a una tienda del 2026-09-25 por ₡42.000",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Anular Ordenex le cobra a una tienda del 2026-09-10 por ₡2.500,50",
      }),
    ).toBeInTheDocument();
  });
});

describe("461 — anular un cobro desde el libro (R13/R17/R21)", () => {
  it("motivo obligatorio; manda {cobroId, motivo} SIN monto a la action del cobro; el módulo relee", async () => {
    anularCobroMock.mockResolvedValue({ status: "ok", saldo: { saldo: "58000.00", signo: "positivo" } });
    const onAnulado = vi.fn();
    const user = userEvent.setup();
    render(<WalletLedger movimientos={TODAS} onDocumentoAnulado={onAnulado} />);

    await user.click(
      within(filaPorDescripcion(/Material de despacho/)).getByRole("button", { name: /^Anular / }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Anular el cobro de Ordenex a una tienda")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Se registrará hoy un movimiento contrario por ₡42.000. El registro original, su comprobante y su historial quedan intactos: no se borra nada.",
      ),
    ).toBeInTheDocument();
    const confirmar = within(dialog).getByRole("button", { name: "Anular" });
    expect(confirmar).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "  Se cobró dos veces ");
    await user.click(confirmar);

    await waitFor(() => expect(anularCobroMock).toHaveBeenCalledTimes(1));
    // R13: sin monto; el motivo recortado; el id es el del DÉBITO de la tienda (el origen de la línea).
    expect(anularCobroMock.mock.calls[0][0]).toEqual({ cobroId: COBRO_ID, motivo: "Se cobró dos veces" });
    expect(Object.keys(anularCobroMock.mock.calls[0][0] as object).sort()).toEqual(["cobroId", "motivo"]);
    for (const otra of [anularPagoMock, anularAporteMock, anularAjusteMock]) expect(otra).not.toHaveBeenCalled();
    await waitFor(() => expect(onAnulado).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith("Anulado. Se registró el movimiento contrario.");
  }, 20000);

  it("la línea COMPLETADA se anula igual, con el id de SU cobro (R37)", async () => {
    anularCobroMock.mockResolvedValue({ status: "ok", saldo: { saldo: "0.00", signo: "cero" } });
    const user = userEvent.setup();
    render(<WalletLedger movimientos={[COBRO_COMPLETADO]} onDocumentoAnulado={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /^Anular / }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "Era de otra tienda");
    await user.click(within(dialog).getByRole("button", { name: "Anular" }));

    await waitFor(() => expect(anularCobroMock).toHaveBeenCalledTimes(1));
    expect(anularCobroMock.mock.calls[0][0]).toEqual({
      cobroId: COBRO_COMPLETADO_ID,
      motivo: "Era de otra tienda",
    });
  }, 20000);

  it("R15: «ya estaba anulado» también cierra y relee, sin toast de error", async () => {
    anularCobroMock.mockResolvedValue({ status: "ya_anulado" });
    const onAnulado = vi.fn();
    const user = userEvent.setup();
    render(<WalletLedger movimientos={[COBRO_VIGENTE]} onDocumentoAnulado={onAnulado} />);

    await user.click(screen.getByRole("button", { name: /^Anular / }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "x");
    await user.click(within(dialog).getByRole("button", { name: "Anular" }));

    await waitFor(() => expect(onAnulado).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith("Ya estaba anulado; no se registró nada más.");
    expect(errorMock).not.toHaveBeenCalled();
  }, 20000);

  it.each([
    ["reclasificado", "Este cobro no se puede anular desde aquí: se reclasificó como pago de un gasto de la tienda."],
    ["sin_linea_de_caja", "Este cobro no se puede anular desde aquí: no tiene su línea en la caja."],
  ])("R17: `no_anulable` (%s) se dice DENTRO del diálogo, que no se cierra ni relee", async (motivo, aviso) => {
    anularCobroMock.mockResolvedValue({ status: "no_anulable", motivo });
    const onAnulado = vi.fn();
    const user = userEvent.setup();
    render(<WalletLedger movimientos={[COBRO_VIGENTE]} onDocumentoAnulado={onAnulado} />);

    await user.click(screen.getByRole("button", { name: /^Anular / }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "x");
    await user.click(within(dialog).getByRole("button", { name: "Anular" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(aviso);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onAnulado).not.toHaveBeenCalled();
    expect(successMock).not.toHaveBeenCalled();
    // El motivo lo redacta el DICCIONARIO, nunca el valor técnico del servidor.
    expect(dialog.textContent ?? "").not.toContain("sin_linea_de_caja");
  }, 20000);

  it("R16: «no encontrado» se dice y no cierra", async () => {
    anularCobroMock.mockResolvedValue({ status: "no_encontrado" });
    const user = userEvent.setup();
    render(<WalletLedger movimientos={[COBRO_VIGENTE]} onDocumentoAnulado={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^Anular / }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Motivo de la anulación/), "x");
    await user.click(within(dialog).getByRole("button", { name: "Anular" }));
    expect(await within(dialog).findByText("No se encontró ese registro.")).toBeInTheDocument();
  }, 20000);
});

// ── R42/R52 — rótulos y dueño, en la tabla y en la descarga ────────────────────────────────────

/** Lo que tiene que leerse en cada fila: concepto, tipo, origen legible y dueño (design §7). */
const ESPERADO: ReadonlyArray<{
  caso: string;
  movimiento: WalletMovimientoDTO;
  concepto: string;
  tipo: string;
  origen: string;
  dueno: string;
}> = [
  {
    caso: "la línea del cobro (propia)",
    movimiento: COBRO_VIGENTE,
    concepto: "Ordenex le cobra a una tienda",
    tipo: "Ingreso",
    origen: "Cobro de Ordenex a una tienda · Tienda Norte · Material de despacho",
    dueno: "Ordenex",
  },
  {
    caso: "la línea completada por la migración de datos",
    movimiento: COBRO_COMPLETADO,
    concepto: "Ordenex le cobra a una tienda",
    tipo: "Ingreso",
    origen: "Cobro de Ordenex a una tienda (línea de caja completada al corregir) · Tienda Sur · Bolsas",
    dueno: "Ordenex",
  },
  {
    caso: "el reverso de un cobro anulado",
    movimiento: REVERSO,
    concepto: "Cobro a una tienda anulado",
    tipo: "Egreso",
    origen: "Cobro de Ordenex a una tienda · Anulación · Tienda Este · Etiquetas",
    dueno: "Ordenex",
  },
  {
    caso: "la salida de un cobro reclasificado por la 459",
    movimiento: RECLASIFICADO,
    concepto: "Ordenex paga un gasto de una tienda",
    tipo: "Egreso",
    origen: "Cobro reclasificado como pago de un gasto de la tienda · Nuform · pago FACEBOOK",
    dueno: "Tienda",
  },
];

describe("461 — concepto, tipo, origen y dueño de las líneas del cobro (R42, design §7.2/§7.3)", () => {
  it.each(ESPERADO)("tabla — $caso: «$concepto» · $tipo · «$origen» · «$dueno»", (e) => {
    render(<WalletLedger movimientos={[e.movimiento]} />);
    const f = screen.getAllByRole("row")[1];
    expect(within(f).getByText(e.concepto)).toBeInTheDocument();
    expect(within(f).getByText(e.tipo)).toBeInTheDocument();
    expect(within(f).getByText(e.origen)).toBeInTheDocument();
    expect(within(f).getByText(e.dueno)).toBeInTheDocument();
    // Ningún valor crudo del enum se asoma en la fila.
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

  it("el filtro por concepto del libro ofrece los dos conceptos nuevos con su nombre desde Ordenex", () => {
    const opciones = new Map(CATEGORIA_OPTIONS.map((o) => [o.value, o.label]));
    expect(opciones.get("ingreso_cobro_tienda")).toBe("Ordenex le cobra a una tienda");
    expect(opciones.get("egreso_reverso_cobro_tienda")).toBe("Cobro a una tienda anulado");
  });

  it("la fecha de cada línea es el día de Costa Rica del instante", () => {
    render(<WalletLedger movimientos={[fila({ fechaMovimiento: "2026-09-26T05:30:00.000Z" })]} />);
    // 05:30Z del 26 son las 23:30 del 25 en Costa Rica.
    expect(within(screen.getAllByRole("row")[1]).getByText("2026-09-25")).toBeInTheDocument();
  });
});

describe("461 — ningún identificador interno en pantalla ni en la descarga (R52)", () => {
  it("la tabla no pinta el id del débito, del movimiento ni del cierre, tampoco en los nombres accesibles", () => {
    render(<WalletLedger movimientos={TODAS} />);
    const texto = document.body.textContent ?? "";
    const ids = [
      COBRO_ID,
      COBRO_COMPLETADO_ID,
      COBRO_ANULADO_ID,
      COBRO_RECLASIFICADO_ID,
      ...TODAS.map((m) => m.id),
      ...TODAS.map((m) => m.origenId ?? ""),
    ].filter((id) => id !== "");
    for (const id of ids) expect(texto).not.toContain(id);
    for (const nodo of document.querySelectorAll("[aria-label]")) {
      const nombre = nodo.getAttribute("aria-label") ?? "";
      for (const id of ids) expect(nombre).not.toContain(id);
    }
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });

  it("la descarga no gana columnas por el documento y no lleva ningún uuid", () => {
    for (const m of TODAS) {
      const f = filaDescargaMovimientoCaja(m);
      const valores = Object.values(f).join(" | ");
      expect(valores).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
      expect(valores).not.toMatch(/tieneComprobante|anulado":|documento/i);
    }
  });
});

// ── P3 de la auditoría de la wallet — «Reversar» sobre un egreso ya reversado ──────────────────

/** Un gasto de Ordenex registrado a mano, con su reverso en la MISMA página. */
const EGRESO_REVERSADO = fila({
  id: EGRESO_ID,
  tipo: "egreso",
  categoria: "egreso_gasto_variable",
  origenTipo: "gasto",
  origenId: null,
  monto: "1234.56",
  descripcion: "Suministros",
  fechaMovimiento: "2026-09-23T15:00:00.000Z",
});
const REVERSO_DEL_EGRESO = fila({
  id: "m-reverso-egreso",
  tipo: "ingreso",
  categoria: "ingreso_ajuste",
  origenTipo: "gasto",
  origenId: EGRESO_ID,
  monto: "1234.56",
  descripcion: "Reversa de egreso · Suministros",
  fechaMovimiento: "2026-09-25T16:00:00.000Z",
});
/** Otro gasto SIN reverso: sigue ofreciendo «Reversar». */
const EGRESO_VIGENTE = fila({
  id: EGRESO_SIN_REVERSO_ID,
  tipo: "egreso",
  categoria: "egreso_sueldo",
  origenTipo: "gasto",
  origenId: null,
  monto: "800.00",
  descripcion: "Juan Pérez — septiembre",
  fechaMovimiento: "2026-09-21T15:00:00.000Z",
});

describe("auditoría P3 (461) — un egreso ya reversado dice «Reversado», no ofrece «Reversar»", () => {
  it("con el reverso en la página, la fila del egreso dice «Reversado» y el otro egreso sigue con su botón", () => {
    render(<WalletLedger movimientos={[REVERSO_DEL_EGRESO, EGRESO_REVERSADO, EGRESO_VIGENTE]} />);

    const reversado = filaPorDescripcion(/^(?!.*Reversa de egreso).*Suministros/);
    expect(within(reversado).getByText("Reversado")).toBeInTheDocument();
    expect(within(reversado).queryByRole("button", { name: "Reversar" })).toBeNull();

    const vigente = filaPorDescripcion(/Juan Pérez/);
    expect(within(vigente).getByRole("button", { name: "Reversar" })).toBeInTheDocument();
    expect(within(vigente).queryByText("Reversado")).toBeNull();

    // El reverso mismo (un ingreso) no ofrece nada ni dice «Reversado».
    const reverso = filaPorDescripcion(/Reversa de egreso/);
    expect(within(reverso).queryAllByRole("button")).toHaveLength(0);
    expect(within(reverso).queryByText("Reversado")).toBeNull();
    // Y en toda la tabla hay exactamente UN «Reversar» y UN «Reversado».
    expect(screen.getAllByRole("button", { name: "Reversar" })).toHaveLength(1);
    expect(screen.getAllByText("Reversado")).toHaveLength(1);
  });

  it("al reversar con éxito, la fila pasa a «Reversado» sin esperar a que el libro se relea", async () => {
    reversarMock.mockResolvedValue({ status: "ok" });
    const onReversado = vi.fn();
    const user = userEvent.setup();
    render(<WalletLedger movimientos={[EGRESO_VIGENTE]} onReversado={onReversado} />);

    await user.click(screen.getByRole("button", { name: "Reversar" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Reversar" }));

    await waitFor(() => expect(reversarMock).toHaveBeenCalledWith({ movimientoId: EGRESO_SIN_REVERSO_ID }));
    await waitFor(() => expect(screen.getByText("Reversado")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Reversar" })).toBeNull();
    expect(onReversado).toHaveBeenCalledTimes(1);
  }, 20000);

  it("si el servidor responde que ya tenía su reversa, la fila también pasa a «Reversado»", async () => {
    reversarMock.mockResolvedValue({ status: "already_reversed" });
    const user = userEvent.setup();
    render(<WalletLedger movimientos={[EGRESO_VIGENTE]} />);

    await user.click(screen.getByRole("button", { name: "Reversar" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Reversar" }));

    await waitFor(() => expect(infoMock).toHaveBeenCalledWith("Este egreso ya tenía su reversa."));
    await waitFor(() => expect(screen.getByText("Reversado")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Reversar" })).toBeNull();
  }, 20000);

  it("una corrección de caja registrada a mano (origen manual) NO se toma por el reverso de nadie", () => {
    // Misma categoría que un reverso, pero origen `manual` y sin `origenId`: no marca ningún egreso.
    const correccion = fila({
      id: "m-correccion",
      tipo: "ingreso",
      categoria: "ingreso_ajuste",
      origenTipo: "manual",
      origenId: null,
      descripcion: "Sobrante al cuadrar",
    });
    render(<WalletLedger movimientos={[correccion, EGRESO_VIGENTE]} />);
    expect(screen.getByRole("button", { name: "Reversar" })).toBeInTheDocument();
    expect(screen.queryByText("Reversado")).toBeNull();
  });
});
