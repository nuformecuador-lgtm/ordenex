// @vitest-environment jsdom
// Feature 172 (TANDA E) — PAGAR A UN MENSAJERO desde `/cierres-admin`. Cubre R6, R16, R17,
// R18, R19, R26, R27, R28, R49.
//
// Esta es la mitad delicada del frontend de la 172, y lo es por una razón concreta: toca la
// APROBACIÓN DEL CIERRE, que es la transacción más cargada del sistema y la que desbloquea al
// mensajero (feature 111). La propiedad que este archivo existe para proteger no es «se puede
// pagar», que es fácil, sino **que pagar no pueda tumbar la aprobación**:
//
//   - con «Ahora no», el cierre queda aprobado y NO se llama a ninguna acción de pago;
//   - si la acción de pago FALLA, el cierre sigue aprobado y el mensaje lo dice;
//   - un cierre con pendiente 0 no abre el diálogo;
//   - **un `adminSatelite` aprueba sin que aparezca el diálogo** ([P3]/R6: aprobar un cierre y
//     mover dinero no son la misma responsabilidad).
//
// Si el pago pudiera revertir la aprobación, el cierre volvería a `solicitado` —estado
// BLOQUEANTE— y el mensajero se quedaría sin trabajar al día siguiente por un trámite
// administrativo ajeno a él. Por eso varios casos afirman AUSENCIA de llamadas: es lo único
// que distingue «dos pasos de verdad» de «dos pasos que en realidad son uno».
//
// R26 se mide aquí y no ampliando `CierresAdminModule.test.tsx`: ese archivo (y el de la 158)
// tienen que seguir verdes SIN EDITARLOS, que es la prueba de que la 172 extiende esta
// pantalla en vez de cambiarla.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreGrupos,
  CierreTotales,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreEstado } from "@/lib/types/cierre";
import type { PagoRegistradoDTO, RegistrarPagoResult } from "@/lib/types/liquidacion";

// --- Dobles de las Server Actions ---------------------------------------

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
  listarPagosDeCierreAction: vi.fn(),
  // T F.5: la sección la importa para el control de anular de la lista de comprobantes.
  // Sin declararla aquí, el módulo mockeado no la exporta y el import revienta.
  anularPagoAction: vi.fn(),
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

