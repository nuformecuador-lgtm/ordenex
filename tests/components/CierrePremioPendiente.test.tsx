// @vitest-environment jsdom
// Feature 293 (T5.5, R27) — **EL CIERRE QUE YA ESTABA SALDADO VUELVE A TENER PENDIENTE.**
//
// Es el caso de borde 2 del diseño, y no es hipotético: producción arrancó vacía el 25/08, así
// que hoy todos los cierres salen «Liquidado» con `total_pago_mensajero` en ₡0,00. El primer
// premio que se registre los devuelve a «con pendiente», y eso se va a ver el primer día.
//
// **LO QUE ESTE ARCHIVO MIDE, Y QUE NINGÚN TEST DE SERVIDOR PUEDE MEDIR.** El servidor ya
// deriva el pendiente nuevo (`derivarPendienteCierre` con `premiosVivos`, T2.1). Lo que falta
// comprobar es que **la pantalla lo cuenta bien**: que pinta lo DERIVADO y no lo que dice el
// snapshot del cierre, que sigue diciendo lo que dijo el día en que se aprobó (R13).
//
// Por eso los fixtures ponen los dos números **en desacuerdo a propósito**: un cierre cuyo
// `totalPagoMensajero` es ₡10.000 y ya se pagó entero, con ₡5.000 de premio encima. Con los dos
// iguales, una pantalla que pintara el snapshot pasaría el test sin enterarse nadie.
//
// Se mide acá y no ampliando `CierresAdminPagoMensajero.test.tsx`: ese archivo tiene que seguir
// verde SIN EDITARLO, que es la prueba de que la 293 no cambia lo que la 172 dejó hecho.
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
  listarPagosDeCierreAction: vi.fn(),
  anularPagoAction: vi.fn(),
  anularRepartoAction: vi.fn(),
}));

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/cierres-admin",
  useSearchParams: () => new URLSearchParams(),
}));

