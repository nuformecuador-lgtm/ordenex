// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import type {
  ListarMovimientosDeTiendaResult,
  SaldoTiendaResumenDTO,
  WalletTiendaMovimientoDTO,
} from "@/lib/types/wallet-tienda";
import type { PagoMensajeroMovimientoDTO } from "@/lib/types/wallet-mensajero";

// =================================================================================================
// FICHA 459 — RECORRIDO F1: LA FECHA DE LA WALLET ES LA DE COSTA RICA
// =================================================================================================
//
// El recorrido registró un pago por cuenta a las 21:28 del 24/09 en Costa Rica y el libro lo
// fechó «2026-09-25»: las tablas y las descargas recortaban el ISO en UTC con `.slice(0, 10)`.
// Aquí, un movimiento de las 22:00 del 24 de septiembre en Costa Rica (`2026-09-25T04:00:00Z`)
// tiene que leerse «2026-09-24» en las TRES tablas (caja, desglose de /wallet/tiendas y
// /mi-wallet), en su nombre accesible y en las CUATRO descargas. Los días esperados van escritos
// a mano: compararlos contra la función que los produce sería verde siempre.
//
// Y la otra convención que vive en el mismo libro: los pagos y anulaciones de la liquidación se
// guardan a MEDIANOCHE UTC del día elegido (`medianocheUtcDelDia`, ficha 172). Ese día ya es el
// de Costa Rica: correrlo −6 h lo pintaría el día ANTERIOR. También se mide.