import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import {
  verCierreDetalle,
  aprobarCierre,
  rechazarCierre,
  forzarSolicitudVencido,
  listarHistoricoCierresAdminPaginado,
  listarPendientesCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import {
  registrarPagoMensajeroAction,
  listarPagosDeCierreAction,
} from "@/lib/actions/liquidacion";
import { PAGO_MENSAJERO_TEXTO } from "@/app/(app)/cierres-admin/_components/pago-mensajero-labels";

const verDetalleMock = vi.mocked(verCierreDetalle);
const aprobarMock = vi.mocked(aprobarCierre);
const rechazarMock = vi.mocked(rechazarCierre);
const forzarMock = vi.mocked(forzarSolicitudVencido);
const historicoPaginadoMock = vi.mocked(listarHistoricoCierresAdminPaginado);
const pendientesPaginadoMock = vi.mocked(listarPendientesCierresAdminPaginado);
const registrarPagoMock = vi.mocked(registrarPagoMensajeroAction);
const listarPagosMock = vi.mocked(listarPagosDeCierreAction);

// --- Datos ---------------------------------------------------------------

const MENSAJERO = "Ana Mensajera";
const DIALOGO_PAGO = `Registrar pago a ${MENSAJERO}`;
const SECCION = PAGO_MENSAJERO_TEXTO.seccion;
/** El día de hoy en hora de Costa Rica: es con el que el formulario prefija la fecha real. */
const HOY_CR = fechaCalendarioCR(new Date());

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
    mensajeroNombre: MENSAJERO,
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z1",
    destinoZonaNombre: "GAM",
    totales: ZERO_TOTALES,
    totalPagoMensajero: "50000.00",
    totalIngresoBodegaRechazos: "0.00",
    pendientePagoMensajero: null,
    solicitadoAt: "2026-07-30T10:00:00.000Z",
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

/** Programa el detalle que devolverá `verCierreDetalle` para ese cierre. */
function conDetalleDe(cierre: CierreAdminResumen) {
  verDetalleMock.mockResolvedValue({
    status: "ok",
    cierre,
    grupos: emptyGrupos(), // sin incidentes: aprobar NO pasa por el sub-modal de la 158 (R36)
    totalesIngreso: zeroIngreso(),
    desgloseIngresoBodegaRechazos: { sla: "0.00", manual: "0.00", total: "0.00" },
    ganancia: "0.00",
    pagoTienda: "0.00",
  });
}

const COMPROBANTE: PagoRegistradoDTO = {
  id: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  monto: "50000.00",
  metodo: "SINPE",
  referencia: "SINPE-99887766",
  nota: "Liquidación del cierre del 30",
  fechaPago: "2026-07-31",
  registradoPorNombre: "Ana Maestra",
  registradoAt: "2026-08-02T15:04:05.000Z",
  esDeReparto: false, // feature 206: pago SUELTO, sin reparto
  anulacion: null,
};

const PAGO_OK: RegistrarPagoResult = {
  status: "ok",
  pago: COMPROBANTE,
  restante: "0.00",
};

// --- Montaje -------------------------------------------------------------

function renderModule(props?: {
  pendientes?: CierreAdminResumen[];
  historico?: CierreAdminResumen[];
  /** [P3]/R6 — `false` es el `adminSatelite`: aprueba, pero no mueve dinero. */
  puedeRegistrarPago?: boolean;
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
        sinZona={false}
        puedeRegistrarPago={props?.puedeRegistrarPago ?? true}
      />
    </SWRConfig>,
  );
}

/**
 * Aprueba el cierre `c1` de la cola: abre su detalle y pulsa «Aprobar». Sin incidentes, la
 * 158 aprueba directo (R36), así que este es el camino corto de la 38.
 */
async function aprobarDesdeLaCola(
  user: ReturnType<typeof userEvent.setup>,
  opciones: { puedeRegistrarPago?: boolean } = {},
) {
  const cierre = makeResumen({ cierreId: "c1", estado: "solicitado" });
  conDetalleDe(cierre);
  renderModule({ pendientes: [cierre], ...opciones });
  await user.click(screen.getByRole("button", { name: "Ver / decidir" }));
  const detalle = await screen.findByRole("dialog", { name: "Detalle del cierre" });
  await user.click(within(detalle).getByRole("button", { name: "Aprobar" }));
  await waitFor(() => expect(aprobarMock).toHaveBeenCalledTimes(1));
}

/** Abre el detalle de un cierre del HISTÓRICO (botón «Ver» de su comprobante). */
async function abrirDetalleDelHistorico(
  user: ReturnType<typeof userEvent.setup>,
  cierre: CierreAdminResumen,
  opciones: { puedeRegistrarPago?: boolean } = {},
) {
  conDetalleDe(cierre);
  renderModule({ historico: [cierre], ...opciones });
  // Pedido humano del 2026-08-16: el histórico es la pestaña «Resueltos», así que abrirla es
  // parte del gesto. Es lo que hace el usuario, y por eso el helper lo hace en vez de buscar el
  // panel escondido (que sigue montado, para no perder su paginación, pero fuera del árbol de
  // accesibilidad mientras no es el visible).
  await user.click(screen.getByRole("button", { name: /^Resueltos/ }));
  await user.click(
    within(screen.getByRole("region", { name: "Histórico" })).getByRole("button", {
      name: /^Ver el cierre resuelto de/,
    }),
  );
  return screen.findByRole("dialog", { name: "Detalle del cierre" });
}

/**
 * Abre la pestaña «Resueltos» (donde vive el histórico desde el pedido humano del 2026-08-16) y
 * devuelve su región. Los casos que solo MIRAN el listado también tienen que dar ese clic: es
 * el gesto real del usuario.
 */
async function verHistorico(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Resueltos/ }));
  return screen.getByRole("region", { name: "Histórico" });
}

/** El aviso de que NADA se aprobó de más ni se deshizo: ninguna otra decisión se disparó. */
function ningunaOtraDecisionDelCierre() {
  expect(aprobarMock).toHaveBeenCalledTimes(1);
  expect(rechazarMock).not.toHaveBeenCalled();
  expect(forzarMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  aprobarMock.mockResolvedValue({
    status: "ok",
    cierreId: "c1",
    estado: "aprobado",
    pendientePagoMensajero: "50000.00",
  });
  registrarPagoMock.mockResolvedValue(PAGO_OK);
  listarPagosMock.mockResolvedValue({ status: "ok", pagos: [] });
});

