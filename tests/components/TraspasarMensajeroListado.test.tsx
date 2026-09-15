// @vitest-environment jsdom
// FICHA 427 — T24 sobre T23: la acción «Traspasar a otro mensajero» en la barra de `/ordenes`.
// Cubre R34 (sólo en los dos estados traspasables y sólo con acciones por lote), R3 (el mensajero
// no tiene superficie) y el cableado barra → modal con el origen ya derivado de la selección.
//
// Se ejercita el componente REAL (`OrdenesListado`); lo único mockeado es el borde (Server
// Actions), el toast y el router, para que lo verificado sea el cableado de la UI y no la
// implementación del backend. Molde literal de `tests/components/CambiarDiaRepartoListados.test.tsx`
// (262), que es el precedente exacto de esta misma barra.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import type { OrdenListItemDTO } from "@/lib/types/orden";

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

// El borde de la ficha: UNA sola llamada por lote.
const traspasarMock = vi.fn();
vi.mock("@/lib/actions/traspasar-mensajero", () => ({
  traspasarMensajero: (...a: unknown[]) => traspasarMock(...a),
}));

vi.mock("@/lib/actions/corregir-dia-reparto", () => ({
  corregirDiaReparto: vi.fn(),
}));

const listarOrderStatusMock = vi.fn();
vi.mock("@/lib/actions/order-status", () => ({
  listarOrderStatus: (...a: unknown[]) => listarOrderStatusMock(...a),
}));

const listarOrdenesMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
}));

const ANDY = { id: "m-andy", nombre: "Andy Cortés" };
const CARLOS = { id: "m-carlos", nombre: "Carlos Eduardo" };

vi.mock("@/lib/actions/ordenes-guia", () => ({
  listarMensajerosParaAsignacion: vi.fn().mockResolvedValue({
    status: "ok",
    mensajeros: [
      { id: "m-andy", nombre: "Andy Cortés" },
      { id: "m-carlos", nombre: "Carlos Eduardo" },
    ],
    bloqueadosIds: [],
    noAsignablesIds: [],
    conRepartoIds: [],
    conRecoleccionIds: [],
  }),
  listarZonasBloqueadasPorCierre: vi
    .fn()
    .mockResolvedValue({ status: "ok", zonasBloqueadasIds: [] }),
}));

vi.mock("@/lib/actions/deshacer-asignacion", () => ({
  deshacerAsignacion: vi.fn(),
}));

vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

import { OrdenesListado } from "@/app/(app)/ordenes/_components/OrdenesListado";

/** LITERAL a mano: es lo que la persona lee en el botón, no lo que una constante devuelve. */
const ACCION = "Traspasar a otro mensajero";
const CONFIRMAR = "Traspasar";
const FECHAS = { hoy: "2026-09-14", manana: "2026-09-15" };

/**
 * Los cinco estados que este archivo necesita. Los DOS primeros son los traspasables (el paquete
 * va encima del mensajero); los tres últimos son el control negativo, y cada uno por su motivo:
 * `por_recoger` está en la bodega y tiene su propia acción desde la 149;
 * `devolviendo_a_tienda` es un problema de dónde está la caja; `en_bodega_central` no está con
 * nadie.
 */
const CATALOGO = [
  { id: "est-en_reparto", value: "en_reparto" },
  { id: "est-ayuda_tienda", value: "ayuda_tienda" },
  { id: "est-por_recoger", value: "por_recoger" },
  { id: "est-devolviendo_a_tienda", value: "devolviendo_a_tienda" },
  { id: "est-en_bodega_central", value: "en_bodega_central" },
];

function makeOrden(over: Partial<OrdenListItemDTO> & { id: string }): OrdenListItemDTO {
  return {
    numGuia: 1001,
    numRemision: `REM-${over.id}`,
    estatusId: "est-en_reparto",
    estatusValue: "en_reparto",
    fechaRepartoISO: "2026-09-14",
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
    mensajeroAsignadoId: ANDY.id,
    relaciones: {
      estatus: { id: "est-en_reparto", value: "en_reparto" },
      tienda: null,
      zona: { id: "zona-1", nombre: "Limón", esCentral: false },
      provincia: null,
      canton: null,
      distrito: null,
      mensajeroAsignado: { id: ANDY.id, nombre: ANDY.nombre },
    },
    createdAt: new Date("2026-09-14T00:00:00Z"),
    updatedAt: new Date("2026-09-14T00:00:00Z"),
    ...over,
  } as OrdenListItemDTO;
}

