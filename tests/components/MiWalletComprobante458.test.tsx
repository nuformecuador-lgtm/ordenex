// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";

import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";
import { FORMA_UUID, UUID_MOV, UUID_TIENDA } from "@/tests/fixtures/estado-cuenta";

// =================================================================================================
// FICHA 458-D (T D.5; R35, R77, R78, H3) — `/mi-wallet`: LA TIENDA VE EL COMPROBANTE QUE SUBIÓ ORDENEX.
//
//  - R78: «Ver comprobante» en las filas de SU libro que pueden llevarlo (pago de Ordenex a la tienda,
//    pago de un gasto por ella, cobro de Ordenex, su pago a Ordenex); en las demás, nada.
//  - R77: lo pide al servidor por el DESTINO de la fila (`verComprobanteAction`, alcance de la tienda);
//    «no encontrado» se dice igual para lo ajeno y lo inexistente.
//  - R35: nada de registrar, anular ni adjuntar.
// =================================================================================================

const verComprobanteMock = vi.fn();
vi.mock("@/lib/actions/wallet-comprobante", () => ({
  verComprobanteAction: (...a: unknown[]) => verComprobanteMock(...a),
}));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  verDetalleDeMiMovimientoAction: vi.fn(),
  verDetalleDeMiMovimientoCompletoAction: vi.fn(),
}));

vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: vi.fn(),
  verEstadoCuentaCompletoAction: vi.fn(),
  verMiEstadoCuentaAction: vi.fn(),
  verMiEstadoCuentaCompletoAction: vi.fn(),
  verOrdenesDeFilaAction: vi.fn(),
}));

// FICHA 458-D (T D.5, cierre de pantalla): `/mi-wallet` es el ESTADO DE CUENTA de la tienda; «Ver
// comprobante» es la acción de SOLO LECTURA de cada fila (`MiEstadoCuenta`). Mismos casos.
import { MiEstadoCuenta } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";
import type { FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import { estado, fila } from "@/tests/fixtures/estado-cuenta";

function mov(n: number, parcial: Partial<WalletTiendaMovimientoDTO>): WalletTiendaMovimientoDTO {
  return {
    id: UUID_MOV(n),
    tiendaId: UUID_TIENDA,
    tipo: "debito",
    categoria: "cobro_manual",
    monto: "500.00",
    origenTipo: "manual",
    origenId: null,
    descripcion: null,
    fechaMovimiento: "2026-09-12T15:00:00.000Z",
    ...parcial,
  };
}

const FILAS = [
  mov(1, { categoria: "cod_recaudado", tipo: "credito", origenTipo: "cierre_dia" }),
  mov(2, { categoria: "cobro_manual" }),
  mov(3, { categoria: "pago_tienda", origenTipo: "pago_tienda" }),
  mov(4, { categoria: "pago_por_cuenta", origenTipo: "pago_por_cuenta_tienda" }),
  mov(5, { categoria: "abono_tienda", tipo: "credito", origenTipo: "abono_tienda" }),
  mov(6, { categoria: "flete", origenTipo: "cierre_dia" }),
];

/** El movimiento como fila del estado de cuenta de la tienda (vista tienda). */
function comoFila(m: WalletTiendaMovimientoDTO): FilaEstadoCuentaDTO {
  return fila({
    ref: { libro: "tienda", movimientoId: m.id },
    fecha: m.fechaMovimiento.slice(0, 10),
    categoria: m.categoria,
    origenTipo: m.origenTipo,
    cargo: m.tipo === "debito" ? m.monto : null,
    abono: m.tipo === "credito" ? m.monto : null,
    naceDeUnCierre: m.origenTipo === "cierre_dia",
    registro: { nombre: null, automatico: null },
  });
}

function montar() {
  const filas = FILAS.map(comoFila);
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ToastProvider>
        <MiEstadoCuenta
          inicial={estado({ filas, total: filas.length })}
          cierres={{ opciones: [], hayMas: false, disponible: true }}
        />
      </ToastProvider>
    </SWRConfig>,
  );
}

let abierta: { opener: unknown; location: { href: string }; close: () => void };
beforeEach(() => {
  vi.clearAllMocks();
  abierta = { opener: {}, location: { href: "" }, close: vi.fn() };
  vi.spyOn(window, "open").mockImplementation(() => abierta as unknown as Window);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("R78 — «Ver comprobante» solo en las filas que pueden llevarlo", () => {
  it("cobro, pago de Ordenex, pago de un gasto y pago de la tienda: sí; lo del cierre: no", () => {
    montar();
    const botones = screen.getAllByRole("button", { name: /^Ver comprobante: / }).map((b) => b.getAttribute("aria-label"));
    expect(botones).toEqual([
      "Ver comprobante: Comprobante de «Ordenex te cobró» del 2026-09-12",
      "Ver comprobante: Comprobante de «Ordenex te pagó» del 2026-09-12",
      "Ver comprobante: Comprobante de «Ordenex pagó un gasto por ti» del 2026-09-12",
      "Ver comprobante: Comprobante de «Le pagaste a Ordenex» del 2026-09-12",
    ]);
  });

  it("R77: lo pide por el destino de SU fila y abre el enlace temporal que devuelve el servidor", async () => {
    verComprobanteMock.mockResolvedValue({
      status: "ok",
      url: "https://almacen.example/firmado?token=x",
      rotulo: { fuente: "tienda", categoria: "pago_tienda", fecha: "2026-09-12" },
    });
    montar();
    fireEvent.click(screen.getByRole("button", { name: /«Ordenex te pagó»/ }));
    await waitFor(() =>
      expect(verComprobanteMock).toHaveBeenCalledWith({ destino: { libro: "tienda", movimientoId: UUID_MOV(3) } }),
    );
    await waitFor(() => expect(abierta.location.href).toBe("https://almacen.example/firmado?token=x"));
    expect(abierta.opener).toBeNull();
  });

  it("R77: «no encontrado» se dice en palabras y la pestaña se cierra", async () => {
    verComprobanteMock.mockResolvedValue({ status: "no_encontrado" });
    montar();
    fireEvent.click(screen.getByRole("button", { name: /«Ordenex te cobró»/ }));
    expect(await screen.findByText("No se encontró el comprobante.")).toBeInTheDocument();
    expect(abierta.close).toHaveBeenCalled();
  });

  it("sin comprobante: «Este registro no tiene comprobante.»", async () => {
    verComprobanteMock.mockResolvedValue({ status: "sin_comprobante" });
    montar();
    fireEvent.click(screen.getByRole("button", { name: /«Le pagaste a Ordenex»/ }));
    expect(await screen.findByText("Este registro no tiene comprobante.")).toBeInTheDocument();
  });
});

describe("R35 — `/mi-wallet` solo lee", () => {
  it("ningún botón de registrar, cobrar, pagar, anular ni adjuntar; ningún uuid a la vista", () => {
    const { container } = montar();
    const tabla = screen.getByRole("table");
    for (const b of within(tabla).queryAllByRole("button")) {
      expect(b.textContent ?? "").not.toMatch(/Registrar|Cobrar|Pagar|Anular|Adjuntar/i);
    }
    expect(container.textContent ?? "").not.toMatch(FORMA_UUID);
    for (const el of Array.from(container.querySelectorAll("[aria-label]"))) {
      expect(el.getAttribute("aria-label") ?? "").not.toMatch(FORMA_UUID);
    }
  });
});