afterEach(() => {
  cleanup();
});

// =========================================================================
// T E.1 — Se pregunta AL APROBAR (R16, R17, R18, R6)
// =========================================================================

describe("T E.1/R16 — tras aprobar con pendiente > 0 se OFRECE registrar el pago", () => {
  it("abre el mismo diálogo compartido, prefijado con el pendiente del SERVIDOR", async () => {
    const user = userEvent.setup();
    await aprobarDesdeLaCola(user);

    const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });
    // R23/R30: el monto llega prefijado con el pendiente que derivó el servidor, TAL CUAL.
    expect(within(dialogo).getByLabelText(/^Monto/)).toHaveValue("50000.00");
    expect(within(dialogo).getByText("₡50.000,00")).toBeInTheDocument();
    // Y el cierre ya está aprobado ANTES de que este diálogo exista.
    expect(successMock).toHaveBeenCalledWith("Cierre aprobado correctamente.");
  });

  it("el pendiente que prefija el formulario sale de la RESPUESTA de aprobar, no de la fila", async () => {
    const user = userEvent.setup();
    // La fila de la cola trae `null` (no está aprobada todavía); el valor bueno es el que
    // devuelve `aprobarCierre`. Si la pantalla leyera la fila, aquí no habría nada que pagar.
    aprobarMock.mockResolvedValue({
      status: "ok",
      cierreId: "c1",
      estado: "aprobado",
      pendientePagoMensajero: "17500.25",
    });
    await aprobarDesdeLaCola(user);

    const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });
    expect(within(dialogo).getByLabelText(/^Monto/)).toHaveValue("17500.25");
  });

  it("registrar el pago manda el `cierreId` y el monto TAL CUAL (money-safe)", async () => {
    const user = userEvent.setup();
    await aprobarDesdeLaCola(user);
    const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });

    await user.click(within(dialogo).getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(registrarPagoMock).toHaveBeenCalledTimes(1));
    const enviado = registrarPagoMock.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado).toMatchObject({
      cierreId: "c1",
      monto: "50000.00",
      metodo: "efectivo",
      fechaPago: HOY_CR,
    });
    // R14: el monto viaja como STRING, jamás como número.
    expect(typeof enviado.monto).toBe("string");
    // §4.1/R43: la clave de idempotencia se acuña al abrir el diálogo y viaja con la petición.
    expect(enviado.claveIdempotencia).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        PAGO_MENSAJERO_TEXTO.registrado("50000.00"),
      ),
    );
  });
});

describe("T E.1/R27 — un cierre con pendiente 0 NO abre el diálogo", () => {
  it("aprueba y termina, como antes de la 172", async () => {
    const user = userEvent.setup();
    aprobarMock.mockResolvedValue({
      status: "ok",
      cierreId: "c1",
      estado: "aprobado",
      pendientePagoMensajero: "0.00",
    });
    await aprobarDesdeLaCola(user);

    await waitFor(() => expect(successMock).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: DIALOGO_PAGO })).toBeNull();
    expect(registrarPagoMock).not.toHaveBeenCalled();
  });
});

describe("T E.1/R6 [P3] — el `adminSatelite` APRUEBA, pero no paga", () => {
  it("aprueba con pendiente > 0 y NO le aparece el diálogo de pago", async () => {
    const user = userEvent.setup();
    await aprobarDesdeLaCola(user, { puedeRegistrarPago: false });

    // El cierre queda aprobado exactamente como hoy…
    await waitFor(() => expect(successMock).toHaveBeenCalledWith("Cierre aprobado correctamente."));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // …y la oferta de pago no existe para él.
    expect(screen.queryByRole("dialog", { name: DIALOGO_PAGO })).toBeNull();
    expect(registrarPagoMock).not.toHaveBeenCalled();
  });

  it("tampoco ve la sección «Pago al mensajero» en el detalle de un cierre aprobado", async () => {
    const user = userEvent.setup();
    const cierre = makeResumen({
      cierreId: "c9",
      estado: "aprobado",
      resueltoAt: "2026-07-31T08:00:00.000Z",
      pendientePagoMensajero: "50000.00",
    });
    await abrirDetalleDelHistorico(user, cierre, { puedeRegistrarPago: false });

    expect(screen.queryByRole("region", { name: SECCION })).toBeNull();
    // Ni siquiera se le pide la lista de comprobantes: es la misma superficie de dinero.
    expect(listarPagosMock).not.toHaveBeenCalled();
  });

  it("CONTRAPRUEBA: el mismo cierre CON permiso sí ofrece pagar (el gate discrimina)", async () => {
    const user = userEvent.setup();
    const cierre = makeResumen({
      cierreId: "c9",
      estado: "aprobado",
      resueltoAt: "2026-07-31T08:00:00.000Z",
      pendientePagoMensajero: "50000.00",
    });
    await abrirDetalleDelHistorico(user, cierre, { puedeRegistrarPago: true });

    expect(await screen.findByRole("region", { name: SECCION })).toBeInTheDocument();
  });
});

