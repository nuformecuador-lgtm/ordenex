// @vitest-environment jsdom
// Feature 205 (T6.3) — el CIERRE, DIRECCIONABLE. Cubre R39, R40, R41, R42 y R45.
//
// El enlace que la wallet pone en cada fila (`/cierres-admin?cierre=<uuid>`) solo vale si el
// destino sabe abrirlo, y lo que lo hace barato es una propiedad que se mide acá: **el detalle
// se pide POR ID, no se lee de ninguna tabla**. Por eso casi todos los casos usan un cierre que
// NO está en las tablas que la pantalla pinta: si alguien «optimizara» buscando la fila en la
// página cargada, el enlace dejaría de funcionar para un cierre del histórico antiguo —que es
// justo el caso normal cuando se paga la deuda vieja de un mensajero— y estos casos caerían.
//
// La segunda propiedad es la de salida (R45): al cerrar, el parámetro se retira de la URL. Sin
// eso, recargar la pantalla reabre un detalle que la persona acaba de cerrar y no hay forma de
// salir de él salvo editando la dirección a mano.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreGrupos,
  CierreTotales,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";

vi.mock("@/lib/actions/cierres-admin", () => ({
  // Feature 230 (T2.3): el borde de la descarga DETALLADA de esta pantalla. Se añade al doble
  // porque el módulo la importa; ninguna aserción de este archivo cambia.
  listarGestionesCierresAdminCompleto: vi.fn(),
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  listarCierresAdmin: vi.fn(),
  forzarSolicitudVencido: vi.fn(),
  listarHistoricoCierresAdminPaginado: vi.fn(),
  listarPendientesCierresAdminPaginado: vi.fn(),
}));

vi.mock("@/lib/actions/liquidacion", () => ({
  registrarPagoMensajeroAction: vi.fn(),
  listarPagosDeCierreAction: vi.fn().mockResolvedValue({ status: "ok", pagos: [] }),
  anularPagoAction: vi.fn(),
}));

const { successMock, errorMock, refreshMock, replaceMock, pushMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
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

/**
 * La URL de la prueba. Es un `let` porque cada caso navega a una dirección distinta y el
 * módulo la lee con `useSearchParams`, igual que en la aplicación.
 */
let parametros = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: pushMock, replace: replaceMock }),
  usePathname: () => "/cierres-admin",
  useSearchParams: () => parametros,
}));

import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import {
  verCierreDetalle,
  listarHistoricoCierresAdminPaginado,
  listarPendientesCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import { PARAM_CIERRE } from "@/app/(app)/cierres-admin/_components/cierre-enlace";

const verDetalleMock = vi.mocked(verCierreDetalle);
const historicoPaginadoMock = vi.mocked(listarHistoricoCierresAdminPaginado);
const pendientesPaginadoMock = vi.mocked(listarPendientesCierresAdminPaginado);

// --- Datos ---------------------------------------------------------------

/** El cierre al que apunta el enlace. NO está en ninguna de las dos tablas, a propósito. */
const CIERRE_ENLAZADO = "cccccccc-3333-4333-8333-cccccccccccc";

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
    totalPagoMensajero: "0.00",
    totalIngresoBodegaRechazos: "0.00",
    pendientePagoMensajero: null,
    solicitadoAt: "2026-07-11T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
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

function detalleOk(cierreId: string, mensajeroNombre = "Zoe del Histórico") {
  return {
    status: "ok" as const,
    desgloseIngresoBodegaRechazos: { sla: "0.00", manual: "0.00", total: "0.00" },
    cierre: makeResumen({ cierreId, mensajeroNombre, estado: "aprobado" }),
    grupos: emptyGrupos(),
    totalesIngreso: zeroIngreso(),
    ganancia: "0.00",
    pagoTienda: "0.00",
    // Feature 264: el contrato del detalle trae SIEMPRE el par (lista, marca). Aqui van en su
    // valor neutro —«registrado, y no hubo ninguna»— porque esta suite mide enlaces profundos,
    // no la seccion; los casos de la seccion viven en su propio archivo.
    ordenesSinGestion: [],
    sinGestionRegistrado: true,
  };
}

/** Monta la pantalla con las dos tablas VACÍAS: nada de lo que se abre sale de una fila. */
function renderModule(pendientes: CierreAdminResumen[] = []) {
  const cola = paginaInicial(pendientes);
  const pagina = paginaInicial([]);
  pendientesPaginadoMock.mockResolvedValue({ status: "ok", page: 1, ...cola });
  historicoPaginadoMock.mockResolvedValue({ status: "ok", page: 1, ...pagina });
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CierresAdminModule
        pendientes={cola}
        historico={pagina}
        sinZona={false}
        puedeRegistrarPago
      />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  parametros = new URLSearchParams();
  verDetalleMock.mockResolvedValue(detalleOk(CIERRE_ENLAZADO));
});

afterEach(() => {
  cleanup();
});

// -------------------------------------------------------------------------

