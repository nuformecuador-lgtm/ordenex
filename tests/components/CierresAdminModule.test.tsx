// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import {
  verCierreDetalle,
  aprobarCierre,
  rechazarCierre,
  forzarSolicitudVencido,
  listarHistoricoCierresAdminPaginado,
  listarPendientesCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  CierreTotales,
  CierreResultado,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";

// Feature 38 (T13) — módulo cliente de "Cierres del día" del admin. Se mockean las
// Server Actions (ver detalle / aprobar / rechazar), el toast y el router (refresh)
// para afirmar la composición (cola, histórico, detalle, decisiones) sin DB ni sesión.
vi.mock("@/lib/actions/cierres-admin", () => ({
  // Feature 230 (T2.3): el borde de la descarga DETALLADA de esta pantalla. Se añade al doble
  // porque el módulo la importa; ninguna aserción de este archivo cambia.
  listarGestionesCierresAdminCompleto: vi.fn(),
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  listarCierresAdmin: vi.fn(),
  // Feature 111/R16: válvula de escape (destrabar `vencido` abandonado).
  forzarSolicitudVencido: vi.fn(),
  // Feature 170 — FASE 2 (T I.2): el histórico llega paginado del servidor.
  listarHistoricoCierresAdminPaginado: vi.fn(),
  // Feature 170 — FASE 2 (T J.2): la COLA de pendientes también.
  listarPendientesCierresAdminPaginado: vi.fn(),
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
  // Feature 205 (T6.1): el modulo lee `?cierre=` para abrir un detalle por enlace, asi que
  // el doble de `next/navigation` tiene que exportar tambien estos dos. Cambio del ARNES:
  // ninguna asercion de este archivo se toca.
  usePathname: () => "/cierres-admin",
  useSearchParams: () => new URLSearchParams(),
}));

const verDetalleMock = vi.mocked(verCierreDetalle);
const aprobarMock = vi.mocked(aprobarCierre);
const rechazarMock = vi.mocked(rechazarCierre);
const forzarMock = vi.mocked(forzarSolicitudVencido);
const historicoPaginadoMock = vi.mocked(listarHistoricoCierresAdminPaginado);
const pendientesPaginadoMock = vi.mocked(listarPendientesCierresAdminPaginado);

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
    pendientePagoMensajero: null, // feature 172/T C.2: null = cierre no aprobado (R28)
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
    // Feature 212/R31: el DTO gana el desglose y CONSERVA el escalar de arriba.
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: null, // feature 39
    ingresoBodegaRechazo: null, // feature 56
    tarifaFaltante: false, // feature 56/R23
    esRechazoSla: false, // feature 102
    desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
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

/**
 * Feature 102 (T10/T11): desglose del ingreso de bodega por rechazos. Default en cero (los tests
 * que no lo están mirando solo lo necesitan para el typecheck); los tests del desglose lo
 * sobreescriben con montos reales para afirmar SLA separado del manual (R8).
 */
function makeDesglose(
  over: Partial<{ sla: string; manual: string; total: string }> = {},
): { sla: string; manual: string; total: string } {
  return { sla: "0.00", manual: "0.00", total: "0.00", ...over };
}

/** Ingreso de Ordenex en cero: el default para los tests que no lo están mirando. */
function zeroIngreso(over: Partial<TotalesIngresoOrdenex> = {}): TotalesIngresoOrdenex {
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
    ...over,
  };
}

/**
 * Despliega la fila de una gestión en el comprobante del detalle. Lo que antes eran
 * columnas de la tabla (dinero recibido, método, ingreso de bodega, evidencia, badges)
 * ahora vive en el desplegable de su fila: hay que abrirla para afirmarlo.
 */