describe("T E.1/R17 — «Ahora no»: el cierre queda APROBADO y no se paga nada", () => {
  it("cierra el diálogo sin llamar a ninguna acción de pago", async () => {
    const user = userEvent.setup();
    await aprobarDesdeLaCola(user);
    const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });

    await user.click(within(dialogo).getByRole("button", { name: PAGO_MENSAJERO_TEXTO.ahoraNo }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: DIALOGO_PAGO })).toBeNull());
    // Lo único que decide esta task: NADA se persiste al declinar.
    expect(registrarPagoMock).not.toHaveBeenCalled();
    // Y el cierre sigue aprobado: ni se reintenta la aprobación ni se deshace.
    expect(successMock).toHaveBeenCalledWith("Cierre aprobado correctamente.");
    ningunaOtraDecisionDelCierre();
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("el botón se llama «Ahora no» y NO «Cancelar»: no hay nada que cancelar", async () => {
    const user = userEvent.setup();
    await aprobarDesdeLaCola(user);
    const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });

    // El matiz no es cosmético: «Cancelar» insinuaría que se deshace la aprobación, que es
    // justo la lectura que R17/R18 existen para impedir.
    expect(
      within(dialogo).getByRole("button", { name: PAGO_MENSAJERO_TEXTO.ahoraNo }),
    ).toBeInTheDocument();
    expect(within(dialogo).queryByRole("button", { name: "Cancelar" })).toBeNull();
  });
});

describe("T E.1/R17 — si el PAGO FALLA, el cierre sigue aprobado y el mensaje lo dice", () => {
  it("un fallo de red no toca la aprobación y el aviso empieza por lo que SÍ quedó hecho", async () => {
    const user = userEvent.setup();
    registrarPagoMock.mockRejectedValue(new Error("network"));
    await aprobarDesdeLaCola(user);
    const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });

    await user.click(within(dialogo).getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(registrarPagoMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(PAGO_MENSAJERO_TEXTO.cierreSigueAprobado),
    );
    // El mensaje DICE que el cierre quedó aprobado; no es un «algo falló» genérico.
    expect(PAGO_MENSAJERO_TEXTO.cierreSigueAprobado).toMatch(/cierre qued[óo] aprobado/i);
    // La aprobación se declaró y no se deshizo por el fallo del pago.
    expect(successMock).toHaveBeenCalledWith("Cierre aprobado correctamente.");
    ningunaOtraDecisionDelCierre();
    // El formulario sigue abierto para reintentar (con la MISMA clave, T D.1/R43).
    expect(screen.getByRole("dialog", { name: DIALOGO_PAGO })).toBeInTheDocument();
  });

  it("un rechazo del DOMINIO (`excede`) tampoco revierte nada, y también se avisa", async () => {
    const user = userEvent.setup();
    registrarPagoMock.mockResolvedValue({ status: "excede", disponible: "40000.00" });
    await aprobarDesdeLaCola(user);
    const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });

    await user.click(within(dialogo).getByRole("button", { name: "Registrar pago" }));

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(PAGO_MENSAJERO_TEXTO.cierreSigueAprobado),
    );
    expect(successMock).toHaveBeenCalledWith("Cierre aprobado correctamente.");
    ningunaOtraDecisionDelCierre();
    // Y el disponible que devolvió el servidor se pinta tal cual, sin recalcularlo.
    expect(within(dialogo).getByRole("alert")).toHaveTextContent("₡40.000,00");
  });

  it("un `forbidden` del servidor deja igual el cierre: aprobado y con la deuda abierta", async () => {
    const user = userEvent.setup();
    registrarPagoMock.mockResolvedValue({ status: "forbidden" });
    await aprobarDesdeLaCola(user);
    const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });

    await user.click(within(dialogo).getByRole("button", { name: "Registrar pago" }));

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(PAGO_MENSAJERO_TEXTO.cierreSigueAprobado),
    );
    ningunaOtraDecisionDelCierre();
  });
});

