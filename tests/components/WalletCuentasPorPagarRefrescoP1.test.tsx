// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import type { PrevisualizacionRepartoDTO, RegistrarRepartoResult } from "@/lib/types/liquidacion-reparto";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";

// =================================================================================================
// FICHA 461 — AUDITORÍA DE LA WALLET, P1 (`progress/auditoria_wallet.md`): LA TABLA DE CUENTAS POR
// PAGAR SE REFRESCA AL PAGAR DESDE EL DESGLOSE DEL MENSAJERO
// =================================================================================================
//
// Medido en el clon: tras el reparto de ₡100 la tabla siguió en 15.600 / 5.100 y la cabecera del
// desglose en 15.700 / 5.000. La corrección: `DesglosePagosMensajero` refresca también la clave de la
// tabla (`esClaveCuentasPorPagar`) cuando el bloque de pago avisa `onRegistrado`.
//
// Se monta `CuentasPorPagarTable` de verdad, con el desglose y el bloque de pago reales dentro. El
// doble del servidor devuelve la cuenta que tenga en ese momento, y el reparto la cambia.

const { paginadoMock, conjuntoMock, desgloseMock, previsualizarMock, registrarMock } = vi.hoisted(
  () => ({
    paginadoMock: vi.fn(),
    conjuntoMock: vi.fn(),
    desgloseMock: vi.fn(),
    previsualizarMock: vi.fn(),
    registrarMock: vi.fn(),
  }),
);

vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarCuentasPorPagarPaginadoAction: (...a: unknown[]) => paginadoMock(...a),
  listarCuentasPorPagarCompletoAction: (...a: unknown[]) => conjuntoMock(...a),
  listarPagosDeMensajeroAction: (...a: unknown[]) => desgloseMock(...a),
  listarPagosDeMensajeroCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/liquidacion", () => ({
  previsualizarRepartoMensajeroAction: (...a: unknown[]) => previsualizarMock(...a),
  registrarRepartoMensajeroAction: (...a: unknown[]) => registrarMock(...a),
}));

import { CuentasPorPagarTable } from "@/app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable";

const MENSAJERO = "1e2d3c4b-5a69-4788-9900-aabbccddeeff";
const CIERRE_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const CIERRE_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const CIERRE_C = "cccccccc-3333-4333-8333-cccccccccccc";

/** El estado del "servidor": lo pagado y la cuenta por pagar de Ana, que el reparto mueve. */
let pagado = "74850.00";
let cuentaPorPagar = "21150.00";

function resumen(): CuentaPorPagarResumenDTO {
  return {
    mensajeroId: MENSAJERO,
    mensajeroNombre: "Ana Mensajera",
    devengado: "96000.00",
    pagado,
    cuentaPorPagar,
    signo: "positivo",
  };
}

/** Los mismos tres imputables distintos del fixture de la 205: ₡12.400 en la ventana. */
const PREVISUALIZACION: PrevisualizacionRepartoDTO = {
  mensajeroNombre: "Ana Mensajera",
  imputable: "12400.00",
  imputableTotal: "18850.00",
  cuentaPorPagar: "21150.00",
  deudaNoImputable: { hay: true, monto: "2300.00" },
  recorte: { aplicado: true, tope: 3, enVentana: 3, fuera: 2, montoFuera: "6450.00" },
  imputaciones: [
    { cierreId: CIERRE_A, solicitadoAt: "2026-07-28T06:00:00.000Z", pendienteActual: "4000.00", monto: "4000.00", pendienteDespues: "0.00", parcial: false },
    { cierreId: CIERRE_B, solicitadoAt: "2026-07-30T06:00:00.000Z", pendienteActual: "5000.00", monto: "5000.00", pendienteDespues: "0.00", parcial: false },
    { cierreId: CIERRE_C, solicitadoAt: "2026-08-01T06:00:00.000Z", pendienteActual: "3400.00", monto: "3400.00", pendienteDespues: "0.00", parcial: false },
  ],
  sobrante: "0.00",
  excede: false,
  excluidos: [],
};

