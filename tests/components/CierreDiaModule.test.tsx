// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CierreDiaModule } from "@/app/(app)/cierre-dia/_components/CierreDiaModule";
import { solicitarCierre } from "@/lib/actions/cierre-dia";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreTotales,
  CierrePasadoDTO,
  CierreResultado,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 37 (T15) — módulo cliente del "Cierre del día". Se mockea la Server
// Action (solicitarCierre), el toast y el router (refresh) para afirmar la
// composición (agrupación, totales, gate, histórico) y el envío sin DB ni sesión.
vi.mock("@/lib/actions/cierre-dia", () => ({
  solicitarCierre: vi.fn(),
  listarCierreDia: vi.fn(),
}));

const { successMock, errorMock, refreshMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const solicitarMock = vi.mocked(solicitarCierre);

function makeGestion(
  over: Partial<CierreDetalleGestion> & { gestionId: string; resultado: CierreResultado },
): CierreDetalleGestion {
  return {
    ordenId: `o-${over.gestionId}`,
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Ana Pérez",
    direccion: "Calle 1, casa 2",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    producto: "Caja mediana",
    tiendaNombre: "Tienda X",
    montoRecibido: null,
    metodoPago: null,
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: null, // feature 39
    ingresoBodegaRechazo: null, // feature 56
    tarifaFaltante: false, // feature 56/R23
    ...over,
  };
}

function emptyGrupos(): CierreGrupos {
  return { entregada: [], reprogramada: [], devuelta: [], rechazada: [] };
}

const ZERO_TOTALES: CierreTotales = {
  efectivo: "0.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "0.00",
};

function renderModule(props?: Partial<Parameters<typeof CierreDiaModule>[0]>) {
  render(
    <CierreDiaModule
      grupos={props?.grupos ?? emptyGrupos()}
      totales={props?.totales ?? ZERO_TOTALES}
      totalPagoMensajero={props?.totalPagoMensajero ?? "0.00"}
      totalIngresoBodegaRechazos={props?.totalIngresoBodegaRechazos ?? "0.00"}
      puedesSolicitar={props?.puedesSolicitar ?? true}
      motivoBloqueo={props?.motivoBloqueo ?? null}
      cierresPasados={props?.cierresPasados ?? []}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  solicitarMock.mockResolvedValue({
    status: "ok",
    cierreId: "c1",
    totales: ZERO_TOTALES,
    destinoTipo: "bodega_satelite",
  });
});

afterEach(() => {
  cleanup();
});

describe("CierreDiaModule", () => {
  it("R3: agrupa las gestiones en las 4 secciones por resultado", () => {
    const grupos: CierreGrupos = {
      entregada: [makeGestion({ gestionId: "g1", resultado: "entregada", numRemision: "REM-ENT" })],
      reprogramada: [makeGestion({ gestionId: "g2", resultado: "reprogramada", numRemision: "REM-REP" })],
      devuelta: [makeGestion({ gestionId: "g3", resultado: "devuelta", numRemision: "REM-DEV" })],
      rechazada: [makeGestion({ gestionId: "g4", resultado: "rechazada", numRemision: "REM-REC" })],
    };
    renderModule({ grupos });

    expect(
      within(screen.getByRole("region", { name: "Entregadas" })).getByText("REM-ENT"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Reprogramadas" })).getByText("REM-REP"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Devueltas" })).getByText("REM-DEV"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Rechazadas" })).getByText("REM-REC"),
    ).toBeInTheDocument();
  });

  it("R4: muestra el detalle completo de la orden gestionada", () => {
    const grupos = emptyGrupos();
    grupos.devuelta = [
      makeGestion({
        gestionId: "g1",
        resultado: "devuelta",
        numGuia: 2002,
        numRemision: "REM-DETALLE",
        destinatario: "Beto Ruiz",
        direccion: "Av. Central 100",
        producto: "Sobre",
        tiendaNombre: "Tienda Norte",
        zonaNombre: "Cartago",
        provinciaNombre: "Cartago",
        cantonNombre: "Oreamuno",
        distritoNombre: "San Rafael",
        motivo: "Cliente rechazó",
      }),
    ];
    renderModule({ grupos });

    const region = screen.getByRole("region", { name: "Devueltas" });
    expect(within(region).getByText("2002")).toBeInTheDocument();
    expect(within(region).getByText("Beto Ruiz")).toBeInTheDocument();
    expect(within(region).getByText("Av. Central 100")).toBeInTheDocument();
    expect(within(region).getByText("Sobre")).toBeInTheDocument();
    expect(within(region).getByText("Tienda Norte")).toBeInTheDocument();
    expect(within(region).getByText("Cliente rechazó")).toBeInTheDocument();
    expect(
      within(region).getByText("Cartago · Cartago · Oreamuno · San Rafael"),
    ).toBeInTheDocument();
  });

  it("R6: una entrega expone su monto (string, money-safe) y su método de pago", () => {
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({
        gestionId: "g1",
        resultado: "entregada",
        numRemision: "REM-ENT",
        montoRecibido: "1250.50",
        metodoPago: "SIMPE",
      }),
    ];
    renderModule({ grupos });

    const region = screen.getByRole("region", { name: "Entregadas" });
    expect(within(region).getByText("₡1250.50")).toBeInTheDocument();
    expect(within(region).getByText("SIMPE")).toBeInTheDocument();
  });

  it("R5: la evidencia se muestra vía URL firmada en el visor (nunca el path crudo)", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.rechazada = [
      makeGestion({
        gestionId: "g1",
        resultado: "rechazada",
        numRemision: "REM-REC",
        motivo: "Dirección inexistente",
        evidenciaUrl: "https://signed.example/evidencia.jpg?token=abc",
      }),
    ];
    renderModule({ grupos });

    await user.click(screen.getByRole("button", { name: "Ver evidencia" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Evidencia de la gestión",
    });
    const img = within(dialog).getByRole("img", {
      name: "Evidencia fotográfica de la gestión",
    });
    expect(img).toHaveAttribute(
      "src",
      "https://signed.example/evidencia.jpg?token=abc",
    );
  });

  it("R7: el panel de totales muestra los 4 totales tal cual (sin reparsear)", () => {
    renderModule({
      totales: {
        efectivo: "100.00",
        simpe: "50.25",
        transferencia: "10.10",
        general: "160.35",
      },
    });

    const region = screen.getByRole("region", { name: "Totales del día" });
    expect(within(region).getByText("₡100.00")).toBeInTheDocument();
    expect(within(region).getByText("₡50.25")).toBeInTheDocument();
    expect(within(region).getByText("₡10.10")).toBeInTheDocument();
    expect(within(region).getByText("₡160.35")).toBeInTheDocument();
  });

  it("R10: expone el pago al mensajero por orden (string, money-safe) en la sección de entregadas", () => {
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({
        gestionId: "g1",
        resultado: "entregada",
        numRemision: "REM-ENT",
        montoRecibido: "1250.50",
        metodoPago: "efectivo",
        pagoMensajero: "1500.00",
      }),
    ];
    renderModule({ grupos });

    const region = screen.getByRole("region", { name: "Entregadas" });
    expect(within(region).getByText("₡1500.00")).toBeInTheDocument();
  });

  it("R11: el total a pagar al mensajero se muestra separado de los totales de dinero recibido", () => {
    renderModule({ totalPagoMensajero: "4200.00" });

    const region = screen.getByRole("region", { name: "Pago al mensajero" });
    expect(within(region).getByText("₡4200.00")).toBeInTheDocument();
  });

  it("feature 56/R12: una gestión rechazada expone su ingreso de bodega por rechazos (string, money-safe)", () => {
    const grupos = emptyGrupos();
    grupos.rechazada = [
      makeGestion({
        gestionId: "g1",
        resultado: "rechazada",
        numRemision: "REM-REC",
        motivo: "Cliente rechazó",
        ingresoBodegaRechazo: "3500.00",
      }),
    ];
    renderModule({ grupos });

    const region = screen.getByRole("region", { name: "Rechazadas" });
    expect(within(region).getByText("₡3500.00")).toBeInTheDocument();
  });

  it("feature 56/R10: el total del ingreso de bodega por rechazos se muestra separado de los demás totales", () => {
    renderModule({ totalIngresoBodegaRechazos: "7800.00" });

    const region = screen.getByRole("region", {
      name: "Ingreso de bodega por rechazos",
    });
    expect(within(region).getByText("₡7800.00")).toBeInTheDocument();
  });

  it("R10/R11: sin poder solicitar, el botón está deshabilitado y se muestra el motivo", () => {
    renderModule({
      puedesSolicitar: false,
      motivoBloqueo: "Tenés órdenes sin gestionar; gestionalas antes de cerrar.",
    });

    expect(
      screen.getByRole("button", { name: "Solicitar cierre" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Tenés órdenes sin gestionar; gestionalas antes de cerrar."),
    ).toBeInTheDocument();
  });

  it("solicitar cierre OK: confirma, muestra toast de éxito y refresca", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.entregada = [makeGestion({ gestionId: "g1", resultado: "entregada" })];
    renderModule({ grupos, puedesSolicitar: true });

    await user.click(screen.getByRole("button", { name: "Solicitar cierre" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Solicitar cierre del día",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Solicitar cierre" }),
    );

    await vi.waitFor(() => expect(solicitarMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("solicitar cierre conflict: muestra toast de error con el motivo del dominio", async () => {
    const user = userEvent.setup();
    solicitarMock.mockResolvedValue({
      status: "conflict",
      motivo: "Ya tienes un cierre solicitado.",
    });
    const grupos = emptyGrupos();
    grupos.entregada = [makeGestion({ gestionId: "g1", resultado: "entregada" })];
    renderModule({ grupos, puedesSolicitar: true });

    await user.click(screen.getByRole("button", { name: "Solicitar cierre" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Solicitar cierre del día",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Solicitar cierre" }),
    );

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("Ya tienes un cierre solicitado."),
    );
    expect(successMock).not.toHaveBeenCalled();
  });

  it("R18: el histórico lista los cierres pasados con estado, destino y totales", () => {
    const cierresPasados: CierrePasadoDTO[] = [
      {
        cierreId: "c1",
        estado: "solicitado",
        destinoTipo: "bodega_central",
        destinoZonaId: "z1",
        totales: {
          efectivo: "300.00",
          simpe: "0.00",
          transferencia: "0.00",
          general: "300.00",
        },
        totalPagoMensajero: "0.00", // feature 39/R13
        totalIngresoBodegaRechazos: "2100.00", // feature 56/R12
        solicitadoAt: "2026-07-11T10:00:00.000Z",
      },
    ];
    renderModule({ cierresPasados });

    const region = screen.getByRole("region", { name: "Cierres solicitados" });
    expect(within(region).getByText("Solicitado")).toBeInTheDocument();
    expect(within(region).getByText("Bodega central")).toBeInTheDocument();
    // Efectivo y total general comparten valor: hay 2 celdas con ₡300.00.
    expect(within(region).getAllByText("₡300.00")).toHaveLength(2);
    // feature 56/R12: el total del ingreso de bodega por rechazos en el histórico.
    expect(within(region).getByText("₡2100.00")).toBeInTheDocument();
    expect(within(region).getByText("2026-07-11")).toBeInTheDocument();
  });

  it("R18: sin cierres pasados muestra el estado vacío del histórico", () => {
    renderModule({ cierresPasados: [] });
    const region = screen.getByRole("region", { name: "Cierres solicitados" });
    expect(
      within(region).getByText("Aún no has solicitado ningún cierre."),
    ).toBeInTheDocument();
  });
});