describe("T E.1/R18 — aprobar NO exige pagar ni crea ningún estado nuevo", () => {
  it("el payload de aprobar es el MISMO de la 38: ni una clave de pago", async () => {
    const user = userEvent.setup();
    await aprobarDesdeLaCola(user);

    expect(aprobarMock).toHaveBeenCalledWith({ cierreId: "c1" });
    expect(Object.keys(aprobarMock.mock.calls[0][0] as object)).toEqual(["cierreId"]);
  });

  it("el éxito de la aprobación se declara y la ruta se refresca ANTES de saber si se paga", async () => {
    const user = userEvent.setup();
    await aprobarDesdeLaCola(user);

    // Con el diálogo de pago todavía abierto y sin haber pagado nada:
    expect(await screen.findByRole("dialog", { name: DIALOGO_PAGO })).toBeInTheDocument();
    expect(successMock).toHaveBeenCalledWith("Cierre aprobado correctamente.");
    expect(refreshMock).toHaveBeenCalled();
    expect(registrarPagoMock).not.toHaveBeenCalled();
  });

  it("declinar dos veces seguidas no deja rastro: el cierre no vuelve a decidirse", async () => {
    const user = userEvent.setup();
    await aprobarDesdeLaCola(user);
    const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });
    await user.click(within(dialogo).getByRole("button", { name: PAGO_MENSAJERO_TEXTO.ahoraNo }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: DIALOGO_PAGO })).toBeNull());

    // «Ahora no» no es un estado: no se guardó nada que impida volver a ofrecerlo mañana.
    ningunaOtraDecisionDelCierre();
    expect(registrarPagoMock).not.toHaveBeenCalled();
  });
});

// =========================================================================
// T E.2 — Pagar DESPUÉS, desde el detalle de un cierre aprobado (R19, R27, R28, R49)
// =========================================================================

describe("T E.2/R19 — el detalle de un cierre APROBADO ofrece registrar el pago", () => {
  const APROBADO = makeResumen({
    cierreId: "c2",
    estado: "aprobado",
    resueltoAt: "2026-07-31T08:00:00.000Z",
    pendientePagoMensajero: "50000.00",
  });

  it("muestra la sección con el pendiente y el botón de registrar", async () => {
    const user = userEvent.setup();
    await abrirDetalleDelHistorico(user, APROBADO);

    const seccion = await screen.findByRole("region", { name: SECCION });
    expect(within(seccion).getByText(PAGO_MENSAJERO_TEXTO.pendiente + ":")).toBeInTheDocument();
    expect(within(seccion).getByText("₡50.000,00")).toBeInTheDocument();
    expect(
      within(seccion).getByRole("button", { name: PAGO_MENSAJERO_TEXTO.registrar }),
    ).toBeInTheDocument();
  });

  it("el botón abre el diálogo y registrar manda el `cierreId` de ESE cierre", async () => {
    const user = userEvent.setup();
    await abrirDetalleDelHistorico(user, APROBADO);
    const seccion = await screen.findByRole("region", { name: SECCION });

    await user.click(within(seccion).getByRole("button", { name: PAGO_MENSAJERO_TEXTO.registrar }));
    const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });
    expect(within(dialogo).getByLabelText(/^Monto/)).toHaveValue("50000.00");

    await user.click(within(dialogo).getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(registrarPagoMock).toHaveBeenCalledTimes(1));
    expect(registrarPagoMock.mock.calls[0][0]).toMatchObject({
      cierreId: "c2",
      monto: "50000.00",
    });
  });

  it("aquí el botón de salida SÍ dice «Cancelar»: no venimos de aprobar", async () => {
    const user = userEvent.setup();
    await abrirDetalleDelHistorico(user, APROBADO);
    const seccion = await screen.findByRole("region", { name: SECCION });
    await user.click(within(seccion).getByRole("button", { name: PAGO_MENSAJERO_TEXTO.registrar }));

    const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });
    expect(within(dialogo).getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(
      within(dialogo).queryByRole("button", { name: PAGO_MENSAJERO_TEXTO.ahoraNo }),
    ).toBeNull();
  });

  it("tras registrar, el pendiente se vuelve a LEER del servidor (no se resta en el cliente)", async () => {
    const user = userEvent.setup();
    await abrirDetalleDelHistorico(user, APROBADO);
    const seccion = await screen.findByRole("region", { name: SECCION });
    await user.click(within(seccion).getByRole("button", { name: PAGO_MENSAJERO_TEXTO.registrar }));
    const dialogo = await screen.findByRole("dialog", { name: DIALOGO_PAGO });

    // El servidor devolverá el cierre ya liquidado en la relectura del detalle.
    verDetalleMock.mockResolvedValue({
      status: "ok",
      cierre: { ...APROBADO, pendientePagoMensajero: "0.00" },
      grupos: emptyGrupos(),
      totalesIngreso: zeroIngreso(),
      desgloseIngresoBodegaRechazos: { sla: "0.00", manual: "0.00", total: "0.00" },
      ganancia: "0.00",
      pagoTienda: "0.00",
    });

    await user.click(within(dialogo).getByRole("button", { name: "Registrar pago" }));

    // Se vuelve a pedir el DETALLE (2.ª llamada): el pendiente lo deriva el servidor (R14).
    await waitFor(() => expect(verDetalleMock).toHaveBeenCalledTimes(2));
    expect(verDetalleMock).toHaveBeenLastCalledWith({ cierreId: "c2" });
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: SECCION })).queryByRole("button", {
          name: PAGO_MENSAJERO_TEXTO.registrar,
        }),
      ).toBeNull(),
    );
  });
});

