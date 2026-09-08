// @vitest-environment jsdom
// Feature 230 (T5.1) — la descarga DETALLADA montada en «Cierres del día» (`cierres-admin`).
//
// Cubre R1, R4, R6, R33, R38 y R51.
//
// Qué vigila que no vigile `DescargarGestionesDialog.test.tsx`: aquél prueba el diálogo aislado;
// éste prueba que la PANTALLA lo monta bien — que descargar no mueve nada de lo que el usuario
// tenía delante, y que el archivo que sale es el que el diálogo pidió.
//
// ACTUALIZADO el 2026-09-05: ya no hay un botón «Descargar detallada» junto al general. Hay UNO,
// y el detalle es un NIVEL de su selector; por eso cada caso empieza eligiéndolo. Lo que este
// archivo afirma no cambia —el conjunto lo redacta el diálogo, el archivo es el que pidió—; lo
// que cambia es cómo se llega. Que sea UNO y que el nivel mande sobre las columnas lo cubre
// `CierresDescargaNiveles.test.tsx`.
//
// La no-regresión de la descarga GENERAL (R2) vive en `CierresDescarga.test.tsx`, que NO se ha
// tocado: si hubiera hecho falta tocarlo, sería un hallazgo y no un ajuste.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type { CierreResultado } from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreGestionDescargaDTO } from "@/lib/interfaces/services/ICierresAdminService";
import type { CatalogoFiltrosCierresDTO } from "@/lib/types/filtros-cierres";

vi.mock("@/lib/actions/cierres-admin", () => ({
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  forzarSolicitudVencido: vi.fn(),
  listarHistoricoCierresAdminPaginado: vi.fn(),
  listarHistoricoCierresAdminCompleto: vi.fn(),
  listarPendientesCierresAdminPaginado: vi.fn(),
  listarPendientesCierresAdminCompleto: vi.fn(),
  // Feature 230 (T2.3): el ÚNICO punto de entrada de la descarga detallada de esta pantalla.
  listarGestionesCierresAdminCompleto: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
  usePathname: () => "/cierres-admin",
  useSearchParams: () => new URLSearchParams(),
}));
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

