// @vitest-environment jsdom
// Feature 170 (T E.6) — descarga de las DOS tablas de la cola de incidentes: pendientes de
// decisión e histórico de resueltos. Cubre R1, R8, R11, R14, R20, R22, R30 y R32.
//
// El dato caliente aquí es `evidenciaUrls`: un incidente llega con URL FIRMADAS de sus fotos.
// La tabla no las muestra (se ven en el detalle) y el archivo tampoco puede llevarlas — un
// `xlsx` reenviado por correo con una URL firmada dentro es acceso a la foto sin sesión.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows, XLSX_MIME } from "@/lib/utils/xlsx-template";
import type { IncidenteAdminDTO } from "@/lib/interfaces/services/IIncidenteAdminService";
import { listarIncidentes, listarHistoricoIncidentesPaginado } from "@/lib/actions/incidentes";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";

vi.mock("@/lib/actions/incidentes", () => ({
  aprobarIncidente: vi.fn(),
  rechazarIncidente: vi.fn(),
  retractarIncidente: vi.fn(),
  verIncidente: vi.fn(),
  listarIncidentes: vi.fn(),
  // Feature 170 — FASE 2 (T I.2): el histórico llega paginado del servidor.
  listarHistoricoIncidentesPaginado: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { IncidentesAdminModule } from "@/app/(app)/incidentes/_components/IncidentesAdminModule";

/** URL FIRMADA de evidencia: lo que NO puede acabar en el archivo (R22). */
const EVIDENCIA_FIRMADA =
  "https://storage.example/storage/v1/evidencias/incidente.jpg?token=secreto";

function incidente(
  over: Partial<IncidenteAdminDTO> & { incidenteId: string },
): IncidenteAdminDTO {
  return {
    ordenId: `o-${over.incidenteId}`,
    numGuia: 1001,
    numRemision: `REM-${over.incidenteId}`,
    destinatario: "Ana Pérez",
    zonaNombre: "Limón",
    estatusValue: "incidente",
    causa: "robado",
    motivo: "Robo en la parada",
    estado: "solicitado",
    indemnizacion: null,
    reportadoPorNombre: "Beto Mensajero",
    resueltoPorNombre: null,
    resueltoAt: null,
    motivoRechazo: null,
    createdAt: "2026-07-11T10:00:00.000Z",
    evidenciaUrls: [EVIDENCIA_FIRMADA],
    esPropio: false,
    ...over,
  };
}

const PENDIENTES = [
  incidente({ incidenteId: "i1" }),
  incidente({ incidenteId: "i2", causa: "danado", destinatario: "Beto Cliente" }),
];
const HISTORICO = [
  incidente({
    incidenteId: "i3",
    estado: "aprobado",
    causa: "perdido",
    indemnizacion: "2500.10",
    resueltoPorNombre: "Maestra Ordenex",
    resueltoAt: "2026-07-12T10:00:00.000Z",
  }),
  incidente({
    incidenteId: "i4",
    estado: "rechazado",
    resueltoPorNombre: "Maestra Ordenex",
    resueltoAt: "2026-07-13T10:00:00.000Z",
    motivoRechazo: "No procede",
  }),
];

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/**
 * Feature 170 — FASE 2 (T I.2): el histórico se pinta desde la PÁGINA, y su descarga RELEE el
 * conjunto completo del servidor (R52). El helper programa las dos lecturas con los mismos
 * datos: la página que se ve y el conjunto que se descarga.
 */
function renderIncidentes(
  pendientes = PENDIENTES,
  historico = HISTORICO,
  historicoCompleto = historico,
) {
  const pagina = paginaInicial(historico, { total: historicoCompleto.length });
  vi.mocked(listarHistoricoIncidentesPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...pagina,
  });
  vi.mocked(listarIncidentes).mockResolvedValue({
    status: "ok",
    pendientes,
    historico: historicoCompleto,
    sinZona: false,
  });
  return envolver(
    <IncidentesAdminModule
      pendientes={pendientes}
      historico={pagina}
      sinZona={false}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Incidentes · descarga", () => {
  it("las dos tablas ofrecen su control, con nombres accesibles distintos", async () => {
    // R1/R13: las dos viven en la MISMA pantalla, así que sus controles no pueden llamarse
    // igual. Y no se llaman como los encabezados ("Pendientes de decisión" / "Histórico"),
    // que son genéricos: el archivo tiene que decir de qué es.
    renderIncidentes();

    expect(
      screen.getByRole("button", { name: "Descargar Incidentes pendientes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Descargar Incidentes resueltos" }),
    ).toBeInTheDocument();
  });

  it("cada archivo trae SU tabla entera, en el orden de la pantalla", async () => {
    // R11/R30: Familia B — el array de props es el conjunto completo (la página no pagina),
    // así que el archivo es exactamente lo que la tabla pinta, en el mismo orden.
    const user = userEvent.setup();
    renderIncidentes();

    const tabla = screen.getByRole("table", { name: "Pendientes de decisión" });
    expect(within(tabla).getAllByRole("row")).toHaveLength(PENDIENTES.length + 1);

    await user.click(screen.getByRole("button", { name: "Descargar Incidentes pendientes" }));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas, titulo] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(PENDIENTES.length);
    expect(filas.map((f) => f.numRemision)).toEqual(PENDIENTES.map((i) => i.numRemision));
    expect(titulo).toBe("Incidentes pendientes");

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    const [, mime, nombreArchivo] = descargarBlobMock.mock.calls[0];
    expect(mime).toBe(XLSX_MIME);
    expect(nombreArchivo).toMatch(/^incidentes-pendientes-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("estados y causas salen como etiqueta legible, nunca el slug del enum", async () => {
    // R8. Un archivo que dijera `perdido` o `rechazado` obligaría a traducir a mano lo que
    // la pantalla ya traduce. Y la indemnización viaja money-safe: STRING tal cual.
    const user = userEvent.setup();
    renderIncidentes();

    await user.click(screen.getByRole("button", { name: "Descargar Incidentes resueltos" }));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas[0].estado).toBe("Aprobado");
    expect(filas[0].causa).toBe("Paquete perdido");
    expect(filas[0].indemnizacion).toBe("2500.10");
    expect(String(filas[0].indemnizacion)).not.toContain("₡");
    // Un rechazado no tiene monto: celda VACÍA, que NO es lo mismo que un cero.
    expect(filas[1].estado).toBe("Rechazado");
    expect(filas[1].indemnizacion).toBeNull();
    expect(filas[1].motivo).toBe("No procede");
  });

  it("ninguna URL firmada ni ruta de almacenamiento llega al archivo", async () => {
    // R22: el DTO trae `evidenciaUrls` firmadas; ni la tabla ni el archivo las muestran.
    const user = userEvent.setup();
    renderIncidentes();

    for (const control of ["Incidentes pendientes", "Incidentes resueltos"]) {
      await user.click(screen.getByRole("button", { name: `Descargar ${control}` }));
      await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalled());

      const [, filas] = buildXlsxRowsMock.mock.calls.at(-1)!;
      for (const fila of filas) {
        for (const celda of Object.values(fila)) {
          const texto = String(celda ?? "");
          expect(texto, `${control}: celda con URL`).not.toMatch(/https?:\/\//i);
          expect(texto, `${control}: celda con ruta de almacén`).not.toMatch(
            /(^|\/)(storage|buckets?|evidencias?|uploads?)\//i,
          );
          expect(texto).not.toContain("token=");
        }
      }
    }
  });

  it("el archivo del adminSatelite solo trae los incidentes de su alcance", async () => {
    // R14/R20: el acotamiento por zona lo pone el SERVIDOR (la página del adminSatelite solo
    // recibe los suyos). Lo que se fija aquí es que la descarga no lo amplía: el archivo es
    // exactamente el conjunto recibido por props, ni una fila más.
    const user = userEvent.setup();
    const soloSuZona = [incidente({ incidenteId: "iz", zonaNombre: "Limón" })];
    renderIncidentes(soloSuZona, []);

    await user.click(screen.getByRole("button", { name: "Descargar Incidentes pendientes" }));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(1);
    expect(filas[0].zona).toBe("Limón");
    expect(filas[0].numRemision).toBe(soloSuZona[0].numRemision);
  });
});
