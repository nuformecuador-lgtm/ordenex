// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CierreDiaModule } from "@/app/(app)/cierre-dia/_components/CierreDiaModule";
import { deshacerGestion, solicitarCierre } from "@/lib/actions/cierre-dia";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreTotales,
  CierreResultado,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 158 (T2.2 — R18/R17/Q-D) — el grupo "Incidentes" en el detalle del cierre del
// MENSAJERO. Lo que este archivo protege:
//   - que el grupo existe, tiene etiqueta legible en español y es PROPIO (R18);
//   - que NO trae ninguna columna de dinero (R17): un incidente no se paga al mensajero, y
//     la indemnización es plata de la tienda que él no ve (design §7.2);
//   - que el "Devolver a gestión" SÍ se ofrece sobre un incidente (Q-D/R14: se puede deshacer);
//   - que el grupo vacío NO se pinta (patrón de la 37).
vi.mock("@/lib/actions/cierre-dia", () => ({
  solicitarCierre: vi.fn(),
  listarCierreDia: vi.fn(),
  deshacerGestion: vi.fn(),
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

const deshacerMock = vi.mocked(deshacerGestion);
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
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false,
    // Feature 158/R9/R19: campos POR RAMA del incidente; los casos del incidente los
    // sobreescriben.
    causaIncidente: null,
    indemnizacion: null,
    ...over,
  };
}

function emptyGrupos(): CierreGrupos {
  return { entregada: [], reprogramada: [], devuelta: [], rechazada: [], incidente: [] };
}

const ZERO_TOTALES: CierreTotales = {
  efectivo: "0.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "0.00",
};

function renderModule(grupos: CierreGrupos) {
  render(
    <CierreDiaModule
      grupos={grupos}
      totales={ZERO_TOTALES}
      totalPagoMensajero="0.00"
      puedesSolicitar
      motivoBloqueo={null}
      cierresPasados={[]}
      bloqueado={false}
      tieneVencido={false}
      tieneRechazado={false}
    />,
  );
}

/** Un incidente del día, con su motivo y su evidencia ya firmada por el servidor. */
function incidente(over: Partial<CierreDetalleGestion> = {}): CierreDetalleGestion {
  return makeGestion({
    gestionId: "gi1",
    resultado: "incidente",
    numRemision: "REM-INC",
    destinatario: "Beto Ruiz",
    motivo: "Caja aplastada en el furgón",
    evidenciaUrl: "https://signed.example/inc.jpg?token=abc",
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  deshacerMock.mockResolvedValue({ status: "ok", ordenId: "o-gi1" });
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

describe("R18 — el incidente es un grupo PROPIO del detalle del mensajero", () => {
  it('pinta la sección "Incidentes" con su etiqueta en español y el conteo', () => {
    renderModule({ ...emptyGrupos(), incidente: [incidente()] });

    const region = screen.getByRole("region", { name: "Incidentes" });
    expect(region).toBeInTheDocument();
    expect(within(region).getByRole("heading", { name: /Incidentes/ })).toHaveTextContent("(1)");
    expect(within(region).getByText("REM-INC")).toBeInTheDocument();
    expect(within(region).getByText("Caja aplastada en el furgón")).toBeInTheDocument();
  });

  it("NO se mezcla con las devoluciones ni con los rechazos", () => {
    renderModule({
      ...emptyGrupos(),
      devuelta: [makeGestion({ gestionId: "gd", resultado: "devuelta", numRemision: "REM-DEV" })],
      incidente: [incidente()],
    });

    const incidentes = screen.getByRole("region", { name: "Incidentes" });
    const devueltas = screen.getByRole("region", { name: "Devueltas" });
    expect(within(incidentes).getByText("REM-INC")).toBeInTheDocument();
    expect(within(incidentes).queryByText("REM-DEV")).toBeNull();
    expect(within(devueltas).queryByText("REM-INC")).toBeNull();
  });

  it("el grupo VACÍO no se pinta (patrón de la 37)", () => {
    renderModule(emptyGrupos());
    expect(screen.queryByRole("region", { name: "Incidentes" })).toBeNull();
  });

  it("la evidencia se abre desde la URL FIRMADA que llega del servidor", async () => {
    const user = userEvent.setup();
    renderModule({ ...emptyGrupos(), incidente: [incidente()] });

    const region = screen.getByRole("region", { name: "Incidentes" });
    await user.click(within(region).getByRole("button", { name: "Ver evidencia" }));

    const dialog = await screen.findByRole("dialog", { name: "Evidencia de la gestión" });
    expect(within(dialog).getByRole("img")).toHaveAttribute(
      "src",
      "https://signed.example/inc.jpg?token=abc",
    );
  });
});

describe("R17 — el incidente no muestra dinero en la vista del mensajero", () => {
  it("la tabla de incidentes NO tiene columna de ganancia ni de ningún monto", () => {
    // El snapshot de dinero de un incidente es 0.00 (backend). Aun así NO se pinta: un
    // "₡0.00" en la fila se lee como "me pagaron cero por esto", que no es lo que pasó.
    renderModule({
      ...emptyGrupos(),
      incidente: [incidente({ pagoMensajero: "0.00", montoRecibido: "0.00" })],
    });

    const tabla = screen.getByRole("table", { name: "Incidentes" });
    const cabeceras = within(tabla)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(cabeceras).not.toContain("Ganancia");
    expect(cabeceras).not.toContain("Monto");
    expect(cabeceras).not.toContain("Método");
    // Y ningún importe en el cuerpo de la tabla.
    expect(within(tabla).queryByText(/₡/)).toBeNull();
  });

  it("tampoco trae la columna del MONTO de la indemnización (no es plata suya)", () => {
    // El backend lo garantiza en la CONSULTA (`WITH_DETALLE` ni selecciona la columna), así
    // que aquí el dato es SIEMPRE `null`. Este caso fija la otra mitad: que la pantalla del
    // mensajero tampoco intente pintarlo. Si alguien añadiera la columna, mostraría un "—"
    // permanente que se leería como «me deben algo y todavía no me lo pagan».
    renderModule({ ...emptyGrupos(), incidente: [incidente()] });

    const cabeceras = within(screen.getByRole("table", { name: "Incidentes" }))
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(cabeceras).not.toContain("Indemnización");
  });

  it("la sección de una ENTREGA sí conserva sus columnas de dinero (no regresión)", () => {
    renderModule({
      ...emptyGrupos(),
      entregada: [
        makeGestion({
          gestionId: "ge",
          resultado: "entregada",
          montoRecibido: "150.00",
          metodoPago: "efectivo",
          pagoMensajero: "12.00",
        }),
      ],
    });

    const tabla = screen.getByRole("table", { name: "Entregadas" });
    const cabeceras = within(tabla)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(cabeceras).toContain("Ganancia");
    expect(cabeceras).toContain("Monto");
    expect(within(tabla).getByText("₡150.00")).toBeInTheDocument();
  });
});

describe("R9 — el mensajero SÍ ve la causa que él mismo reportó", () => {
  it.each([
    ["danado", "Paquete dañado"],
    ["perdido", "Paquete perdido"],
    ["robado", "Paquete robado"],
  ] as const)("causa `%s` se muestra como «%s», nunca el slug", (value, etiqueta) => {
    // El backend selecciona la causa en la consulta del mensajero A PROPÓSITO (a diferencia
    // del monto, que ni siquiera pide): es el hecho que él reportó, no dinero. Sin esta
    // columna ese `select` no lo vería nadie y sería código muerto.
    renderModule({ ...emptyGrupos(), incidente: [incidente({ causaIncidente: value })] });

    const tabla = screen.getByRole("table", { name: "Incidentes" });
    expect(within(tabla).getByText(etiqueta)).toBeInTheDocument();
    expect(tabla.textContent).not.toMatch(/danado/);
    cleanup();
  });

  it("la columna de causa NO aparece en los otros cuatro resultados", () => {
    renderModule({
      ...emptyGrupos(),
      devuelta: [makeGestion({ gestionId: "gd", resultado: "devuelta" })],
    });

    const cabeceras = within(screen.getByRole("table", { name: "Devueltas" }))
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(cabeceras).not.toContain("Causa");
  });
});

describe("Q-D/R14 — un incidente SE PUEDE deshacer desde el detalle", () => {
  it("ofrece 'Devolver a gestión' en la fila del incidente y llama a la action", async () => {
    const user = userEvent.setup();
    renderModule({ ...emptyGrupos(), incidente: [incidente()] });

    const region = screen.getByRole("region", { name: "Incidentes" });
    await user.click(
      within(region).getByRole("button", {
        name: "Devolver a gestión la orden REM-INC · Beto Ruiz",
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Devolver la orden a gestión" });
    await user.click(within(dialog).getByRole("button", { name: "Devolver a gestión" }));

    await vi.waitFor(() => expect(deshacerMock).toHaveBeenCalledWith({ gestionId: "gi1" }));
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});
