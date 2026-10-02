// @vitest-environment jsdom
// Ficha 458-A (TA.3/TA.4) — los filtros de la wallet sobre las pantallas actuales:
//
//  - TA.3 (R13–R15): los TRES filtros de concepto (`/wallet`, el desglose de una tienda y
//    `/mi-wallet`) piden al servidor los conceptos con movimientos del periodo y la cuenta que se
//    miran —cada uno con SU libro, y `/mi-wallet` sin ningún id— y conservan el elegido con 0.
//  - TA.4 (R2, R10–R12): el cierre de `/wallet/tiendas` y `/wallet/mensajeros` se ELIGE en un
//    selector con búsqueda (leído al abrirlo), ya no se teclea: ningún campo pide un identificador.
//
// FICHA 458-D (T D.8, D14): los dos desgloses que montaban el selector se retiraron; desde el cierre de
// pantalla de la 458-D el selector vive en el filtro por cierre del ESTADO DE CUENTA de tienda y
// mensajero (`SelectorCierreDeCuenta`, medido montado en `EstadoCuenta458DPantalla.test.tsx`). Aquí se
// conserva la red de la composición (`SelectorBuscable` + `useCierresDeLaCuenta` +
// `CIERRE_SELECTOR_TEXTOS`) y el estado de cuenta se mide por R2 (ningún control pide un id).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";


const { conceptosMock, cierresMock, desgloseTiendaMock, miEstadoCuentaMock } = vi.hoisted(() => ({
  miEstadoCuentaMock: vi.fn(),
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
  verEstadoCuentaCompletoAction: vi.fn(),
  verMiEstadoCuentaAction: (...a: unknown[]) => miEstadoCuentaMock(...a),
  verMiEstadoCuentaCompletoAction: vi.fn(),
  verOrdenesDeFilaAction: vi.fn(),
}));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-tienda", () => ({ verDetalleDeMiMovimientoAction: vi.fn(), verDetalleDeMiMovimientoCompletoAction: vi.fn() }));
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

// FICHA 463/467: la categoría de la caja es la casilla «Concepto» de la barra única del libro; el periodo
// llega ya aplicado por la prop de la wallet.
import { LibroCajaBarraControlada } from "@/tests/fixtures/libro-caja-barra";
import { elegirEnBarra } from "@/tests/fixtures/barra-libro-wallet";
import { MiEstadoCuenta } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";
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
  it("R13: pide los conceptos del periodo APLICADO y el tipo vigente y los ofrece con su número", async () => {
    const { rerender } = conSWR(<LibroCajaBarraControlada activosIniciales={["categoria"]} />);
    await waitFor(() => expect(conceptosMock).toHaveBeenCalledWith({ libro: "caja" }));

    // FICHA 463: el periodo llega de la zona de la wallet, ya aplicado.
    rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <LibroCajaBarraControlada activosIniciales={["categoria"]} filtrosWallet={{ desde: "2026-09-01", hasta: "2026-09-30" }} />
      </SWRConfig>,
    );
    await waitFor(() =>
      expect(conceptosMock).toHaveBeenLastCalledWith({ libro: "caja", desde: "2026-09-01", hasta: "2026-09-30" }),
    );
    // La lista viene del servidor y se rotula con el diccionario de la caja: nunca un valor técnico.
    await waitFor(async () => {
      expect(conceptosMock).toHaveBeenCalled();
    });
    const opciones = await opcionesDe(screen.getByRole("combobox", { name: "Concepto" }));
    // FICHA 467: sin la opción «Todas las categorías» (sin elección, el disparador ya dice «Todos»).
    expect(opciones).not.toContain("Todas las categorías");
    expect(opciones[0]).toBe("Sueldo (2)");
    for (const o of opciones) expect(o).not.toMatch(/_/);
  });

  it("R15: la categoría elegida se conserva, con 0, cuando el periodo la deja sin movimientos", async () => {
    const user = userEvent.setup();
    const proveedor = new Map();
    const onCambiar = vi.fn();
    const montar = (desde: string) => (
      <SWRConfig value={{ provider: () => proveedor, dedupingInterval: 0 }}>
        <LibroCajaBarraControlada activosIniciales={["categoria"]} filtrosWallet={{ desde, hasta: "" }} onCambiar={onCambiar} />
      </SWRConfig>
    );
    const { rerender } = render(montar(""));
    await user.click(screen.getByRole("combobox", { name: "Concepto" }));
    await user.click(await screen.findByRole("option", { name: "Sueldo (2)" }));
    // FICHA 467: la elección se aplica tras la espera estándar del orquestador.
    await waitFor(() => expect(onCambiar).toHaveBeenCalledWith(expect.objectContaining({ categoria: "egreso_sueldo" })));

    conceptosMock.mockResolvedValue({ status: "ok", conceptos: [{ categoria: "ingreso_flete", movimientos: 7 }] });
    rerender(montar("2026-01-01"));

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Concepto" })).toHaveTextContent("Sueldo (0)"),
    );
  });

  it("si la lectura falla, lo dice (y el filtro sigue usable con «todas»)", async () => {
    conceptosMock.mockResolvedValue({ status: "forbidden" });
    conSWR(<LibroCajaBarraControlada activosIniciales={["categoria"]} />);
    expect(await screen.findByText("No pudimos cargar los conceptos del periodo.")).toBeInTheDocument();
  });
});

