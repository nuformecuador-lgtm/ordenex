// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";

// =================================================================================================
// FICHA 457 (T6.1; R46, R47, R48, R50, R51) — EL PAGO DE LA TIENDA A ORDENEX EN LOS DOS LIBROS DE LA
// TIENDA: `/wallet/tiendas` (desde Ordenex) y `/mi-wallet` (desde la tienda)
// =================================================================================================
//
// R46: el desglose de `/wallet/tiendas` dice «La tienda le paga a Ordenex» / «Pago de la tienda a
// Ordenex anulado», con origen «Pago de una tienda a Ordenex», en tabla, filtro y descarga. R47:
// `/mi-wallet` dice «Le pagaste a Ordenex» / «Ordenex anuló el pago que le hiciste» —DISTINTAS de las de
// Ordenex—. R48: ni un valor técnico ni un uuid. R50: las pistas de la cabecera nombran el pago y su
// anulación con la palabra de su fila. R51: las filas del pago no ofrecen desplegar órdenes.
//
// Los literales van escritos a mano: comparar contra el diccionario sería una aserción contra su
// propia fuente.

const listarDesgloseMock = vi.fn();
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarMovimientosDeTiendaAction: (...a: unknown[]) => listarDesgloseMock(...a),
  listarMovimientosDeTiendaCompletoAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { opcionesDeConceptos } from "@/components/shared/wallet/conceptos-filtro";
import { DesgloseMovimientosTienda } from "@/app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda";

/** 458-A: lo que devolveria `conceptosConMovimientosAction` para una tienda con los dos. */
const CON_MOVIMIENTOS = [
  { categoria: "abono_tienda", movimientos: 2 },
  { categoria: "abono_tienda_anulado", movimientos: 1 },
];
import { DesgloseTiendaLedger } from "@/app/(app)/mi-wallet/_components/DesgloseTiendaLedger";
import { filaDescargaDesgloseTienda } from "@/app/(app)/wallet/tiendas/_components/desglose-tienda-descarga-columnas";
import { filaDescargaMiWallet } from "@/app/(app)/mi-wallet/_components/mi-wallet-descarga-columnas";
import {
  CATEGORIA_TIENDA_LABEL,
  CONCEPTO_TIENDA_TODOS_OPTION,
  DESGLOSE_TIENDA_LABEL,
} from "@/app/(app)/wallet/tiendas/_components/desglose-tienda-labels";
import {
  CATEGORIA_MI_WALLET_LABEL,
  CONCEPTO_MI_WALLET_TODOS_OPTION,
  DESGLOSE_MI_WALLET_LABEL,
} from "@/app/(app)/mi-wallet/_components/mi-wallet-labels";

const ABONO_ID = "5b7d9f1a-3c5e-4a7b-9d1f-3a5c7e9b1d2f";
const TIENDA_ID = "2c4e6a8b-1d3f-4b5c-9e7a-1c3e5a7b9d0f";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

const ABONO: WalletTiendaMovimientoDTO = {
  id: "0a1b2c3d-1111-4111-8111-111111111111",
  tiendaId: TIENDA_ID,
  tipo: "credito",
  categoria: "abono_tienda",
  monto: "4000.00",
  origenTipo: "abono_tienda",
  origenId: ABONO_ID,
  descripcion: "Pago de los fletes · SINPE · 123456",
  fechaMovimiento: "2026-09-24T06:00:00.000Z",
};
const ANULADO: WalletTiendaMovimientoDTO = {
  ...ABONO,
  id: "0a1b2c3d-2222-4222-8222-222222222222",
  tipo: "debito",
  categoria: "abono_tienda_anulado",
  descripcion: "Anulación · Pago de los fletes · SINPE · 123456",
  fechaMovimiento: "2026-09-25T06:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  listarDesgloseMock.mockResolvedValue({
    status: "ok",
    data: {
      tiendaId: TIENDA_ID,
      movimientos: [ABONO, ANULADO],
      total: 2,
      page: 1,
      pageSize: 20,
      desglose: { aFavor: "4000.00", cargos: "4000.00", pagado: "0.00", saldo: "0.00", signo: "cero" },
    },
  });
});

afterEach(() => {
  cleanup();
});

