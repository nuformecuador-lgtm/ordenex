// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";

// =================================================================================================
// FICHA 457 (T6.1; R46, R47, R48, R50, R51) — EL PAGO DE LA TIENDA A ORDENEX EN LOS DOS LIBROS DE LA
// TIENDA: `/wallet/tiendas` (desde Ordenex) y `/mi-wallet` (desde la tienda)
// =================================================================================================
//
// R46: el ESTADO DE CUENTA de la tienda en la oficina (458-D: sustituye al desglose de
// `/wallet/tiendas`) dice «La tienda le paga a Ordenex» / «Pago de la tienda a Ordenex anulado», con
// origen «Pago de una tienda a Ordenex», en tabla, chip y descarga. R47:
// `/mi-wallet` dice «Le pagaste a Ordenex» / «Ordenex anuló el pago que le hiciste» —DISTINTAS de las de
// Ordenex—. R48: ni un valor técnico ni un uuid. R50: las pistas de la cabecera nombran el pago y su
// anulación con la palabra de su fila (solo queda la cabecera de `/mi-wallet`: la del desglose de la
// oficina se retiró con él, 458-D). R51: las filas del pago no ofrecen desplegar órdenes.
//
// Los literales van escritos a mano: comparar contra el diccionario sería una aserción contra su
// propia fuente.