function renderConSwr(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>,
  );
}

function renderOrdenes(
  items: OrdenListItemDTO[],
  props: Partial<{ accionesLote: boolean; puedeEliminar: boolean }> = {
    accionesLote: true,
  },
) {
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items,
    page: 1,
    pageSize: 25,
    total: items.length,
  });
  return renderConSwr(<OrdenesListado fechasDiaReparto={FECHAS} {...props} />);
}

/** Marca el checkbox de una fila por su nº de remisión. */
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
  traspasarMock.mockResolvedValue({
    status: "ok",
    movidas: 2,
    conversaciones: 2,
    origen: { id: ANDY.id, nombre: ANDY.nombre },
    destino: { id: CARLOS.id, nombre: CARLOS.nombre },
  });
});

afterEach(() => {
  cleanup();
});

/* ============================================================================================ */
/* R34 — la acción sólo en `en_reparto` y `ayuda_tienda`                                        */
/* ============================================================================================ */

describe("427/R34 — `/ordenes` ofrece el traspaso EXACTAMENTE en los dos estados traspasables", () => {
  it("se ofrece en `en_reparto` — el caso de la ficha", async () => {
    const user = userEvent.setup();
    renderOrdenes([makeOrden({ id: "o1" })]);

    await seleccionarFila(user, "REM-o1");

    expect(await screen.findByRole("button", { name: ACCION })).toBeInTheDocument();
  });

  it("se ofrece en `ayuda_tienda` — el paquete sigue con él, en la calle", async () => {
    const user = userEvent.setup();
    renderOrdenes([
      makeOrden({ id: "o2", estatusId: "est-ayuda_tienda", estatusValue: "ayuda_tienda" }),
    ]);

    await seleccionarFila(user, "REM-o2");

    expect(await screen.findByRole("button", { name: ACCION })).toBeInTheDocument();
  });

  it("NO se ofrece en `por_recoger`: el paquete está en la bodega y ya tiene su propia acción", async () => {
    const user = userEvent.setup();
    renderOrdenes([
      makeOrden({ id: "o3", estatusId: "est-por_recoger", estatusValue: "por_recoger" }),
    ]);

    await seleccionarFila(user, "REM-o3");

    // La barra EXISTE —esta selección sí tiene acciones—, y aun así el traspaso no está. La
    // pareja presencia/ausencia es lo que impide que esto pase en verde por no haberse
    // renderizado nada.
    expect(
      await screen.findByRole("button", { name: "Deshacer asignación" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACCION })).toBeNull();
  });

  it("NO se ofrece en `devolviendo_a_tienda`: ahí el problema es dónde está la caja", async () => {
    const user = userEvent.setup();
    renderOrdenes([
      makeOrden({
        id: "o4",
        estatusId: "est-devolviendo_a_tienda",
        estatusValue: "devolviendo_a_tienda",
      }),
      // Acompañante `en_reparto` a propósito: sin ella la columna de casillas podría no montarse
      // y la ausencia de abajo sería la de la tabla entera.
      makeOrden({ id: "o4b" }),
    ]);

    await seleccionarFila(user, "REM-o4b");
    expect(await screen.findByRole("button", { name: ACCION })).toBeInTheDocument();

    // Y la `devolviendo_a_tienda` ni siquiera participa de la selección por lote.
    expect(screen.getByText("REM-o4")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Seleccionar orden REM-o4" })).toBeNull();
  });

  it("NO se ofrece en `en_bodega_central`: el paquete no está con nadie", async () => {
    const user = userEvent.setup();
    renderOrdenes([
      makeOrden({
        id: "o5",
        estatusId: "est-en_bodega_central",
        estatusValue: "en_bodega_central",
        zonaEsGam: true,
      }),
    ]);

    await seleccionarFila(user, "REM-o5");

    expect(
      await screen.findByRole("button", { name: "Asignar mensajero" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACCION })).toBeNull();
  });

  it("con estados MEZCLADOS, el traspaso desaparece de la barra", async () => {
    const user = userEvent.setup();
    renderOrdenes([
      makeOrden({ id: "o6" }), // en_reparto -> sí
      makeOrden({
        id: "o7",
        estatusId: "est-por_recoger",
        estatusValue: "por_recoger",
      }), // -> no
    ]);

    await seleccionarFila(user, "REM-o6");
    expect(await screen.findByRole("button", { name: ACCION })).toBeInTheDocument();

    await seleccionarFila(user, "REM-o7");
    // La barra sigue viva (los dos estados comparten «Cambiar día de reparto»), pero el traspaso
    // ya no: `por_recoger` no es traspasable y el servidor rechazaría el lote entero.
    expect(
      await screen.findByRole("button", { name: "Cambiar día de reparto" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: ACCION })).toBeNull());
  });
});

