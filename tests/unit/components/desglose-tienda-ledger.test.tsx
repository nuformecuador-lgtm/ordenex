// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import { estado, fila } from "@/tests/fixtures/estado-cuenta";

// ⭑ FICHA 381 (T I.2, R32/R35) — LA TIENDA VE EL COBRO EN SU PROPIA WALLET.
//
// Es la decisión D4 del humano: «ojo, esos cobros deben también verlos las tiendas en su propia
// wallet». El servidor ya afirma contra Postgres que el cobro sale en la lectura de `/mi-wallet`; lo
// que se mide aquí es que la TABLA lo pinte, con el nombre que el libro le da, y que se pueda filtrar.
//
// FICHA 458-D (T D.5): el libro de `/mi-wallet` (`DesgloseTiendaLedger` + `MiWalletFiltros`) se
// retiró; lo sustituye el ESTADO DE CUENTA de la tienda (`MiEstadoCuenta`). Los mismos casos, sobre
// él: la fila del cobro está, con su día, su nombre, su importe (como CARGO) y su origen; no se come
// las otras filas; se distingue de una corrección; no pinta el enum; no despliega órdenes. El filtro
// por el concepto del cobro (R35) es ahora el chip «Cobros» (R24 de la 458).

const detalleMock = vi.fn();
const detalleCompletoMock = vi.fn();
vi.mock("@/lib/actions/wallet-tienda", () => ({
  verDetalleDeMiMovimientoAction: (...a: unknown[]) => detalleMock(...a),
  verDetalleDeMiMovimientoCompletoAction: (...a: unknown[]) => detalleCompletoMock(...a),
}));
const verMiEstadoCuentaMock = vi.fn();
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: vi.fn(),
  verEstadoCuentaCompletoAction: vi.fn(),
  verMiEstadoCuentaAction: (...a: unknown[]) => verMiEstadoCuentaMock(...a),
  verMiEstadoCuentaCompletoAction: vi.fn(),
  verOrdenesDeFilaAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));

import { MiEstadoCuenta } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";

/** El cobro tal como el servidor lo devuelve en el estado de cuenta de ESA tienda (vista tienda). */
const COBRO: FilaEstadoCuentaDTO = fila({
  n: 1,
  fecha: "2026-09-08",
  categoria: "cobro_manual",
  origenTipo: "manual",
  origen: { texto: "Registrado a mano", enlace: null },
  descripcion: "Material de despacho entregado en bodega",
  chip: "cobros",
  naceDeUnCierre: false,
  abono: null,
  cargo: "15000.00",
  saldoCorrido: "-12200.00",
  registro: { nombre: null, automatico: null },
});

/** Un movimiento automático de siempre, para que el cobro no se mida solo. */
const FLETE: FilaEstadoCuentaDTO = fila({
  n: 2,
  fecha: "2026-09-07",
  categoria: "flete",
  abono: null,
  cargo: "2800.00",
  saldoCorrido: "2800.00",
  registro: { nombre: null, automatico: null },
});

const SIN_CIERRES = { opciones: [], hayMas: false, disponible: true };

function envolver(nodo: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

function montar(filas: FilaEstadoCuentaDTO[]) {
  return envolver(<MiEstadoCuenta inicial={estado({ filas, total: filas.length })} cierres={SIN_CIERRES} />);
}

/** La fila del extracto que contiene ese texto. */
function filaCon(texto: string): HTMLElement {
  const celda = within(screen.getByRole("table")).getByText(texto);
  const tr = celda.closest("tr");
  if (tr === null) throw new Error(`«${texto}» no está en ninguna fila`);
  return tr;
}

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  cleanup();
});

describe("/mi-wallet — el cobro aparece en el estado de cuenta de la tienda (381/R32 → 458-D)", () => {
  it("pinta la fila con su día, su nombre, su importe (un CARGO) y su origen con el motivo", () => {
    montar([FLETE, COBRO]);

    const fila = filaCon("Ordenex te cobró");
    expect(within(fila).getByText("2026-09-08")).toBeInTheDocument();
    // Un cobro BAJA el disponible de la tienda: va en la columna «Cargo», como un flete.
    expect(within(fila).getByText("₡15.000")).toHaveClass("text-danger-strong");
    expect(within(fila).getByText("Registrado a mano")).toBeInTheDocument();
    expect(within(fila).getByText("Material de despacho entregado en bodega")).toBeInTheDocument();
  });

  it("y no se come las otras filas del libro: el flete sigue estando", () => {
    montar([FLETE, COBRO]);
    expect(screen.getByText("Ordenex te cobró")).toBeInTheDocument();
    expect(screen.getByText("Ordenex te cobró el flete")).toBeInTheDocument();
    // cabecera + saldo inicial + dos movimientos
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(4);
  });

  it("el cobro se distingue de una corrección: son dos nombres distintos en la misma tabla", () => {
    montar([COBRO, { ...FLETE, categoria: "ajuste_debito", origenTipo: "manual", chip: "correcciones" }]);
    expect(screen.getByText("Ordenex te cobró")).toBeInTheDocument();
    expect(screen.getByText("Corrección en tu contra")).toBeInTheDocument();
  });

  it("no se pinta el valor CRUDO del enum: la tienda lee palabras, no `cobro_manual`", () => {
    const { container } = montar([COBRO]);
    expect(container.textContent ?? "").not.toContain("cobro_manual");
  });

  it("la fila del cobro no ofrece abrirse: no nace de un cierre y no hay órdenes detrás", () => {
    montar([COBRO, FLETE]);
    expect(within(filaCon("Ordenex te cobró")).queryByRole("button", { name: /^Ver las órdenes/ })).toBeNull();
    // Pintar la tabla no dispara la lectura del detalle.
    expect(detalleMock).not.toHaveBeenCalled();
    expect(detalleCompletoMock).not.toHaveBeenCalled();
  });
});

describe("/mi-wallet — la tienda puede filtrar por el cobro (381/R35 → chip «Cobros», 458 R24)", () => {
  it("el chip «Cobros» pide SU estado de cuenta con `chip: cobros`, sin ninguna clave de tienda", async () => {
    const user = userEvent.setup();
    verMiEstadoCuentaMock.mockResolvedValue({ status: "ok", estado: estado({ filas: [COBRO] }) });
    montar([COBRO, FLETE]);

    await user.click(screen.getByRole("button", { name: "Cobros" }));
    await waitFor(() => expect(verMiEstadoCuentaMock).toHaveBeenCalledWith({ chip: "cobros", page: 1, pageSize: 20 }));
    await waitFor(() => expect(screen.queryByText("Ordenex te cobró el flete")).toBeNull());
    expect(screen.getByText("Ordenex te cobró")).toBeInTheDocument();
  });
});
