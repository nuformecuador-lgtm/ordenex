// @vitest-environment jsdom
// Ficha 458-A (TA.3/TA.4) — los filtros de la wallet sobre las pantallas actuales:
//
//  - TA.3 (R13–R15): los TRES filtros de concepto (`/wallet`, el desglose de una tienda y
//    `/mi-wallet`) piden al servidor los conceptos con movimientos del periodo y la cuenta que se
//    miran —cada uno con SU libro, y `/mi-wallet` sin ningún id— y conservan el elegido con 0.
//  - TA.4 (R2, R10–R12): el cierre de `/wallet/tiendas` y `/wallet/mensajeros` se ELIGE en un
//    selector con búsqueda (leído al abrirlo), ya no se teclea: ningún campo pide un identificador.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";

import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";

const { conceptosMock, cierresMock, desgloseTiendaMock, desgloseMensajeroMock } = vi.hoisted(() => ({
  conceptosMock: vi.fn(),
  cierresMock: vi.fn(),
  desgloseTiendaMock: vi.fn(),
  desgloseMensajeroMock: vi.fn(),
}));

vi.mock("@/lib/actions/wallet-filtros", () => ({
  conceptosConMovimientosAction: (...a: unknown[]) => conceptosMock(...a),
  cierresDeLaCuentaAction: (...a: unknown[]) => cierresMock(...a),
}));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  listarMovimientosDeTiendaAction: (...a: unknown[]) => desgloseTiendaMock(...a),
  listarMovimientosDeTiendaCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-mensajero", () => ({
  listarPagosDeMensajeroAction: (...a: unknown[]) => desgloseMensajeroMock(...a),
  listarPagosDeMensajeroCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/liquidacion", () => ({
  previsualizarRepartoMensajeroAction: vi.fn(async () => ({ status: "forbidden" })),
  registrarRepartoMensajeroAction: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { WalletFiltros } from "@/app/(app)/wallet/_components/WalletFiltros";
import { MiWalletFiltros } from "@/app/(app)/mi-wallet/_components/MiWalletFiltros";
import { DesgloseMovimientosTienda } from "@/app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda";
import { DesglosePagosMensajero } from "@/app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const TIENDA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MENSAJERO = "1e2d3c4b-5a69-4788-9900-aabbccddeeff";
const CIERRE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

const RESUMEN_TIENDA: SaldoTiendaResumenDTO = {
  tiendaId: TIENDA,
  tiendaNombre: "Tania Tienda",
  saldo: "1000.00",
  signo: "positivo",
};
const RESUMEN_MENSAJERO: CuentaPorPagarResumenDTO = {
  mensajeroId: MENSAJERO,
  mensajeroNombre: "Juan Pérez Mora",
  devengado: "100.00",
  pagado: "0.00",
  cuentaPorPagar: "100.00",
  signo: "positivo",
};

function conSWR(ui: ReactNode) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

beforeEach(() => {
  vi.clearAllMocks();
  conceptosMock.mockResolvedValue({
    status: "ok",
    conceptos: [
      { categoria: "egreso_sueldo", movimientos: 2 },
      { categoria: "cod_recaudado", movimientos: 4 },
      { categoria: "cobro_manual", movimientos: 1 },
    ],
  });
  cierresMock.mockResolvedValue({
    status: "ok",
    opciones: [{ cierreId: CIERRE, dia: "2026-09-12", hora: "17:05", mensajero: "Juan Pérez Mora", movimientos: 3 }],
    hayMas: true,
  });
  desgloseTiendaMock.mockResolvedValue({
    status: "ok",
    data: {
      tiendaId: TIENDA,
      movimientos: [],
      total: 0,
      page: 1,
      pageSize: 20,
      desglose: { aFavor: "0.00", cargos: "0.00", pagado: "0.00", saldo: "0.00", signo: "cero" },
    },
  });
  desgloseMensajeroMock.mockResolvedValue({
    status: "ok",
    data: {
      movimientos: [],
      total: 0,
      page: 1,
      pageSize: 20,
      cuenta: { devengado: "0.00", pagado: "0.00", cuentaPorPagar: "0.00", signo: "cero" },
    },
  });
});
afterEach(cleanup);

