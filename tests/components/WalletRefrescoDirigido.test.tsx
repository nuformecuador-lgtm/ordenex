// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import { UUID_MOV, UUID_TIENDA, estado, fila } from "@/tests/fixtures/estado-cuenta";

// =================================================================================================
// FICHA 458-D (T D.7; R30, R48) — REFRESCO DIRIGIDO DESDE EL ESTADO DE CUENTA.
//
//  - R48/R30: tras registrar desde el estado de cuenta de una tienda, el diálogo avisa con el saldo del
//    SERVIDOR y se releen las tarjetas y las filas de ESA cuenta, sin recargar; las claves de OTRA
//    cuenta abierta en la misma caché no se vuelven a leer.
//  - R30: al volver al listado, la tabla de saldos se lee al montarse y la fila dice el saldo nuevo.
// Sustituye a `PagoTiendaAccionesAbono457.test.tsx` «tras registrar, se releen…» y a
// `WalletSaldosTiendasRefrescoP1.test.tsx` (461 P1: pagar y anular desde el desglose dejaba la fila de
// la tabla con el saldo viejo): mismo contrato, en la pantalla nueva — registrar, anular, y la fila del
// listado al volver.
// =================================================================================================

const OTRA = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f2a3b4c5d";

let saldoTania = "-10000.00";
const verEstadoCuentaMock = vi.fn();
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: (...a: unknown[]) => verEstadoCuentaMock(...a),
}));
const registrarAbonoMock = vi.fn();
vi.mock("@/lib/actions/abono-tienda", () => ({
  registrarAbonoTiendaAction: (...a: unknown[]) => registrarAbonoMock(...a),
}));
const listarSaldosMock = vi.fn();
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarSaldosTiendasPaginadoAction: (...a: unknown[]) => listarSaldosMock(...a),
  listarSaldosTiendasCompletoAction: vi.fn(),
  registrarCobroTiendaAction: vi.fn(),
}));
vi.mock("@/lib/actions/usuarios-por-rol", () => ({ listarAdminTiendas: vi.fn(), listarMensajerosActivos: vi.fn() }));
vi.mock("@/lib/actions/efecto-movimiento", () => ({
  previsualizarMovimientoAction: vi.fn(async () => ({ status: "forbidden" })),
}));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
const anularMock = vi.fn();
vi.mock("@/lib/actions/wallet-anulacion", () => ({
  anularMovimientoAction: (...a: unknown[]) => anularMock(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { EstadoCuentaTienda } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";
import { SaldosTiendasTable } from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";

function signo(s: string) {
  return s.startsWith("-") ? ("negativo" as const) : s === "0.00" ? ("cero" as const) : ("positivo" as const);
}
function tania() {
  return estado({
    id: UUID_TIENDA,
    nombre: "Tania Tienda",
    saldoActual: saldoTania,
    saldoFinal: saldoTania,
    signo: signo(saldoTania),
    sentido: saldoTania.startsWith("-") ? "cuenta_debe" : "ordenex_debe",
    filas: [],
    total: 0,
  });
}
function otra() {
  return estado({ id: OTRA, nombre: "Otra Tienda", filas: [], total: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  saldoTania = "-10000.00";
  verEstadoCuentaMock.mockImplementation(async (input: { cuenta: { id: string } }) => ({
    status: "ok",
    estado: input.cuenta.id === UUID_TIENDA ? tania() : otra(),
  }));
  registrarAbonoMock.mockImplementation(async () => {
    saldoTania = "-6000.00";
    return {
      status: "ok",
      abono: { id: "ab1", tiendaNombre: "Tania Tienda", monto: "4000.00" },
      saldo: { creditos: "4000.00", debitos: "10000.00", saldo: "-6000.00", signo: "negativo" },
    };
  });
  listarSaldosMock.mockImplementation(async () => ({
    status: "ok",
    page: 1,
    ...paginaInicial([{ tiendaId: UUID_TIENDA, tiendaNombre: "Tania Tienda", saldo: saldoTania, signo: signo(saldoTania) }]),
  }));
});
afterEach(() => cleanup());

describe("R30/R48 — registrar desde el estado de cuenta relee ESA cuenta y ninguna otra", () => {
  it("tras «La tienda le paga a Ordenex»: aviso con el saldo del servidor, tarjeta nueva, y la otra cuenta sin releer", async () => {
    const user = userEvent.setup();
    const cache = new Map();
    render(
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <ToastProvider>
          <EstadoCuentaTienda inicial={tania()} puedeRegistrar />
          <EstadoCuentaTienda inicial={otra()} puedeRegistrar />
        </ToastProvider>
      </SWRConfig>,
    );
    // 458-D (cierre de pantalla): la primera página del servidor NO se relee al montar (`revalidateIfStale: false`).
    expect(verEstadoCuentaMock).not.toHaveBeenCalled();
    const acciones = screen.getByRole("region", { name: "Acciones sobre la cuenta de Tania Tienda" });
    await user.click(within(acciones).getByRole("button", { name: "La tienda le paga a Ordenex" }));
    const dialogo = await screen.findByRole("dialog");
    await user.type(within(dialogo).getByLabelText(/^Monto/), "4000.00");
    await user.type(within(dialogo).getByLabelText(/^Motivo del pago/), "Pago de los fletes");
    await user.click(within(dialogo).getByRole("combobox", { name: "Método de pago" }));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Efectivo" }));

    const antes = verEstadoCuentaMock.mock.calls.length;
    await user.click(within(dialogo).getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(registrarAbonoMock).toHaveBeenCalledTimes(1));
    const fd = registrarAbonoMock.mock.calls[0][0] as FormData;
    expect(fd.get("tiendaId")).toBe(UUID_TIENDA);

    // R48: el aviso con el saldo que devolvió el SERVIDOR.
    expect(
      await screen.findByText(
        "Pago registrado. El saldo de Tania Tienda queda en -₡6.000 · En contra. La tienda todavía le debe ese dinero a Ordenex.",
      ),
    ).toBeInTheDocument();
    // R30: las tarjetas de ESA cuenta, sin recargar.
    await waitFor(() => expect(screen.getByText("Tania Tienda le debe ₡6.000 a Ordenex")).toBeInTheDocument());
    const despues = verEstadoCuentaMock.mock.calls.slice(antes).map(([i]) => (i as { cuenta: { id: string } }).cuenta.id);
    expect(despues.length).toBeGreaterThan(0);
    expect(despues.every((id) => id === UUID_TIENDA)).toBe(true);
  }, 30000);
});

describe("R30 — ANULAR desde el estado de cuenta relee ESA cuenta y ninguna otra", () => {
  it("tras anular un pago a la tienda: tarjeta nueva y la otra cuenta sin releer", async () => {
    const user = userEvent.setup();
    saldoTania = "0.00";
    const pago = fila({
      n: 9,
      categoria: "pago_tienda",
      origenTipo: "pago_tienda",
      chip: "pagos",
      abono: null,
      cargo: "4000.00",
      saldoCorrido: "0.00",
      anulable: true,
      naceDeUnCierre: false,
      registro: { nombre: "Ana Admin", automatico: null },
    });
    verEstadoCuentaMock.mockImplementation(async (input: { cuenta: { id: string } }) => ({
      status: "ok",
      estado: input.cuenta.id === UUID_TIENDA ? { ...tania(), filas: [pago], total: 1 } : otra(),
    }));
    anularMock.mockImplementation(async () => {
      saldoTania = "4000.00";
      return { status: "ok", camino: "liquidacion_pago" };
    });
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <EstadoCuentaTienda inicial={{ ...tania(), filas: [pago], total: 1 }} puedeRegistrar />
          <EstadoCuentaTienda inicial={otra()} puedeRegistrar />
        </ToastProvider>
      </SWRConfig>,
    );
    await user.click(screen.getByRole("button", { name: /^Ver Ordenex le paga a la tienda/ }));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: "Anular…" }));
    const dialogos = await screen.findAllByRole("dialog");
    const anular = dialogos[dialogos.length - 1];
    await user.type(within(anular).getByLabelText(/Motivo de la anulación/), "Pagado dos veces");
    const antes = verEstadoCuentaMock.mock.calls.length;
    await user.click(within(anular).getByRole("button", { name: "Anular" }));
    await waitFor(() =>
      expect(anularMock).toHaveBeenCalledWith({
        destino: { libro: "tienda", movimientoId: UUID_MOV(9) },
        motivo: "Pagado dos veces",
      }),
    );
    await waitFor(() => expect(screen.getByText("Ordenex le debe ₡4.000 a Tania Tienda")).toBeInTheDocument());
    const despues = verEstadoCuentaMock.mock.calls.slice(antes).map(([i]) => (i as { cuenta: { id: string } }).cuenta.id);
    expect(despues.length).toBeGreaterThan(0);
    expect(despues.every((id) => id === UUID_TIENDA)).toBe(true);
  }, 30000);
});

describe("R30 — al volver al listado, la fila dice el saldo nuevo", () => {
  it("la tabla de saldos se lee AL MONTARSE, aunque traiga la página del servidor", async () => {
    saldoTania = "-6000.00";
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <SaldosTiendasTable
            initialData={paginaInicial([
              { tiendaId: UUID_TIENDA, tiendaNombre: "Tania Tienda", saldo: "-10000.00", signo: "negativo" },
            ])}
          />
        </ToastProvider>
      </SWRConfig>,
    );
    await waitFor(() => expect(listarSaldosMock).toHaveBeenCalled());
    const tabla = screen.getByRole("table", { name: "Saldos de tiendas" });
    await waitFor(() => expect(tabla.textContent).toContain("-₡6.000"));
  });
});