async function abrirFila(
  user: ReturnType<typeof userEvent.setup>,
  scope: HTMLElement,
  remision: string,
  destinatario = "Beto Ruiz",
) {
  // Con snapshot el desplegable se anuncia como el desglose de ingreso; sin snapshot,
  // como el detalle de la orden. Se acepta cualquiera de los dos nombres.
  const nombre = new RegExp(
    `(Desglose de ingreso|Detalle) de la orden ${remision} · ${destinatario}`,
  );
  await user.click(within(scope).getByRole("button", { name: nombre }));
}

/**
 * Feature 170 — FASE 2 (T I.2 el histórico, T J.2 la cola): las DOS tablas dejan de recibir un
 * array y reciben la PÁGINA que pre-carga el Server Component. El helper sigue recibiendo los
 * arrays para no reescribir cada caso, y ADEMÁS programa las dos Server Actions paginadas con
 * esas mismas páginas: SWR revalida al montar, y sin los dobles las tablas se vaciarían a
 * mitad del test.
 */
function renderModule(props?: {
  pendientes?: CierreAdminResumen[];
  historico?: CierreAdminResumen[];
  sinZona?: boolean;
}) {
  const cola = paginaInicial(props?.pendientes ?? []);
  const pagina = paginaInicial(props?.historico ?? []);
  pendientesPaginadoMock.mockResolvedValue({ status: "ok", page: 1, ...cola });
  historicoPaginadoMock.mockResolvedValue({ status: "ok", page: 1, ...pagina });
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CierresAdminModule
        pendientes={cola}
        historico={pagina}
        sinZona={props?.sinZona ?? false}
      />
    </SWRConfig>,
  );
}

/**
 * Pedido humano del 2026-08-16 — el histórico dejó de estar debajo de la cola y pasó a ser la
 * pestaña «Resueltos», así que hay que ABRIRLA antes de mirarlo. No es un rodeo del test: es
 * exactamente el gesto que hace ahora el usuario, y por eso se escribe en vez de esquivarse
 * apuntando al DOM escondido —que existe (los paneles no se desmontan, para no perder su
 * paginación) pero está fuera del árbol de accesibilidad—.
 */