describe("T E.2/R28 — los CUATRO estados del cierre", () => {
  it.each<[CierreEstado, boolean]>([
    ["solicitado", false],
    ["vencido", false],
    ["rechazado", false],
    ["aprobado", true],
  ])("estado `%s` → sección visible: %s", async (estado, visible) => {
    const user = userEvent.setup();
    // El pendiente de un cierre NO aprobado es `null` por contrato (T C.2/R28).
    const cierre = makeResumen({
      cierreId: `c-${estado}`,
      estado,
      resueltoAt: estado === "solicitado" || estado === "vencido" ? null : "2026-07-31T08:00:00.000Z",
      pendientePagoMensajero: estado === "aprobado" ? "50000.00" : null,
    });
    conDetalleDe(cierre);
    // Los no resueltos viven en la cola; los resueltos, en el histórico.
    const enCola = estado === "solicitado" || estado === "vencido";
    renderModule(enCola ? { pendientes: [cierre] } : { historico: [cierre] });

    if (!enCola) await user.click(screen.getByRole("button", { name: /^Resueltos/ }));
    const region = screen.getByRole("region", {
      name: enCola ? "Pendientes de decisión" : "Histórico",
    });
    // El nombre accesible del botón depende de dónde vive el comprobante: en la cola, «Ver /
    // decidir» si es resoluble y «Ver el cierre de …» si es un `vencido`; en el histórico,
    // «Ver el cierre resuelto de …». Los tres abren el mismo detalle.
    const abrir = within(region).getByRole("button", {
      name:
        estado === "solicitado"
          ? "Ver / decidir"
          : enCola
            ? /^Ver el cierre de/
            : /^Ver el cierre resuelto de/,
    });
    await user.click(abrir);
    await screen.findByRole("dialog", { name: "Detalle del cierre" });

    if (visible) {
      expect(await screen.findByRole("region", { name: SECCION })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("region", { name: SECCION })).toBeNull();
      // En un cierre no aprobado no se muestra NI SE PIDE nada relativo al pago.
      expect(listarPagosMock).not.toHaveBeenCalled();
    }
    cleanup();
  });
});