describe("R39/R40 — la dirección abre el detalle de ESE cierre", () => {
  it("con `?cierre=` el detalle se abre solo, y la lectura se pide POR ID", async () => {
    parametros = new URLSearchParams({ [PARAM_CIERRE]: CIERRE_ENLAZADO });
    renderModule();

    expect(
      await screen.findByRole("dialog", { name: "Detalle del cierre" }),
    ).toBeInTheDocument();
    expect(verDetalleMock).toHaveBeenCalledWith({ cierreId: CIERRE_ENLAZADO });
    // El nombre del mensajero del cierre enlazado se lee DENTRO del detalle abierto.
    const dialogo = screen.getByRole("dialog", { name: "Detalle del cierre" });
    expect(within(dialogo).getAllByText(/Zoe del Histórico/).length).toBeGreaterThan(0);
  });

  it("funciona con un cierre que NO está en la página visible", async () => {
    // Las tablas traen OTRO cierre; el enlazado no está en ninguna de las dos. Si el detalle
    // saliera de una fila, acá no habría nada que abrir.
    parametros = new URLSearchParams({ [PARAM_CIERRE]: CIERRE_ENLAZADO });
    renderModule([makeResumen({ cierreId: "otro-cierre", mensajeroNombre: "Ana Mensajera" })]);

    await screen.findByRole("dialog", { name: "Detalle del cierre" });
    expect(verDetalleMock).toHaveBeenCalledTimes(1);
    expect(verDetalleMock).toHaveBeenCalledWith({ cierreId: CIERRE_ENLAZADO });
  });

  it("sin parámetro no se abre nada ni se pide ninguna lectura", async () => {
    renderModule([makeResumen({ cierreId: "otro-cierre" })]);

    // La pantalla pinta cada cierre en la tabla Y en la vista tipo factura, así que el
    // control aparece más de una vez: se espera a que ESTÉ, no a cuántos hay.
    await screen.findAllByRole("button", { name: /Ver \/ decidir/ });
    expect(verDetalleMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Detalle del cierre" })).not.toBeInTheDocument();
  });

  it("se abre UNA vez por navegación, no una por render", async () => {
    parametros = new URLSearchParams({ [PARAM_CIERRE]: CIERRE_ENLAZADO });
    const { rerender } = renderModule();
    await screen.findByRole("dialog", { name: "Detalle del cierre" });

    const cola = paginaInicial([]);
    for (let i = 0; i < 3; i++) {
      rerender(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <CierresAdminModule
            pendientes={cola}
            historico={cola}
            sinZona={false}
            puedeRegistrarPago
          />
        </SWRConfig>,
      );
    }

    expect(verDetalleMock).toHaveBeenCalledTimes(1);
  });
});

describe("R41 — el cierre que no existe o queda fuera de alcance", () => {
  it("avisa y no pinta ni un dato del cierre", async () => {
    verDetalleMock.mockResolvedValue({ status: "no_encontrada" });
    parametros = new URLSearchParams({ [PARAM_CIERRE]: CIERRE_ENLAZADO });
    renderModule();

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "El cierre ya no está disponible. Actualizando la lista.",
      ),
    );
    expect(screen.queryByRole("dialog", { name: "Detalle del cierre" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Zoe del Histórico/)).not.toBeInTheDocument();
  });

  it("una sesión caída se dice como tal, sin dejar la pantalla rota", async () => {
    verDetalleMock.mockResolvedValue({ status: "unauthenticated" });
    parametros = new URLSearchParams({ [PARAM_CIERRE]: CIERRE_ENLAZADO });
    renderModule();

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("Tu sesión expiró. Iniciá sesión de nuevo."),
    );
    // La pantalla sigue en pie: las dos secciones se siguen viendo.
    expect(screen.getByRole("region", { name: "Pendientes de decisión" })).toBeInTheDocument();
  });
});

describe("R45 — al cerrar, la dirección deja de nombrar el cierre", () => {
  it("cerrar el detalle abierto por enlace retira el parámetro de la URL", async () => {
    const user = userEvent.setup();
    parametros = new URLSearchParams({ [PARAM_CIERRE]: CIERRE_ENLAZADO });
    renderModule();

    const dialogo = await screen.findByRole("dialog", { name: "Detalle del cierre" });
    await user.click(within(dialogo).getByRole("button", { name: "Cerrar" }));

    expect(replaceMock).toHaveBeenCalledWith("/cierres-admin", { scroll: false });
  });

  it("conserva los demás parámetros de la dirección", async () => {
    const user = userEvent.setup();
    parametros = new URLSearchParams({ tab: "historico", [PARAM_CIERRE]: CIERRE_ENLAZADO });
    renderModule();

    const dialogo = await screen.findByRole("dialog", { name: "Detalle del cierre" });
    await user.click(within(dialogo).getByRole("button", { name: "Cerrar" }));

    expect(replaceMock).toHaveBeenCalledWith("/cierres-admin?tab=historico", {
      scroll: false,
    });
  });

  it("el detalle abierto desde la TABLA no toca la URL al cerrarse", async () => {
    // No hay parámetro que limpiar: navegar sin motivo borraría el estado de la pantalla.
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue(detalleOk("c1", "Ana Mensajera"));
    renderModule([makeResumen({ cierreId: "c1" })]);

    const controles = await screen.findAllByRole("button", { name: /Ver \/ decidir/ });
    await user.click(controles[0]);
    const dialogo = await screen.findByRole("dialog", { name: "Detalle del cierre" });
    await user.click(within(dialogo).getByRole("button", { name: "Cerrar" }));

    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe("el enlace y quien lo construye hablan del MISMO parámetro", () => {
  it("el módulo lee la clave que escribe el constructor del enlace", async () => {
    // Sin esto, renombrar el parámetro en un solo lado dejaría el enlace apuntando a algo que
    // nadie lee: la pantalla abriría sin detalle y ningún test de la otra mitad lo vería.
    const { hrefDetalleCierre } = await import(
      "@/app/(app)/cierres-admin/_components/cierre-enlace"
    );
    const href = hrefDetalleCierre(CIERRE_ENLAZADO);
    const [, query] = href.split("?");
    parametros = new URLSearchParams(query);
    renderModule();

    await screen.findByRole("dialog", { name: "Detalle del cierre" });
    expect(verDetalleMock).toHaveBeenCalledWith({ cierreId: CIERRE_ENLAZADO });
  });
});
