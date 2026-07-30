// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import { verCierreDetalle, aprobarCierre } from "@/lib/actions/cierres-admin";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreResultado,
  CierreTotales,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 158 (T2.4 — R34/R19/R20/R36) — el sub-modal de CAPTURA del monto de indemnización
// al aprobar un cierre con incidentes. Espejo del sub-modal de rechazo (38/R11).
//
// Lo que protege este archivo (y ningún test de backend puede protegerlo):
//   - que un cierre CON incidentes NO se apruebe sin pasar por la captura (R34);
//   - que el confirmar esté BLOQUEADO mientras falte o sea inválido algún monto (R34), con
//     el mismo criterio `montoValido` que revalida el servidor;
//   - que el payload enviado sea `{ cierreId, indemnizaciones }` con los montos TAL CUAL
//     (STRING, sin `parseFloat`, sin redondear);
//   - que un cierre SIN incidentes se apruebe exactamente como hoy (R36): mismo payload de
//     la 38, sin campos nuevos;
//   - que los `validation_error` del servidor se pinten POR FILA sin cerrar el sub-modal.
vi.mock("@/lib/actions/cierres-admin", () => ({
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  listarCierresAdmin: vi.fn(),
  forzarSolicitudVencido: vi.fn(),
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

const ZERO_TOTALES: CierreTotales = {
  efectivo: "0.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "0.00",
};

const SUB_MODAL = "Indemnizar los incidentes del cierre";
const CONFIRMAR = "Aprobar e indemnizar";

function makeResumen(over: Partial<CierreAdminResumen> & { cierreId: string }): CierreAdminResumen {
  return {
    mensajeroId: `m-${over.cierreId}`,
    mensajeroNombre: "Ana Mensajera",
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z1",
    destinoZonaNombre: "GAM",
    totales: ZERO_TOTALES,
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    solicitadoAt: "2026-07-30T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    ...over,
  };
}

function makeGestion(
  over: Partial<CierreDetalleGestion> & { gestionId: string; resultado: CierreResultado },
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
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
    ...over,
  };
}

function emptyGrupos(): CierreGrupos {
  return { entregada: [], reprogramada: [], devuelta: [], rechazada: [], incidente: [] };
}

function zeroIngreso(): TotalesIngresoOrdenex {
  return {
    montoCobrar: "0.00",
    fleteConIva: "0.00",
    fleteDevolucionConIva: "0.00",
    comisionConIva: "0.00",
    total: "0.00",
    flete: "0.00",
    ivaFlete: "0.00",
    fleteDevolucion: "0.00",
    ivaFleteDevolucion: "0.00",
    comisionCod: "0.00",
    ivaComisionCod: "0.00",
  };
}

/** Deja listo el detalle que devolverá `verCierreDetalle` con los incidentes indicados. */
function conIncidentes(incidente: CierreDetalleGestion[]) {
  verDetalleMock.mockResolvedValue({
    status: "ok",
    desgloseIngresoBodegaRechazos: { sla: "0.00", manual: "0.00", total: "0.00" },
    cierre: makeResumen({ cierreId: "c1", estado: "solicitado" }),
    grupos: { ...emptyGrupos(), incidente },
    totalesIngreso: zeroIngreso(),
    ganancia: "0.00",
    pagoTienda: "0.00",
  });
}

const INC_1 = makeGestion({
  gestionId: "gi1",
  resultado: "incidente",
  numRemision: "REM-INC-1",
  destinatario: "Beto Ruiz",
  numGuia: 5001,
  motivo: "Caja aplastada",
});
const INC_2 = makeGestion({
  gestionId: "gi2",
  resultado: "incidente",
  numRemision: "REM-INC-2",
  destinatario: "Carla Mora",
  numGuia: 5002,
  motivo: "Robo en la parada",
});

/** Abre el detalle del cierre `c1` y pulsa "Aprobar". */
async function pulsarAprobar(user: ReturnType<typeof userEvent.setup>) {
  render(<CierresAdminModule pendientes={[makeResumen({ cierreId: "c1" })]} historico={[]} sinZona={false} />);
  await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
  const dialog = await screen.findByRole("dialog", { name: "Detalle del cierre" });
  await user.click(within(dialog).getByRole("button", { name: "Aprobar" }));
}

/** Teclea el monto de una gestión en el sub-modal. */
function tecleaMonto(gestionId: string, valor: string) {
  fireEvent.change(document.getElementById(`indemnizacion-${gestionId}`) as HTMLInputElement, {
    target: { value: valor },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  aprobarMock.mockResolvedValue({ status: "ok", cierreId: "c1", estado: "aprobado" });
});

afterEach(() => {
  cleanup();
});

describe("R36 — un cierre SIN incidentes se aprueba exactamente como hoy", () => {
  it("no abre ningún sub-modal y manda el MISMO payload de la 38", async () => {
    const user = userEvent.setup();
    conIncidentes([]);
    await pulsarAprobar(user);

    expect(screen.queryByRole("dialog", { name: SUB_MODAL })).toBeNull();
    await vi.waitFor(() => expect(aprobarMock).toHaveBeenCalledWith({ cierreId: "c1" }));
    // Ni una clave nueva: el contrato de la 38 queda intacto.
    expect(Object.keys(aprobarMock.mock.calls[0][0] as object)).toEqual(["cierreId"]);
    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
  });
});

describe("R34 — con incidentes, aprobar pasa SIEMPRE por la captura del monto", () => {
  it("abre el sub-modal y NO aprueba todavía", async () => {
    const user = userEvent.setup();
    conIncidentes([INC_1]);
    await pulsarAprobar(user);

    expect(await screen.findByRole("dialog", { name: SUB_MODAL })).toBeInTheDocument();
    expect(aprobarMock).not.toHaveBeenCalled();
  });

  it("muestra, por cada incidente, la identificación de la orden y pide su monto", async () => {
    const user = userEvent.setup();
    conIncidentes([INC_1, INC_2]);
    await pulsarAprobar(user);

    const dialog = await screen.findByRole("dialog", { name: SUB_MODAL });
    for (const inc of [INC_1, INC_2]) {
      expect(within(dialog).getByText(`${inc.numRemision} · ${inc.destinatario}`)).toBeInTheDocument();
      expect(
        within(dialog).getByText(new RegExp(`Nº Guía ${inc.numGuia}`)),
      ).toBeInTheDocument();
      // Un campo de monto POR incidente, identificado por su gestión.
      expect(document.getElementById(`indemnizacion-${inc.gestionId}`)).toBeInTheDocument();
    }
    expect(within(dialog).getAllByLabelText("Monto de la indemnización")).toHaveLength(2);
  });

  it("no deja confirmar mientras falte algún monto, y lo dice con TEXTO", async () => {
    const user = userEvent.setup();
    conIncidentes([INC_1, INC_2]);
    await pulsarAprobar(user);
    const dialog = await screen.findByRole("dialog", { name: SUB_MODAL });

    // Sin nada tecleado.
    expect(within(dialog).getByRole("button", { name: CONFIRMAR })).toBeDisabled();
    expect(within(dialog).getByRole("note")).toHaveTextContent(
      "Falta el monto de al menos un incidente",
    );

    // Con UNO de los dos: sigue bloqueado (la cobertura es EXACTA, R19).
    tecleaMonto("gi1", "12500.00");
    expect(within(dialog).getByRole("button", { name: CONFIRMAR })).toBeDisabled();

    // Con los dos: se habilita.
    tecleaMonto("gi2", "300.50");
    expect(within(dialog).getByRole("button", { name: CONFIRMAR })).toBeEnabled();
  });

  it.each([
    ["vacío", ""],
    ["cero", "0"],
    ["cero con decimales", "0.00"],
    ["negativo", "-5.00"],
    ["con 3 decimales", "10.005"],
    ["con coma", "10,50"],
    ["texto", "mucho"],
  ])("un monto %s deja el confirmar deshabilitado (mismo criterio que el servidor)", async (
    _caso,
    valor,
  ) => {
    const user = userEvent.setup();
    conIncidentes([INC_1]);
    await pulsarAprobar(user);
    const dialog = await screen.findByRole("dialog", { name: SUB_MODAL });

    tecleaMonto("gi1", valor);
    expect(within(dialog).getByRole("button", { name: CONFIRMAR })).toBeDisabled();

    // Y aunque se fuerce el click, no llega a la action.
    await user.click(within(dialog).getByRole("button", { name: CONFIRMAR }));
    expect(aprobarMock).not.toHaveBeenCalled();
    cleanup();
  });

  it("envía `{ cierreId, indemnizaciones }` con los montos TAL CUAL (STRING)", async () => {
    const user = userEvent.setup();
    conIncidentes([INC_1, INC_2]);
    await pulsarAprobar(user);
    const dialog = await screen.findByRole("dialog", { name: SUB_MODAL });

    tecleaMonto("gi1", "12500.00");
    tecleaMonto("gi2", "300.50");
    await user.click(within(dialog).getByRole("button", { name: CONFIRMAR }));

    await vi.waitFor(() => expect(aprobarMock).toHaveBeenCalledTimes(1));
    expect(aprobarMock).toHaveBeenCalledWith({
      cierreId: "c1",
      indemnizaciones: [
        { gestionId: "gi1", monto: "12500.00" },
        { gestionId: "gi2", monto: "300.50" },
      ],
    });
    // Money-safe: el monto viaja como STRING, no como number.
    const enviado = aprobarMock.mock.calls[0][0] as {
      indemnizaciones: { monto: unknown }[];
    };
    for (const { monto } of enviado.indemnizaciones) expect(typeof monto).toBe("string");
    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("un monto con espacios sobrantes se envía recortado, no re-formateado", async () => {
    const user = userEvent.setup();
    conIncidentes([INC_1]);
    await pulsarAprobar(user);
    const dialog = await screen.findByRole("dialog", { name: SUB_MODAL });

    tecleaMonto("gi1", "  99.90  ");
    await user.click(within(dialog).getByRole("button", { name: CONFIRMAR }));

    await vi.waitFor(() => expect(aprobarMock).toHaveBeenCalledTimes(1));
    expect(aprobarMock).toHaveBeenCalledWith({
      cierreId: "c1",
      indemnizaciones: [{ gestionId: "gi1", monto: "99.90" }],
    });
  });
});

describe("R19/R21 — los errores del servidor se pintan POR FILA", () => {
  it("un `validation_error` por gestión marca su campo y deja el sub-modal abierto", async () => {
    const user = userEvent.setup();
    conIncidentes([INC_1, INC_2]);
    aprobarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { gi2: ["falta el monto de indemnización de esta gestión"] },
    });
    await pulsarAprobar(user);
    const dialog = await screen.findByRole("dialog", { name: SUB_MODAL });

    tecleaMonto("gi1", "100.00");
    tecleaMonto("gi2", "200.00");
    await user.click(within(dialog).getByRole("button", { name: CONFIRMAR }));

    await vi.waitFor(() => expect(aprobarMock).toHaveBeenCalledTimes(1));
    // El sub-modal SIGUE abierto: cerrarlo obligaría a recapturar todo.
    expect(await screen.findByRole("dialog", { name: SUB_MODAL })).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(document.getElementById("indemnizacion-gi2")).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(document.getElementById("indemnizacion-gi1")).not.toHaveAttribute("aria-invalid");
    expect(
      screen.getAllByRole("alert").some((a) => /falta el monto/i.test(a.textContent ?? "")),
    ).toBe(true);
    // Y NO se declara éxito ni se refresca la ruta: nada se aprobó.
    expect(successMock).not.toHaveBeenCalled();
  });

  it("teclear de nuevo en la fila con error lo limpia (y no toca las otras)", async () => {
    const user = userEvent.setup();
    conIncidentes([INC_1, INC_2]);
    aprobarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: {
        gi1: ["esta gestión no pertenece al cierre"],
        gi2: ["falta el monto de indemnización de esta gestión"],
      },
    });
    await pulsarAprobar(user);
    const dialog = await screen.findByRole("dialog", { name: SUB_MODAL });
    tecleaMonto("gi1", "100.00");
    tecleaMonto("gi2", "200.00");
    await user.click(within(dialog).getByRole("button", { name: CONFIRMAR }));
    await vi.waitFor(() =>
      expect(document.getElementById("indemnizacion-gi1")).toHaveAttribute("aria-invalid", "true"),
    );

    tecleaMonto("gi1", "150.00");

    expect(document.getElementById("indemnizacion-gi1")).not.toHaveAttribute("aria-invalid");
    expect(document.getElementById("indemnizacion-gi2")).toHaveAttribute("aria-invalid", "true");
  });

  it("un `conflict` del servidor sí cierra el detalle y avisa (camino de la 38 intacto)", async () => {
    const user = userEvent.setup();
    conIncidentes([INC_1]);
    aprobarMock.mockResolvedValue({ status: "conflict" });
    await pulsarAprobar(user);
    const dialog = await screen.findByRole("dialog", { name: SUB_MODAL });

    tecleaMonto("gi1", "100.00");
    await user.click(within(dialog).getByRole("button", { name: CONFIRMAR }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: SUB_MODAL })).toBeNull(),
    );
  });
});

describe("R34 — cerrar y reabrir no arrastra montos de otro cierre", () => {
  it("al cerrar el detalle se descartan los montos capturados", async () => {
    const user = userEvent.setup();
    conIncidentes([INC_1]);
    await pulsarAprobar(user);
    await screen.findByRole("dialog", { name: SUB_MODAL });
    tecleaMonto("gi1", "12500.00");

    // Cancelar el sub-modal y cerrar el detalle.
    await user.click(
      within(screen.getByRole("dialog", { name: SUB_MODAL })).getByRole("button", {
        name: "Cancelar",
      }),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "Detalle del cierre" })).getAllByRole("button", {
        name: "Cerrar",
      })[0],
    );

    // Reabrir: el campo vuelve vacío y el confirmar, bloqueado.
    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", { name: "Detalle del cierre" });
    await user.click(within(dialog).getByRole("button", { name: "Aprobar" }));
    const sub = await screen.findByRole("dialog", { name: SUB_MODAL });
    expect(document.getElementById("indemnizacion-gi1")).toHaveValue("");
    expect(within(sub).getByRole("button", { name: CONFIRMAR })).toBeDisabled();
  });
});
