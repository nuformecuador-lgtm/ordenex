// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import type {
  ListarMovimientosDeTiendaResult,
  SaldoTiendaDTO,
  SaldoTiendaResumenDTO,
} from "@/lib/types/wallet-tienda";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";

// =================================================================================================
// FICHA 457 (T6.6, design §8.4, R59) — «REGISTRAR PAGO DE LA TIENDA A ORDENEX» EN EL DESGLOSE
// =================================================================================================
//
// Donde una tienda de `/wallet/tiendas` está EN CONTRA, su desglose ofrece la acción que abre el MISMO
// diálogo «Registrar movimiento» con el concepto «Una tienda le paga a Ordenex» y la tienda FIJOS; tras
// registrar se releen el desglose, sus comprobantes y la tabla de saldos, sin recargar. Con saldo cero o
// a favor la acción NO se ofrece. MUTACIÓN 13 de design §13 (sin el botón con saldo negativo) → rojo.
//
// Se monta `SaldosTiendasTable` de verdad (molde `WalletSaldosTiendasRefrescoP1.test.tsx`): lo que se
// mide es la relación entre la fila de la tabla y el desglose abierto dentro de ella. El doble del
// servidor devuelve el saldo que tenga en cada momento, y el pago lo cambia.

const listarDesgloseMock = vi.fn();
const listarDesgloseCompletoMock = vi.fn();
const listarSaldosPaginaMock = vi.fn();
const listarSaldosDedicadoMock = vi.fn();
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarMovimientosDeTiendaAction: (...a: unknown[]) => listarDesgloseMock(...a),
  listarMovimientosDeTiendaCompletoAction: (...a: unknown[]) => listarDesgloseCompletoMock(...a),
  listarSaldosTiendasPaginadoAction: (...a: unknown[]) => listarSaldosPaginaMock(...a),
  listarSaldosTiendasCompletoAction: (...a: unknown[]) => listarSaldosDedicadoMock(...a),
}));

const listarPagosMock = vi.fn();
vi.mock("@/lib/actions/liquidacion", () => ({
  registrarPagoTiendaAction: vi.fn(),
  listarPagosDeTiendaAction: (...a: unknown[]) => listarPagosMock(...a),
  anularPagoAction: vi.fn(),
}));

const registrarAbonoMock = vi.fn();
vi.mock("@/lib/actions/abono-tienda", () => ({
  registrarAbonoTiendaAction: (...a: unknown[]) => registrarAbonoMock(...a),
}));