describe("T E.2/R27 — con el cierre liquidado del todo NO hay botón de registrar", () => {
  const LIQUIDADO = makeResumen({
    cierreId: "c3",
    estado: "aprobado",
    resueltoAt: "2026-07-31T08:00:00.000Z",
    pendientePagoMensajero: "0.00",
  });

  it("no ofrece registrar, y lo dice con TEXTO en vez de con un hueco", async () => {
    const user = userEvent.setup();
    await abrirDetalleDelHistorico(user, LIQUIDADO);

    const seccion = await screen.findByRole("region", { name: SECCION });
    expect(
      within(seccion).queryByRole("button", { name: PAGO_MENSAJERO_TEXTO.registrar }),
    ).toBeNull();
    expect(within(seccion).getByText(PAGO_MENSAJERO_TEXTO.liquidado)).toBeInTheDocument();
    expect(within(seccion).getByText(PAGO_MENSAJERO_TEXTO.sinPendiente)).toBeInTheDocument();
  });

  it("pero los COMPROBANTES se siguen viendo: son la explicación de por qué ya no debe nada", async () => {
    const user = userEvent.setup();
    listarPagosMock.mockResolvedValue({ status: "ok", pagos: [COMPROBANTE] });
    await abrirDetalleDelHistorico(user, LIQUIDADO);

    const seccion = await screen.findByRole("region", { name: SECCION });
    expect(await within(seccion).findByText("₡50.000,00")).toBeInTheDocument();
  });
});

describe("T E.2/R49 — la lista de comprobantes del cierre", () => {
  const APROBADO = makeResumen({
    cierreId: "c4",
    estado: "aprobado",
    resueltoAt: "2026-07-31T08:00:00.000Z",
    pendientePagoMensajero: "12000.00",
  });

  it("se pide para ESE cierre y pinta fecha real, monto, método, referencia, nota, quién y cuándo", async () => {
    const user = userEvent.setup();
    listarPagosMock.mockResolvedValue({ status: "ok", pagos: [COMPROBANTE] });
    await abrirDetalleDelHistorico(user, APROBADO);

    await waitFor(() => expect(listarPagosMock).toHaveBeenCalledWith({ cierreId: "c4" }));
    const tabla = await screen.findByRole("table", {
      name: `Pagos registrados de ${MENSAJERO}`,
    });
    const fila = within(tabla).getByText("2026-07-31").closest("tr") as HTMLElement;
    expect(within(fila).getByText("₡50.000,00")).toBeInTheDocument();
    expect(within(fila).getByText("SINPE")).toBeInTheDocument();
    expect(within(fila).getByText("SINPE-99887766")).toBeInTheDocument();
    expect(within(fila).getByText("Liquidación del cierre del 30")).toBeInTheDocument();
    expect(within(fila).getByText("Ana Maestra")).toBeInTheDocument();
    expect(within(fila).getByText("2026-08-02")).toBeInTheDocument();
  });

  it("un fallo de la lectura se dice en la tabla, sin tumbar la sección ni el botón", async () => {
    const user = userEvent.setup();
    listarPagosMock.mockResolvedValue({ status: "forbidden" });
    await abrirDetalleDelHistorico(user, APROBADO);

    const seccion = await screen.findByRole("region", { name: SECCION });
    expect(
      await within(seccion).findByText("No se pudieron cargar los pagos registrados."),
    ).toBeInTheDocument();
    expect(
      within(seccion).getByRole("button", { name: PAGO_MENSAJERO_TEXTO.registrar }),
    ).toBeInTheDocument();
  });
});

// =========================================================================
// T E.3 — La deuda se ve sin abrir nada (R26, R28)
// =========================================================================