/* ============================================================================================ */
/* R3 — quien no tiene acciones por lote no tiene esta superficie                                */
/* ============================================================================================ */

describe("427/R3 — sin acciones de flujo no hay traspaso, ni casilla que lleve a él", () => {
  it("sin `accionesLote` (el rol que no es de acceso total) no hay ni casilla ni acción", async () => {
    renderOrdenes([makeOrden({ id: "o8" })], { accionesLote: false });

    // La fila se lista igual —el listado es de lectura para más roles— pero no gana casilla.
    expect(await screen.findByText("REM-o8")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Seleccionar orden REM-o8" })).toBeNull();
    expect(screen.queryByRole("button", { name: ACCION })).toBeNull();
  });

  it("con casilla pero SIN acciones de flujo (la tienda, que sí puede eliminar) tampoco aparece", async () => {
    const user = userEvent.setup();
    renderOrdenes([makeOrden({ id: "o9", eliminable: true } as Partial<OrdenListItemDTO> & { id: string })], {
      accionesLote: false,
      puedeEliminar: true,
    });

    await seleccionarFila(user, "REM-o9");

    // La barra se le llena de lo suyo —«Eliminar»— y de nada más: el traspaso es una acción de
    // flujo y `accionesDe` devuelve vacío sin `accionesLote`.
    expect(await screen.findByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACCION })).toBeNull();
  });
});

/* ============================================================================================ */
/* El cableado barra → modal: el ORIGEN sale de la selección (R8/R35)                            */
/* ============================================================================================ */

describe("427/R35 — al abrir desde la barra, el modal ya sabe de quién son las órdenes", () => {
  it("dice cuántas y de quién, y al confirmar manda UNA llamada con el lote completo", async () => {
    const user = userEvent.setup();
    renderOrdenes([makeOrden({ id: "o10" }), makeOrden({ id: "o11" })]);

    await seleccionarFila(user, "REM-o10");
    await seleccionarFila(user, "REM-o11");
    await user.click(await screen.findByRole("button", { name: ACCION }));

    // R35, literal a mano: el origen NO se eligió en ningún sitio, salió de las dos filas.
    expect(
      await screen.findByText(
        "Vas a pasar 2 órdenes de Andy Cortés. Elige a quién se las traspasas.",
      ),
    ).toBeInTheDocument();

    // R7: Andy no está entre los destinos; Carlos sí.
    await user.click(screen.getByRole("combobox", { name: "Mensajero que recibe el lote" }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryByRole("option", { name: "Andy Cortés" })).toBeNull();
    await user.click(within(listbox).getByRole("option", { name: "Carlos Eduardo" }));

    await user.type(
      screen.getByLabelText("Motivo"),
      "Andy se reportó enfermo a media jornada",
    );
    await user.click(screen.getByRole("button", { name: CONFIRMAR }));

    await waitFor(() => expect(traspasarMock).toHaveBeenCalledTimes(1));
    expect(traspasarMock).toHaveBeenCalledWith({
      ordenIds: ["o10", "o11"],
      mensajeroDestinoId: CARLOS.id,
      motivo: "Andy se reportó enfermo a media jornada",
    });

    // R36/R33: las cifras del servidor y el aviso de la ruta se leen SIN cerrar el modal.
    expect(
      await screen.findByText("Se movieron 2 órdenes y 2 conversaciones de chat."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "La ruta de Carlos Eduardo se va a recalcular; hasta entonces las paradas nuevas aparecen al final de su recorrido.",
      ),
    ).toBeInTheDocument();
  });
});