// Con la tienda fija el diálogo NO pide el catálogo de tiendas: si lo pidiera, este doble lo contaría.
const listarTiendasMock = vi.fn();
vi.mock("@/lib/actions/usuarios-por-rol", () => ({
  listarAdminTiendas: (...a: unknown[]) => listarTiendasMock(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { SaldosTiendasTable } from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";

const BOTON = "Registrar pago de la tienda a Ordenex";

// --- El estado del "servidor": el saldo de Tienda Norte, que el pago mueve -----------------------

/** Lo que el servidor devuelve HOY para Tienda Norte: EN CONTRA, ₡10.000. */
let saldoNorte = "-10000.00";

function signoDe(saldo: string): SaldoTiendaDTO["signo"] {
  if (saldo.startsWith("-")) return "negativo";
  return /^0(\.0+)?$/.test(saldo) ? "cero" : "positivo";
}

function norte(): SaldoTiendaResumenDTO {
  return { tiendaId: "t1", tiendaNombre: "Tienda Norte", saldo: saldoNorte, signo: signoDe(saldoNorte) };
}
const ESTE: SaldoTiendaResumenDTO = { tiendaId: "t2", tiendaNombre: "Tienda Este", saldo: "5000.00", signo: "positivo" };
const OESTE: SaldoTiendaResumenDTO = { tiendaId: "t3", tiendaNombre: "Tienda Oeste", saldo: "0.00", signo: "cero" };

function desglose(tiendaId: string, saldo: string): ListarMovimientosDeTiendaResult {
  return {
    tiendaId,
    movimientos: [],
    total: 0,
    page: 1,
    pageSize: 20,
    desglose: { aFavor: "0.00", cargos: "0.00", pagado: "0.00", saldo, signo: signoDe(saldo) },
  };
}

function envolver(nodo: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

function renderTabla() {
  return envolver(
    <SaldosTiendasTable initialData={paginaInicial([norte(), ESTE, OESTE])} puedeRegistrarPago />,
  );
}

async function desplegar(tiendaNombre: string) {
  fireEvent.click(screen.getByRole("button", { name: `Ver desglose de ${tiendaNombre}` }));
  return screen.findByRole("region", { name: `Desglose de ${tiendaNombre}` });
}

function saldoEnLaTabla(tiendaNombre: string): string {
  const tabla = screen.getByRole("table", { name: "Saldos de tiendas" });
  const fila = within(tabla)
    .getAllByRole("row")
    .find((r) => within(r).queryByText(tiendaNombre) !== null);
  if (!fila) throw new Error(`sin fila para ${tiendaNombre}`);
  return within(fila).getAllByRole("cell")[2]?.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  saldoNorte = "-10000.00";
  listarSaldosPaginaMock.mockImplementation(async () => ({
    status: "ok",
    page: 1,
    ...paginaInicial([norte(), ESTE, OESTE]),
  }));
  listarSaldosDedicadoMock.mockResolvedValue({ status: "ok", items: [norte(), ESTE, OESTE], total: 3 });
  listarDesgloseMock.mockImplementation(async (input: { tiendaId: string }) => {
    const saldo = input.tiendaId === "t1" ? saldoNorte : input.tiendaId === "t2" ? ESTE.saldo : OESTE.saldo;
    return { status: "ok", data: desglose(input.tiendaId, saldo) };
  });
  listarDesgloseCompletoMock.mockResolvedValue({ status: "ok", items: [], total: 0 });
  listarPagosMock.mockResolvedValue({ status: "ok", pagos: [] });
  registrarAbonoMock.mockImplementation(async () => {
    saldoNorte = "-6000.00"; // el pago de ₡4.000 sube el saldo en el servidor
    return {
      status: "ok",
      abono: { id: "ab1", tiendaNombre: "Tienda Norte", monto: "4000.00" },
      saldo: { creditos: "4000.00", debitos: "10000.00", saldo: "-6000.00", signo: "negativo" },
    };
  });
});

afterEach(() => {
  cleanup();
});

describe("457/R59 — la acción solo existe cuando la tienda está EN CONTRA", () => {
  it("con saldo negativo, el desglose ofrece «Registrar pago de la tienda a Ordenex» (mutación 13)", async () => {
    renderTabla();
    const region = await desplegar("Tienda Norte");
    expect(await within(region).findByRole("button", { name: BOTON })).toBeEnabled();
  }, 20000);

  it.each([
    ["a favor", "Tienda Este"],
    ["en cero", "Tienda Oeste"],
  ])("con saldo %s NO se ofrece (control: el pago de Ordenex a la tienda sí se pinta)", async (_caso, tienda) => {
    renderTabla();
    const region = await desplegar(tienda);
    // El bloque de acciones SÍ está montado (el botón de pagar a la tienda existe): la ausencia de
    // abajo no es porque no se haya pintado nada.
    expect(await within(region).findByRole("button", { name: "Registrar pago" })).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: BOTON })).toBeNull();
  }, 20000);
});

describe("457/R59 — abre el MISMO diálogo con el concepto y la tienda fijos", () => {
  it("concepto «Una tienda le paga a Ordenex» y tienda «Tienda Norte», los dos deshabilitados; sin catálogo", async () => {
    renderTabla();
    const region = await desplegar("Tienda Norte");
    fireEvent.click(await within(region).findByRole("button", { name: BOTON }));
    const dialogo = await screen.findByRole("dialog");

    const concepto = within(dialogo).getByRole("combobox", { name: "Concepto del movimiento" });
    expect(concepto).toBeDisabled();
    expect(concepto.textContent).toContain("Una tienda le paga a Ordenex");
    const tienda = within(dialogo).getByRole("combobox", { name: "Tienda que paga" });
    expect(tienda).toBeDisabled();
    expect(tienda.textContent).toContain("Tienda Norte");
    expect(
      within(dialogo).getByText(
        "Llega dinero de la tienda a la caja: paga lo que debe y su saldo sube; la ganancia de Ordenex no cambia.",
      ),
    ).toBeInTheDocument();
    expect(listarTiendasMock).not.toHaveBeenCalled();
  }, 20000);

  it("tras registrar, se releen el desglose, sus comprobantes y la tabla de saldos, y la fila dice el saldo nuevo", async () => {
    const user = userEvent.setup();
    renderTabla();
    await waitFor(() => expect(listarSaldosPaginaMock).toHaveBeenCalled());
    expect(saldoEnLaTabla("Tienda Norte")).toBe("-₡10.000");

    const region = await desplegar("Tienda Norte");
    await user.click(await within(region).findByRole("button", { name: BOTON }));
    const dialogo = await screen.findByRole("dialog");
    await user.type(within(dialogo).getByLabelText("Monto"), "4000.00");
    await user.type(within(dialogo).getByLabelText("Motivo del pago"), "Pago de los fletes");
    await user.click(within(dialogo).getByRole("combobox", { name: "Método de pago" }));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Efectivo" }));

    const saldosAntes = listarSaldosPaginaMock.mock.calls.length;
    const desgloseAntes = listarDesgloseMock.mock.calls.filter(([i]) => i.tiendaId === "t1").length;
    const pagosAntes = listarPagosMock.mock.calls.filter(([i]) => i.tiendaId === "t1").length;
    await user.click(within(dialogo).getByRole("button", { name: "Registrar" }));

    await waitFor(() => expect(registrarAbonoMock).toHaveBeenCalledTimes(1));
    const fd = registrarAbonoMock.mock.calls[0][0] as FormData;
    expect(fd.get("tiendaId")).toBe("t1");
    expect(fd.get("monto")).toBe("4000.00");
    // El aviso con el saldo del SERVIDOR.
    expect(
      await screen.findByText(
        "Pago registrado. El saldo de Tienda Norte queda en -₡6.000 · En contra. La tienda todavía le debe ese dinero a Ordenex.",
      ),
    ).toBeInTheDocument();
    // Las TRES lecturas de esta tienda (R59), sin recargar la página.
    await waitFor(() => expect(listarSaldosPaginaMock.mock.calls.length).toBeGreaterThan(saldosAntes));
    await waitFor(() =>
      expect(listarDesgloseMock.mock.calls.filter(([i]) => i.tiendaId === "t1").length).toBeGreaterThan(desgloseAntes),
    );
    await waitFor(() =>
      expect(listarPagosMock.mock.calls.filter(([i]) => i.tiendaId === "t1").length).toBeGreaterThan(pagosAntes),
    );
    await waitFor(() => expect(saldoEnLaTabla("Tienda Norte")).toBe("-₡6.000"));
    // La otra tienda no se toca.
    expect(saldoEnLaTabla("Tienda Este")).toBe("₡5.000");
  }, 30000);
});
