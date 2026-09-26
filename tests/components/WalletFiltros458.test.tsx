// @vitest-environment jsdom
// Ficha 458-A (TA.3/TA.4) — los filtros de la wallet sobre las pantallas actuales:
//
//  - TA.3 (R13–R15): los TRES filtros de concepto (`/wallet`, el desglose de una tienda y
//    `/mi-wallet`) piden al servidor los conceptos con movimientos del periodo y la cuenta que se
//    miran —cada uno con SU libro, y `/mi-wallet` sin ningún id— y conservan el elegido con 0.
//  - TA.4 (R2, R10–R12): el cierre de `/wallet/tiendas` y `/wallet/mensajeros` se ELIGE en un
//    selector con búsqueda (leído al abrirlo), ya no se teclea: ningún campo pide un identificador.
//
// FICHA 458-D (T D.8, D14): los dos desgloses que montaban el selector se retiraron y el estado de
// cuenta que los sustituye todavía NO filtra por cierre (su borde no lo acepta: pendiente de servidor,
// `progress/impl_458-D.md`). Para no perder la red, los casos del selector se conservan sobre la MISMA
// composición que usaban los desgloses (`SelectorBuscable` + `useCierresDeLaCuenta` +
// `CIERRE_SELECTOR_TEXTOS`), montada aquí; y el estado de cuenta se mide por R2 (ningún control pide
// un id).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";


const { conceptosMock, cierresMock, desgloseTiendaMock } = vi.hoisted(() => ({
  conceptosMock: vi.fn(),
  cierresMock: vi.fn(),
  desgloseTiendaMock: vi.fn(),
}));

vi.mock("@/lib/actions/wallet-filtros", () => ({
  conceptosConMovimientosAction: (...a: unknown[]) => conceptosMock(...a),
  cierresDeLaCuentaAction: (...a: unknown[]) => cierresMock(...a),
}));
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: (...a: unknown[]) => desgloseTiendaMock(...a),
}));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));
vi.mock("@/lib/actions/usuarios-por-rol", () => ({ listarAdminTiendas: vi.fn(), listarMensajerosActivos: vi.fn() }));
vi.mock("@/lib/actions/efecto-movimiento", () => ({ previsualizarMovimientoAction: vi.fn(async () => ({ status: "forbidden" })) }));
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
import { useState } from "react";
import { SelectorBuscable } from "@/components/shared/SelectorBuscable";
import { CIERRE_SELECTOR_TEXTOS } from "@/components/shared/wallet/cierres-selector";
import { useCierresDeLaCuenta, type CuentaDelSelector } from "@/components/shared/wallet/use-cierres-de-la-cuenta";
import { EstadoCuentaTienda } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";
import { EstadoCuentaMensajero } from "@/app/(app)/wallet/mensajeros/_components/EstadoCuentaMensajero";
import { estado } from "@/tests/fixtures/estado-cuenta";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const TIENDA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MENSAJERO = "1e2d3c4b-5a69-4788-9900-aabbccddeeff";
const CIERRE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

/** La composición que montaban los dos desgloses retirados: el selector con la lectura perezosa. */
function SelectorDeCierre({ cuenta, onElegido }: { cuenta: CuentaDelSelector; onElegido?: (v: string | null) => void }) {
  const cierres = useCierresDeLaCuenta(cuenta);
  const [valor, setValor] = useState<string | null>(null);
  return (
    <SelectorBuscable
      id="selector-cierre"
      etiqueta="Cierre"
      opciones={cierres.opciones}
      valor={valor}
      onCambiar={(v) => {
        setValor(v);
        onElegido?.(v);
      }}
      onBuscar={cierres.buscar}
      estado={cierres.estado}
      hayMas={cierres.hayMas}
      textos={CIERRE_SELECTOR_TEXTOS}
    />
  );
}

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
  desgloseTiendaMock.mockResolvedValue({ status: "forbidden" });
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

describe("TA.4 — el selector de cierre de una cuenta (la composición de los desgloses retirados)", () => {
  it("R2/R10: se lee AL ABRIRLO, rotula por día y mensajero y busca por día o nombre", async () => {
    const user = userEvent.setup();
    conSWR(<SelectorDeCierre cuenta={{ cuenta: "tienda", tiendaId: TIENDA }} />);
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

  it("R10/R12: el valor elegido es el cierre (viaja); en pantalla, su rótulo y ningún uuid", async () => {
    const user = userEvent.setup();
    const elegido = vi.fn();
    conSWR(<SelectorDeCierre cuenta={{ cuenta: "mensajero", mensajeroId: MENSAJERO }} onElegido={elegido} />);
    await user.click(screen.getByRole("button", { name: "Cierre: Todos los cierres" }));
    await waitFor(() => expect(cierresMock).toHaveBeenCalledWith({ cuenta: "mensajero", mensajeroId: MENSAJERO }));
    await user.click(await screen.findByRole("option", { name: /Cierre del 2026-09-12/ }));
    expect(elegido).toHaveBeenLastCalledWith(CIERRE);
    expect(
      screen.getByRole("button", { name: "Cierre: Cierre del 2026-09-12 · Juan Pérez Mora · 3 movimientos" }),
    ).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(UUID);
  });

  it("si la lectura de cierres falla, el selector lo dice", async () => {
    const user = userEvent.setup();
    cierresMock.mockResolvedValue({ status: "forbidden" });
    conSWR(<SelectorDeCierre cuenta={{ cuenta: "mensajero", mensajeroId: MENSAJERO }} />);
    await user.click(screen.getByRole("button", { name: "Cierre: Todos los cierres" }));
    expect(await screen.findByText("No pudimos cargar los cierres. Probá de nuevo.")).toHaveAttribute("role", "alert");
  });
});

describe("458-D — los estados de cuenta de tienda y mensajero: ningún control pide un id (R2)", () => {
  it.each([
    ["tienda", () => <EstadoCuentaTienda inicial={estado({ id: TIENDA, nombre: "Tania Tienda" })} puedeRegistrar />],
    ["mensajero", () => <EstadoCuentaMensajero inicial={estado({ tipo: "mensajero", id: MENSAJERO, nombre: "Juan Pérez Mora" })} puedeRegistrar={false} />],
  ])("%s: sin campo de texto, sin «ID», «identificador», «pegá» ni «copiá su dirección»; los únicos campos son las fechas", (_c, montar) => {
    conSWR(montar());
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByPlaceholderText(/ID|identificador/i)).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/\bID\b|identificador|pegá|copiá su dirección/i);
    expect(document.body.textContent ?? "").not.toMatch(UUID);
    expect(screen.getByLabelText("Desde")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Hasta")).toHaveAttribute("type", "date");
  });
});
