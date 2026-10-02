// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import { FORMA_UUID, UUID_MENSAJERO, UUID_MOV, UUID_TIENDA, estado, fila } from "@/tests/fixtures/estado-cuenta";

// =================================================================================================
// FICHA 458-D (cierre de PANTALLA de los pendientes de servidor) — lo que el estado de cuenta de la
// OFICINA gana sobre los contratos de `progress/impl_458-D.md` §Servidor:
//
//  - R10–R12: el filtro por CIERRE (`SelectorBuscable` + `cierresDeLaCuentaAction`), con el cierre
//    elegido pasado a `verEstadoCuentaAction` como `cierreId`; ningún id a la vista.
//  - R6–R8: el ORIGEN con su entidad y, si el servidor manda enlace, el enlace (id SOLO en `href`).
//  - Método y referencia del pago en la fila y en el panel «Ver».
//  - R19 (344/345): las filas que nacen de un cierre despliegan sus órdenes (`verOrdenesDeFilaAction`,
//    con la cuenta de la página); el mensajero responde `sin_reparto: snapshot_del_cierre` y el panel
//    lo dice con un texto legible.
// =================================================================================================

const verEstadoCuentaMock = vi.fn();
const verOrdenesDeFilaMock = vi.fn();
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: (...a: unknown[]) => verEstadoCuentaMock(...a),
  verEstadoCuentaCompletoAction: vi.fn(),
  verMiEstadoCuentaAction: vi.fn(),
  verMiEstadoCuentaCompletoAction: vi.fn(),
  verOrdenesDeFilaAction: (...a: unknown[]) => verOrdenesDeFilaMock(...a),
}));
const cierresMock = vi.fn();
vi.mock("@/lib/actions/wallet-filtros", () => ({
  cierresDeLaCuentaAction: (...a: unknown[]) => cierresMock(...a),
  conceptosConMovimientosAction: vi.fn(),
}));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn(async () => ({ status: "forbidden" })) }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet", () => ({
  verDetalleDeMovimientoAction: vi.fn(),
  verDetalleDeMovimientoCompletoAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { EstadoCuenta } from "@/components/shared/estado-cuenta/EstadoCuenta";
import { EstadoCuentaTienda, ROTULOS_TIENDA, PANEL_TIENDA } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";
import { EstadoCuentaMensajero } from "@/app/(app)/wallet/mensajeros/_components/EstadoCuentaMensajero";
import { DETALLE_MOVIMIENTO_SIN_REPARTO } from "@/app/(app)/wallet/_components/detalle-movimiento-labels";

const CIERRE = "5e1d2c3b-4a59-4687-8a9b-0c1d2e3f4a5b";
const ORDEN = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

