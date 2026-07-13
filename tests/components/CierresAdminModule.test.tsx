// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import {
  verCierreDetalle,
  aprobarCierre,
  rechazarCierre,
} from "@/lib/actions/cierres-admin";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreTotales,
  CierreResultado,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 38 (T13) — módulo cliente de "Cierres del día" del admin. Se mockean las
// Server Actions (ver detalle / aprobar / rechazar), el toast y el router (refresh)
// para afirmar la composición (cola, histórico, detalle, decisiones) sin DB ni sesión.
vi.mock("@/lib/actions/cierres-admin", () => ({
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  listarCierresAdmin: vi.fn(),
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

const verDetalleMock = vi.mocked(verCierreDetalle);
const aprobarMock = vi.mocked(aprobarCierre);
const rechazarMock = vi.mocked(rechazarCierre);

const ZERO_TOTALES: CierreTotales = {
  efectivo: "0.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "0.00",
};

function makeResumen(
  over: Partial<CierreAdminResumen> & { cierreId: string },
): CierreAdminResumen {
  return {
    mensajeroId: `m-${over.cierreId}`,
    mensajeroNombre: "Ana Mensajera",
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z1",
    destinoZonaNombre: "GAM",
    totales: ZERO_TOTALES,
    totalPagoMensajero: "0.00", // feature 39/R17
    totalIngresoBodegaRechazos: "0.00", // feature 56/R16
    solicitadoAt: "2026-07-11T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    ...over,
  };
}

function makeGestion(
  over: Partial<CierreDetalleGestion> & {
    gestionId: string;
    resultado: CierreResultado;
  },
): CierreDetalleGestion {
  return {
    ordenId: `o-${over.gestionId}`,
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Beto Ruiz",
    direccion: "Calle 1",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    producto: "Caja",
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

function renderModule(props?: Partial<Parameters<typeof CierresAdminModule>[0]>) {
  render(
    <CierresAdminModule
      pendientes={props?.pendientes ?? []}
      historico={props?.historico ?? []}
      sinZona={props?.sinZona ?? false}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("CierresAdminModule", () => {
  it("R3: sinZona muestra aviso accionable y NO tablas de acción", () => {
    renderModule({ sinZona: true });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No tenés una zona asignada; contactá a tu administrador.",
    );
    expect(
      screen.queryByRole("region", { name: "Pendientes de decisión" }),
    ).not.toBeInTheDocument();
  });

  it("R4: lista los cierres pendientes con mensajero, destino y total general", () => {
    renderModule({
      pendientes: [
        makeResumen({
          cierreId: "c1",
          mensajeroNombre: "Carlos Vega",
          destinoTipo: "bodega_central",
          destinoZonaNombre: "GAM",
          totales: { ...ZERO_TOTALES, general: "500.00" },
        }),
      ],
    });

    const region = screen.getByRole("region", { name: "Pendientes de decisión" });
    expect(within(region).getByText("Carlos Vega")).toBeInTheDocument();
    expect(within(region).getByText("2026-07-11")).toBeInTheDocument();
    expect(
      within(region).getByText("Bodega central · GAM"),
    ).toBeInTheDocument();
    expect(within(region).getByText("₡500.00")).toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: "Ver / decidir" }),
    ).toBeInTheDocument();
  });

  it("R5: el histórico lista cierres resueltos con estado, fecha resuelta y motivo (solo lectura)", () => {
    renderModule({
      historico: [
        makeResumen({
          cierreId: "c2",
          estado: "rechazado",
          mensajeroNombre: "Diana Mora",
          resueltoAt: "2026-07-12T08:00:00.000Z",
          motivoRechazo: "Faltan evidencias",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: "Histórico" });
    expect(within(region).getByText("Rechazado")).toBeInTheDocument();
    expect(within(region).getByText("Diana Mora")).toBeInTheDocument();
    expect(within(region).getByText("2026-07-12")).toBeInTheDocument();
    expect(within(region).getByText("Faltan evidencias")).toBeInTheDocument();
    // Solo lectura: el botón del histórico es "Ver", sin acciones de decisión.
    expect(within(region).getByRole("button", { name: "Ver" })).toBeInTheDocument();
  });

  it("R8/R9: al abrir el detalle muestra los totales snapshot como string (sin reparsear)", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({
        cierreId: "c1",
        totales: {
          efectivo: "100.00",
          simpe: "50.25",
          transferencia: "10.10",
          general: "160.35",
        },
      }),
      grupos: emptyGrupos(),
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    const totales = within(dialog).getByRole("region", {
      name: "Totales del cierre",
    });
    expect(within(totales).getByText("₡100.00")).toBeInTheDocument();
    expect(within(totales).getByText("₡50.25")).toBeInTheDocument();
    expect(within(totales).getByText("₡10.10")).toBeInTheDocument();
    expect(within(totales).getByText("₡160.35")).toBeInTheDocument();
  });

  it("R6/R9: una entrega expone su monto (string) y método en el detalle", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({
        gestionId: "g1",
        resultado: "entregada",
        montoRecibido: "1250.50",
        metodoPago: "SIMPE",
      }),
    ];
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    const region = within(dialog).getByRole("region", { name: "Entregadas" });
    expect(within(region).getByText("₡1250.50")).toBeInTheDocument();
    expect(within(region).getByText("SIMPE")).toBeInTheDocument();
  });

  it("feature 56/R23 (Q6): el badge 'Sin tarifa' se muestra por el flag tarifaFaltante en ENTREGAS", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({
        gestionId: "g1",
        resultado: "entregada",
        numRemision: "REM-SINTARIFA",
        montoRecibido: "1000.00",
        metodoPago: "efectivo",
        pagoMensajero: "0.00",
        tarifaFaltante: true,
      }),
    ];
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    const region = within(dialog).getByRole("region", { name: "Entregadas" });
    expect(within(region).getByText("Sin tarifa")).toBeInTheDocument();
  });

  it("feature 56/R23 (Q6): SIN flag tarifaFaltante NO se muestra el badge, aun con pago 0.00 (entrega y rechazo)", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({
        gestionId: "g1",
        resultado: "entregada",
        numRemision: "REM-ENT",
        montoRecibido: "1000.00",
        metodoPago: "efectivo",
        pagoMensajero: "0.00",
        tarifaFaltante: false,
      }),
    ];
    grupos.rechazada = [
      makeGestion({
        gestionId: "g2",
        resultado: "rechazada",
        numRemision: "REM-REC",
        pagoMensajero: "0.00",
        tarifaFaltante: false,
      }),
    ];
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    expect(within(dialog).queryByText("Sin tarifa")).not.toBeInTheDocument();
  });

  it("feature 56/R23 (Q6): el badge 'Sin tarifa' se muestra por el flag tarifaFaltante también en RECHAZOS", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.rechazada = [
      makeGestion({
        gestionId: "g1",
        resultado: "rechazada",
        numRemision: "REM-REC",
        pagoMensajero: "0.00",
        tarifaFaltante: true,
      }),
    ];
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    const region = within(dialog).getByRole("region", { name: "Rechazadas" });
    expect(within(region).getByText("Sin tarifa")).toBeInTheDocument();
  });

  it("feature 56/R12: una gestión rechazada expone su ingreso de bodega por rechazos (string, money-safe)", async () => {
    const user = userEvent.setup();
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
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    const region = within(dialog).getByRole("region", { name: "Rechazadas" });
    expect(within(region).getByText("₡3500.00")).toBeInTheDocument();
  });

  it("feature 56/R16: el total del ingreso de bodega por rechazos se muestra separado en el detalle", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({
        cierreId: "c1",
        totalIngresoBodegaRechazos: "9200.00",
      }),
      grupos: emptyGrupos(),
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    const region = within(dialog).getByRole("region", {
      name: "Ingreso de bodega por rechazos del cierre",
    });
    expect(within(region).getByText("₡9200.00")).toBeInTheDocument();
  });

  it("R7: la evidencia se muestra vía URL firmada en el visor (nunca el path crudo)", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.rechazada = [
      makeGestion({
        gestionId: "g1",
        resultado: "rechazada",
        motivo: "Dirección inexistente",
        evidenciaUrl: "https://signed.example/evidencia.jpg?token=abc",
      }),
    ];
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    await screen.findByRole("dialog", { name: "Detalle del cierre" });
    await user.click(screen.getByRole("button", { name: "Ver evidencia" }));

    const visor = await screen.findByRole("dialog", {
      name: "Evidencia de la gestión",
    });
    const img = within(visor).getByRole("img", {
      name: "Evidencia fotográfica de la gestión",
    });
    expect(img).toHaveAttribute(
      "src",
      "https://signed.example/evidencia.jpg?token=abc",
    );
  });

  it("R10: aprobar llama a aprobarCierre, muestra éxito y refresca", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({ cierreId: "c1", estado: "solicitado" }),
      grupos: emptyGrupos(),
    });
    aprobarMock.mockResolvedValue({
      status: "ok",
      cierreId: "c1",
      estado: "aprobado",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    await user.click(within(dialog).getByRole("button", { name: "Aprobar" }));

    await vi.waitFor(() =>
      expect(aprobarMock).toHaveBeenCalledWith({ cierreId: "c1" }),
    );
    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("R11: rechazar sin motivo NO llama a la action y muestra el error de validación", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({ cierreId: "c1", estado: "solicitado" }),
      grupos: emptyGrupos(),
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    await user.click(within(dialog).getByRole("button", { name: "Rechazar" }));

    const rechazo = await screen.findByRole("dialog", { name: "Rechazar cierre" });
    // Sin escribir motivo: confirmar bloquea y valida.
    await user.click(
      within(rechazo).getByRole("button", { name: "Rechazar cierre" }),
    );

    expect(
      within(rechazo).getByText("El motivo de rechazo es obligatorio."),
    ).toBeInTheDocument();
    expect(rechazarMock).not.toHaveBeenCalled();
  });

  it("R11: rechazar con motivo llama a rechazarCierre, muestra éxito y refresca", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({ cierreId: "c1", estado: "solicitado" }),
      grupos: emptyGrupos(),
    });
    rechazarMock.mockResolvedValue({
      status: "ok",
      cierreId: "c1",
      estado: "rechazado",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    await user.click(within(dialog).getByRole("button", { name: "Rechazar" }));

    const rechazo = await screen.findByRole("dialog", { name: "Rechazar cierre" });
    await user.type(
      within(rechazo).getByLabelText("Motivo del rechazo"),
      "Montos no cuadran",
    );
    await user.click(
      within(rechazo).getByRole("button", { name: "Rechazar cierre" }),
    );

    await vi.waitFor(() =>
      expect(rechazarMock).toHaveBeenCalledWith({
        cierreId: "c1",
        motivo: "Montos no cuadran",
      }),
    );
    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("R5: un cierre del histórico se abre en solo lectura, sin botones de decisión", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({ cierreId: "c2", estado: "aprobado", resueltoAt: "2026-07-12T00:00:00.000Z" }),
      grupos: emptyGrupos(),
    });
    renderModule({
      historico: [
        makeResumen({ cierreId: "c2", estado: "aprobado", resueltoAt: "2026-07-12T00:00:00.000Z" }),
      ],
    });

    await user.click(screen.getByRole("button", { name: "Ver" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    expect(
      within(dialog).queryByRole("button", { name: "Aprobar" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Rechazar" }),
    ).not.toBeInTheDocument();
  });

  it("aprobar conflict: muestra toast de 'ya resuelto' y refresca", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({ cierreId: "c1", estado: "solicitado" }),
      grupos: emptyGrupos(),
    });
    aprobarMock.mockResolvedValue({ status: "conflict" });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    await user.click(within(dialog).getByRole("button", { name: "Aprobar" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "Este cierre ya fue resuelto por otro administrador.",
      ),
    );
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(successMock).not.toHaveBeenCalled();
  });

  it("abrir detalle no_encontrada: muestra toast accionable y refresca", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({ status: "no_encontrada" });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(
      screen.queryByRole("dialog", { name: "Detalle del cierre" }),
    ).not.toBeInTheDocument();
  });

  // ---------- Feature 41 (F1, R20) ----------

  it("R20: un cierre 'vencido' se muestra en la cola con badge DIFERENCIADO del 'solicitado'", () => {
    renderModule({
      pendientes: [
        makeResumen({
          cierreId: "cv",
          estado: "vencido",
          mensajeroNombre: "Eva Vencida",
        }),
        makeResumen({
          cierreId: "cs",
          estado: "solicitado",
          mensajeroNombre: "Sol Solicita",
        }),
      ],
    });

    const region = screen.getByRole("region", { name: "Pendientes de decisión" });
    // Ambos estados quedan visibles y diferenciados en la misma cola.
    expect(within(region).getByText("Vencido")).toBeInTheDocument();
    expect(within(region).getByText("Solicitado")).toBeInTheDocument();
    expect(within(region).getByText("Eva Vencida")).toBeInTheDocument();
  });

  it("R20: un 'vencido' es RESOLUBLE — su detalle expone aprobar/rechazar", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({ cierreId: "cv", estado: "vencido" }),
      grupos: emptyGrupos(),
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "cv", estado: "vencido" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    expect(
      within(dialog).getByRole("button", { name: "Aprobar" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Rechazar" }),
    ).toBeInTheDocument();
  });

  it("R20: aprobar un 'vencido' llama a aprobarCierre y refresca", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: makeResumen({ cierreId: "cv", estado: "vencido" }),
      grupos: emptyGrupos(),
    });
    aprobarMock.mockResolvedValue({
      status: "ok",
      cierreId: "cv",
      estado: "aprobado",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "cv", estado: "vencido" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    await user.click(within(dialog).getByRole("button", { name: "Aprobar" }));

    await vi.waitFor(() =>
      expect(aprobarMock).toHaveBeenCalledWith({ cierreId: "cv" }),
    );
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});
