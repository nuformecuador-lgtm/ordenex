// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";

// ⭑ FICHA 381 (T I.5, R31) — «SE LE PAGA SOLO CUANDO SE LE DEBA DINERO».
//
// Es la otra mitad de la decisión D3 del humano, y la que hace que el saldo negativo sea
// coherente en vez de una cifra suelta: «el disponible debe verse en negativo Y COBRARSE SOLO
// CUANDO MEDIANTE LA GESTIÓN SE LE DEBA DINERO A ESA TIENDA». Traducido a pantalla: mientras el
// saldo no sea POSITIVO no se ofrece pagarle, y se dice por qué.
//
// El comportamiento ya existía (`hayQuePagar = signo === "positivo"`, ficha 172) y hasta hoy
// ningún test lo ataba. Desde esta ficha un saldo no positivo lo produce una decisión humana y
// va a ser común, así que se fija: los DOS lados, porque un botón deshabilitado SIEMPRE pasaría
// un test que solo mirase el caso negativo.

const listarPagosMock = vi.fn();
const registrarPagoMock = vi.fn();
const anularPagoMock = vi.fn();
vi.mock("@/lib/actions/liquidacion", () => ({
  registrarPagoTiendaAction: (...a: unknown[]) => registrarPagoMock(...a),
  listarPagosDeTiendaAction: (...a: unknown[]) => listarPagosMock(...a),
  anularPagoAction: (...a: unknown[]) => anularPagoMock(...a),
}));

// `PagoTiendaAcciones` importa `claveDesgloseTienda` de `DesgloseMovimientosTienda`, que a su
// vez importa las Server Actions del ledger: sin este doble, un test de jsdom arrastraría
// Prisma y la sesión, y el archivo entero se quedaría sin ejecutar.
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarMovimientosDeTiendaAction: vi.fn(),
  listarMovimientosDeTiendaCompletoAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { PagoTiendaAcciones } from "@/app/(app)/wallet/tiendas/_components/PagoTiendaAcciones";

/** El texto exacto que la pantalla enseña cuando no hay nada que pagar (ficha 172, R32). */
const SIN_SALDO = "Esta tienda no tiene saldo a favor: no hay nada que pagar.";

function resumen(over: Partial<SaldoTiendaResumenDTO> = {}): SaldoTiendaResumenDTO {
  return {
    tiendaId: "t-neg",
    tiendaNombre: "Tienda Sur",
    saldo: "-15000.00",
    signo: "negativo",
    ...over,
  };
}

function envolver(nodo: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarPagosMock.mockResolvedValue({ status: "ok", pagos: [] });
});

afterEach(() => {
  cleanup();
});

describe("PagoTiendaAcciones — con saldo NO POSITIVO no se ofrece pagar (381/R31)", () => {
  it.each([
    ["negativo", "-15000.00"],
    ["cero", "0.00"],
  ])("signo `%s` → el botón está deshabilitado y se explica por qué", async (signo, saldo) => {
    envolver(
      <PagoTiendaAcciones
        resumen={resumen({ saldo, signo: signo as SaldoTiendaResumenDTO["signo"] })}
        puedeAnular
      />,
    );

    const boton = await screen.findByRole("button", { name: "Registrar pago" });
    expect(boton).toBeDisabled();
    // Y NO se queda mudo: dice el motivo, que es la mitad de R31 que un `disabled` a secas no
    // cumple. Quien mira la pantalla tiene que entender que no es un fallo.
    expect(screen.getByText(SIN_SALDO)).toBeInTheDocument();
  });

  it("un saldo negativo por un COBRO no se anuncia como un error ni como saldo insuficiente", async () => {
    const { container } = envolver(<PagoTiendaAcciones resumen={resumen()} puedeAnular />);
    await screen.findByRole("button", { name: "Registrar pago" });

    // R27: el negativo es el estado correcto, no una anomalía. La pantalla dice «no hay nada
    // que pagar», que es cierto, y no «saldo insuficiente», que sugeriría un fallo.
    expect(container.textContent ?? "").not.toMatch(/insuficiente|no alcanza|error/i);
  });
});

describe("PagoTiendaAcciones — con saldo POSITIVO sí se ofrece pagar (381/R31)", () => {
  it("el botón está habilitado y el aviso de «no hay nada que pagar» desaparece", async () => {
    envolver(
      <PagoTiendaAcciones
        resumen={resumen({ tiendaId: "t-pos", saldo: "9000.00", signo: "positivo" })}
        puedeAnular
      />,
    );

    const boton = await screen.findByRole("button", { name: "Registrar pago" });
    // Sin esta mitad, un botón deshabilitado SIEMPRE pasaría los dos casos anteriores.
    expect(boton).toBeEnabled();
    expect(screen.queryByText(SIN_SALDO)).not.toBeInTheDocument();
  });

  it("no registra ningún pago por el mero hecho de montarse", async () => {
    envolver(
      <PagoTiendaAcciones
        resumen={resumen({ tiendaId: "t-pos", saldo: "9000.00", signo: "positivo" })}
        puedeAnular
      />,
    );
    await screen.findByRole("button", { name: "Registrar pago" });
    await waitFor(() => expect(listarPagosMock).toHaveBeenCalled());
    expect(registrarPagoMock).not.toHaveBeenCalled();
    expect(anularPagoMock).not.toHaveBeenCalled();
  });
});
