// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import type {
  ListarMovimientosDeTiendaResult,
  SaldoTiendaResumenDTO,
} from "@/lib/types/wallet-tienda";
import type { AnularPagoResult, PagoRegistradoDTO, RegistrarPagoResult } from "@/lib/types/liquidacion";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";

// =================================================================================================
// FICHA 461 — AUDITORÍA DE LA WALLET, P1 (`progress/auditoria_wallet.md`): LA TABLA DE SALDOS SE
// REFRESCA AL PAGAR O ANULAR DESDE EL DESGLOSE
// =================================================================================================
//
// Medido en el clon el 2026-09-25: tras pagar ₡1.000 la tabla siguió en ₡137.670,10 y la cabecera del
// desglose, debajo, en ₡136.670,10; tras anular, al revés. Dos cifras distintas del mismo dinero en la
// misma pantalla hasta recargar. La corrección: `PagoTiendaAcciones` refresca también la clave de la
// tabla de saldos (`esClaveSaldosTiendas`), además de las dos de la tienda que ya refrescaba (R33).
//
// Se monta `SaldosTiendasTable` de verdad, como hizo la 172: lo que se mide es la RELACIÓN entre la
// fila de la tabla y el desglose abierto dentro de ella. El doble del servidor devuelve el saldo que
// tenga en ese momento, y pagar o anular lo cambia: si la tabla no relee, se queda con el viejo.

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