describe("T E.3/R26 — columna «pendiente de liquidar» en el listado", () => {
  it("un cierre aprobado CON deuda se distingue en el listado, con el importe del servidor", async () => {
    const user = userEvent.setup();
    // R26 no cambió con el pedido humano del 2026-08-16, y esta es la mitad que importa: LA
    // DEUDA SE VE SIN ABRIR NADA. Antes era una columna del histórico; ahora es una insignia
    // junto al estado, en la cabecera del comprobante — fuera del desplegable, a propósito.
    renderModule({
      historico: [
        makeResumen({
          cierreId: "c5",
          estado: "aprobado",
          resueltoAt: "2026-07-31T08:00:00.000Z",
          pendientePagoMensajero: "1234.50",
        }),
      ],
    });

    const region = await verHistorico(user);
    // El importe se PINTA, no se calcula: es el STRING del servidor, carácter por carácter.
    expect(within(region).getByText("₡1.234,50")).toBeInTheDocument();
  });

  it("los TRES casos se distinguen entre sí (no es una etiqueta fija)", async () => {
    const user = userEvent.setup();
    renderModule({
      historico: [
        makeResumen({
          cierreId: "c-deuda",
          estado: "aprobado",
          resueltoAt: "2026-07-31T08:00:00.000Z",
          pendientePagoMensajero: "0.10",
        }),
        makeResumen({
          cierreId: "c-liquidado",
          estado: "aprobado",
          resueltoAt: "2026-07-31T08:00:00.000Z",
          pendientePagoMensajero: "0.00",
        }),
        makeResumen({
          cierreId: "c-rechazado",
          estado: "rechazado",
          resueltoAt: "2026-07-31T08:00:00.000Z",
          motivoRechazo: "Faltan evidencias",
          pendientePagoMensajero: null,
        }),
      ],
    });

    // Un comprobante por cierre, en el orden que devolvió el servidor. Los tres se distinguen
    // por lo que su cabecera dice del pago, sin abrir ninguno.
    await verHistorico(user);
    const filas = within(
      screen.getByRole("list", { name: "Histórico" }),
    ).getAllByRole("listitem");
    expect(filas).toHaveLength(3);

    // Con deuda: el importe, hasta el último céntimo.
    expect(filas[0].textContent).toContain("₡0,10");
    // Liquidado del todo (R27): deja de señalarse como pendiente, pero NO pasa por «no se
    // sabe» ni repite el importe: «no debe nada» y «todavía no aplica» son cosas distintas.
    expect(filas[1].textContent).toContain(PAGO_MENSAJERO_TEXTO.sinPendiente);
    expect(filas[1].textContent).not.toContain("₡0,10");
    // No aprobado (R28): no se muestra NADA relativo al pago. En la tabla ese «nada» era un
    // guion —la celda existía y había que rellenarla—; en una tarjeta no hay celda que llenar,
    // así que el marcador de ausencia es que la insignia no se pinta. Es la misma decisión de
    // R28 dicha en el medio nuevo, y por eso se comprueba por las dos mitades: ni importe, ni
    // la etiqueta de «al día».
    expect(filas[2].textContent).not.toContain(PAGO_MENSAJERO_TEXTO.sinPendiente);
    expect(filas[2].textContent).not.toContain("₡0,10");
  });

  it("R28 — la COLA no muestra pendiente: sus cierres no están aprobados", () => {
    renderModule({
      pendientes: [makeResumen({ cierreId: "c6", estado: "solicitado" })],
    });

    const region = screen.getByRole("region", { name: "Pendientes de decisión" });
    // Ni la insignia de «al día» ni ningún rótulo del pendiente: en la cola, `null` por
    // definición (R28). Se pregunta por el TEXTO, que es lo que un comprobante puede tener.
    expect(within(region).queryByText(PAGO_MENSAJERO_TEXTO.pendiente)).toBeNull();
    expect(within(region).queryByText(PAGO_MENSAJERO_TEXTO.sinPendiente)).toBeNull();
  });
});

// =========================================================================
// R14 — money-safe: el dinero es TEXTO de punta a punta
// =========================================================================

describe("R14 — ni un `Number(` ni un `parseFloat` sobre montos en esta tanda", () => {
  it.each([
    "app/(app)/cierres-admin/_components/PagoMensajeroSeccion.tsx",
    "app/(app)/cierres-admin/_components/PendienteLiquidarBadge.tsx",
    "app/(app)/cierres-admin/_components/RegistrarPagoMensajeroDialog.tsx",
    "app/(app)/cierres-admin/_components/pago-mensajero-labels.ts",
    "app/(app)/cierres-admin/_components/CierresAdminModule.tsx",
    "app/(app)/cierres-admin/_components/CierresAdminHistoricoLista.tsx",
  ])("%s no convierte dinero a número", (ruta) => {
    const codigo = codigoSinComentarios(ruta);
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(codigo).not.toMatch(prohibida);
    }
  });

  it("CONTRAPRUEBA: el barrido detecta de verdad una conversión colada", () => {
    const codigo = codigoSinComentarios(
      "app/(app)/cierres-admin/_components/PendienteLiquidarBadge.tsx",
    );
    const mutado = `${codigo}\nconst x = Number(pendiente);`;
    expect(LLAMADAS_PROHIBIDAS_EN_DINERO.some((p) => p.test(mutado))).toBe(true);
  });
});