const listarDesgloseMock = vi.fn();
const listarDesgloseCompletoMock = vi.fn();
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarMovimientosDeTiendaAction: (...a: unknown[]) => listarDesgloseMock(...a),
  listarMovimientosDeTiendaCompletoAction: (...a: unknown[]) => listarDesgloseCompletoMock(...a),
  verDetalleDeMiMovimientoAction: vi.fn(),
  verDetalleDeMiMovimientoCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/pago-por-cuenta-tienda", () => ({
  anularPagoPorCuentaTiendaAction: vi.fn(),
  obtenerComprobantePagoPorCuentaAction: vi.fn(),
}));
vi.mock("@/lib/actions/aporte-capital", () => ({
  anularAporteCapitalAction: vi.fn(),
  obtenerComprobanteAporteCapitalAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-egresos", () => ({ reversarEgresoAdministrativoAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { WalletLedger } from "@/app/(app)/wallet/_components/WalletLedger";
import { filaDescargaMovimientoCaja } from "@/app/(app)/wallet/_components/wallet-ledger-descarga-columnas";
import { DesgloseMovimientosTienda } from "@/app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda";
import { filaDescargaDesgloseTienda } from "@/app/(app)/wallet/tiendas/_components/desglose-tienda-descarga-columnas";
import { filaDescargaDesgloseMensajero } from "@/app/(app)/wallet/mensajeros/_components/desglose-mensajero-descarga-columnas";
import { DesgloseTiendaLedger } from "@/app/(app)/mi-wallet/_components/DesgloseTiendaLedger";
import { filaDescargaMiWallet } from "@/app/(app)/mi-wallet/_components/mi-wallet-descarga-columnas";
import { fechaDiaMovimientoCR } from "@/lib/utils/fecha-dia-iso";

/** 22:00 del 24/09/2026 en Costa Rica (UTC-6). */
const NOCHE_CR = "2026-09-25T04:00:00.000Z";
const DIA_CR = "2026-09-24";
const DIA_UTC = "2026-09-25";
/** Un pago de la liquidación del 20/09, guardado con la convención `@db.Date` (00:00Z). */
const PAGO_LIQUIDACION = "2026-09-20T00:00:00.000Z";

const PAGO_POR_CUENTA: WalletMovimientoDTO = {
  id: "m-noche",
  tipo: "egreso",
  categoria: "egreso_pago_por_cuenta_tienda",
  monto: "10000.00",
  origenTipo: "pago_por_cuenta_tienda",
  origenId: "0b6c1f7e-7a44-4b43-9c1a-5e0f2d9a1c11",
  descripcion: "Tania Tienda · A Facebook · Pauta",
  registradoPor: null,
  fechaMovimiento: NOCHE_CR,
  dueno: "terceros",
  documento: { tipo: "pago_por_cuenta_tienda", anulado: false, tieneComprobante: false },
};

const PAGO_A_TIENDA: WalletMovimientoDTO = {
  ...PAGO_POR_CUENTA,
  id: "m-liquidacion",
  categoria: "egreso_pago_tienda",
  origenTipo: "pago_tienda",
  descripcion: "Pago SINPE",
  fechaMovimiento: PAGO_LIQUIDACION,
  documento: null,
};

const CARGO_TIENDA: WalletTiendaMovimientoDTO = {
  id: "t-noche",
  tiendaId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  tipo: "debito",
  categoria: "cobro_manual",
  monto: "10000.00",
  origenTipo: "manual",
  origenId: null,
  descripcion: "Cobro de la noche",
  fechaMovimiento: NOCHE_CR,
};

const MOV_MENSAJERO = {
  id: "p-noche",
  mensajeroId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  tipo: "credito",
  categoria: "cod_recaudado",
  monto: "5000.00",
  origenTipo: "manual",
  origenId: null,
  descripcion: null,
  fechaMovimiento: NOCHE_CR,
} as unknown as PagoMensajeroMovimientoDTO;

function envolver(nodo: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

describe("459/F1 — el día de Costa Rica de un instante de la wallet", () => {
  it("las 22:00 del 24 en Costa Rica son el 24; las 23:59 también; las 00:00 del 25, el 25", () => {
    expect(fechaDiaMovimientoCR(NOCHE_CR)).toBe(DIA_CR);
    expect(fechaDiaMovimientoCR("2026-09-25T05:59:59.999Z")).toBe("2026-09-24");
    expect(fechaDiaMovimientoCR("2026-09-25T06:00:00.000Z")).toBe("2026-09-25");
    expect(fechaDiaMovimientoCR("2026-09-24T15:00:00.000Z")).toBe("2026-09-24");
  });

  it("la medianoche UTC de la liquidación (ficha 172) conserva su día: no se corre al anterior", () => {
    expect(fechaDiaMovimientoCR(PAGO_LIQUIDACION)).toBe("2026-09-20");
    expect(fechaDiaMovimientoCR("2026-09-20")).toBe("2026-09-20");
  });

  it("lo que no es un instante se devuelve tal cual (la sonda de la guardia de descargas)", () => {
    expect(fechaDiaMovimientoCR("")).toBe("");
    expect(fechaDiaMovimientoCR("__sonda.fechaMovimiento__")).toBe("__sonda.fechaMovimiento__");
  });
});

describe("459/F1 — /wallet: el libro de la caja y su descarga", () => {
  it("la fila y el nombre accesible de «Anular…» dicen el 24, no el 25", () => {
    envolver(<WalletLedger movimientos={[PAGO_POR_CUENTA, PAGO_A_TIENDA]} />);
    const fila = screen.getByRole("row", { name: /A Facebook · Pauta/ });
    expect(within(fila).getByText(DIA_CR)).toBeInTheDocument();
    expect(within(fila).queryByText(DIA_UTC)).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Anular Pago por cuenta de una tienda del 2026-09-24 por ₡10.000",
      }),
    ).toBeInTheDocument();
    // El pago de la liquidación sigue en SU día.
    const liquidacion = screen.getByRole("row", { name: /Pago SINPE/ });
    expect(within(liquidacion).getByText("2026-09-20")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(DIA_UTC);
  });

  it("la descarga dice el mismo día que la tabla", () => {
    expect(filaDescargaMovimientoCaja(PAGO_POR_CUENTA).fecha).toBe(DIA_CR);
    expect(filaDescargaMovimientoCaja(PAGO_A_TIENDA).fecha).toBe("2026-09-20");
  });
});

describe("459/F1 — /wallet/tiendas: el desglose de una tienda y su descarga", () => {
  it("la tabla y la descarga dicen el 24", async () => {
    const resumen: SaldoTiendaResumenDTO = {
      tiendaId: CARGO_TIENDA.tiendaId,
      tiendaNombre: "Tania Tienda",
      saldo: "-10000.00",
      signo: "negativo",
    };
    const respuesta: ListarMovimientosDeTiendaResult = {
      tiendaId: resumen.tiendaId,
      movimientos: [CARGO_TIENDA],
      total: 1,
      page: 1,
      pageSize: 20,
      desglose: {
        aFavor: "0.00",
        cargos: "10000.00",
        pagado: "0.00",
        saldo: "-10000.00",
        signo: "negativo",
      },
    };
    listarDesgloseMock.mockResolvedValue({ status: "ok", data: respuesta });
    envolver(<DesgloseMovimientosTienda resumen={resumen} id="desglose-tania" />);

    const celda = await screen.findByText("Manual · Cobro de la noche");
    const fila = celda.closest("tr");
    expect(fila).not.toBeNull();
    expect(within(fila!).getByText(DIA_CR)).toBeInTheDocument();
    expect(within(fila!).queryByText(DIA_UTC)).toBeNull();

    expect(filaDescargaDesgloseTienda(CARGO_TIENDA).fecha).toBe(DIA_CR);
  }, 15000);
});

describe("459/F1 — /mi-wallet: el libro de la tienda y su descarga", () => {
  it("la tabla y la descarga dicen el 24", () => {
    envolver(<DesgloseTiendaLedger movimientos={[CARGO_TIENDA]} />);
    const fila = screen.getByText("Manual · Cobro de la noche").closest("tr");
    expect(fila).not.toBeNull();
    expect(within(fila!).getByText(DIA_CR)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(DIA_UTC);

    expect(filaDescargaMiWallet(CARGO_TIENDA).fecha).toBe(DIA_CR);
  });
});

describe("459/F1 — /wallet/mensajeros: la descarga del desglose", () => {
  it("dice el 24", () => {
    expect(filaDescargaDesgloseMensajero(MOV_MENSAJERO).fecha).toBe(DIA_CR);
  });
});