vi.mock("@/lib/actions/wallet-tienda", () => ({
  verDetalleDeMiMovimientoAction: vi.fn(),
  verDetalleDeMiMovimientoCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/estado-cuenta", () => ({ verEstadoCuentaAction: vi.fn(async () => ({ status: "forbidden" })) }));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { EstadoCuentaTienda, ROTULOS_TIENDA } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";
import { lineaDeFila } from "@/components/shared/estado-cuenta/estado-cuenta-lineas";
import { estado, fila } from "@/tests/fixtures/estado-cuenta";
import { CATEGORIA_TIENDA_LABEL } from "@/app/(app)/wallet/tiendas/_components/desglose-tienda-labels";
import { MiEstadoCuenta, ROTULOS_MI_WALLET } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";
import { DESGLOSE_MI_WALLET_LABEL } from "@/app/(app)/mi-wallet/_components/mi-wallet-labels";

const TIENDA_ID = "2c4e6a8b-1d3f-4b5c-9e7a-1c3e5a7b9d0f";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

/** Las dos filas en el estado de cuenta de la oficina, como las manda el servidor. */
const FILA_ABONO = fila({
  n: 1,
  fecha: "2026-09-24",
  categoria: "abono_tienda",
  origenTipo: "abono_tienda",
  chip: "pagos",
  abono: "4000.00",
  saldoCorrido: "4000.00",
  descripcion: "Pago de los fletes · SINPE · 123456",
  registro: { nombre: "Ana Admin", automatico: null },
  anulacion: { motivo: "Duplicado", por: "Ana Admin", fecha: "2026-09-25" },
  naceDeUnCierre: false,
});
const FILA_ANULADO = fila({
  n: 2,
  fecha: "2026-09-25",
  categoria: "abono_tienda_anulado",
  origenTipo: "abono_tienda",
  chip: "pagos",
  abono: null,
  cargo: "4000.00",
  saldoCorrido: "0.00",
  descripcion: "Anulación · Pago de los fletes · SINPE · 123456",
  registro: { nombre: "Ana Admin", automatico: null },
  esContraAsiento: true,
  naceDeUnCierre: false,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("457/R46/R48/R49/R51 — `/wallet/tiendas/[tiendaId]`: el estado de cuenta lo dice desde Ordenex", () => {
  it("tabla: «La tienda le paga a Ordenex» y «Pago de la tienda a Ordenex anulado», con su origen; sin desplegar ni ids", () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <EstadoCuentaTienda
            inicial={estado({ id: TIENDA_ID, nombre: "Tienda Norte", filas: [FILA_ABONO, FILA_ANULADO], total: 2 })}
            puedeRegistrar={false}
          />
        </ToastProvider>
      </SWRConfig>,
    );
    const tabla = screen.getByRole("table", { name: "Estado de cuenta de Tienda Norte" });
    const pago = within(tabla).getByText("La tienda le paga a Ordenex").closest("tr") as HTMLElement;
    expect(within(pago).getByText("Pago de una tienda a Ordenex")).toBeInTheDocument();
    expect(within(pago).getByText("Pago de los fletes · SINPE · 123456")).toBeInTheDocument();
    const anulado = within(tabla).getByText("Pago de la tienda a Ordenex anulado").closest("tr") as HTMLElement;
    expect(within(anulado).getByText("Anulación · Pago de los fletes · SINPE · 123456")).toBeInTheDocument();
    // R51: ninguna de las dos se despliega (no nacen de un cierre); solo «Ver» abre SU panel.
    for (const f of [pago, anulado]) {
      expect(within(f).queryByRole("button", { name: /desglose|órdenes/i })).toBeNull();
    }
    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(UUID);
    expect(texto).not.toMatch(/abono_tienda/);
  });

  it("descarga: las mismas palabras que la tabla, sin uuids", () => {
    expect(lineaDeFila(FILA_ABONO, ROTULOS_TIENDA)).toMatchObject({
      fecha: "2026-09-24",
      movimiento: "La tienda le paga a Ordenex",
      abono: "4000.00",
      origen: "Pago de una tienda a Ordenex",
      motivo: "Pago de los fletes · SINPE · 123456",
    });
    expect(lineaDeFila(FILA_ANULADO, ROTULOS_TIENDA).movimiento).toBe("Pago de la tienda a Ordenex anulado");
    for (const f of [FILA_ABONO, FILA_ANULADO]) {
      const valores = Object.values(lineaDeFila(f, ROTULOS_TIENDA)).join(" | ");
      expect(valores).not.toMatch(UUID);
      expect(valores).not.toMatch(/abono_tienda/);
    }
  });

  it("el diccionario desde Ordenex nombra los dos (el filtro de la oficina es el chip «Pagos», D10)", () => {
    expect(CATEGORIA_TIENDA_LABEL.abono_tienda).toBe("La tienda le paga a Ordenex");
    expect(CATEGORIA_TIENDA_LABEL.abono_tienda_anulado).toBe("Pago de la tienda a Ordenex anulado");
  });
});

// FICHA 458-D (T D.5): `/mi-wallet` es el ESTADO DE CUENTA de la tienda (`MiEstadoCuenta`), leído desde
// su lado. Las mismas dos filas, en la vista de la tienda (sin nombres de Ordenex).
const MI_ABONO = { ...FILA_ABONO, registro: { nombre: null, automatico: null }, anulacion: null };
const MI_ANULADO = { ...FILA_ANULADO, registro: { nombre: null, automatico: null } };

describe("457/R47/R48/R51 — `/mi-wallet`: la tienda lo lee desde su lado", () => {
  it("tabla: «Le pagaste a Ordenex» y «Ordenex anuló el pago que le hiciste», con su origen; sin desplegar ni ids", () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <MiEstadoCuenta
            inicial={estado({ id: TIENDA_ID, nombre: "Tienda Norte", filas: [MI_ABONO, MI_ANULADO], total: 2 })}
            cierres={{ opciones: [], hayMas: false, disponible: true }}
          />
        </ToastProvider>
      </SWRConfig>,
    );
    const tabla = screen.getByRole("table", { name: "Estado de cuenta de Tienda Norte" });
    const pago = within(tabla).getByText("Le pagaste a Ordenex").closest("tr") as HTMLElement;
    expect(within(pago).getByText("Pago de una tienda a Ordenex")).toBeInTheDocument();
    expect(within(pago).getByText("Pago de los fletes · SINPE · 123456")).toBeInTheDocument();
    const anulado = within(tabla).getByText("Ordenex anuló el pago que le hiciste").closest("tr") as HTMLElement;
    expect(anulado).toBeInTheDocument();
    // R51: nada que desplegar. 458-D (R78): el pago lleva «Ver comprobante» —ver, no desplegar—.
    for (const f of [pago, anulado]) {
      const botones = within(f).queryAllByRole("button").map((b) => b.textContent);
      expect(botones.filter((b) => b !== "Ver comprobante")).toEqual([]);
    }
    // Los nombres desde Ordenex NO se asoman en la pantalla de la tienda (R47).
    const texto = document.body.textContent ?? "";
    expect(texto).not.toContain("La tienda le paga a Ordenex");
    expect(texto).not.toContain("Pago de la tienda a Ordenex anulado");
    expect(texto).not.toMatch(UUID);
    expect(texto).not.toMatch(/abono_tienda/);
  });

  it("descarga: las mismas palabras que la tabla, sin uuids", () => {
    expect(lineaDeFila(MI_ABONO, ROTULOS_MI_WALLET)).toMatchObject({
      movimiento: "Le pagaste a Ordenex",
      origen: "Pago de una tienda a Ordenex",
      motivo: "Pago de los fletes · SINPE · 123456",
    });
    expect(lineaDeFila(MI_ANULADO, ROTULOS_MI_WALLET).movimiento).toBe("Ordenex anuló el pago que le hiciste");
    for (const f of [MI_ABONO, MI_ANULADO]) {
      const valores = Object.values(lineaDeFila(f, ROTULOS_MI_WALLET)).join(" | ");
      expect(valores).not.toMatch(UUID);
      expect(valores).not.toMatch(/abono_tienda/);
    }
  });

  it("filtro: los dos caen en el chip «Pagos» de la tienda (D10), rotulados desde la tienda", () => {
    expect(MI_ABONO.chip).toBe("pagos");
    expect(MI_ANULADO.chip).toBe("pagos");
    expect(ROTULOS_MI_WALLET.concepto(MI_ABONO)).toBe("Le pagaste a Ordenex");
    expect(ROTULOS_MI_WALLET.concepto(MI_ANULADO)).toBe("Ordenex anuló el pago que le hiciste");
  });

  it("R50: las pistas de la cabecera de tres importes nombran el pago y su anulación, literales (la cabecera se retiró con el libro, 458-D; los textos quedan)", () => {
    expect(DESGLOSE_MI_WALLET_LABEL.aFavorHint).toBe(
      "Lo cobrado a tus clientes, las correcciones a tu favor, lo que le pagaste a Ordenex y lo que Ordenex te devolvió al anular",
    );
    expect(DESGLOSE_MI_WALLET_LABEL.cargosHint).toBe(
      "Fletes, comisión, IVA, lo que Ordenex te cobró y los pagos a Ordenex que se anularon",
    );
  });
});

