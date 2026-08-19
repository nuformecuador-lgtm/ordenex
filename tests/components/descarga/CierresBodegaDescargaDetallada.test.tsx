// @vitest-environment jsdom
// Feature 230 (T7.4) — la descarga DETALLADA montada en el listado de cierres de BODEGA del
// maestro (`CierresBodegaAdminModule`). Cubre R23 y la mitad de UI de R24 y R26.
//
// POR QUÉ HAY DOS MONTAJES Y NO UNO, que es lo que este archivo hace visible: los dos listados
// cubren conjuntos DISJUNTOS (design §2.6). `CierresAdminService.resolveAlcance` le da al maestro
// `{ destinoTipo: "bodega_central" }`, así que en «Cierres del día» solo ve la GAM; los cierres de
// las bodegas satélite le llegan ÚNICAMENTE consolidados, y por aquí. Un solo botón no cubriría
// las dos mitades, y por eso cada uno llama a SU borde.
//
// Lo que sí es común, y también se afirma: el componente del diálogo, las 26 columnas y la
// proyección son los MISMOS que en la otra pantalla (R26).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import type { CierreBodegaResumen } from "@/lib/interfaces/services/ICierreBodegaService";
import type { CierreGestionDescargaDTO } from "@/lib/interfaces/services/ICierresAdminService";
import type { CatalogoFiltrosCierresDTO } from "@/lib/types/filtros-cierres";