const { errorToastMock } = vi.hoisted(() => ({ errorToastMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorToastMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import {
  listarGestionesCierresAdminCompleto,
  listarHistoricoCierresAdminPaginado,
  listarPendientesCierresAdminCompleto,
  listarPendientesCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import { paginaInicial } from "@/tests/fixtures/pagina-inicial";
import { CierresAdminModule } from "@/app/(app)/cierres-admin/_components/CierresAdminModule";
import {
  NIVEL_DETALLE_LABEL,
  SELECTOR_DISPARADOR,
} from "@/app/(app)/cierres-admin/_components/DescargarCierresButton";

// --- Datos ----------------------------------------------------------------

const ANA = "11111111-1111-4111-8111-111111111111";
const BETO = "22222222-2222-4222-8222-222222222222";
const ZONA = "33333333-3333-4333-8333-333333333333";

const CATALOGO: CatalogoFiltrosCierresDTO = {
  zonas: [{ id: ZONA, nombre: "Bodega central" }],
  mensajeros: [
    { id: ANA, nombre: "Ana Mensajera", zonaId: ZONA },
    { id: BETO, nombre: "Beto Mensajero", zonaId: ZONA },
  ],
  // Ficha 351: los dos en pie, así que filtro y universo coinciden en este fixture.
  mensajerosFiltro: [
    { id: ANA, nombre: "Ana Mensajera", zonaId: ZONA },
    { id: BETO, nombre: "Beto Mensajero", zonaId: ZONA },
  ],
};

const TOTALES = {
  efectivo: "1000.10",
  simpe: "0.00",
  transferencia: "0.00",
  general: "1000.10",
};

function cierreAdmin(cierreId: string, over: Partial<CierreAdminResumen> = {}): CierreAdminResumen {
  return {
    cierreId,
    mensajeroId: `m-${cierreId}`,
    mensajeroNombre: "Ana Mensajera",
    estado: "solicitado",
    // En esta pantalla el maestro solo ve los cierres con destino BODEGA CENTRAL (la GAM):
    // design §2.6. Lo satélite le llega consolidado, por la otra pantalla.
    destinoTipo: "bodega_central",
    destinoZonaId: ZONA,
    destinoZonaNombre: "Bodega central",
    totales: TOTALES,
    totalPagoMensajero: "100.10",
    totalIngresoBodegaRechazos: "5.00",
    pendientePagoMensajero: null,
    solicitadoAt: "2026-07-11T10:00:00.000Z",
    resueltoAt: null,
    motivoRechazo: null,
    ...over,
  };
}

const PENDIENTES = [cierreAdmin("c1"), cierreAdmin("c2")];
const HISTORICO = [
  cierreAdmin("c3", { estado: "aprobado", resueltoAt: "2026-07-12T10:00:00.000Z" }),
];

function gestion(resultado: CierreResultado, numRemision: string): CierreGestionDescargaDTO {
  return {
    mensajeroNombre: "Ana Mensajera",
    cierreSolicitadoAt: "2026-07-11T10:00:00.000Z",
    fechaGestion: "2026-07-11",
    diaReparto: "2026-07-11",
    fechaCreacionOrden: "2026-07-05",
    numGuia: 1001,
    numRemision,
    destinatario: "Ana Pérez",
    direccion: "Calle 1",
    zonaNombre: "San José",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: null,
    producto: "Caja",
    tiendaNombre: "Tienda X",
    intentosContactoTienda: 2,
    resultado,
    montoRecibido: null,
    pagos: [],
    motivo: null,
    fechaReprogramacion: null,
    esRechazoSla: false,
    causaIncidente: null,
    indemnizacion: null,
    pagoMensajero: "100.10",
    ingresoBodegaRechazo: null,
    ingresoOrdenex: null,
  };
}

/** Un conjunto con los CINCO resultados a la vez: el caso que D3 decidió fundir en una hoja. */
const LOS_CINCO = [
  gestion("entregada", "REM-1"),
  gestion("reprogramada", "REM-2"),
  gestion("devuelta", "REM-3"),
  gestion("rechazada", "REM-4"),
  gestion("incidente", "REM-5"),
];

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

function montar() {
  vi.mocked(listarPendientesCierresAdminPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(PENDIENTES),
  });
  vi.mocked(listarHistoricoCierresAdminPaginado).mockResolvedValue({
    status: "ok",
    page: 1,
    ...paginaInicial(HISTORICO),
  });
  vi.mocked(listarPendientesCierresAdminCompleto).mockResolvedValue({
    status: "ok",
    items: PENDIENTES,
    total: PENDIENTES.length,
  });
  return envolver(
    <CierresAdminModule
      pendientes={paginaInicial(PENDIENTES)}
      historico={paginaInicial(HISTORICO)}
      sinZona={false}
      catalogoFiltros={CATALOGO}
    />,
  );
}

/** El nombre accesible del botón único cuando el nivel elegido es «Detalle». */
const BOTON_DETALLE = "Descargar detallada por mensajero";

/**
 * Pone el botón en el nivel «Detalle». Es el primer paso de TODA descarga detallada desde que
 * los dos botones se fundieron en uno: se abre el selector, se elige el nivel y se cierra.
 */
async function elegirNivelDetalle(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: SELECTOR_DISPARADOR }));
  await user.click(await screen.findByRole("radio", { name: NIVEL_DETALLE_LABEL }));
  await user.keyboard("{Escape}");
  return screen.findByRole("button", { name: BOTON_DETALLE });
}

/**
 * Elige el nivel, abre el diálogo y deja elegida SOLO a Ana.
 *
 * Desde el 2026-08-19 el diálogo abre con TODOS marcados, así que «elegir a Ana» ya no es un
 * clic sobre Ana —eso la desmarcaría—: es apagar la lista desde «Todos» y encenderla a ella.
 */
async function abrirYElegirAAna(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await elegirNivelDetalle(user));
  await user.click(await screen.findByRole("checkbox", { name: "Todos" }));
  await user.click(screen.getByRole("checkbox", { name: "Ana Mensajera" }));
}

