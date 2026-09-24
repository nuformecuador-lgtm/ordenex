// @vitest-environment jsdom
// FICHA 454 (T2.2, R29 + R54/R55) — `/ordenes` con las señales que el servidor pone en cada fila
// (`gestionPendiente`, `ayudaAbierta`, `progress/impl_454_datos.md`):
//
//   · R29: junto al chip «En reparto», la nota «<Resultado> · pendiente de confirmación» o
//     «Ayuda solicitada a la tienda». El chip NO cambia: la orden sigue en reparto.
//   · R54: una fila con gestión pendiente NO ofrece «Traspasar a otro mensajero».
//   · R55: ni «Cambiar día de reparto». La fila no se marca y el «!» explica por qué.
//   · R28/R54: la de ayuda abierta SÍ sigue ofreciendo las dos.
//
// Componente REAL (`OrdenesListado`); solo se mockea el borde (Server Actions), el toast y el
// router. Harness copiado de `TraspasarMensajeroListado.test.tsx` (427). Literales a mano.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
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

/** LITERALES a mano: es lo que la persona lee, no lo que una constante devuelve. */
const TRASPASAR = "Traspasar a otro mensajero";
const CAMBIAR_DIA = "Cambiar día de reparto";
const FECHAS = { hoy: "2026-09-14", manana: "2026-09-15" };

const CATALOGO = [{ id: "est-en_reparto", value: "en_reparto" }];

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
});

afterEach(() => {
  cleanup();
});

const PENDIENTE = makeOrden({
  id: "pend",
  gestionPendiente: { resultado: "entregado", registradaAt: "2026-09-23T21:00:00.000Z" },
  ayudaAbierta: false,
});
const CON_AYUDA = makeOrden({ id: "ayuda", gestionPendiente: null, ayudaAbierta: true });
const EN_MANO = makeOrden({ id: "mano", gestionPendiente: null, ayudaAbierta: false });

const MOTIVO =
  "Tiene una gestión pendiente de confirmación: no se puede traspasar ni cambiar el día hasta que se apruebe el cierre del mensajero.";

/** La fila (`tr`) con esa remisión. */
async function filaDe(numRemision: string): Promise<HTMLElement> {
  const celda = await screen.findByText(numRemision);
  return celda.closest("tr") as HTMLElement;
}

describe("454/R29 — `/ordenes` pinta la nota junto al chip de estado", () => {
  it("gestión pendiente: «En reparto» + «Entregada · pendiente de confirmación»", async () => {
    renderOrdenes([PENDIENTE, EN_MANO]);
    const fila = await filaDe("REM-pend");
    expect(within(fila).getByText("En reparto")).toBeInTheDocument();
    expect(within(fila).getByText("Entregada · pendiente de confirmación")).toBeInTheDocument();
  });

  it("el nombre es el del resultado: rechazada → «Rechazada · pendiente de confirmación»", async () => {
    renderOrdenes([
      makeOrden({
        id: "rech",
        gestionPendiente: { resultado: "devolucion_a_origen_por_rechazo", registradaAt: "2026-09-23T21:00:00.000Z" },
      }),
    ]);
    const fila = await filaDe("REM-rech");
    expect(within(fila).getByText("Rechazada · pendiente de confirmación")).toBeInTheDocument();
  });

  it("ayuda abierta: «En reparto» + «Ayuda solicitada a la tienda»", async () => {
    renderOrdenes([CON_AYUDA]);
    const fila = await filaDe("REM-ayuda");
    expect(within(fila).getByText("En reparto")).toBeInTheDocument();
    expect(within(fila).getByText("Ayuda solicitada a la tienda")).toBeInTheDocument();
  });

  it("en mano (sin señales) y DTO sin los campos: ninguna nota", async () => {
    renderOrdenes([EN_MANO, makeOrden({ id: "legado" })]);
    await filaDe("REM-mano");
    await filaDe("REM-legado");
    expect(screen.queryByText(/pendiente de confirmación/)).toBeNull();
    expect(screen.queryByText("Ayuda solicitada a la tienda")).toBeNull();
  });
});

describe("454/R54-R55 — una fila con gestión pendiente no ofrece traspaso ni cambio de día", () => {
  it("no tiene casilla: el «!» explica que hay una gestión pendiente de confirmación", async () => {
    renderOrdenes([PENDIENTE, EN_MANO]);
    const fila = await filaDe("REM-pend");
    expect(
      within(fila).queryByRole("checkbox", { name: "Seleccionar orden REM-pend" }),
    ).toBeNull();
    expect(
      within(fila).getByRole("img", {
        name: `No se puede seleccionar la orden REM-pend: ${MOTIVO}`,
      }),
    ).toBeInTheDocument();
  });

  it("R54 — «Traspasar a otro mensajero»: sale para la vecina en mano y el lote no incluye la pendiente", async () => {
    const user = userEvent.setup();
    renderOrdenes([PENDIENTE, EN_MANO]);

    // «Seleccionar todas» marca solo lo seleccionable: la pendiente no entra.
    await user.click(
      await screen.findByRole("checkbox", { name: /Seleccionar todas/ }),
    );
    await user.click(await screen.findByRole("button", { name: TRASPASAR }));
    // El modal habla de UNA orden: la pendiente no entró en el lote.
    expect(await screen.findByText(/Vas a pasar 1 orden de Andy Cortés/)).toBeInTheDocument();
  });

  it("R55 — «Cambiar día de reparto»: sale para la vecina en mano, sin conteo parcial", async () => {
    const user = userEvent.setup();
    renderOrdenes([PENDIENTE, EN_MANO]);

    await user.click(
      await screen.findByRole("checkbox", { name: /Seleccionar todas/ }),
    );
    expect(await screen.findByRole("button", { name: CAMBIAR_DIA })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cambiar día de reparto \(/ })).toBeNull();
  });

  it("con SOLO filas pendientes no se ofrece ninguna de las dos", async () => {
    renderOrdenes([PENDIENTE]);
    await filaDe("REM-pend");
    expect(screen.queryByRole("checkbox", { name: "Seleccionar orden REM-pend" })).toBeNull();
    expect(screen.queryByRole("button", { name: TRASPASAR })).toBeNull();
    expect(screen.queryByRole("button", { name: CAMBIAR_DIA })).toBeNull();
  });

  it("R28/R54 — la de ayuda abierta SÍ sigue ofreciendo traspaso y cambio de día", async () => {
    const user = userEvent.setup();
    renderOrdenes([CON_AYUDA]);

    await seleccionarFila(user, "REM-ayuda");
    expect(await screen.findByRole("button", { name: TRASPASAR })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CAMBIAR_DIA })).toBeInTheDocument();
  });
});
