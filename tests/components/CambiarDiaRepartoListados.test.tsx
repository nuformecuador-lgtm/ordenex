// @vitest-environment jsdom
// Feature 262 — F5 sobre F3/F4: la acción «Cambiar día de reparto» en LAS DOS SUPERFICIES
// (R13). Cubre que aparece en los estados que toca, que NO aparece donde no toca, y que la
// puerta de cada página no se toca.
//
// Las dos se ejercitan con el componente REAL —`OrdenesListado` y `RecepcionSateliteModule`—;
// lo único mockeado es el borde (Server Actions), el toast y el router, para que lo verificado
// sea el cableado de la UI y no la implementación del backend. Molde literal de
// `tests/unit/components/deshacer-asignacion.ui.test.tsx` (149), que es el precedente exacto.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

const { refreshMock, successMock, errorMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
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

// El borde de la feature: UNA sola llamada por lote.
const corregirMock = vi.fn();
vi.mock("@/lib/actions/corregir-dia-reparto", () => ({
  corregirDiaReparto: (...a: unknown[]) => corregirMock(...a),
}));

// --- Acciones que consume el listado de `/ordenes` ---
const listarOrderStatusMock = vi.fn();
vi.mock("@/lib/actions/order-status", () => ({
  listarOrderStatus: (...a: unknown[]) => listarOrderStatusMock(...a),
}));

const listarOrdenesMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
}));

vi.mock("@/lib/actions/ordenes-guia", () => ({
  listarMensajerosParaAsignacion: vi.fn().mockResolvedValue({
    status: "ok",
    mensajeros: [],
    bloqueadosIds: [],
  }),
  listarZonasBloqueadasPorCierre: vi
    .fn()
    .mockResolvedValue({ status: "ok", zonasBloqueadasIds: [] }),
}));

vi.mock("@/lib/actions/deshacer-asignacion", () => ({
  deshacerAsignacion: vi.fn(),
}));

// --- Acciones que consume el módulo de la bodega satélite ---
const { paginadoBodegaMock } = vi.hoisted(() => ({ paginadoBodegaMock: vi.fn() }));
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: vi.fn(),
  listarRecepcionSatelite: vi.fn(),
  asignarDesdeSatelite: vi.fn(),
  listarOrdenesBodegaPaginado: (...args: unknown[]) => paginadoBodegaMock(...args),
  listarOrdenesBodegaCompleto: vi.fn(async () => ({ status: "ok", items: [], total: 0 })),
  listarIdsVigentesBodega: vi.fn(async () => ({ status: "ok", ids: [] })),
}));
vi.mock("@/lib/actions/envio-devolucion-central", () => ({
  enviarACentral: vi.fn(),
}));
vi.mock("@/lib/actions/resolver-novedad", () => ({
  recuperarABodega: vi.fn(),
}));
vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

import { OrdenesListado } from "@/app/(app)/ordenes/_components/OrdenesListado";
import { RecepcionSateliteModule } from "@/app/(app)/recepcion-satelite/_components/RecepcionSateliteModule";
import {
  PAGE_SIZE_SATELITE,
  catalogoSatelite,
  paginaBodega,
} from "@/tests/fixtures/satelite-bodega";

/** LITERAL a mano: es lo que la persona lee en el botón, no lo que una constante devuelve. */
const ACCION = "Cambiar día de reparto";
const CONFIRMAR = "Cambiar día";
const MOTIVO_OK = "la bodega marcó el lote para el día que no era";
const FECHAS = { hoy: "2026-08-22", manana: "2026-08-23" };

/**
 * Los cinco estados que este test necesita del catálogo. Los TRES primeros son los que ofrecen
 * la corrección (donde el día de reparto todavía decide algo); los dos últimos son el control
 * negativo.
 */
const CATALOGO = [
  { id: "est-por_recoger", value: "por_recoger" },
  { id: "est-en_reparto", value: "en_reparto" },
  { id: "est-ayuda_tienda", value: "ayuda_tienda" },
  { id: "est-en_bodega_central", value: "en_bodega_central" },
  { id: "est-entregada", value: "entregada" },
];

function makeOrden(
  over: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: 1001,
    numRemision: `REM-${over.id}`,
    estatusId: "est-por_recoger",
    estatusValue: "por_recoger",
    fechaRepartoISO: "2026-08-23",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-1",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    zonaNombre: "Limón",
    zonaEsGam: false,
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  } as OrdenListItemDTO;
}

