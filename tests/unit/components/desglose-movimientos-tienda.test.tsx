// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type {
  ListarMovimientosDeTiendaResult,
  SaldoTiendaResumenDTO,
  WalletTiendaMovimientoDTO,
} from "@/lib/types/wallet-tienda";

// ⭑ FICHA 381 (T I.2, R34/R35) — EL COBRO EN LA VISTA DE ADMINISTRACIÓN.
//
// Gemelo de `desglose-tienda-ledger.test.tsx` sobre la otra cara del MISMO libro. R34 pide algo
// muy concreto: que el administrador vea el cobro con el MISMO nombre con el que lo ve la
// tienda. No «uno equivalente»: el mismo, porque salen del mismo objeto (`CATEGORIA_TIENDA_LABEL`,
// reexportado por `desglose-tienda-labels`). Dos mapas paralelos divergirían en cuanto alguien
// renombrara uno, y entonces la tienda y quien le cobra estarían discutiendo sobre dos cosas que
// se llaman distinto.

const listarDesgloseMock = vi.fn();
const listarDesgloseCompletoMock = vi.fn();
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarMovimientosDeTiendaAction: (...a: unknown[]) => listarDesgloseMock(...a),
  listarMovimientosDeTiendaCompletoAction: (...a: unknown[]) =>
    listarDesgloseCompletoMock(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { DesgloseMovimientosTienda } from "@/app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda";

const RESUMEN: SaldoTiendaResumenDTO = {
  tiendaId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  tiendaNombre: "Tienda Sur",
  // Se le cobró más de lo que se le debía: el disponible quedó EN NEGATIVO, y es lo correcto.
  saldo: "-15000.00",
  signo: "negativo",
};

const COBRO: WalletTiendaMovimientoDTO = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  tiendaId: RESUMEN.tiendaId,
  tipo: "debito",
  categoria: "cobro_manual",
  monto: "15000.00",
  origenTipo: "manual",
  origenId: null,
  descripcion: "Material de despacho entregado en bodega",
  fechaMovimiento: "2026-09-08T14:30:00.000Z",
};

const RESPUESTA: ListarMovimientosDeTiendaResult = {
  tiendaId: RESUMEN.tiendaId,
  movimientos: [COBRO],
  total: 1,
  page: 1,
  pageSize: 20,
  desglose: {
    aFavor: "0.00",
    cargos: "15000.00",
    pagado: "0.00",
    saldo: "-15000.00",
    signo: "negativo",
  },
};

function envolver(nodo: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

function montar() {
  listarDesgloseMock.mockResolvedValue({ status: "ok", data: RESPUESTA });
  listarDesgloseCompletoMock.mockResolvedValue({
    status: "ok",
    data: { tiendaId: RESUMEN.tiendaId, movimientos: [COBRO] },
  });
  return envolver(<DesgloseMovimientosTienda resumen={RESUMEN} id="desglose-tienda-sur" />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("DesgloseMovimientosTienda — el admin ve el cobro con el MISMO nombre (381/R34)", () => {
  it("la tabla pinta «Cobro de Ordenex», su importe y su origen manual", async () => {
    montar();
    const etiqueta = await screen.findByText("Cobro de Ordenex");
    const fila = etiqueta.closest("tr");
    expect(fila).not.toBeNull();

    expect(within(fila!).getByText("Débito")).toBeInTheDocument();
    expect(within(fila!).getByText("₡15.000")).toBeInTheDocument();
    expect(
      within(fila!).getByText("Manual · Material de despacho entregado en bodega"),
    ).toBeInTheDocument();
  }, 15000);

  it("no se le enseña el valor crudo del enum a nadie", async () => {
    const { container } = montar();
    await screen.findByText("Cobro de Ordenex");
    expect(container.textContent ?? "").not.toContain("cobro_manual");
  }, 15000);

  it("la cabecera enseña el saldo NEGATIVO entero, con su signo (381/R28)", async () => {
    montar();
    await screen.findByText("Cobro de Ordenex");
    // El desglose que devuelve el servidor deja el saldo en −15.000: se pinta tal cual, sin
    // recortarlo a cero y sin quitarle el signo.
    expect(screen.getByText("-₡15.000")).toBeInTheDocument();
    // Y los dos importes que SÍ valen cero («a favor» y «ya pagado») se pintan como cero: el
    // saldo no se ha confundido con ellos.
    expect(screen.getAllByText("₡0").length).toBeGreaterThanOrEqual(2);
  }, 15000);
});

describe("DesgloseMovimientosTienda — se puede filtrar por el cobro (381/R35)", () => {
  it("el selector de concepto de la vista de administración ofrece «Cobro de Ordenex»", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByText("Cobro de Ordenex");

    await user.click(
      screen.getByRole("combobox", {
        name: "Filtrar por concepto del desglose de Tienda Sur",
      }),
    );
    const lista = await screen.findByRole("listbox");
    const opciones = within(lista)
      .getAllByRole("option")
      .map((o) => o.textContent?.trim());

    // Es la MISMA lista que ve la tienda en `/mi-wallet`: sale del SEED del enum, no de una
    // segunda lista escrita a mano que habría que acordarse de ampliar.
    expect(opciones).toContain("Cobro de Ordenex");
    expect(opciones[0]).toBe("Todos los conceptos");
  }, 20000);

  it("elegir ese concepto y aplicar manda la categoría al servidor", async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByText("Cobro de Ordenex");
    listarDesgloseMock.mockClear();

    await user.click(
      screen.getByRole("combobox", {
        name: "Filtrar por concepto del desglose de Tienda Sur",
      }),
    );
    const lista = await screen.findByRole("listbox");
    await user.click(within(lista).getByRole("option", { name: "Cobro de Ordenex" }));
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    // El filtro llega al borde con el VALOR del enum, que es lo que la base entiende: la
    // etiqueta es de pantalla y no viaja.
    await waitFor(() => expect(listarDesgloseMock).toHaveBeenCalled());
    const input = listarDesgloseMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(input.categoria).toBe("cobro_manual");
    expect(input.tiendaId).toBe(RESUMEN.tiendaId);
  }, 20000);
});
