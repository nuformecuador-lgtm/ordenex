// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import type { EstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import { estado } from "@/tests/fixtures/estado-cuenta";

// =================================================================================================
// FICHA 458-D (T D.2; R26–R28, R40) — LAS ACCIONES DEL ESTADO DE CUENTA DE UNA TIENDA.
//
//  - R26: «La tienda le paga a Ordenex» SOLO con saldo en contra.
//  - R27: «Ordenex le cobra a la tienda» siempre.
//  - R28: «Ordenex le paga a la tienda» deshabilitado CON el motivo en texto visible sin saldo a favor;
//    con saldo a favor, abre el registro.
//  - R40: cada acción abre el diálogo ÚNICO de la 458-C con el concepto y la tienda YA elegidos (y fijos),
//    sin pedir el catálogo de tiendas.
// Quién debe a quién lo dice el `signo` del SERVIDOR; aquí no se compara ningún importe.
// Sustituye a `pago-tienda-acciones.test.tsx` (381/R31) y a `PagoTiendaAccionesAbono457.test.tsx`
// (457/R59): las mismas reglas, en su pantalla nueva.
// =================================================================================================

const listarTiendasMock = vi.fn();
vi.mock("@/lib/actions/usuarios-por-rol", () => ({
  listarAdminTiendas: (...a: unknown[]) => listarTiendasMock(...a),
  listarMensajerosActivos: vi.fn(),
}));
vi.mock("@/lib/actions/efecto-movimiento", () => ({
  previsualizarMovimientoAction: vi.fn(async () => ({ status: "forbidden" })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { EstadoCuentaAcciones } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaAcciones";

const PAGA = "La tienda le paga a Ordenex";
const COBRA = "Ordenex le cobra a la tienda";
const ORDENEX_PAGA = "Ordenex le paga a la tienda";
const SIN_SALDO = "Ordenex no le debe nada a Tania Tienda: sin saldo a favor no hay nada que pagarle.";

function montar(e: EstadoCuentaDTO) {
  const onCambio = vi.fn(async () => undefined);
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <EstadoCuentaAcciones estado={e} onCambio={onCambio} />
      </ToastProvider>
    </SWRConfig>,
  );
  return onCambio;
}

const EN_CONTRA = estado({ saldoActual: "-2500.00", signo: "negativo", sentido: "cuenta_debe" });
const A_FAVOR = estado({ saldoActual: "1000.00", signo: "positivo", sentido: "ordenex_debe" });
const EN_CERO = estado({ saldoActual: "0.00", signo: "cero", sentido: "en_cero" });

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("R26 — «La tienda le paga a Ordenex» solo con saldo en contra", () => {
  it("en contra: se ofrece", () => {
    montar(EN_CONTRA);
    expect(screen.getByRole("button", { name: PAGA })).toBeEnabled();
  });

  it.each([
    ["a favor", A_FAVOR],
    ["en cero", EN_CERO],
  ])("%s: no se ofrece (control: el cobro sí se pinta)", (_caso, e) => {
    montar(e);
    expect(screen.getByRole("button", { name: COBRA })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: PAGA })).toBeNull();
  });
});

describe("R27 — «Ordenex le cobra a la tienda» siempre", () => {
  it.each([
    ["en contra", EN_CONTRA],
    ["a favor", A_FAVOR],
    ["en cero", EN_CERO],
  ])("%s: se ofrece", (_caso, e) => {
    montar(e);
    expect(screen.getByRole("button", { name: COBRA })).toBeEnabled();
  });
});

describe("R28 — «Ordenex le paga a la tienda»: sin saldo a favor, deshabilitado y diciendo por qué", () => {
  it.each([
    ["en contra", EN_CONTRA],
    ["en cero", EN_CERO],
  ])("%s: deshabilitado, con el motivo en texto visible que lo describe", (_caso, e) => {
    montar(e);
    const boton = screen.getByRole("button", { name: ORDENEX_PAGA });
    expect(boton).toBeDisabled();
    expect(screen.getByText(SIN_SALDO)).toBeVisible();
    expect(boton).toHaveAccessibleDescription(SIN_SALDO);
  });

  it("a favor: habilitado y sin el aviso", () => {
    montar(A_FAVOR);
    expect(screen.getByRole("button", { name: ORDENEX_PAGA })).toBeEnabled();
    expect(screen.queryByText(SIN_SALDO)).toBeNull();
  });
});

describe("R40 — cada acción abre el diálogo único con concepto y tienda YA elegidos", () => {
  it.each([
    [PAGA, "Una tienda le paga a Ordenex", /^Tienda que paga/, EN_CONTRA],
    [COBRA, "Ordenex le cobra a una tienda", /^Tienda a la que se le cobra/, A_FAVOR],
    [ORDENEX_PAGA, "Ordenex le paga a una tienda", /^Tienda a la que se le paga/, A_FAVOR],
  ])("«%s» → concepto «%s» elegido y fijo; la tienda, fija por su nombre", async (boton, concepto, campo, e) => {
    montar(e);
    fireEvent.click(screen.getByRole("button", { name: boton }));
    const dialogo = await screen.findByRole("dialog");
    const radio = within(dialogo).getByRole("radio", { name: concepto });
    expect(radio).toBeChecked();
    expect(radio).toHaveAttribute("aria-disabled", "true");
    const tienda = within(dialogo).getByLabelText(campo) as HTMLInputElement;
    expect(tienda.value).toBe("Tania Tienda");
    expect(tienda).toBeDisabled();
    expect(listarTiendasMock).not.toHaveBeenCalled();
  }, 20000);
});