const registrarPagoMock = vi.fn();
const listarPagosMock = vi.fn();
const anularPagoMock = vi.fn();
vi.mock("@/lib/actions/liquidacion", () => ({
  registrarPagoTiendaAction: (...a: unknown[]) => registrarPagoMock(...a),
  listarPagosDeTiendaAction: (...a: unknown[]) => listarPagosMock(...a),
  anularPagoAction: (...a: unknown[]) => anularPagoMock(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { SaldosTiendasTable } from "@/app/(app)/wallet/tiendas/_components/SaldosTiendasTable";

// --- El estado del "servidor": el saldo de Tienda Norte, que pagar y anular mueven ----------

/** Lo que el servidor devuelve HOY para Tienda Norte; empieza en ₡9.000 a favor. */
let saldoNorte = "9000.00";

function norte(): SaldoTiendaResumenDTO {
  return { tiendaId: "t1", tiendaNombre: "Tienda Norte", saldo: saldoNorte, signo: "positivo" };
}
const ESTE: SaldoTiendaResumenDTO = {
  tiendaId: "t2",
  tiendaNombre: "Tienda Este",
  saldo: "5000.00",
  signo: "positivo",
};

function desgloseNorte(): ListarMovimientosDeTiendaResult {
  return {
    tiendaId: "t1",
    movimientos: [],
    total: 0,
    page: 1,
    pageSize: 20,
    desglose: { aFavor: "10000.00", cargos: "1000.00", pagado: "0.00", saldo: saldoNorte, signo: "positivo" },
  };
}

const COMPROBANTE: PagoRegistradoDTO = {
  id: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  monto: "4000.00",
  metodo: "efectivo",
  referencia: null,
  nota: null,
  fechaPago: "2026-09-25",
  registradoPorNombre: "Ana Maestra",
  registradoAt: "2026-09-25T15:04:05.000Z",
  esDeReparto: false,
  anulacion: null,
};
const PAGO_OK: RegistrarPagoResult = { status: "ok", pago: COMPROBANTE, restante: "5000.00" };
const ANULACION_OK: AnularPagoResult = {
  status: "ok",
  pago: {
    ...COMPROBANTE,
    anulacion: { motivo: "Monto equivocado", anuladoPorNombre: "Ana Maestra", anuladoAt: "2026-09-25T16:00:00.000Z" },
  },
  restante: "9000.00",
};

function envolver(nodo: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

function renderTabla() {
  const tiendas = () => [norte(), ESTE];
  return envolver(
    <SaldosTiendasTable initialData={paginaInicial(tiendas())} puedeRegistrarPago />,
  );
}

async function desplegar(tiendaNombre: string) {
  fireEvent.click(screen.getByRole("button", { name: `Ver desglose de ${tiendaNombre}` }));
  return screen.findByRole("region", { name: `Desglose de ${tiendaNombre}` });
}

/** La celda «Saldo a favor» de la fila de una tienda en la TABLA DE SALDOS (no en su desglose). */
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
  saldoNorte = "9000.00";
  // El servidor de saldos devuelve el saldo VIGENTE: es lo que distingue una tabla que relee de una
  // que se queda con lo que le llegó del Server Component.
  listarSaldosPaginaMock.mockImplementation(async () => ({
    status: "ok",
    page: 1,
    ...paginaInicial([norte(), ESTE]),
  }));
  listarSaldosDedicadoMock.mockResolvedValue({ status: "ok", items: [norte(), ESTE], total: 2 });
  listarDesgloseMock.mockImplementation(async (input: { tiendaId: string }) =>
    input.tiendaId === "t1"
      ? { status: "ok", data: desgloseNorte() }
      : { status: "ok", data: { ...desgloseNorte(), tiendaId: "t2", desglose: { aFavor: "5000.00", cargos: "0.00", pagado: "0.00", saldo: "5000.00", signo: "positivo" } } },
  );
  listarDesgloseCompletoMock.mockResolvedValue({ status: "ok", items: [], total: 0 });
  listarPagosMock.mockImplementation(async () => ({
    status: "ok",
    pagos: saldoNorte === "5000.00" ? [COMPROBANTE] : [],
  }));
  registrarPagoMock.mockImplementation(async () => {
    saldoNorte = "5000.00"; // el pago de ₡4.000 baja el saldo en el servidor
    return PAGO_OK;
  });
  anularPagoMock.mockImplementation(async () => {
    saldoNorte = "9000.00"; // la anulación lo devuelve
    return ANULACION_OK;
  });
});

afterEach(() => {
  cleanup();
});

describe("P1 — la fila de la tabla de saldos se refresca al PAGAR desde el desglose", () => {
  it("tras registrar el pago, la tabla relee y su fila dice el saldo nuevo, igual que la cabecera del desglose", async () => {
    renderTabla();
    await waitFor(() => expect(listarSaldosPaginaMock).toHaveBeenCalled());
    const lecturasAntes = listarSaldosPaginaMock.mock.calls.length;
    expect(saldoEnLaTabla("Tienda Norte")).toBe("₡9.000");

    const region = await desplegar("Tienda Norte");
    fireEvent.click(within(region).getByRole("button", { name: "Registrar pago" }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(registrarPagoMock).toHaveBeenCalledTimes(1));
    // La tabla de saldos VUELVE a leerse (la corrección) y su fila cambia a ₡5.000…
    await waitFor(() => expect(listarSaldosPaginaMock.mock.calls.length).toBeGreaterThan(lecturasAntes));
    await waitFor(() => expect(saldoEnLaTabla("Tienda Norte")).toBe("₡5.000"));
    // …y la cabecera del desglose dice lo MISMO: una sola cifra para el mismo dinero.
    await waitFor(() => expect(within(region).getAllByText("₡5.000").length).toBeGreaterThan(0));
    // La otra tienda no se toca.
    expect(saldoEnLaTabla("Tienda Este")).toBe("₡5.000");
  }, 20000);
});

describe("P1 — la fila de la tabla de saldos se refresca al ANULAR desde el desglose", () => {
  it("tras anular el pago, la tabla relee y su fila vuelve al saldo anterior", async () => {
    saldoNorte = "5000.00"; // arranca con el pago hecho y su comprobante vigente
    renderTabla();
    await waitFor(() => expect(listarSaldosPaginaMock).toHaveBeenCalled());
    expect(saldoEnLaTabla("Tienda Norte")).toBe("₡5.000");

    const region = await desplegar("Tienda Norte");
    fireEvent.click((await within(region).findAllByRole("button", { name: /^Anular el pago/ }))[0]);
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText(/^Motivo de la anulación/), {
      target: { value: "Monto equivocado" },
    });
    const lecturasAntes = listarSaldosPaginaMock.mock.calls.length;
    fireEvent.click(within(dialogo).getByRole("button", { name: "Anular pago" }));

    await waitFor(() => expect(anularPagoMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listarSaldosPaginaMock.mock.calls.length).toBeGreaterThan(lecturasAntes));
    await waitFor(() => expect(saldoEnLaTabla("Tienda Norte")).toBe("₡9.000"));
  }, 20000);
});

describe("P1 — CONTRAPRUEBA: sin refrescar la tabla, la fila se quedaría con el saldo viejo", () => {
  it("el doble del servidor SÍ cambia el saldo entre lecturas: la corrección no está midiendo un dato fijo", async () => {
    // Si el servidor devolviera siempre lo mismo, el caso de arriba pasaría en verde sin refresco
    // alguno. Aquí se afirma que la segunda lectura devuelve OTRA cifra que la primera.
    const antes = (await listarSaldosPaginaMock()) as { items: SaldoTiendaResumenDTO[] };
    await registrarPagoMock();
    const despues = (await listarSaldosPaginaMock()) as { items: SaldoTiendaResumenDTO[] };
    expect(antes.items[0].saldo).toBe("9000.00");
    expect(despues.items[0].saldo).toBe("5000.00");
  });
});