function envolver(nodo: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

function tabla(nombre = "Tania Tienda") {
  return screen.getByRole("table", { name: `Estado de cuenta de ${nombre}` });
}

beforeEach(() => {
  vi.clearAllMocks();
  verEstadoCuentaMock.mockImplementation(async () => ({ status: "ok", estado: estado() }));
  cierresMock.mockResolvedValue({
    status: "ok",
    opciones: [{ cierreId: CIERRE, dia: "2026-09-12", hora: "18:00", mensajero: "Juan Pérez Mora", movimientos: 3 }],
    hayMas: false,
  });
});

afterEach(() => cleanup());

describe("La primera página ya la leyó el servidor", () => {
  it("al montar NO se vuelve a pedir (una lectura de más, y un fallo que taparía las filas buenas)", async () => {
    verEstadoCuentaMock.mockResolvedValue({ status: "forbidden" });
    envolver(<EstadoCuentaTienda inicial={estado()} puedeRegistrar={false} />);
    await new Promise((r) => setTimeout(r, 250));
    expect(verEstadoCuentaMock).not.toHaveBeenCalled();
    expect(within(tabla()).getAllByRole("row").length).toBeGreaterThan(1);
    expect(screen.queryByText("No se pudo cargar el estado de cuenta.")).toBeNull();
  });
});

describe("R10–R12 — el estado de cuenta de la oficina se filtra por CIERRE", () => {
  it("tienda: el selector lee los cierres de ESTA tienda al abrirlo y el elegido viaja como `cierreId`", async () => {
    const user = userEvent.setup();
    envolver(<EstadoCuentaTienda inicial={estado()} puedeRegistrar={false} />);
    expect(cierresMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cierre: Todos los cierres" }));
    await waitFor(() => expect(cierresMock).toHaveBeenCalledWith({ cuenta: "tienda", tiendaId: UUID_TIENDA }));
    await user.click(await screen.findByRole("option", { name: "Cierre del 2026-09-12 · Juan Pérez Mora · 3 movimientos" }));

    await waitFor(() =>
      expect(verEstadoCuentaMock).toHaveBeenLastCalledWith({
        cuenta: { tipo: "tienda", id: UUID_TIENDA },
        cierreId: CIERRE,
        page: 1,
        pageSize: 20,
      }),
    );
    // R1: en pantalla, el rótulo; el cierre no se pinta.
    expect(document.body.textContent ?? "").not.toMatch(FORMA_UUID);
  });

  it("mensajero: el selector lee los cierres de ESE mensajero", async () => {
    const user = userEvent.setup();
    envolver(
      <EstadoCuentaMensajero
        inicial={estado({ tipo: "mensajero", nombre: "Juan Pérez Mora", filas: [fila({ libro: "mensajero" })] })}
        puedeRegistrar={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cierre: Todos los cierres" }));
    await waitFor(() => expect(cierresMock).toHaveBeenCalledWith({ cuenta: "mensajero", mensajeroId: UUID_MENSAJERO }));
    await user.click(await screen.findByRole("option", { name: /Cierre del 2026-09-12/ }));
    await waitFor(() =>
      expect(verEstadoCuentaMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ cuenta: { tipo: "mensajero", id: UUID_MENSAJERO }, cierreId: CIERRE }),
      ),
    );
  });
});

describe("R6–R8 — el origen con su ENTIDAD, y el enlace solo si el servidor lo manda", () => {
  it("R6/R7: se lee la entidad; el enlace lleva el id SOLO en `href` y su nombre accesible no lo dice", () => {
    envolver(
      <EstadoCuenta descargaDeLaSuperficie={{ ambitoColumnas: "prueba-estado-cuenta" }}
        inicial={estado({
          filas: [
            fila({
              origen: {
                texto: "Cierre del día · 2026-09-12 · Juan Pérez Mora",
                enlace: { etiqueta: "Ver el cierre del 2026-09-12 de Juan Pérez Mora", href: `/cierres/${CIERRE}` },
              },
            }),
          ],
        })}
        rotulos={ROTULOS_TIENDA}
        panel={PANEL_TIENDA}
      />,
    );
    expect(within(tabla()).getByText("Cierre del día · 2026-09-12 · Juan Pérez Mora")).toBeInTheDocument();
    const enlace = within(tabla()).getByRole("link", { name: "Ver el cierre del 2026-09-12 de Juan Pérez Mora" });
    expect(enlace).toHaveAttribute("href", `/cierres/${CIERRE}`);
    expect(enlace.textContent).toBe("Ver");
    expect(tabla().textContent ?? "").not.toMatch(FORMA_UUID);
  });

  it("R8: sin enlace del servidor, el nombre del origen sin enlace", () => {
    envolver(
      <EstadoCuenta descargaDeLaSuperficie={{ ambitoColumnas: "prueba-estado-cuenta" }}
        inicial={estado({ filas: [fila({ origen: { texto: "Cierre del día · 2026-09-12", enlace: null } })] })}
        rotulos={ROTULOS_TIENDA}
        panel={PANEL_TIENDA}
      />,
    );
    expect(within(tabla()).getByText("Cierre del día · 2026-09-12")).toBeInTheDocument();
    expect(within(tabla()).queryAllByRole("link")).toHaveLength(0);
  });
});

describe("Método y referencia del pago (458-D servidor → pantalla)", () => {
  const PAGO = fila({
    n: 7,
    categoria: "pago_tienda",
    origenTipo: "pago_tienda",
    origen: { texto: "Pago de Ordenex a una tienda · 2026-09-12 · SINPE", enlace: null },
    pago: { metodo: "SINPE", referencia: "REF-77" },
    chip: "pagos",
    naceDeUnCierre: false,
    abono: null,
    cargo: "5000.00",
    saldoCorrido: "-4000.00",
    registro: { nombre: "Ana Admin", automatico: null },
  });

  it("la fila dice cómo se pagó; una fila que no es un pago, no", () => {
    envolver(<EstadoCuenta descargaDeLaSuperficie={{ ambitoColumnas: "prueba-estado-cuenta" }} inicial={estado({ filas: [fila({}), PAGO], total: 2 })} rotulos={ROTULOS_TIENDA} panel={PANEL_TIENDA} />);
    expect(within(tabla()).getAllByText(/^Cómo se pagó:/)).toHaveLength(1);
    expect(within(tabla()).getByText("Cómo se pagó: SINPE · referencia REF-77")).toBeInTheDocument();
  });

  it("el panel «Ver» de ese pago tiene la línea «Cómo»", async () => {
    envolver(<EstadoCuenta descargaDeLaSuperficie={{ ambitoColumnas: "prueba-estado-cuenta" }} inicial={estado({ filas: [PAGO] })} rotulos={ROTULOS_TIENDA} panel={PANEL_TIENDA} />);
    fireEvent.click(within(tabla()).getByRole("button", { name: /^Ver Ordenex le paga a la tienda/ }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Cómo")).toBeInTheDocument();
    expect(within(panel).getByText("SINPE · referencia REF-77")).toBeInTheDocument();
  });
});

describe("R19 — las filas que nacen de un cierre despliegan sus órdenes", () => {
  const PAYLOAD = {
    monto: "1000.00",
    cierre: { fecha: "2026-09-12T18:00:00.000Z", mensajeroNombre: "Juan Pérez Mora" },
    ordenesDelCierre: 5,
    total: 1,
    page: 1,
    pageSize: 25,
    ordenes: [
      {
        ordenId: ORDEN,
        guia: "4321",
        destinatario: "Carla Cliente",
        tiendaNombre: "Tania Tienda",
        resultados: ["entregado"],
        aporte: "1000.00",
      },
    ],
  };

  it("tienda: solo la fila de cierre ofrece desplegar; al abrirla, UNA lectura con la cuenta de la página", async () => {
    const user = userEvent.setup();
    verOrdenesDeFilaMock.mockResolvedValue({ status: "ok", data: PAYLOAD });
    envolver(
      <EstadoCuentaTienda
        inicial={estado({
          filas: [
            fila({ n: 1 }),
            fila({ n: 2, categoria: "cobro_manual", origenTipo: "manual", naceDeUnCierre: false, chip: "cobros", abono: null, cargo: "10.00" }),
          ],
          total: 2,
        })}
        puedeRegistrar={false}
      />,
    );
    // Cerrado: ninguna lectura de órdenes (R2 de la 344).
    expect(verOrdenesDeFilaMock).not.toHaveBeenCalled();
    const botones = within(tabla()).getAllByRole("button", { name: /^Ver las órdenes que componen/ });
    expect(botones).toHaveLength(1);
    expect(botones[0]).toHaveAccessibleName("Ver las órdenes que componen Contra-entrega cobrado a los clientes de la tienda del 2026-09-12");

    await user.click(botones[0]);
    await waitFor(() =>
      expect(verOrdenesDeFilaMock).toHaveBeenCalledWith({
        cuenta: { tipo: "tienda", id: UUID_TIENDA },
        movimientoId: UUID_MOV(1),
        page: 1,
      }),
    );
    expect(verOrdenesDeFilaMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("link", { name: /4321/ })).toBeInTheDocument();
    expect(screen.getByText("Carla Cliente")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(FORMA_UUID);
  });

  it("un contra-asiento no despliega: sus órdenes son las de su original", () => {
    envolver(
      <EstadoCuentaTienda
        inicial={estado({ filas: [fila({ n: 3, esContraAsiento: true })] })}
        puedeRegistrar={false}
      />,
    );
    expect(within(tabla()).queryAllByRole("button", { name: /^Ver las órdenes que componen/ })).toHaveLength(0);
  });

  it("mensajero: `sin_reparto: snapshot_del_cierre` se dice con un texto legible, no como un fallo", async () => {
    const user = userEvent.setup();
    verOrdenesDeFilaMock.mockResolvedValue({ status: "sin_reparto", motivo: "snapshot_del_cierre" });
    envolver(
      <EstadoCuentaMensajero
        inicial={estado({
          tipo: "mensajero",
          nombre: "Juan Pérez Mora",
          filas: [fila({ libro: "mensajero", categoria: "pago_devengado", chip: "cierres" })],
        })}
        puedeRegistrar={false}
      />,
    );
    await user.click(within(tabla("Juan Pérez Mora")).getByRole("button", { name: /^Ver las órdenes que componen/ }));
    await waitFor(() =>
      expect(verOrdenesDeFilaMock).toHaveBeenCalledWith(
        expect.objectContaining({ cuenta: { tipo: "mensajero", id: UUID_MENSAJERO }, movimientoId: UUID_MOV(1) }),
      ),
    );
    expect(await screen.findByText(DETALLE_MOVIMIENTO_SIN_REPARTO.snapshot_del_cierre)).toBeInTheDocument();
    expect(DETALLE_MOVIMIENTO_SIN_REPARTO.snapshot_del_cierre).not.toMatch(/snapshot|sin_reparto/);
    expect(screen.queryByText(/No se pudo cargar/)).toBeNull();
  });
});
