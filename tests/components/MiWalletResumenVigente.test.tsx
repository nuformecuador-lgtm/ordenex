// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";

import type { CierresDeLaTienda } from "@/app/(app)/mi-wallet/_components/mi-wallet-cierres";
import { estado, fila } from "@/tests/fixtures/estado-cuenta";

/**
 * FICHA 458-D (revisión m1; 172 R55) — el resumen de tres cifras de `/mi-wallet` se pinta con la lectura
 * VIGENTE, no con la del servidor al cargar la página. Escenario de la revisión: la tienda tiene la
 * pantalla abierta, la oficina aprueba un cierre y la tienda cambia de chip. La nueva lectura trae el
 * saldo y el resumen nuevos: la tarjeta «Saldo actual» y «Saldo a favor» del resumen tienen que cambiar
 * JUNTAS (la ayuda dice que son el mismo número).
 */

const verMiEstadoCuentaMock = vi.fn();
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: vi.fn(),
  verEstadoCuentaCompletoAction: vi.fn(),
  verMiEstadoCuentaAction: (...a: unknown[]) => verMiEstadoCuentaMock(...a),
  verMiEstadoCuentaCompletoAction: vi.fn(),
  verOrdenesDeFilaAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  verDetalleDeMiMovimientoAction: vi.fn(),
  verDetalleDeMiMovimientoCompletoAction: vi.fn(),
}));

import { MiEstadoCuenta } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";

const CIERRES: CierresDeLaTienda = { opciones: [], hayMas: false, disponible: true };

const ANTES = estado({
  saldoActual: "5200.00",
  saldoFinal: "5200.00",
  resumen: { aFavor: "13000.00", cargos: "3800.00", pagado: "4000.00", saldo: "5200.00", signo: "positivo" },
  filas: [fila({ saldoCorrido: "5200.00" })],
});

/** Lo que la tienda lee DESPUÉS de que la oficina aprobó un cierre de 2.000 a su favor. */
const DESPUES = estado({
  saldoActual: "7200.00",
  saldoFinal: "7200.00",
  resumen: { aFavor: "15000.00", cargos: "3800.00", pagado: "4000.00", saldo: "7200.00", signo: "positivo" },
  filas: [fila({ saldoCorrido: "7200.00", chip: "cobros" })],
});

function conSWR(ui: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

function resumen() {
  return screen.getByRole("region", { name: "Resumen de tu cuenta" });
}

function tarjetaSaldo() {
  const tarjetas = screen.getByRole("region", { name: "Saldo de Tania Tienda" });
  return within(tarjetas).getByText("Saldo actual").parentElement as HTMLElement;
}

function saldoDelResumen() {
  return within(resumen()).getByText("Saldo a favor").parentElement as HTMLElement;
}

beforeEach(() => {
  verMiEstadoCuentaMock.mockReset();
  verMiEstadoCuentaMock.mockResolvedValue({ status: "ok", estado: DESPUES });
});
afterEach(() => cleanup());

describe("/mi-wallet — el resumen se relee con cada lectura (458-D m1, 172 R55)", () => {
  it("al cargar, el resumen y la tarjeta dicen lo mismo (la lectura del servidor)", () => {
    conSWR(<MiEstadoCuenta inicial={ANTES} cierres={CIERRES} />);
    expect(within(tarjetaSaldo()).getByText("₡5.200")).toBeInTheDocument();
    expect(within(saldoDelResumen()).getByText("₡5.200")).toBeInTheDocument();
    expect(within(resumen()).getByText("₡13.000")).toBeInTheDocument();
  });

  it("tras una lectura nueva (cambiar de chip), el resumen cambia JUNTO con la tarjeta", async () => {
    conSWR(<MiEstadoCuenta inicial={ANTES} cierres={CIERRES} />);
    fireEvent.click(screen.getByRole("button", { name: "Cobros" }));
    await waitFor(() => expect(within(tarjetaSaldo()).getByText("₡7.200")).toBeInTheDocument());
    expect(within(saldoDelResumen()).getByText("₡7.200")).toBeInTheDocument();
    expect(within(resumen()).getByText("₡15.000")).toBeInTheDocument();
    expect(within(resumen()).queryByText("₡13.000")).toBeNull();
    // El resumen sigue ENCIMA de las tarjetas y fuera de ellas.
    const tarjetas = screen.getByRole("region", { name: "Saldo de Tania Tienda" });
    expect(resumen().compareDocumentPosition(tarjetas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tarjetas.contains(resumen())).toBe(false);
  });
});