/**
 * Escribe una fecha. El `clear` es defensivo: desde la ficha 384 (2026-09-07) los controles abren
 * VACÍOS —el rango hoy-hoy del 2026-08-19 se retiró porque era un filtro que nadie puso—, pero
 * escribir dos veces sobre el mismo control sin vaciarlo concatenaría los valores.
 */
async function ponerFecha(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  valor: string,
) {
  const control = screen.getByLabelText(label);
  await user.clear(control);
  await user.type(control, valor);
}

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});
afterEach(() => cleanup());

describe("descarga detallada en cierres del día (T5.1)", () => {
  it("la descarga detallada se ofrece en las DOS pestañas, como un nivel del botón único (R1)", async () => {
    montar();
    const user = userEvent.setup();

    // UN control con dos niveles: «Resumen» baja una fila por CIERRE de lo que la pestaña
    // enseña; «Detalle», una fila por GESTIÓN de lo que su diálogo diga.
    expect(
      await screen.findByRole("button", { name: "Descargar Cierres pendientes de decisión" }),
    ).toBeInTheDocument();
    expect(await elegirNivelDetalle(user)).toBeInTheDocument();

    // Y también en la otra pestaña: el conjunto del detallado no depende de cuál esté abierta.
    await user.click(screen.getByRole("button", { name: /^Resueltos/ }));
    expect(screen.getByRole("button", { name: BOTON_DETALLE })).toBeInTheDocument();
  });

  it("cada nivel tiene su nombre accesible y su nombre de archivo (R51)", async () => {
    montar();
    const user = userEvent.setup();

    const general = await screen.findByRole("button", {
      name: "Descargar Cierres pendientes de decisión",
    });
    const nombreGeneral = general.getAttribute("aria-label");
    const detallada = await elegirNivelDetalle(user);
    expect(nombreGeneral).not.toBe(detallada.getAttribute("aria-label"));

    // El nombre del ARCHIVO también los distingue: `cierres-pendientes-…` vs `gestiones-…`.
    vi.mocked(listarGestionesCierresAdminCompleto).mockResolvedValue({
      status: "ok",
      items: LOS_CINCO,
      total: LOS_CINCO.length,
    });
    await abrirYElegirAAna(user);
    await user.click(screen.getByRole("button", { name: "Descargar Gestiones de cierres" }));

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    expect(descargarBlobMock.mock.calls[0][2]).toMatch(
      /^gestiones-de-cierres-\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
  });

  it("produce un solo archivo de una sola hoja para un conjunto con los cinco resultados (R6)", async () => {
    montar();
    const user = userEvent.setup();
    vi.mocked(listarGestionesCierresAdminCompleto).mockResolvedValue({
      status: "ok",
      items: LOS_CINCO,
      total: LOS_CINCO.length,
    });

    await abrirYElegirAAna(user);
    await user.click(screen.getByRole("button", { name: "Descargar Gestiones de cierres" }));

    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    // UN archivo (una llamada al generador, una entrega) y UNA hoja (un solo `sheetName`).
    expect(descargarBlobMock).toHaveBeenCalledTimes(1);
    const [columnas, filas, hoja] = buildXlsxRowsMock.mock.calls[0];
    expect(hoja).toBe("Gestiones de cierres");
    // 31 desde la ficha 385 (2026-09-07): las 29 anteriores más «Fecha de creación de la orden»
    // e «Intentos de contacto de la tienda». Aquéllas eran las 27 de la 230 más «Fecha de
    // gestión» y «Día de reparto» (2026-09-05).
    expect(columnas).toHaveLength(31);
    // Cinco resultados distintos, CINCO filas, en la misma hoja y con la columna que los nombra.
    expect(filas).toHaveLength(5);
    expect(filas.map((f) => f.resultado)).toEqual([
      "Entregada",
      "Reprogramada",
      "Devuelta",
      "Rechazada",
      "Incidente",
    ]);
  });

  it("el archivo solo contiene gestiones de los mensajeros y el rango confirmados (R33)", async () => {
    montar();
    const user = userEvent.setup();
    vi.mocked(listarGestionesCierresAdminCompleto).mockResolvedValue({
      status: "ok",
      items: [LOS_CINCO[0]],
      total: 1,
    });

    await user.click(await elegirNivelDetalle(user));
    await user.click(await screen.findByRole("checkbox", { name: "Todos" }));
    await user.click(screen.getByRole("checkbox", { name: "Beto Mensajero" }));
    await ponerFecha(user, "Desde", "2026-07-01");
    await ponerFecha(user, "Hasta", "2026-07-31");
    await user.click(screen.getByRole("button", { name: "Descargar Gestiones de cierres" }));

    await waitFor(() => expect(listarGestionesCierresAdminCompleto).toHaveBeenCalledTimes(1));
    // Lo confirmado, y SOLO lo confirmado: el alcance no viaja (lo resuelve el servicio) y los
    // filtros de la barra tampoco (D11).
    expect(listarGestionesCierresAdminCompleto).toHaveBeenCalledWith({
      mensajeroIds: [BETO],
      desde: "2026-07-01",
      hasta: "2026-07-31",
    });
    // Y las filas del archivo son EXACTAMENTE lo que devolvió ese borde, sin añadir nada.
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(1);
    expect(filas[0].numRemision).toBe("REM-1");
  });

  it("un mensajero sin cierres y uno fuera de alcance producen el mismo mensaje (R38)", async () => {
    // D12, y es deliberado: distinguirlos filtraría información sobre el alcance ajeno. Los dos
    // llegan como `{ ok, items: [] }` y no hay ninguna rama que los separe.
    montar();
    const user = userEvent.setup();
    vi.mocked(listarGestionesCierresAdminCompleto).mockResolvedValue({
      status: "ok",
      items: [],
      total: 0,
    });

    await abrirYElegirAAna(user);
    await user.click(screen.getByRole("button", { name: "Descargar Gestiones de cierres" }));
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    const mensajeSinCierres = errorToastMock.mock.calls[0][0];

    // Ahora el «fuera de alcance»: el servicio devuelve lo MISMO (nunca `forbidden`, nunca
    // filas ajenas), así que la pantalla no puede decir nada distinto.
    await user.click(screen.getByRole("checkbox", { name: "Ana Mensajera" }));
    await user.click(screen.getByRole("checkbox", { name: "Beto Mensajero" }));
    await user.click(screen.getByRole("button", { name: "Descargar Gestiones de cierres" }));
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(2));

    expect(errorToastMock.mock.calls[1][0]).toBe(mensajeSinCierres);
    // Ni uno ni otro producen archivo.
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("descargar no cambia la página, ni los filtros, ni el detalle abierto (R4)", async () => {
    montar();
    const user = userEvent.setup();
    vi.mocked(listarGestionesCierresAdminCompleto).mockResolvedValue({
      status: "ok",
      items: LOS_CINCO,
      total: LOS_CINCO.length,
    });

    // Estado de partida: la cola pintada, con su contador y su pestaña.
    await screen.findByRole("button", { name: "Descargar Cierres pendientes de decisión" });
    const pestanaAntes = screen.getByRole("button", { name: /^Pendientes/ }).textContent;
    // Se deja asentar la lectura de la página antes de contar: SWR revalida al montar, y medir
    // antes de que termine haría que este caso midiera el arranque en vez de la descarga.
    await waitFor(() => expect(listarPendientesCierresAdminPaginado).toHaveBeenCalled());
    const lecturasAntes = vi.mocked(listarPendientesCierresAdminPaginado).mock.calls.length;

    await abrirYElegirAAna(user);
    await user.click(screen.getByRole("button", { name: "Descargar Gestiones de cierres" }));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    // Se cierra el diálogo para volver a mirar la pantalla que había debajo: mientras está
    // abierto, el modal la deja inerte y no habría nada que observar.
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Ni una lectura más del listado: la descarga detallada no re-pagina ni refresca la ruta.
    expect(vi.mocked(listarPendientesCierresAdminPaginado).mock.calls.length).toBe(lecturasAntes);
    expect(refreshMock).not.toHaveBeenCalled();
    // La pestaña activa y su contador siguen siendo los de antes.
    expect(screen.getByRole("button", { name: /^Pendientes/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^Pendientes/ }).textContent).toBe(pestanaAntes);
    // Y el listado general no se ha vuelto a leer para el archivo detallado: son dos bordes.
    expect(listarPendientesCierresAdminCompleto).not.toHaveBeenCalled();
  });
});