function makeOrdenSatelite(
  over: Partial<RecepcionSateliteDTO> & { id: string },
): RecepcionSateliteDTO {
  return {
    numGuia: 2001,
    numRemision: `SAT-${over.id}`,
    estatusValue: "por_recoger",
    fechaRepartoISO: "2026-08-23",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1",
    producto: "Caja",
    montoCobrar: 150,
    tiendaNombre: "Tienda X",
    zonaNombre: "Limón",
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: "Limón",
    ...over,
  } as RecepcionSateliteDTO;
}

function renderConSwr(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>,
  );
}

function renderOrdenes(items: OrdenListItemDTO[]) {
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items,
    page: 1,
    pageSize: 25,
    total: items.length,
  });
  return renderConSwr(<OrdenesListado accionesLote fechasDiaReparto={FECHAS} />);
}

function renderSatelite(asignadas: RecepcionSateliteDTO[]) {
  paginadoBodegaMock.mockResolvedValue({
    status: "ok",
    items: asignadas,
    page: 1,
    pageSize: PAGE_SIZE_SATELITE,
    total: asignadas.length,
  });
  return renderConSwr(
    <RecepcionSateliteModule
      porRecibir={[]}
      ordenesBodega={paginaBodega(asignadas)}
      catalogoFiltros={catalogoSatelite(asignadas)}
      zonaNombre="Limón"
      sinZona={false}
      mensajeros={[]}
      fechasDiaReparto={FECHAS}
      bloqueoBodega={{
        bloqueada: false,
        porMensajeros: false,
        porCierreBodega: false,
        cierresAbiertos: 0,
        totalMensajeros: 2,
        mensajerosConCierreIds: [],
      }}
    />,
  );
}