// FICHA 458-D (T D.5): `/mi-wallet` es el ESTADO DE CUENTA de la tienda; su filtro de concepto
// (`MiWalletFiltros`, `libro: "mi_tienda"`) se retiró con el libro y lo sustituyen los chips (R24), como
// en la oficina. Lo que TA.3 protegía en `/mi-wallet` —ningún id de tienda viaja y se lee desde la
// tienda— se mide sobre el chip.
describe("TA.3 → 458-D — `/mi-wallet`: el filtro por concepto es el chip, sin ningún id de tienda", () => {
  it("R13/R36: el chip «Cobros» lee SU estado de cuenta sin `tiendaId` ni `cuenta`, y rotula desde la tienda", async () => {
    miEstadoCuentaMock.mockResolvedValue({ status: "ok", estado: estado() });
    conSWR(<MiEstadoCuenta inicial={estado()} cierres={{ opciones: [], hayMas: false, disponible: true }} />);
    await elegirEnBarra(userEvent.setup(), document.body, "Tipo de movimiento", "Cobros");
    await waitFor(() => expect(miEstadoCuentaMock).toHaveBeenLastCalledWith({ chip: "cobros", page: 1, pageSize: 20 }));
    for (const [input] of miEstadoCuentaMock.mock.calls) {
      expect(input).not.toHaveProperty("tiendaId");
      expect(input).not.toHaveProperty("cuenta");
    }
    expect(screen.getByText("Cobrado a tus clientes en contra-entrega")).toBeInTheDocument();
    expect(conceptosMock).not.toHaveBeenCalled();
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
  ])("%s: sin campo de texto, sin «ID», «identificador», «pegá» ni «copiá su dirección»; el único campo libre es el buscador del libro", (_c, montar) => {
    conSWR(montar());
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByPlaceholderText(/ID|identificador/i)).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/\bID\b|identificador|pegá|copiá su dirección/i);
    expect(document.body.textContent ?? "").not.toMatch(UUID);
    // FICHA 463/467: el periodo es un calendario (casilla «Periodo» de la barra única); el único campo
    // que se escribe es el buscador del libro (R23), que busca por la descripción o quién registró.
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    expect(screen.getByRole("searchbox", { name: "Buscar en el libro" })).toHaveAttribute(
      "placeholder",
      "Buscar por descripción o quién registró",
    );
    expect(screen.getByRole("button", { name: /^Filtros/ })).toBeInTheDocument();
  });
});