import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import { PendienteLiquidarBadge } from "@/app/(app)/cierres-admin/_components/PendienteLiquidarBadge";
import { PAGO_MENSAJERO_TEXTO } from "@/app/(app)/cierres-admin/_components/pago-mensajero-labels";
import {
  verCierreDetalle,
  listarHistoricoCierresAdminPaginado,
  listarPendientesCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import {
  listarPagosDeCierreAction,
  registrarPagoMensajeroAction,
} from "@/lib/actions/liquidacion";

const verDetalleMock = vi.mocked(verCierreDetalle);
const historicoMock = vi.mocked(listarHistoricoCierresAdminPaginado);
const pendientesMock = vi.mocked(listarPendientesCierresAdminPaginado);
const listarPagosMock = vi.mocked(listarPagosDeCierreAction);
const registrarPagoMock = vi.mocked(registrarPagoMensajeroAction);

// --- Datos ---------------------------------------------------------------

const MENSAJERO = "Kevin Rojas";
const SECCION = PAGO_MENSAJERO_TEXTO.seccion;
const DIALOGO_PAGO = `Registrar pago a ${MENSAJERO}`;

/** El importe del premio del podio del 26/08. Es TODO lo que este cierre vuelve a deber. */
const PREMIO = "5000.00";
/** Lo que el snapshot del cierre congeló el día que se aprobó, y que NO se reescribe (R13). */
const SNAPSHOT_DEL_CIERRE = "10000.00";

const ZERO_TOTALES: CierreTotales = {
  efectivo: "0.00",
  simpe: "0.00",
  transferencia: "0.00",
  general: "0.00",
};

function makeResumen(over: Partial<CierreAdminResumen> & { cierreId: string }): CierreAdminResumen {
  return {
    mensajeroId: `m-${over.cierreId}`,
    mensajeroNombre: MENSAJERO,
    estado: "aprobado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z1",
    destinoZonaNombre: "GAM",
    totales: ZERO_TOTALES,
    // El snapshot sigue diciendo lo que dijo: la 293 no lo toca (R13).
    totalPagoMensajero: SNAPSHOT_DEL_CIERRE,
    totalIngresoBodegaRechazos: "0.00",
    pendientePagoMensajero: null,
    solicitadoAt: "2026-08-26T10:00:00.000Z",
    resueltoAt: "2026-08-26T18:00:00.000Z",
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

function conDetalleDe(cierre: CierreAdminResumen) {
  verDetalleMock.mockResolvedValue({
    ordenesSinGestion: [],
    sinGestionRegistrado: true,
    status: "ok",
    cierre,
    grupos: emptyGrupos(),
    totalesIngreso: zeroIngreso(),
    desgloseIngresoBodegaRechazos: { sla: "0.00", manual: "0.00", total: "0.00" },
    ganancia: "0.00",
    pagoTienda: "0.00",
  });
}

function renderModule(historico: CierreAdminResumen[]) {
  const cola = paginaInicial([] as CierreAdminResumen[]);
  const pagina = paginaInicial(historico);
  pendientesMock.mockResolvedValue({ status: "ok", page: 1, ...cola });
  historicoMock.mockResolvedValue({ status: "ok", page: 1, ...pagina });
  render(
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

/** El histórico vive en la pestaña «Resueltos» desde el pedido humano del 2026-08-16. */
async function verHistorico(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Resueltos/ }));
  return screen.getByRole("region", { name: "Histórico" });
}

async function abrirDetalle(user: ReturnType<typeof userEvent.setup>, cierre: CierreAdminResumen) {
  conDetalleDe(cierre);
  renderModule([cierre]);
  const region = await verHistorico(user);
  await user.click(
    within(region).getByRole("button", { name: /^Ver el cierre resuelto de/ }),
  );
  return screen.findByRole("dialog", { name: "Detalle del cierre" });
}

beforeEach(() => {
  vi.clearAllMocks();
  listarPagosMock.mockResolvedValue({ status: "ok", pagos: [] });
});

afterEach(() => {
  cleanup();
});

// =========================================================================

describe("R27 — la insignia del cierre cuenta el premio", () => {
  it("un cierre saldado con un premio encima vuelve a decir el importe, no «Liquidado»", () => {
    // Es el caso de borde 2 en su forma mínima: el badge sólo puede pintar lo que le dan, y lo
    // que le dan es el pendiente DERIVADO (snapshot + premios vivos − pagos), no el snapshot.
    render(<PendienteLiquidarBadge pendiente={PREMIO} />);

    expect(screen.getByText("₡5.000")).toBeInTheDocument();
    expect(screen.queryByText(PAGO_MENSAJERO_TEXTO.sinPendiente)).toBeNull();
  });

  it("CONTRAPRUEBA: sin premio vivo el mismo cierre sigue diciendo «Liquidado»", () => {
    render(<PendienteLiquidarBadge pendiente="0.00" />);

    expect(screen.getByText(PAGO_MENSAJERO_TEXTO.sinPendiente)).toBeInTheDocument();
    expect(screen.queryByText("₡5.000")).toBeNull();
  });
});

describe("R27 — el LISTADO de cierres lo enseña sin abrir nada", () => {
  it("el comprobante del cierre saldado vuelve a mostrar pendiente por el importe del premio", async () => {
    const user = userEvent.setup();
    renderModule([
      makeResumen({ cierreId: "c-premio", pendientePagoMensajero: PREMIO }),
    ]);

    const region = await verHistorico(user);
    // La deuda nueva se ve en el listado, sin abrir el detalle: es donde el maestro se entera.
    expect(within(region).getByText("₡5.000")).toBeInTheDocument();
    expect(within(region).queryByText(PAGO_MENSAJERO_TEXTO.sinPendiente)).toBeNull();
  });

  it("los DOS números conviven, cada uno en su sitio: el snapshot NO es la deuda (R13)", async () => {
    const user = userEvent.setup();
    renderModule([
      makeResumen({ cierreId: "c-premio", pendientePagoMensajero: PREMIO }),
    ]);

    const region = await verHistorico(user);
    const comprobante = within(region).getAllByRole("listitem")[0];
    // Se despliega el comprobante para que el total congelado del cierre esté TAMBIÉN en el
    // documento. Sin este clic la comprobación de abajo sería vacua: ₡10.000 no estaría en
    // ninguna parte y «no aparece donde no debe» no diría nada.
    await user.click(
      within(comprobante).getByRole("button", {
        name: `Ver detalles del cierre de ${MENSAJERO}`,
      }),
    );

    // El snapshot sigue diciendo ₡10.000 —lo que este cierre movió el día que se aprobó, y que
    // ya se pagó entero (R13)—, y la deuda dice ₡5.000, que es sólo el premio. Que los dos
    // números estén a la vez y sean distintos es la prueba de que la insignia no reusa el
    // snapshot: si lo reusara, el maestro pagaría el cierre por segunda vez.
    expect(within(comprobante).getByText("₡10.000")).toBeInTheDocument();
    expect(within(comprobante).getByText("₡5.000")).toBeInTheDocument();
  });

  it("y los dos casos se distinguen entre sí en el mismo listado", async () => {
    const user = userEvent.setup();
    renderModule([
      makeResumen({ cierreId: "c-premio", pendientePagoMensajero: PREMIO }),
      makeResumen({ cierreId: "c-saldado", pendientePagoMensajero: "0.00" }),
    ]);

    const region = await verHistorico(user);
    const comprobantes = within(region).getAllByRole("listitem");
    expect(comprobantes).toHaveLength(2);
    expect(comprobantes[0].textContent).toContain("₡5.000");
    expect(comprobantes[0].textContent).not.toContain(PAGO_MENSAJERO_TEXTO.sinPendiente);
    expect(comprobantes[1].textContent).toContain(PAGO_MENSAJERO_TEXTO.sinPendiente);
  });
});

describe("R27 — el diálogo de pago vuelve a ofrecer saldarlo", () => {
  it("la sección del detalle ofrece registrar el pago del premio, prefijado con su importe", async () => {
    const user = userEvent.setup();
    const dialogoDetalle = await abrirDetalle(
      user,
      makeResumen({ cierreId: "c-premio", pendientePagoMensajero: PREMIO }),
    );

    const seccion = await within(dialogoDetalle).findByRole("region", { name: SECCION });
    expect(within(seccion).getByText("₡5.000")).toBeInTheDocument();
    // El control vuelve a existir: antes del premio este cierre estaba liquidado y no lo tenía.
    await user.click(
      within(seccion).getByRole("button", { name: PAGO_MENSAJERO_TEXTO.registrar }),
    );

    const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });
    // Prefijado con lo DERIVADO (₡5.000), no con el total congelado (₡10.000).
    expect(within(dialogo).getByLabelText(/^Monto/)).toHaveValue(PREMIO);
  });

  it("y el pago que se manda es por el importe del premio, contra ESE cierre", async () => {
    const user = userEvent.setup();
    registrarPagoMock.mockResolvedValue({
      status: "ok",
      pago: {
        id: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
        monto: PREMIO,
        metodo: "efectivo",
        referencia: null,
        nota: null,
        fechaPago: "2026-08-27",
        registradoPorNombre: "Ana Maestra",
        registradoAt: "2026-08-27T15:04:05.000Z",
        esDeReparto: false,
        anulacion: null,
      },
      restante: "0.00",
    });
    const dialogoDetalle = await abrirDetalle(
      user,
      makeResumen({ cierreId: "c-premio", pendientePagoMensajero: PREMIO }),
    );
    const seccion = await within(dialogoDetalle).findByRole("region", { name: SECCION });
    await user.click(
      within(seccion).getByRole("button", { name: PAGO_MENSAJERO_TEXTO.registrar }),
    );
    const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });

    await user.click(within(dialogo).getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(registrarPagoMock).toHaveBeenCalledTimes(1));
    expect(registrarPagoMock.mock.calls[0][0]).toMatchObject({
      cierreId: "c-premio",
      monto: PREMIO,
    });
    // R35/R14: el importe viaja como STRING de punta a punta.
    expect(typeof (registrarPagoMock.mock.calls[0][0] as { monto: unknown }).monto).toBe(
      "string",
    );
  });

  it("CONTRAPRUEBA: sin premio, el mismo cierre no ofrece registrar y lo dice con texto", async () => {
    const user = userEvent.setup();
    const dialogoDetalle = await abrirDetalle(
      user,
      makeResumen({ cierreId: "c-saldado", pendientePagoMensajero: "0.00" }),
    );

    const seccion = await within(dialogoDetalle).findByRole("region", { name: SECCION });
    expect(
      within(seccion).queryByRole("button", { name: PAGO_MENSAJERO_TEXTO.registrar }),
    ).toBeNull();
    expect(within(seccion).getByText(PAGO_MENSAJERO_TEXTO.liquidado)).toBeInTheDocument();
  });
});