async function opcionesDe(combobox: HTMLElement): Promise<string[]> {
  const user = userEvent.setup();
  await user.click(combobox);
  const lista = await screen.findByRole("listbox");
  await within(lista).findAllByRole("option");
  return within(lista)
    .getAllByRole("option")
    .map((o) => o.textContent?.trim() ?? "");
}

describe("TA.3 — `/wallet`: el filtro de categoría (libro de caja)", () => {
  it("R13: pide los conceptos del periodo y el tipo del borrador y los ofrece con su número", async () => {
    conSWR(<WalletFiltros onAplicar={vi.fn()} onLimpiar={vi.fn()} />);
    await waitFor(() => expect(conceptosMock).toHaveBeenCalledWith({ libro: "caja" }));

    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-09-30" } });
    await waitFor(() =>
      expect(conceptosMock).toHaveBeenLastCalledWith({ libro: "caja", desde: "2026-09-01", hasta: "2026-09-30" }),
    );
    // La lista viene del servidor y se rotula con el diccionario de la caja: nunca un valor técnico.
    await waitFor(async () => {
      expect(conceptosMock).toHaveBeenCalled();
    });
    const opciones = await opcionesDe(screen.getByRole("combobox", { name: "Filtrar por categoría" }));
    expect(opciones[0]).toBe("Todas las categorías");
    expect(opciones).toContain("Sueldo (2)");
    for (const o of opciones) expect(o).not.toMatch(/_/);
  });

  it("R15: la categoría elegida se conserva, con 0, cuando el periodo la deja sin movimientos", async () => {
    const user = userEvent.setup();
    conSWR(<WalletFiltros onAplicar={vi.fn()} onLimpiar={vi.fn()} />);
    await user.click(screen.getByRole("combobox", { name: "Filtrar por categoría" }));
    await user.click(await screen.findByRole("option", { name: "Sueldo (2)" }));

    conceptosMock.mockResolvedValue({ status: "ok", conceptos: [{ categoria: "ingreso_flete", movimientos: 7 }] });
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-01-01" } });

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Filtrar por categoría" })).toHaveTextContent("Sueldo (0)"),
    );
  });

  it("si la lectura falla, lo dice (y el filtro sigue usable con «todas»)", async () => {
    conceptosMock.mockResolvedValue({ status: "forbidden" });
    conSWR(<WalletFiltros onAplicar={vi.fn()} onLimpiar={vi.fn()} />);
    expect(await screen.findByText("No pudimos cargar los conceptos del periodo.")).toBeInTheDocument();
  });
});

describe("TA.3 — `/mi-wallet`: el filtro de concepto de la tienda", () => {
  it("R13: pide `libro: mi_tienda` SIN ningún id de tienda, con el periodo, y rotula desde la tienda", async () => {
    conSWR(
      <MiWalletFiltros onAplicar={vi.fn()} onLimpiar={vi.fn()} cierres={{ opciones: [], hayMas: false, disponible: true }} />,
    );
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-09-01" } });
    await waitFor(() => expect(conceptosMock).toHaveBeenLastCalledWith({ libro: "mi_tienda", desde: "2026-09-01" }));
    for (const [input] of conceptosMock.mock.calls) expect(input).not.toHaveProperty("tiendaId");
    const opciones = await opcionesDe(screen.getByRole("combobox", { name: "Filtrar por concepto" }));
    expect(opciones).toContain("Ordenex te cobró (1)");
  });
});

