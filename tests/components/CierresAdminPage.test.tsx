// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { RolValue } from "@prisma/client";

import CierresAdminPage from "@/app/(app)/cierres-admin/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarCierresAdmin,
  verCierreDetalle,
  aprobarCierre,
  listarPendientesCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import {
  listarConsolidacion,
  listarCierresBodegaAdmin,
} from "@/lib/actions/cierre-bodega";
import { registrarPagoMensajeroAction } from "@/lib/actions/liquidacion";
import { REGISTRAR_PAGO_TEXTO } from "@/components/shared/liquidacion/liquidacion-labels";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreGrupos,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 38 (T12, R1/R3) — la página resuelve el rol SOLO server-side; rol ∉
// {maestro, adminSatelite} (o sin sesión) → `notFound`. Se mockean el resolver, la
// action de listado y next/navigation (notFound lanza; useRouter lo consume el
// módulo cliente).
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));
vi.mock("@/lib/actions/cierres-admin", () => ({
  listarCierresAdmin: vi.fn(),
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  // Feature 111/R16: válvula de escape consumida por el módulo hijo.
  forzarSolicitudVencido: vi.fn(),
  // Feature 170 — FASE 2 (T I.2 el histórico, T J.2 la cola): la página pre-carga la PÁGINA 1
  // de las DOS tablas.
  listarHistoricoCierresAdminPaginado: vi.fn(async () => ({
    status: "ok" as const,
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  })),
  listarPendientesCierresAdminPaginado: vi.fn(async () => ({
    status: "ok" as const,
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  })),
  // Pedido humano del 2026-08-16: la página resuelve también el catálogo de los filtros
  // (bodegas destino y mensajeros del alcance), en el mismo `Promise.all` que las dos páginas.
  obtenerCatalogoFiltrosCierres: vi.fn(async () => ({
    status: "ok" as const,
    catalogo: { zonas: [], mensajeros: [] },
  })),
}));
// Feature 40: la página, role-aware, pre-fetch los datos de cierre de bodega por rol
// (adminSatelite → consolidación; maestro → cola/histórico). Se mockean para aislar
// el control de acceso de la 38; por defecto `forbidden` → no se renderiza la sección.
vi.mock("@/lib/actions/cierre-bodega", () => ({
  listarConsolidacion: vi.fn(),
  listarCierresBodegaAdmin: vi.fn(),
  solicitarCierreBodega: vi.fn(),
  verCierreBodegaDetalle: vi.fn(),
  aprobarCierreBodega: vi.fn(),
  rechazarCierreBodega: vi.fn(),
  // Feature 170 — FASE 2 (T I.2): los dos históricos de bodega también llegan paginados.
  listarHistoricoCierresBodegaPaginado: vi.fn(async () => ({
    status: "ok" as const,
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  })),
  listarCierresBodegaSolicitadosPaginado: vi.fn(async () => ({
    status: "ok" as const,
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  })),
  // Feature 170 — FASE 2 (T J.2): las dos COLAS de esta pantalla también llegan paginadas.
  listarPendientesCierresBodegaPaginado: vi.fn(async () => ({
    status: "ok" as const,
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  })),
  listarConsolidablesPaginado: vi.fn(async () => ({
    status: "ok" as const,
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  })),
}));

// Feature 172 (bloqueante 2 del review) — las acciones de LIQUIDACIÓN que cuelgan del
// módulo de esta página (el diálogo de pago y la sección de comprobantes). Se doblan para
// que ninguna llegue al servidor y, sobre todo, para poder afirmar que a un `adminSatelite`
// NO se le llama ninguna.
vi.mock("@/lib/actions/liquidacion", () => ({
  registrarPagoMensajeroAction: vi.fn(),
  listarPagosDeCierreAction: vi.fn(async () => ({
    status: "ok" as const,
    pagos: [],
  })),
  anularPagoAction: vi.fn(),
}));

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
// El `refresh` va en un doble COMPARTIDO (y no uno nuevo por render) porque es el
// marcador de que la aprobación ya se declaró: la rama que decide si se ofrece pagar
// corre justo después de él. Sin poder esperarlo, un «no aparece el diálogo» sería
// indistinguible de un «todavía no apareció».
const { refreshMock, pushMock, successMock, errorMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  pushMock: vi.fn(),
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  useRouter: () => ({ refresh: refreshMock, push: pushMock }),
  // Feature 205 (T6.1): el modulo lee `?cierre=` para abrir un detalle por enlace, asi que
  // el doble de `next/navigation` tiene que exportar tambien estos dos. Cambio del ARNES:
  // ninguna asercion de este archivo se toca.
  usePathname: () => "/cierres-admin",
  useSearchParams: () => new URLSearchParams(),
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

const resolveActorMock = vi.mocked(resolveActorFromSession);
const listarMock = vi.mocked(listarCierresAdmin);
const listarConsolidacionMock = vi.mocked(listarConsolidacion);
const listarCierresBodegaAdminMock = vi.mocked(listarCierresBodegaAdmin);
const verDetalleMock = vi.mocked(verCierreDetalle);
const aprobarMock = vi.mocked(aprobarCierre);
const pendientesPaginadoMock = vi.mocked(listarPendientesCierresAdminPaginado);
const registrarPagoMock = vi.mocked(registrarPagoMensajeroAction);

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue({
    status: "ok",
    pendientes: [],
    historico: [],
    sinZona: false,
  });
  // Feature 40: por defecto sin sección de cierre de bodega (aísla el control de
  // acceso de la 38); cada test que la necesite sobreescribe con `status: "ok"`.
  listarConsolidacionMock.mockResolvedValue({ status: "forbidden" });
  listarCierresBodegaAdminMock.mockResolvedValue({ status: "forbidden" });
});