vi.mock("@/lib/actions/cierre-bodega", () => ({
  verCierreBodegaDetalle: vi.fn(),
  aprobarCierreBodega: vi.fn(),
  rechazarCierreBodega: vi.fn(),
  listarPendientesCierresBodegaPaginado: vi.fn(),
  listarPendientesCierresBodegaCompleto: vi.fn(),
  listarHistoricoCierresBodegaPaginado: vi.fn(),
  listarHistoricoCierresBodegaCompleto: vi.fn(),
  // Feature 230 (T7.3): el borde de la descarga detallada de ESTA pantalla.
  listarGestionesCierresBodegaCompleto: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/cierres-admin",
  useSearchParams: () => new URLSearchParams(),
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

import {
  listarGestionesCierresBodegaCompleto,
  listarHistoricoCierresBodegaPaginado,
  listarPendientesCierresBodegaCompleto,
  listarPendientesCierresBodegaPaginado,
} from "@/lib/actions/cierre-bodega";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import { CierresBodegaAdminModule } from "@/app/(app)/cierres-admin/_components/CierresBodegaAdminModule";

// --- Datos ----------------------------------------------------------------

const ANA = "11111111-1111-4111-8111-111111111111";
const ZONA = "33333333-3333-4333-8333-333333333333";

const CATALOGO: CatalogoFiltrosCierresDTO = {
  zonas: [{ id: ZONA, nombre: "Limón" }],
  mensajeros: [{ id: ANA, nombre: "Ana Mensajera", zonaId: ZONA }],
};

const TOTALES = {
  efectivo: "1000.10",
  simpe: "0.00",
  transferencia: "0.00",
  general: "1000.10",
};

function cierreBodega(
  cierreBodegaId: string,
  over: Partial<CierreBodegaResumen> = {},
): CierreBodegaResumen {
  return {
    cierreBodegaId,
    zonaId: ZONA,
    zonaNombre: "Limón",
    solicitadoPorId: "u1",
    solicitadoPorNombre: "Sara Satélite",
    estado: "solicitado",
    totales: TOTALES,
    totalPagoMensajero: "100.10",
    totalIngresoBodegaRechazos: "5.00",
    cantidadCierres: 3,
    solicitadoAt: "2026-07-11T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    ...over,
  };
}

const PENDIENTES = [cierreBodega("b1")];
const RESUELTOS = [
  cierreBodega("b2", { estado: "aprobado", resueltoAt: "2026-07-12T10:00:00.000Z" }),
];

/** Una gestión de un cierre del día YA consolidado en un cierre de bodega (R24). */
function gestionConsolidada(): CierreGestionDescargaDTO {
  return {
    mensajeroNombre: "Ana Mensajera",
    cierreSolicitadoAt: "2026-07-11T10:00:00.000Z",
    numGuia: 2002,
    numRemision: "REM-B1",
    destinatario: "Ana Pérez",
    direccion: "Calle 1",
    zonaNombre: "Limón",
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: null,
    producto: "Caja",
    tiendaNombre: "Tienda X",
    resultado: "rechazada",
    montoRecibido: null,
    pagos: [],
    motivo: "Nadie recibió",
    fechaReprogramacion: null,
    esRechazoSla: true,
    causaIncidente: null,
    indemnizacion: null,
    pagoMensajero: "100.10",
    ingresoBodegaRechazo: "12.00",
    ingresoOrdenex: null,
  };
}

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

function montar() {
  vi.mocked(listarPendientesCierresBodegaPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(PENDIENTES),
  });
  vi.mocked(listarHistoricoCierresBodegaPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(RESUELTOS),
  });
  vi.mocked(listarPendientesCierresBodegaCompleto).mockResolvedValue({
    status: "ok",
    items: PENDIENTES,
    total: PENDIENTES.length,
  });
  return envolver(
    <CierresBodegaAdminModule
      pendientes={paginaInicial(PENDIENTES)}
      historico={paginaInicial(RESUELTOS)}
      catalogoFiltros={CATALOGO}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});
afterEach(() => cleanup());

describe("descarga detallada en cierres de bodega (T7.4)", () => {
  it("el listado de cierres de bodega ofrece el control de descarga detallada (R23)", async () => {
    montar();

    expect(
      await screen.findByRole("button", { name: "Descargar Cierres de bodega pendientes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Descargar detallada por mensajero" }),
    ).toBeInTheDocument();
  });

  it("descargar aquí llama al borde de BODEGA y no al de cierres del día (R24/R26)", async () => {
    montar();
    const user = userEvent.setup();
    vi.mocked(listarGestionesCierresBodegaCompleto).mockResolvedValue({
      status: "ok",
      items: [gestionConsolidada()],
      total: 1,
    });

    await user.click(screen.getByRole("button", { name: "Descargar detallada por mensajero" }));
    await user.click(await screen.findByRole("checkbox", { name: "Ana Mensajera" }));
    await user.click(screen.getByRole("button", { name: "Descargar Gestiones de cierres" }));

    await waitFor(() => expect(listarGestionesCierresBodegaCompleto).toHaveBeenCalledTimes(1));
    expect(listarGestionesCierresBodegaCompleto).toHaveBeenCalledWith({ mensajeroIds: [ANA] });
    // El listado general de esta pantalla NO se toca: son dos bordes distintos y dos granos.
    expect(listarPendientesCierresBodegaCompleto).not.toHaveBeenCalled();

    // R26: mismas 26 columnas, mismo orden y misma proyección que en la otra pantalla, porque
    // salen de la MISMA declaración.
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    const [columnas, filas, hoja] = buildXlsxRowsMock.mock.calls[0];
    expect(columnas.map((c) => c.header)).toHaveLength(26);
    expect(columnas[0].header).toBe("Mensajero");
    expect(columnas.map((c) => c.header)).not.toContain("Tiene evidencia");
    expect(hoja).toBe("Gestiones de cierres");
    expect(filas).toHaveLength(1);
    expect(filas[0].numRemision).toBe("REM-B1");
    expect(filas[0].origenRechazo).toBe("Automático");
    expect(descargarBlobMock).toHaveBeenCalledTimes(1);
  });

  it("los cuatro controles de descarga que ya existían siguen en su sitio", async () => {
    // R2/R3 en esta pantalla: la feature añade UNO, no reemplaza ninguno.
    montar();
    const user = userEvent.setup();

    expect(
      await screen.findByRole("button", { name: "Descargar Cierres de bodega pendientes" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Resueltos/ }));
    expect(
      screen.getByRole("button", { name: "Descargar Cierres de bodega resueltos" }),
    ).toBeInTheDocument();
    // Y el detallado sigue estando, sea cual sea la pestaña: su conjunto no depende de ella.
    expect(
      screen.getByRole("button", { name: "Descargar detallada por mensajero" }),
    ).toBeInTheDocument();
  });
});
