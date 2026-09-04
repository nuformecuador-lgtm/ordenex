// @vitest-environment jsdom
// FICHA 371 (UI) — la ACCIÓN «Corregir fecha de reprogramación» en `/ordenes`: que aparece en el
// estado que toca, que NO aparece donde no toca, y que abre el modal con la fecha de ESA orden.
//
// Se ejercita el componente REAL (`OrdenesListado`); lo único mockeado es el borde (Server
// Actions), el toast y el router. Molde literal de `CambiarDiaRepartoListados.test.tsx` (262).
//
// POR QUÉ ESTE ARCHIVO EXISTE APARTE DEL TEST DEL MODAL: hasta esta ficha, una orden
// `reprogramada` caía en el `default: return []` de `accionesDe` y no ofrecía NADA. Un modal
// perfecto sin `case` que lo abra es exactamente el fallo mudo que este repo ya pagó dos veces
// (`rutearABodegaSatelite`). El `case` se prueba desde la barra, no desde el modal.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

// El borde de la ficha: UNA orden por llamada.
const corregirFechaMock = vi.fn();
vi.mock("@/lib/actions/corregir-fecha-reprogramacion", () => ({
  corregirFechaReprogramacion: (...a: unknown[]) => corregirFechaMock(...a),
}));

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

vi.mock("@/lib/actions/corregir-dia-reparto", () => ({
  corregirDiaReparto: vi.fn(),
}));

vi.mock("@/lib/actions/deshacer-asignacion", () => ({
  deshacerAsignacion: vi.fn(),
}));

vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

import { OrdenesListado } from "@/app/(app)/ordenes/_components/OrdenesListado";

/** LITERAL a mano: es lo que la persona lee en el botón, no lo que una constante devuelve. */
const ACCION = "Corregir fecha de reprogramación";
const CAMBIAR_DIA = "Cambiar día de reparto";
const FECHAS = { hoy: "2026-09-03", manana: "2026-09-04" };

/**
 * Los estados que este test necesita del catálogo: el que ofrece la corrección y cuatro controles
 * negativos —dos con acciones propias, uno en bodega y uno terminal—.
 */
const CATALOGO = [
  { id: "est-reprogramada", value: "reprogramada" },
  { id: "est-por_recoger", value: "por_recoger" },
  { id: "est-en_reparto", value: "en_reparto" },
  { id: "est-en_bodega_central", value: "en_bodega_central" },
  { id: "est-entregada", value: "entregada" },
];

function makeOrden(over: Partial<OrdenListItemDTO> & { id: string }): OrdenListItemDTO {
  return {
    numGuia: 49906911,
    numRemision: `REM-${over.id}`,
    estatusId: "est-reprogramada",
    estatusValue: "reprogramada",
    fechaReprogramacion: "2026-09-04",
    fechaRepartoISO: null,
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
    createdAt: new Date("2026-09-02T00:00:00Z"),
    updatedAt: new Date("2026-09-02T00:00:00Z"),
    ...over,
  } as OrdenListItemDTO;
}

function renderOrdenes(items: OrdenListItemDTO[]): ReactElement | void {
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items,
    page: 1,
    pageSize: 25,
    total: items.length,
  });
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <OrdenesListado accionesLote fechasDiaReparto={FECHAS} />
    </SWRConfig>,
  );
}

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

// ---------------------------------------------------------------------------
// El `case` que faltaba
// ---------------------------------------------------------------------------
describe("`/ordenes` ofrece la corrección sobre una orden `reprogramada`", () => {
  it("⭑ marcar una orden `reprogramada` pone el botón en la barra", async () => {
    const user = userEvent.setup();
    renderOrdenes([makeOrden({ id: "o1" })]);

    await seleccionarFila(user, "REM-o1");

    // Antes de esta ficha, `reprogramada` caía en el `default` de `accionesDe` y la barra se
    // quedaba vacía: la orden esperaba a la fecha equivocada y no había pantalla que la
    // arreglara.
    expect(await screen.findByRole("button", { name: ACCION })).toBeInTheDocument();
  });

  it("la fila `reprogramada` es SELECCIONABLE (antes no llevaba a ningún botón)", async () => {
    renderOrdenes([makeOrden({ id: "o1" })]);

    const casilla = await screen.findByRole("checkbox", {
      name: "Seleccionar orden REM-o1",
    });
    expect(casilla).toBeEnabled();
  });

  it("el modal se abre con la fecha ACTUAL de esa orden, no con un hueco", async () => {
    const user = userEvent.setup();
    renderOrdenes([makeOrden({ id: "o1", fechaReprogramacion: "2026-09-04" })]);

    await seleccionarFila(user, "REM-o1");
    await user.click(await screen.findByRole("button", { name: ACCION }));

    expect(
      await screen.findByText("REM-o1 · Ahora está reprogramada para el 4 de septiembre."),
    ).toBeInTheDocument();
    // Y el campo nace con el mínimo de HOY, que baja de la página.
    expect(screen.getByLabelText("Nueva fecha")).toHaveAttribute("min", FECHAS.hoy);
  });
});

// ---------------------------------------------------------------------------
// Los controles negativos
// ---------------------------------------------------------------------------
describe("la corrección NO se ofrece en ningún otro estado", () => {
  it("no aparece en `por_recoger`, que tiene sus propias acciones", async () => {
    const user = userEvent.setup();
    renderOrdenes([
      makeOrden({ id: "o2", estatusId: "est-por_recoger", estatusValue: "por_recoger" }),
    ]);

    await seleccionarFila(user, "REM-o2");

    // Control POSITIVO en la misma pantalla: la barra sí se llenó, así que la ausencia del otro
    // botón no es «no se renderizó nada».
    expect(await screen.findByRole("button", { name: CAMBIAR_DIA })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACCION })).not.toBeInTheDocument();
  });

  it("no aparece en `en_reparto`: ahí la fecha que decide es otra", async () => {
    const user = userEvent.setup();
    renderOrdenes([
      makeOrden({ id: "o3", estatusId: "est-en_reparto", estatusValue: "en_reparto" }),
    ]);

    await seleccionarFila(user, "REM-o3");

    expect(await screen.findByRole("button", { name: CAMBIAR_DIA })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACCION })).not.toBeInTheDocument();
  });

  it("no aparece en `en_bodega_central`: la orden ya volvió a circular", async () => {
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

    expect(await screen.findByRole("button", { name: "Asignar mensajero" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACCION })).not.toBeInTheDocument();
  });

  it("no aparece en `entregada`: mover esa fecha sería escribir un dato muerto", async () => {
    renderOrdenes([
      makeOrden({ id: "o5", estatusId: "est-entregada", estatusValue: "entregada" }),
    ]);

    await screen.findByText("REM-o5");
    expect(screen.queryByRole("button", { name: ACCION })).not.toBeInTheDocument();
  });

  it("marcar `reprogramada` NO ofrece «Cambiar día de reparto»: son dos fechas distintas", async () => {
    const user = userEvent.setup();
    renderOrdenes([makeOrden({ id: "o6" })]);

    await seleccionarFila(user, "REM-o6");

    expect(await screen.findByRole("button", { name: ACCION })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: CAMBIAR_DIA })).not.toBeInTheDocument();
  });
});