const APLICADO: RegistrarRepartoResult = {
  status: "ok",
  reparto: {
    totalImputado: "12400.00",
    restanteImputable: "6450.00",
    imputaciones: [
      { cierreId: CIERRE_A, monto: "4000.00", pendienteDespues: "0.00" },
      { cierreId: CIERRE_B, monto: "5000.00", pendienteDespues: "0.00" },
      { cierreId: CIERRE_C, monto: "3400.00", pendienteDespues: "0.00" },
    ],
  },
};

function montar() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <CuentasPorPagarTable initialData={paginaInicial([resumen()])} />
      </ToastProvider>
    </SWRConfig>,
  );
}

/** La celda «Cuenta por pagar» de la fila de Ana en la TABLA (no en su desglose). */
function cuentaEnLaTabla(): string {
  const tabla = screen.getByRole("table", { name: "Cuentas por pagar a mensajeros" });
  const fila = within(tabla)
    .getAllByRole("row")
    .find((r) => within(r).queryByText("Ana Mensajera") !== null);
  if (!fila) throw new Error("sin fila para Ana");
  return within(fila).getAllByRole("cell")[4]?.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  pagado = "74850.00";
  cuentaPorPagar = "21150.00";
  paginadoMock.mockImplementation(async () => ({
    status: "ok",
    page: 1,
    ...paginaInicial([resumen()]),
  }));
  conjuntoMock.mockResolvedValue({ status: "ok", items: [resumen()], total: 1 });
  desgloseMock.mockImplementation(async () => ({
    status: "ok",
    data: {
      movimientos: [],
      total: 0,
      page: 1,
      pageSize: 20,
      cuenta: { devengado: "96000.00", pagado, cuentaPorPagar, signo: "positivo" },
    },
  }));
  previsualizarMock.mockResolvedValue({ status: "ok", previsualizacion: PREVISUALIZACION });
  registrarMock.mockImplementation(async () => {
    // El reparto de ₡12.400 sube lo pagado y baja la cuenta por pagar en el servidor.
    pagado = "87250.00";
    cuentaPorPagar = "8750.00";
    return APLICADO;
  });
});

afterEach(() => {
  cleanup();
});

describe("P1 — la fila de la tabla de cuentas por pagar se refresca al pagar desde el desglose", () => {
  it("tras registrar el reparto, la tabla relee y su fila dice la cuenta nueva", async () => {
    montar();
    await waitFor(() => expect(paginadoMock).toHaveBeenCalled());
    expect(cuentaEnLaTabla()).toBe("₡21.150");

    fireEvent.click(screen.getByRole("button", { name: "Ver desglose de Ana Mensajera" }));
    const bloque = await screen.findByRole("region", { name: "Pago al mensajero: Ana Mensajera" });
    const abrir = within(bloque).getByRole("button", { name: "Registrar pago" });
    await waitFor(() => expect(abrir).toBeEnabled());
    fireEvent.click(abrir);
    const dialogo = await screen.findByRole("dialog");
    // La previsualización de DENTRO del formulario respondió (espera por defecto del componente).
    await within(dialogo).findByText("Se aplica ₡4.000", undefined, { timeout: 4000 });

    const lecturasAntes = paginadoMock.mock.calls.length;
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    // La tabla VUELVE a leerse (la corrección) y su fila pasa a ₡8.750…
    await waitFor(() => expect(paginadoMock.mock.calls.length).toBeGreaterThan(lecturasAntes));
    await waitFor(() => expect(cuentaEnLaTabla()).toBe("₡8.750"));
    // …y el desglose de ESTE mensajero también se releyó (lo que la 205 ya hacía).
    expect(desgloseMock.mock.calls.length).toBeGreaterThan(1);
  }, 20000);

  it("CONTRAPRUEBA: el doble del servidor sí cambia la cuenta entre lecturas", async () => {
    const antes = (await paginadoMock()) as { items: CuentaPorPagarResumenDTO[] };
    await registrarMock();
    const despues = (await paginadoMock()) as { items: CuentaPorPagarResumenDTO[] };
    expect(antes.items[0].cuentaPorPagar).toBe("21150.00");
    expect(despues.items[0].cuentaPorPagar).toBe("8750.00");
  });
});