describe("TA.3 + TA.4 — `/wallet/tiendas`: el desglose de una tienda", () => {
  it("R2: ningún campo de texto pide el cierre; el selector se lee AL ABRIRLO y busca por día o nombre", async () => {
    const user = userEvent.setup();
    conSWR(<DesgloseMovimientosTienda resumen={RESUMEN_TIENDA} />);
    await waitFor(() => expect(desgloseTiendaMock).toHaveBeenCalledTimes(1));

    expect(screen.queryByPlaceholderText(/ID|identificador/i)).toBeNull();
    // Ningún campo de texto: los únicos campos que se escriben son las dos fechas.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    // Desplegar la fila no lee los cierres (R32/R33 de la 171: una lectura, la del desglose).
    expect(cierresMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cierre: Todos los cierres" }));
    await waitFor(() => expect(cierresMock).toHaveBeenCalledWith({ cuenta: "tienda", tiendaId: TIENDA }));
    expect(
      await screen.findByRole("option", { name: "Cierre del 2026-09-12 · Juan Pérez Mora · 3 movimientos" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Mostramos los cierres más recientes/)).toBeInTheDocument();

    await user.type(screen.getByRole("combobox", { name: "Buscar un cierre" }), "Juan");
    await waitFor(
      () => expect(cierresMock).toHaveBeenLastCalledWith({ cuenta: "tienda", tiendaId: TIENDA, busqueda: "Juan" }),
      { timeout: 3000 },
    );
  });

  it("R10/R12: el cierre ELEGIDO viaja como `cierreId` al listado y al conteo de conceptos; en pantalla, su rótulo", async () => {
    const user = userEvent.setup();
    conSWR(<DesgloseMovimientosTienda resumen={RESUMEN_TIENDA} />);
    await waitFor(() => expect(desgloseTiendaMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Cierre: Todos los cierres" }));
    await user.click(await screen.findByRole("option", { name: /Cierre del 2026-09-12/ }));
    await waitFor(() =>
      expect(conceptosMock).toHaveBeenLastCalledWith({ libro: "tienda", tiendaId: TIENDA, cierreId: CIERRE }),
    );
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() =>
      expect(desgloseTiendaMock).toHaveBeenLastCalledWith({ tiendaId: TIENDA, page: 1, pageSize: 20, cierreId: CIERRE }),
    );
    expect(
      screen.getByRole("button", { name: "Cierre: Cierre del 2026-09-12 · Juan Pérez Mora · 3 movimientos" }),
    ).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(UUID);
  });

  it("R13: el concepto se puebla de los conceptos de ESTA tienda, rotulados desde Ordenex", async () => {
    conSWR(<DesgloseMovimientosTienda resumen={RESUMEN_TIENDA} />);
    await waitFor(() => expect(conceptosMock).toHaveBeenCalledWith({ libro: "tienda", tiendaId: TIENDA }));
    const opciones = await opcionesDe(
      screen.getByRole("combobox", { name: "Filtrar por concepto del desglose de Tania Tienda" }),
    );
    expect(opciones).toContain("Ordenex le cobra a la tienda (1)");
  });
});

describe("TA.4 — `/wallet/mensajeros`: el desglose de un mensajero", () => {
  it("R2: sin «Pegá el identificador» ni su ayuda; el cierre se elige de los de ESTE mensajero y viaja al listado", async () => {
    const user = userEvent.setup();
    conSWR(<DesglosePagosMensajero resumen={RESUMEN_MENSAJERO} />);
    await waitFor(() => expect(desgloseMensajeroMock).toHaveBeenCalledTimes(1));

    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(/identificador|pegá|copiá su dirección/i);
    expect(screen.queryByPlaceholderText(/identificador/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Cierre: Todos los cierres" }));
    await waitFor(() => expect(cierresMock).toHaveBeenCalledWith({ cuenta: "mensajero", mensajeroId: MENSAJERO }));
    await user.click(await screen.findByRole("option", { name: /Cierre del 2026-09-12/ }));
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() =>
      expect(desgloseMensajeroMock).toHaveBeenLastCalledWith({
        mensajeroId: MENSAJERO,
        page: 1,
        pageSize: 20,
        cierreId: CIERRE,
      }),
    );
    expect(document.body.textContent ?? "").not.toMatch(UUID);
  });

  it("si la lectura de cierres falla, el selector lo dice", async () => {
    const user = userEvent.setup();
    cierresMock.mockResolvedValue({ status: "forbidden" });
    conSWR(<DesglosePagosMensajero resumen={RESUMEN_MENSAJERO} />);
    await user.click(screen.getByRole("button", { name: "Cierre: Todos los cierres" }));
    expect(await screen.findByText("No pudimos cargar los cierres. Probá de nuevo.")).toHaveAttribute("role", "alert");
  });
});