describe("457/R46/R48/R49/R51 — `/wallet/tiendas`: el desglose lo dice desde Ordenex", () => {
  it("tabla: «La tienda le paga a Ordenex» y «Pago de la tienda a Ordenex anulado», con su origen; sin desplegar ni ids", async () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <DesgloseMovimientosTienda
            resumen={{ tiendaId: TIENDA_ID, tiendaNombre: "Tienda Norte", saldo: "0.00", signo: "cero" }}
          />
        </ToastProvider>
      </SWRConfig>,
    );
    const pago = await screen.findByRole("row", { name: /La tienda le paga a Ordenex/ });
    expect(within(pago).getByText("Pago de una tienda a Ordenex · Pago de los fletes · SINPE · 123456")).toBeInTheDocument();
    const anulado = screen.getByRole("row", { name: /Pago de la tienda a Ordenex anulado/ });
    expect(
      within(anulado).getByText("Pago de una tienda a Ordenex · Anulación · Pago de los fletes · SINPE · 123456"),
    ).toBeInTheDocument();
    // R51: ninguna de las dos se despliega (no nacen de un cierre).
    for (const f of [pago, anulado]) {
      expect(within(f).queryByRole("button", { name: /desglose|órdenes|Ver/i })).toBeNull();
    }
    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(UUID);
    expect(texto).not.toMatch(/abono_tienda/);
  });

  it("descarga: las mismas palabras que la tabla, sin uuids", () => {
    expect(filaDescargaDesgloseTienda(ABONO)).toEqual({
      fecha: "2026-09-24",
      tipo: expect.any(String),
      concepto: "La tienda le paga a Ordenex",
      monto: "4000.00",
      origen: "Pago de una tienda a Ordenex · Pago de los fletes · SINPE · 123456",
    });
    expect(filaDescargaDesgloseTienda(ANULADO).concepto).toBe("Pago de la tienda a Ordenex anulado");
    for (const m of [ABONO, ANULADO]) {
      const valores = Object.values(filaDescargaDesgloseTienda(m)).join(" | ");
      expect(valores).not.toMatch(UUID);
      expect(valores).not.toMatch(/abono_tienda/);
    }
  });

  it("filtro por concepto: los dos, con su nombre desde Ordenex", () => {
    // 458-A (TA.3): las opciones son los conceptos CON movimientos, con su número.
    const lista = opcionesDeConceptos(CON_MOVIMIENTOS, CATEGORIA_TIENDA_LABEL, "", CONCEPTO_TIENDA_TODOS_OPTION);
    const opciones = new Map(lista.map((o) => [o.value, o.label]));
    expect(opciones.get("abono_tienda")).toBe("La tienda le paga a Ordenex (2)");
    expect(opciones.get("abono_tienda_anulado")).toBe("Pago de la tienda a Ordenex anulado (1)");
  });

  it("R50: las pistas de la cabecera nombran el pago y su anulación, literales", () => {
    expect(DESGLOSE_TIENDA_LABEL.aFavorHint).toBe(
      "Contra-entrega cobrado, correcciones a favor, pagos de la tienda a Ordenex y devoluciones por anulaciones",
    );
    expect(DESGLOSE_TIENDA_LABEL.cargosHint).toBe(
      "Fletes, comisión, IVA, los cobros de Ordenex a la tienda y sus pagos a Ordenex anulados",
    );
  });
});

describe("457/R47/R48/R51 — `/mi-wallet`: la tienda lo lee desde su lado", () => {
  it("tabla: «Le pagaste a Ordenex» y «Ordenex anuló el pago que le hiciste», con su origen; sin desplegar ni ids", () => {
    render(<DesgloseTiendaLedger movimientos={[ABONO, ANULADO]} />);
    const pago = screen.getByRole("row", { name: /Le pagaste a Ordenex/ });
    expect(within(pago).getByText("Pago de una tienda a Ordenex · Pago de los fletes · SINPE · 123456")).toBeInTheDocument();
    const anulado = screen.getByRole("row", { name: /Ordenex anuló el pago que le hiciste/ });
    expect(anulado).toBeInTheDocument();
    for (const f of [pago, anulado]) expect(within(f).queryAllByRole("button")).toHaveLength(0);
    // Los nombres desde Ordenex NO se asoman en la pantalla de la tienda (R47).
    const texto = document.body.textContent ?? "";
    expect(texto).not.toContain("La tienda le paga a Ordenex");
    expect(texto).not.toContain("Pago de la tienda a Ordenex anulado");
    expect(texto).not.toMatch(UUID);
    expect(texto).not.toMatch(/abono_tienda/);
  });

  it("descarga: las mismas palabras que la tabla, sin uuids", () => {
    expect(filaDescargaMiWallet(ABONO).concepto).toBe("Le pagaste a Ordenex");
    expect(filaDescargaMiWallet(ABONO).origen).toBe("Pago de una tienda a Ordenex · Pago de los fletes · SINPE · 123456");
    expect(filaDescargaMiWallet(ANULADO).concepto).toBe("Ordenex anuló el pago que le hiciste");
    for (const m of [ABONO, ANULADO]) {
      const valores = Object.values(filaDescargaMiWallet(m)).join(" | ");
      expect(valores).not.toMatch(UUID);
      expect(valores).not.toMatch(/abono_tienda/);
    }
  });

  it("filtro por concepto: los dos, con la lectura de la tienda", () => {
    // 458-A (TA.3): las opciones son los conceptos CON movimientos, con su número.
    const lista = opcionesDeConceptos(CON_MOVIMIENTOS, CATEGORIA_MI_WALLET_LABEL, "", CONCEPTO_MI_WALLET_TODOS_OPTION);
    const opciones = new Map(lista.map((o) => [o.value, o.label]));
    expect(opciones.get("abono_tienda")).toBe("Le pagaste a Ordenex (2)");
    expect(opciones.get("abono_tienda_anulado")).toBe("Ordenex anuló el pago que le hiciste (1)");
  });

  it("R50: las pistas de la cabecera nombran el pago y su anulación, literales", () => {
    expect(DESGLOSE_MI_WALLET_LABEL.aFavorHint).toBe(
      "Lo cobrado a tus clientes, las correcciones a tu favor, lo que le pagaste a Ordenex y lo que Ordenex te devolvió al anular",
    );
    expect(DESGLOSE_MI_WALLET_LABEL.cargosHint).toBe(
      "Fletes, comisión, IVA, lo que Ordenex te cobró y los pagos a Ordenex que se anularon",
    );
  });
});