afterEach(() => {
  cleanup();
});

describe("CierresAdminPage — control de acceso por rol (R1)", () => {
  it("R1: el rol maestro ve el módulo con su título y secciones", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });

    const page = await CierresAdminPage();
    render(page);

    expect(
      screen.getByRole("heading", { level: 1, name: "Cierres del día" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Pendientes de decisión" }),
    ).toBeInTheDocument();

    // Pedido humano del 2026-08-16: la pantalla se divide en BODEGA / MENSAJERO, y dentro de
    // cada una en PENDIENTES / RESUELTOS. Al entrar se ve «Mensajero → Pendientes», que es lo
    // que esta pantalla dice ser; el histórico está a un clic, y este caso lo da para
    // comprobar que sigue estando y que el conmutador es el que lo trae.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Resueltos/ }));
    expect(screen.getByRole("region", { name: "Histórico" })).toBeInTheDocument();

    // Y las dos mitades existen: el conmutador de arriba ofrece la de bodega.
    expect(screen.getByRole("group", { name: "Tipo de cierre" })).toBeInTheDocument();
  });

  it("R1: el rol adminSatelite ve el módulo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u2", rol: "adminSatelite" });

    const page = await CierresAdminPage();
    render(page);

    expect(
      screen.getByRole("region", { name: "Pendientes de decisión" }),
    ).toBeInTheDocument();
  });

  it("R1 (feature 94, paridad adm↔maestro): el rol admin ve el módulo igual que el maestro", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u3", rol: "admin" });

    const page = await CierresAdminPage();
    render(page);

    expect(
      screen.getByRole("heading", { level: 1, name: "Cierres del día" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Pendientes de decisión" }),
    ).toBeInTheDocument();
  });

  it("R1: roles sin acceso NO ven el módulo (notFound)", async () => {
    // Feature 94: `admin` YA no está aquí (ve el módulo, test aparte). Siguen excluidos
    // el mensajero y el adminTienda.
    const otros: RolValue[] = ["mensajero", "adminTienda"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(CierresAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // No debe consultar el listado si el rol no está autorizado.
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("R1: sin actor autenticado NO ve el módulo (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(CierresAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R1: si el listado responde forbidden, tampoco renderiza el módulo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    await expect(CierresAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R3: adminSatelite sin zona → estado vacío accionable, sin tablas de acción", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u2", rol: "adminSatelite" });
    listarMock.mockResolvedValue({
      status: "ok",
      pendientes: [],
      historico: [],
      sinZona: true,
    });

    const page = await CierresAdminPage();
    render(page);

    expect(
      screen.getByRole("alert"),
    ).toHaveTextContent("No tenés una zona asignada; contactá a tu administrador.");
    // Sin zona: NO se muestran las tablas de acción (R3).
    expect(
      screen.queryByRole("region", { name: "Pendientes de decisión" }),
    ).not.toBeInTheDocument();
  });
});

// =========================================================================
// Feature 172 ([P3]/R6) — el eslabón ROL → PROP, medido donde vive
// =========================================================================
//
// `CierresAdminPagoMensajero.test.tsx` mide que el módulo respeta su prop
// `puedeRegistrarPago`; lo que no medía nadie es QUIÉN produce esa prop. El eslabón que
// convierte «adminSatelite» en «no se le ofrece pagar» es una línea de esta página
// (`puedeRegistrarPago={esAccesoTotal(actor.rol)}`), y ponerla en `true` no rompía ni un
// test de la suite: la decisión del humano estaba afirmada contra una prop, no contra el rol.
//
// Aquí se monta la PÁGINA REAL con el rol de verdad y se aprueba un cierre con pendiente
// > 0, que es el único punto donde ese eslabón se vuelve visible. La respuesta P3 dice que
// `adminSatelite` APRUEBA los cierres de su zona y NO mueve dinero: aprobar un cierre y
// mover dinero no son la misma responsabilidad. Las dos mitades se miden juntas —que
// apruebe y que no se le ofrezca—, porque «no se le ofrece» solo significa algo si el
// cierre quedó aprobado igual que antes de la 172.
//
// La otra mitad del control de acceso (la acción respondiendo `forbidden` a `adminSatelite`)
// vive en `tests/unit/services/liquidacion-service.test.ts`; ocultar el botón no es un
// control de acceso por sí solo, y la acción tampoco lo es sin la otra.
describe("CierresAdminPage — Feature 172 [P3]/R6: quién recibe la oferta de pago sale del ROL", () => {
  const MENSAJERO = "Ana Mensajera";
  /** Nombre accesible del diálogo de pago, tomado del catálogo real (i18n-ready). */
  const DIALOGO_PAGO = REGISTRAR_PAGO_TEXTO.titulo(MENSAJERO);
  /** Lo que el SERVIDOR devuelve como pendiente al aprobar: hay dinero sobre la mesa. */
  const PENDIENTE = "50000.00";

  const CIERRE: CierreAdminResumen = {
    cierreId: "c1",
    mensajeroId: "m1",
    mensajeroNombre: MENSAJERO,
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z1",
    destinoZonaNombre: "GAM",
    totales: {
      efectivo: "0.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "0.00",
    },
    totalPagoMensajero: PENDIENTE,
    totalIngresoBodegaRechazos: "0.00",
    // Un cierre sin aprobar no tiene pendiente por contrato (T C.2/R28): el valor bueno
    // es el que devuelve `aprobarCierre`.
    pendientePagoMensajero: null,
    solicitadoAt: "2026-07-30T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
  };

  const GRUPOS_VACIOS: CierreGrupos = {
    entregada: [],
    reprogramada: [],
    devuelta: [],
    rechazada: [],
    incidente: [],
  };

  const INGRESO_CERO: TotalesIngresoOrdenex = {
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

  /**
   * Monta la página REAL con ese rol y aprueba el cierre `c1` de la cola. Devuelve cuando la
   * aprobación ya se declaró y el detalle se cerró — es decir, PASADA la rama que decide si
   * se ofrece pagar. Sin ese punto de espera, la ausencia del diálogo no probaría nada.
   */
  async function aprobarUnCierreComo(rol: RolValue) {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
    const cola = paginaInicial([CIERRE]);
    pendientesPaginadoMock.mockResolvedValue({ status: "ok", page: 1, ...cola });
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: CIERRE,
      // Sin incidentes: aprobar no pasa por el sub-modal de la 158 (R36).
      grupos: GRUPOS_VACIOS,
      totalesIngreso: INGRESO_CERO,
      desgloseIngresoBodegaRechazos: { sla: "0.00", manual: "0.00", total: "0.00" },
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    aprobarMock.mockResolvedValue({
      status: "ok",
      cierreId: CIERRE.cierreId,
      estado: "aprobado",
      pendientePagoMensajero: PENDIENTE,
    });

    const user = userEvent.setup();
    const page = await CierresAdminPage();
    // Caché de SWR propia de este render: la página no la aísla y los otros tests del
    // archivo comparten la global.
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        {page}
      </SWRConfig>,
    );

    await user.click(await screen.findByRole("button", { name: "Ver / decidir" }));
    const detalle = await screen.findByRole("dialog", { name: "Detalle del cierre" });
    await user.click(within(detalle).getByRole("button", { name: "Aprobar" }));

    // El cierre queda aprobado —y el mensajero libre, feature 111— pase lo que pase con el
    // pago, y con el MISMO payload de la 38.
    await waitFor(() => expect(aprobarMock).toHaveBeenCalledWith({ cierreId: "c1" }));
    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("Cierre aprobado correctamente."),
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // El detalle se cierra en la MISMA tanda de estado en la que se plantearía la oferta:
    // cuando esto se cumple, un diálogo de pago que tocara aparecer ya está en el DOM.
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Detalle del cierre" })).toBeNull(),
    );
  }

  it("adminSatelite: aprueba el cierre de su zona y NO se le ofrece pagar", async () => {
    await aprobarUnCierreComo("adminSatelite");

    expect(screen.queryByRole("dialog", { name: DIALOGO_PAGO })).toBeNull();
    // Ni por accidente: no se llamó a ninguna acción de pago.
    expect(registrarPagoMock).not.toHaveBeenCalled();
  });

  it.each<RolValue>(["maestro", "admin"])(
    "CONTRAPRUEBA — %s: aprueba y SÍ recibe la oferta, con el pendiente del servidor",
    async (rol) => {
      await aprobarUnCierreComo(rol);

      const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });
      // Es la MISMA aprobación con el MISMO pendiente: lo único que cambia es el rol.
      expect(within(dialogo).getByLabelText(/^Monto/)).toHaveValue(PENDIENTE);
    },
  );
});