async function irAResueltos(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Resueltos/ }));
  return screen.getByRole("region", { name: "Histórico" });
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
    expect(within(region).getByText("₡500")).toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: "Ver / decidir" }),
    ).toBeInTheDocument();
  });

  it("R5: el histórico lista cierres resueltos con estado, fecha resuelta y motivo (solo lectura)", async () => {
    // Pedido humano del 2026-08-16: el histórico es una tira de COMPROBANTES. Estado, mensajero
    // y motivo siguen a la vista sin abrir nada —el motivo explica el estado, y por eso queda
    // fuera del desplegable—; la fecha resuelta vive en el desglose, que se despliega.
    const user = userEvent.setup();
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

    const region = await irAResueltos(user);
    expect(within(region).getByText("Rechazado")).toBeInTheDocument();
    expect(within(region).getByText("Diana Mora")).toBeInTheDocument();
    expect(within(region).getByText("Faltan evidencias")).toBeInTheDocument();
    // Solo lectura: la única acción del histórico es «Ver», sin decisión. Su nombre accesible
    // nombra al mensajero porque la pantalla monta una tarjeta por cierre.
    expect(
      within(region).getByRole("button", { name: "Ver el cierre resuelto de Diana Mora" }),
    ).toBeInTheDocument();

    await user.click(
      within(region).getByRole("button", { name: /^Ver detalles del cierre de Diana Mora/ }),
    );
    expect(within(region).getByText("2026-07-12")).toBeInTheDocument();
  });

  it("R8/R9: al abrir el detalle muestra los totales snapshot como string (sin reparsear)", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
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
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    const totales = within(dialog).getByRole("region", {
      name: "Totales del cierre",
    });
    expect(within(totales).getByText("₡100")).toBeInTheDocument();
    expect(within(totales).getByText("₡50")).toBeInTheDocument();
    expect(within(totales).getByText("₡10")).toBeInTheDocument();
    expect(within(totales).getByText("₡160")).toBeInTheDocument();
  });

  it("el detalle muestra el ingreso bruto y NO muestra card de ganancia cuando es ≥ 0", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1", totalPagoMensajero: "1500.00" }),
      grupos: emptyGrupos(),
      totalesIngreso: zeroIngreso({ total: "3672.50" }),
      ganancia: "2172.50", // 3672.50 - 1500.00, derivado server-side (positiva)
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", { name: "Detalle del cierre" });

    // El bruto es un renglón del bloque de liquidación del comprobante.
    const liquidacion = within(dialog).getByRole("region", {
      name: "Liquidación",
    });
    expect(within(liquidacion).getByText("₡3.673")).toBeInTheDocument();
    // Ganancia positiva: no se muestra ni la ganancia ni el "Debe".
    expect(within(liquidacion).queryByText("Ganancia")).toBeNull();
    expect(within(liquidacion).queryByText("Debe")).toBeNull();
    expect(within(liquidacion).queryByText("₡2.173")).toBeNull();
  });

  it("el detalle muestra el pago a tienda derivado server-side (sin recalcular)", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({
        cierreId: "c1",
        totales: {
          efectivo: "25000.00",
          simpe: "0.00",
          transferencia: "0.00",
          general: "25000.00",
        },
      }),
      grupos: emptyGrupos(),
      totalesIngreso: zeroIngreso({ fleteConIva: "2825.00", comisionConIva: "847.50" }),
      ganancia: "0.00",
      pagoTienda: "21327.50", // 25000.00 - 2825.00 - 847.50, derivado server-side
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", { name: "Detalle del cierre" });

    const pago = within(dialog).getByRole("region", { name: "Pago a tienda" });
    expect(within(pago).getByText("₡21.328")).toBeInTheDocument();
  });

  it("muestra 'Debe' en rojo cuando la ganancia es negativa (el pago supera el ingreso)", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1", totalPagoMensajero: "1500.00" }),
      grupos: emptyGrupos(),
      totalesIngreso: zeroIngreso(), // total "0.00": p.ej. puras reprogramaciones
      ganancia: "-1500.00",
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", { name: "Detalle del cierre" });
    // Ganancia negativa -> se rotula "Debe" y el monto va en rojo.
    const liquidacion = within(dialog).getByRole("region", {
      name: "Liquidación",
    });
    expect(within(liquidacion).queryByText("Ganancia")).toBeNull();
    expect(within(liquidacion).getByText("Debe")).toBeInTheDocument();
    const monto = within(liquidacion).getByText("-₡1.500");
    expect(monto).toBeInTheDocument();
    expect(monto).toHaveClass("text-danger-strong");
  });

  it("el detalle muestra el ingreso de Ordenex del cierre por concepto", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1" }),
      grupos: emptyGrupos(),
      totalesIngreso: zeroIngreso({
        montoCobrar: "25000.00",
        fleteConIva: "2825.00",
        comisionConIva: "847.50",
        fleteDevolucionConIva: "1130.00",
        total: "4802.50",
      }),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));

    const dialog = await screen.findByRole("dialog", { name: "Detalle del cierre" });
    const panel = within(dialog).getByRole("region", { name: "Ingreso de Ordenex" });
    // Cada concepto va con su IVA incluido, en un solo monto. Feature 230/R20: el
    // total es el redondeo del total del SERVIDOR (`4802.50` -> `₡4.803`), no la
    // suma de los tres redondeos de arriba; aquí coinciden, y cuando no coincidan
    // manda el del servidor (A1: la columna puede no cuadrar a ojo por ±1/±2).
    expect(within(panel).getByText("₡2.825")).toBeInTheDocument();
    expect(within(panel).getByText("₡848")).toBeInTheDocument();
    expect(within(panel).getByText("₡1.130")).toBeInTheDocument();
    expect(within(panel).getByText("₡4.803")).toBeInTheDocument();
    // El monto a cobrar no es un concepto facturado: vive solo en el desglose por orden.
    expect(within(panel).queryByText("₡25.000")).not.toBeInTheDocument();
    // El IVA no se pinta como concepto aparte en el panel.
    expect(within(panel).queryByText("IVA flete")).not.toBeInTheDocument();
    expect(within(panel).queryByText("IVA comisión")).not.toBeInTheDocument();
  });

  it("el desglose por orden se despliega y muestra la tarifa congelada con su fórmula", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({
        gestionId: "g1",
        resultado: "entregada",
        numRemision: "REM-123",
        destinatario: "Ana Pérez",
        montoRecibido: "25000.00",
        ingresoOrdenex: {
          montoCobrar: "25000.00",
          cobraComision: true,
          esCentral: true,
          flete: "2500.00",
          ivaFlete: "325.00",
          fleteDevolucion: null,
          ivaFleteDevolucion: null,
          comisionCod: "750.00",
          ivaComisionCod: "97.50",
          fleteConIva: "2825.00",
          fleteDevolucionConIva: null,
          comisionConIva: "847.50",
          total: "3672.50",
          tarifa: {
            tarifaId: "tar_88",
            valorFlete: "2000.00",
            valorFleteGam: "2500.00",
            valorFleteDevuelto: "1000.00",
            valorFleteDevueltoGam: "1200.00",
            comisionCod: "3.00",
            ivaFlete: "13.00",
            ivaComisionCod: "13.00",
            fulfillment: "500.00",
          },
        },
      }),
    ];
    verDetalleMock.mockResolvedValue({
      status: "ok",
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", { name: "Detalle del cierre" });
    const region = within(dialog).getByRole("region", { name: "Entregadas" });

    // El botón identifica SU orden, no un genérico repetido por fila.
    const toggle = within(region).getByRole("button", {
      name: "Desglose de ingreso de la orden REM-123 · Ana Pérez",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // La tarifa congelada, incluida la variante NO aplicada (base 2000, se aplicó GAM 2500).
    expect(within(region).getByText("tar_88")).toBeInTheDocument();
    expect(within(region).getByText("₡2.000")).toBeInTheDocument();
    expect(within(region).getAllByText("13.00 %").length).toBeGreaterThan(0);
    expect(within(region).getByText("3.00 %")).toBeInTheDocument();
  });

  it("sin ingresoOrdenex (cierre sin snapshot) no se pinta el botón de desglose", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({ gestionId: "g1", resultado: "entregada", numRemision: "REM-9" }),
    ];
    verDetalleMock.mockResolvedValue({
      status: "ok",
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", { name: "Detalle del cierre" });
    const region = within(dialog).getByRole("region", { name: "Entregadas" });
    expect(
      within(region).queryByRole("button", { name: /Desglose de ingreso/ }),
    ).not.toBeInTheDocument();
  });

  it("R6/R9: una entrega expone su monto (string) y método en el detalle", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.entregada = [
      makeGestion({
        gestionId: "g1",
        resultado: "entregada",
        montoRecibido: "1250.50",
        metodoPago: "SINPE",
        // Feature 213 (T8): desglose COHERENTE con el escalar que este caso ya declaraba.
        // La presentación deriva del desglose (R23); la aserción de abajo NO se relaja.
        pagos: [{ metodo: "SINPE", monto: "1250.50" }],
      }),
    ];
    verDetalleMock.mockResolvedValue({
      status: "ok",
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    const region = within(dialog).getByRole("region", { name: "Entregadas" });
    await abrirFila(user, region, "REM-001");
    // Monto recibido y método van juntos en el desplegable de la orden.
    expect(
      within(region).getByText("₡1.251 · SINPE"),
    ).toBeInTheDocument();
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
        pagos: [{ metodo: "efectivo", monto: "1000.00" }], // feature 213 (T8)
        pagoMensajero: "0.00",
        tarifaFaltante: true,
      }),
    ];
    verDetalleMock.mockResolvedValue({
      status: "ok",
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    const region = within(dialog).getByRole("region", { name: "Entregadas" });
    await abrirFila(user, region, "REM-SINTARIFA");
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
        pagos: [{ metodo: "efectivo", monto: "1000.00" }], // feature 213 (T8)
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
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });

    // Entrega con pago 0.00 pero SIN el flag: nada de badge, ni desplegada.
    const entregadas = within(dialog).getByRole("region", { name: "Entregadas" });
    await abrirFila(user, entregadas, "REM-ENT");
    expect(within(entregadas).queryByText("Sin tarifa")).not.toBeInTheDocument();

    // Mismo caso en el rechazo: hay que pasar a su pestaña para verlo.
    await user.click(within(dialog).getByRole("tab", { name: /Rechazadas/ }));
    const rechazadas = within(dialog).getByRole("region", { name: "Rechazadas" });
    await abrirFila(user, rechazadas, "REM-REC");
    expect(within(rechazadas).queryByText("Sin tarifa")).not.toBeInTheDocument();
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
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    const region = within(dialog).getByRole("region", { name: "Rechazadas" });
    await abrirFila(user, region, "REM-REC");
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
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    const region = within(dialog).getByRole("region", { name: "Rechazadas" });
    await abrirFila(user, region, "REM-REC");
    expect(within(region).getByText("₡3.500")).toBeInTheDocument();
  });


  it("feature 102/R8: el ingreso de bodega por rechazos muestra el total y los subtotales SLA y manual separados", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      // 6000 (SLA) + 3200 (manual) === 9200 (total snapshot), particionado server-side (R5).
      desgloseIngresoBodegaRechazos: makeDesglose({
        sla: "6000.00",
        manual: "3200.00",
        total: "9200.00",
      }),
      cierre: makeResumen({
        cierreId: "c1",
        totalIngresoBodegaRechazos: "9200.00",
      }),
      grupos: emptyGrupos(),
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    const region = within(dialog).getByRole("region", {
      name: "Ingreso de bodega por rechazos del cierre",
    });
    // El total combinado (56) + las dos sublíneas del desglose por origen (102/R8).
    expect(within(region).getByText("₡9.200")).toBeInTheDocument();
    expect(within(region).getByText("Automático (por plazo vencido)")).toBeInTheDocument();
    expect(within(region).getByText("₡6.000")).toBeInTheDocument();
    expect(within(region).getByText("Manual (mensajero)")).toBeInTheDocument();
    expect(within(region).getByText("₡3.200")).toBeInTheDocument();
  });

  it("feature 102/R9: cada fila rechazada se marca como SLA (cron) o Manual (mensajero) según esRechazoSla", async () => {
    const user = userEvent.setup();
    const grupos = emptyGrupos();
    grupos.rechazada = [
      makeGestion({
        gestionId: "g-sla",
        resultado: "rechazada",
        numRemision: "REM-SLA",
        destinatario: "Cliente SLA",
        ingresoBodegaRechazo: "6000.00",
        esRechazoSla: true,
        desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
      }),
      makeGestion({
        gestionId: "g-man",
        resultado: "rechazada",
        numRemision: "REM-MAN",
        destinatario: "Cliente Manual",
        ingresoBodegaRechazo: "3200.00",
        esRechazoSla: false,
        desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
      }),
    ];
    verDetalleMock.mockResolvedValue({
      status: "ok",
      desgloseIngresoBodegaRechazos: makeDesglose({
        sla: "6000.00",
        manual: "3200.00",
        total: "9200.00",
      }),
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    const region = within(dialog).getByRole("region", { name: "Rechazadas" });
    // Cada fila trae su marca de origen: SLA para el escalado, Manual para el del mensajero.
    await abrirFila(user, region, "REM-SLA", "Cliente SLA");
    expect(within(region).getByText("Automático")).toBeInTheDocument();
    expect(within(region).queryByText("Manual")).not.toBeInTheDocument();

    await abrirFila(user, region, "REM-MAN", "Cliente Manual");
    expect(within(region).getByText("Manual")).toBeInTheDocument();
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
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1" }),
      grupos,
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "c1" })] });

    await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Detalle del cierre",
    });
    const region = within(dialog).getByRole("region", { name: "Rechazadas" });
    await abrirFila(user, region, "REM-001");
    await user.click(
      within(region).getByRole("button", {
        name: "Ver evidencia de la orden REM-001 · Beto Ruiz",
      }),
    );

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
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1", estado: "solicitado" }),
      grupos: emptyGrupos(),
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    aprobarMock.mockResolvedValue({
      status: "ok",
      cierreId: "c1",
      estado: "aprobado",
      pendientePagoMensajero: "0.00", // feature 172/T C.2
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
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1", estado: "solicitado" }),
      grupos: emptyGrupos(),
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
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
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1", estado: "solicitado" }),
      grupos: emptyGrupos(),
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
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
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c2", estado: "aprobado", resueltoAt: "2026-07-12T00:00:00.000Z" }),
      grupos: emptyGrupos(),
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    renderModule({
      historico: [
        makeResumen({ cierreId: "c2", estado: "aprobado", resueltoAt: "2026-07-12T00:00:00.000Z" }),
      ],
    });

    const historico = await irAResueltos(user);
    await user.click(
      within(historico).getByRole("button", { name: /^Ver el cierre resuelto de/ }),
    );
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
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "c1", estado: "solicitado" }),
      grupos: emptyGrupos(),
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
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

  // ---------- Feature 41 (F1, R20) + Feature 111 (R15/R16) ----------

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

  it("R16: la acción DIFERENCIADA 'Destrabar cierre vencido' aparece SOLO en las filas 'vencido'", () => {
    renderModule({
      pendientes: [
        makeResumen({ cierreId: "cv", estado: "vencido", mensajeroNombre: "Eva Vencida" }),
        makeResumen({ cierreId: "cs", estado: "solicitado", mensajeroNombre: "Sol Solicita" }),
      ],
    });

    const region = screen.getByRole("region", { name: "Pendientes de decisión" });
    // Una sola fila (la vencida) ofrece el destrabe; el `solicitado` no.
    const destrabar = within(region).getAllByRole("button", {
      name: /Destrabar cierre vencido abandonado de/,
    });
    expect(destrabar).toHaveLength(1);
    expect(
      within(region).getByRole("button", {
        name: "Destrabar cierre vencido abandonado de Eva Vencida",
      }),
    ).toBeInTheDocument();
    // El `solicitado` mantiene su "Ver / decidir"; el `vencido` NO lo ofrece.
    expect(
      within(region).getByRole("button", { name: "Ver / decidir" }),
    ).toBeInTheDocument();
  });

  it("R15: un 'vencido' NO es resoluble por la vía normal — su detalle NO expone aprobar/rechazar", async () => {
    const user = userEvent.setup();
    verDetalleMock.mockResolvedValue({
      status: "ok",
      desgloseIngresoBodegaRechazos: makeDesglose(), // feature 102 (T10/T11)
      cierre: makeResumen({ cierreId: "cv", estado: "vencido" }),
      grupos: emptyGrupos(),
      totalesIngreso: zeroIngreso(),
      ganancia: "0.00",
      pagoTienda: "0.00",
    });
    renderModule({ pendientes: [makeResumen({ cierreId: "cv", estado: "vencido" })] });

    // El comprobante del `vencido` ofrece «Ver» (solo lectura del detalle) junto al destrabar.
    await user.click(screen.getByRole("button", { name: /^Ver el cierre de/ }));
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

  it("R16: destrabar pide confirmación (excepción) y al confirmar llama a forzarSolicitudVencido y refresca", async () => {
    const user = userEvent.setup();
    forzarMock.mockResolvedValue({
      status: "ok",
      cierreId: "cv",
      estado: "solicitado",
    });
    renderModule({
      pendientes: [
        makeResumen({ cierreId: "cv", estado: "vencido", mensajeroNombre: "Eva Vencida" }),
      ],
    });

    await user.click(
      screen.getByRole("button", {
        name: "Destrabar cierre vencido abandonado de Eva Vencida",
      }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Destrabar cierre vencido abandonado",
    });
    // Copy de EXCEPCIÓN: deja claro que es en nombre del mensajero y que luego se aprueba/rechaza.
    expect(dialog).toHaveTextContent(/excepción/i);
    expect(dialog).toHaveTextContent(/Eva Vencida/);
    // No se llamó a la action hasta confirmar (confirmación explícita).
    expect(forzarMock).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole("button", { name: "Destrabar (excepción)" }),
    );

    await vi.waitFor(() =>
      expect(forzarMock).toHaveBeenCalledWith({ cierreId: "cv" }),
    );
    await vi.waitFor(() => expect(successMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("R16: cancelar la confirmación del destrabe NO llama a la action", async () => {
    const user = userEvent.setup();
    renderModule({
      pendientes: [
        makeResumen({ cierreId: "cv", estado: "vencido", mensajeroNombre: "Eva Vencida" }),
      ],
    });

    await user.click(
      screen.getByRole("button", {
        name: "Destrabar cierre vencido abandonado de Eva Vencida",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Destrabar cierre vencido abandonado",
    });
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    expect(forzarMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("R16: si el destrabe da conflict, muestra toast accionable y refresca", async () => {
    const user = userEvent.setup();
    forzarMock.mockResolvedValue({ status: "conflict" });
    renderModule({
      pendientes: [
        makeResumen({ cierreId: "cv", estado: "vencido", mensajeroNombre: "Eva Vencida" }),
      ],
    });

    await user.click(
      screen.getByRole("button", {
        name: "Destrabar cierre vencido abandonado de Eva Vencida",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Destrabar cierre vencido abandonado",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Destrabar (excepción)" }),
    );

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(successMock).not.toHaveBeenCalled();
  });

  // ---------- Feature 109 (R31): `rechazado` del histórico rotulado como bloqueante ----------

  it("R31: un 'rechazado' del histórico se rotula 'Bloqueante hasta re-solicitud' (no resuelto/cerrado)", async () => {
    const user = userEvent.setup();
    renderModule({
      historico: [
        makeResumen({
          cierreId: "c-rech",
          estado: "rechazado",
          mensajeroNombre: "Rita Rechazada",
          resueltoAt: "2026-07-20T08:00:00.000Z",
          motivoRechazo: "Montos no cuadran",
        }),
      ],
    });

    const region = await irAResueltos(user);
    // Conserva su etiqueta "Rechazado"…
    expect(within(region).getByText("Rechazado")).toBeInTheDocument();
    // …pero se rotula BLOQUEANTE hasta que el mensajero lo re-solicite (no "resuelto").
    expect(
      within(region).getByText("Bloqueante hasta re-solicitud"),
    ).toBeInTheDocument();
  });

  it("R31: un 'aprobado' del histórico NO lleva el rótulo de bloqueante (es terminal)", async () => {
    const user = userEvent.setup();
    renderModule({
      historico: [
        makeResumen({
          cierreId: "c-apr",
          estado: "aprobado",
          mensajeroNombre: "Ada Aprobada",
          resueltoAt: "2026-07-20T08:00:00.000Z",
        }),
      ],
    });

    const region = await irAResueltos(user);
    expect(within(region).getByText("Aprobado")).toBeInTheDocument();
    expect(
      within(region).queryByText("Bloqueante hasta re-solicitud"),
    ).toBeNull();
  });
});