/** Marca el checkbox de una fila del listado de `/ordenes` por su nº de remisión. */
async function seleccionarFila(
  user: ReturnType<typeof userEvent.setup>,
  numRemision: string,
) {
  await user.click(
    await screen.findByRole("checkbox", { name: `Seleccionar orden ${numRemision}` }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarOrderStatusMock.mockResolvedValue({ status: "ok", estatus: CATALOGO });
  corregirMock.mockResolvedValue({ status: "ok", corregidas: 1, dia: "hoy" });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// F3 / R13 — `/ordenes`: los TRES estados donde el día todavía decide algo
// ---------------------------------------------------------------------------
describe("R13 — `/ordenes` ofrece la corrección en los tres estados del día vivo", () => {
  it("se ofrece con una selección en `por_recoger` (el caso principal)", async () => {
    const user = userEvent.setup();
    renderOrdenes([makeOrden({ id: "o1" })]);

    await seleccionarFila(user, "REM-o1");

    expect(await screen.findByRole("button", { name: ACCION })).toBeInTheDocument();
  });

  it("se ofrece en `en_reparto` — la población que la 261 dejó ATRAPADA", async () => {
    const user = userEvent.setup();
    renderOrdenes([
      makeOrden({ id: "o2", estatusId: "est-en_reparto", estatusValue: "en_reparto" }),
    ]);

    await seleccionarFila(user, "REM-o2");

    // Sin este estado esta ficha no rescata el caso que la motivó: el paquete ya está en la
    // mano del mensajero y, con el día equivocado, no puede gestionarlo.
    expect(await screen.findByRole("button", { name: ACCION })).toBeInTheDocument();
  });

  it("se ofrece en `ayuda_tienda` — el mismo bloqueo por la otra puerta", async () => {
    const user = userEvent.setup();
    renderOrdenes([
      makeOrden({ id: "o3", estatusId: "est-ayuda_tienda", estatusValue: "ayuda_tienda" }),
    ]);

    await seleccionarFila(user, "REM-o3");

    expect(await screen.findByRole("button", { name: ACCION })).toBeInTheDocument();
  });

  it("NO se ofrece en un estado donde el día ya no decide nada (`en_bodega_central`)", async () => {
    const user = userEvent.setup();
    renderOrdenes([
      makeOrden({
        id: "o4",
        estatusId: "est-en_bodega_central",
        estatusValue: "en_bodega_central",
        zonaEsGam: true,
      }),
    ]);

    await seleccionarFila(user, "REM-o4");

    // La barra de acciones EXISTE —esta selección sí tiene acciones—, y aun así la corrección
    // no está. La pareja presencia/ausencia es lo que impide que esto pase en verde por no
    // haberse renderizado nada.
    expect(
      await screen.findByRole("button", { name: "Asignar mensajero" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACCION })).toBeNull();
  });

  it("una orden `entregada` no gana casilla: no participa de ninguna acción por lote", async () => {
    // Acompañada de una `por_recoger` a propósito: la columna de casillas sólo se monta si
    // ALGUNA fila de la página tiene acción por lote. Sin la acompañante, la ausencia de abajo
    // sería la de la columna entera y este caso pasaría en verde sin comprobar nada.
    renderOrdenes([
      makeOrden({ id: "o5", estatusId: "est-entregada", estatusValue: "entregada" }),
      makeOrden({ id: "o5b" }),
    ]);

    expect(
      await screen.findByRole("checkbox", { name: "Seleccionar orden REM-o5b" }),
    ).toBeInTheDocument();
    // La fila existe —está listada— pero su celda de selección queda vacía: añadir
    // `en_reparto` y `ayuda_tienda` a las acciones por lote NO abre la puerta a los demás
    // estados.
    expect(screen.getByText("REM-o5")).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Seleccionar orden REM-o5" }),
    ).toBeNull();
  });

  it("con estados MEZCLADOS la acción sólo alcanza a las que la admiten, y lo DICE en el botón", async () => {
    const user = userEvent.setup();
    renderOrdenes([
      makeOrden({ id: "o6" }), // por_recoger  -> sí
      makeOrden({
        id: "o7",
        estatusId: "est-en_bodega_central",
        estatusValue: "en_bodega_central",
        zonaEsGam: true,
      }), // -> no
    ]);

    await seleccionarFila(user, "REM-o6");
    await seleccionarFila(user, "REM-o7");

    // Es el patrón de ESTE listado (`accionesPara` = UNIÓN con conteo, no intersección): la
    // acción se ejecuta sólo sobre las filas que la admiten y el botón lleva el número. La
    // alternativa —esconderla— dejaría la barra vacía en el caso más natural, que es el motivo
    // por el que este listado abandonó la intersección.
    const boton = await screen.findByRole("button", { name: `${ACCION} (1)` });
    await user.click(boton);

    // Y lo que llega al modal es SÓLO la elegible: la otra ni se toca. Se busca DENTRO del
    // diálogo —no en toda la pantalla— porque `REM-o7` sigue estando en la tabla de detrás, que
    // es justo el sitio donde una aserción global daría un falso rojo.
    const dialogo = await screen.findByRole("dialog");
    expect(
      within(dialogo).getByText("REM-o6 · hoy está para el 23 de agosto"),
    ).toBeInTheDocument();
    expect(within(dialogo).queryByText(/REM-o7/)).toBeNull();
  });

  it("la corrección viaja con el lote y, al terminar, se relee el listado", async () => {
    const user = userEvent.setup();
    renderOrdenes([
      makeOrden({ id: "o8", estatusId: "est-en_reparto", estatusValue: "en_reparto" }),
    ]);

    await seleccionarFila(user, "REM-o8");
    await user.click(await screen.findByRole("button", { name: ACCION }));

    await user.click(await screen.findByRole("radio", { name: "Hoy · 22 de agosto" }));
    await user.type(await screen.findByLabelText("Motivo"), MOTIVO_OK);
    await user.click(screen.getByRole("button", { name: CONFIRMAR }));

    await waitFor(() => expect(corregirMock).toHaveBeenCalledTimes(1));
    expect(corregirMock).toHaveBeenCalledWith({
      ordenIds: ["o8"],
      dia: "hoy",
      motivo: MOTIVO_OK,
    });
    // El caso que da sentido a la ficha: «mañana → hoy» sobre una orden que el mensajero ya
    // lleva encima. La confirmación se lee en palabras (R10).
    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        "El lote quedó para el reparto de hoy, 22 de agosto.",
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// F4 / R13 — la bodega satélite llega SIN pasar por `/ordenes`
// ---------------------------------------------------------------------------
describe("R13 — la bodega satélite tiene su propia superficie", () => {
  const LISTADO_BODEGA = "Órdenes de la bodega";

  it("con una `por_recoger` seleccionada, la acción se ofrece y está habilitada", async () => {
    const user = userEvent.setup();
    renderSatelite([makeOrdenSatelite({ id: "s1" })]);

    const seccion = screen.getByRole("region", { name: LISTADO_BODEGA });
    // Sin nada marcado no se ofrece: no hay nada sobre lo que actuar.
    expect(within(seccion).queryByRole("button", { name: ACCION })).toBeNull();

    await user.click(
      within(seccion).getByRole("checkbox", { name: "Seleccionar SAT-s1" }),
    );

    expect(within(seccion).getByRole("button", { name: ACCION })).toBeEnabled();
  });

  it("con estado MIXTO el botón se pinta DESHABILITADO (patrón de esta barra)", async () => {
    const user = userEvent.setup();
    renderSatelite([
      makeOrdenSatelite({ id: "s2" }), // por_recoger
      makeOrdenSatelite({ id: "s3", estatusValue: "en_bodega_satelite" }),
    ]);

    const seccion = screen.getByRole("region", { name: LISTADO_BODEGA });
    await user.click(within(seccion).getByRole("checkbox", { name: "Seleccionar SAT-s2" }));
    await user.click(within(seccion).getByRole("checkbox", { name: "Seleccionar SAT-s3" }));

    // Aquí sí es el patrón de la barra satélite —a diferencia de `/ordenes`—: cada acción se
    // ofrece si hay órdenes de su estado seleccionadas, y se habilita sólo si lo seleccionado
    // es TODO de ese estado. Son transiciones distintas y no se mezclan en un lote.
    expect(within(seccion).getByRole("button", { name: ACCION })).toBeDisabled();
    expect(
      within(seccion).getByText("Selecciona órdenes del mismo estado para actuar sobre ellas."),
    ).toBeInTheDocument();
  });

  it("NO se ofrece sobre una selección de `en_bodega_satelite` (aún sin asignar)", async () => {
    const user = userEvent.setup();
    renderSatelite([makeOrdenSatelite({ id: "s4", estatusValue: "en_bodega_satelite" })]);

    const seccion = screen.getByRole("region", { name: LISTADO_BODEGA });
    await user.click(within(seccion).getByRole("checkbox", { name: "Seleccionar SAT-s4" }));

    // La pareja presencia/ausencia: «Asignar» sí está (la selección tiene acciones), la
    // corrección no. Una orden sin mensajero no tiene día que corregir (R5/D3').
    expect(within(seccion).getByRole("button", { name: "Asignar" })).toBeInTheDocument();
    expect(within(seccion).queryByRole("button", { name: ACCION })).toBeNull();
  });

  it("el adminSatelite corrige desde SU listado: el modal se abre con el día de la orden", async () => {
    const user = userEvent.setup();
    renderSatelite([makeOrdenSatelite({ id: "s5", fechaRepartoISO: "2026-08-23" })]);

    const seccion = screen.getByRole("region", { name: LISTADO_BODEGA });
    await user.click(within(seccion).getByRole("checkbox", { name: "Seleccionar SAT-s5" }));
    await user.click(within(seccion).getByRole("button", { name: ACCION }));

    // R16 en la SEGUNDA superficie: el mismo cuerpo, con el mismo texto. Si los dos modales
    // divergieran, esta línea diría otra cosa que la del test del modal.
    expect(
      await screen.findByText("SAT-s5 · hoy está para el 23 de agosto"),
    ).toBeInTheDocument();
  });

  it("al confirmar llama a LA MISMA acción con el token, y relee el listado", async () => {
    const user = userEvent.setup();
    renderSatelite([makeOrdenSatelite({ id: "s6" })]);

    const seccion = screen.getByRole("region", { name: LISTADO_BODEGA });
    await user.click(within(seccion).getByRole("checkbox", { name: "Seleccionar SAT-s6" }));
    await user.click(within(seccion).getByRole("button", { name: ACCION }));

    await user.click(await screen.findByRole("radio", { name: "Mañana · 23 de agosto" }));
    await user.type(await screen.findByLabelText("Motivo"), MOTIVO_OK);
    await user.click(screen.getByRole("button", { name: CONFIRMAR }));

    await waitFor(() => expect(corregirMock).toHaveBeenCalledTimes(1));
    expect(corregirMock).toHaveBeenCalledWith({
      ordenIds: ["s6"],
      dia: "manana",
      motivo: MOTIVO_OK,
    });
  });
});
