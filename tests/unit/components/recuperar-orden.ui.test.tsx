// @vitest-environment jsdom
// Pedido humano (2026-08-27) — UI de las ELIMINADAS: el interruptor que es la única forma de
// listarlas, y la acción por lote que las devuelve al sistema. Se ejercita el componente REAL;
// lo único mockeado es el borde (Server Actions), el toast y el router.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import {
  MSG_ORDEN_NO_BORRADA,
  MSG_ORDEN_NO_EXISTE,
} from "@/lib/services/mensajes-eliminar-orden";

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

const recuperarOrdenesMock = vi.fn();
vi.mock("@/lib/actions/recuperar-orden", () => ({
  recuperarOrdenes: (...a: unknown[]) => recuperarOrdenesMock(...a),
}));

const eliminarOrdenesMock = vi.fn();
vi.mock("@/lib/actions/eliminar-orden", () => ({
  eliminarOrdenes: (...a: unknown[]) => eliminarOrdenesMock(...a),
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

vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

import { OrdenesListado } from "@/app/(app)/ordenes/_components/OrdenesListado";
import { recuperarOrdenErrorMessage } from "@/app/(app)/ordenes/_components/recuperar-orden-error-messages";

const FILTRO = "Eliminadas";
const ACCION = "Recuperar";

const CATALOGO_ESTADOS = [
  { id: "est-en_bodega_central", value: "en_bodega_central" },
  { id: "est-entregada", value: "entregada" },
];

const CATALOGO: CatalogoFiltrosOrdenesDTO = {
  mensajeros: [],
  zonas: [{ id: "z1", nombre: "GAM" }],
  tiendas: [{ id: "t1", nombre: "Tienda Uno", esApiKey: false, activa: true }],
  provincias: [{ id: "p1", nombre: "San José" }],
  cantones: [{ id: "c1", nombre: "Escazú", padreId: "p1" }],
  distritos: [{ id: "d1", nombre: "San Rafael", padreId: "c1" }],
};

function makeOrden(over: Partial<OrdenListItemDTO> & { id: string }): OrdenListItemDTO {
  return {
    numGuia: 1001,
    numRemision: `REM-${over.id}`,
    estatusId: "est-entregada",
    estatusValue: "entregada",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "t1",
    tiendaNombre: "Tienda Uno",
    zonaId: "z1",
    zonaNombre: "GAM",
    zonaEsGam: true,
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: "d1",
    producto: "Producto",
    peso: 1,
    notas: null,
    eliminable: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  } as OrdenListItemDTO;
}

function renderConSwr(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>,
  );
}

function pagina(items: OrdenListItemDTO[]) {
  return { status: "ok", items, page: 1, pageSize: 25, total: items.length };
}

/** Filtro de la ÚLTIMA llamada a `listarOrdenes`. */
function ultimoFilter(): Record<string, unknown> | undefined {
  const ultima = listarOrdenesMock.mock.calls.at(-1)?.[0] as
    | { filter?: Record<string, unknown> }
    | undefined;
  return ultima?.filter;
}

/** Pone en la barra los filtros pedidos, por su etiqueta (la barra nace solo con el buscador). */
async function ponerFiltros(
  user: ReturnType<typeof userEvent.setup>,
  ...etiquetas: string[]
) {
  await user.click(await screen.findByRole("button", { name: /^Filtros/ }));
  const selector = await screen.findByRole("listbox", { name: "Filtros" });
  for (const etiqueta of etiquetas) {
    await user.click(within(selector).getByRole("option", { name: etiqueta }));
  }
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("listbox", { name: "Filtros" })).toBeNull(),
  );
}

/** Etiquetas que el selector "Filtros" OFRECE. */
async function filtrosOfrecidos(
  user: ReturnType<typeof userEvent.setup>,
): Promise<string[]> {
  await user.click(await screen.findByRole("button", { name: /^Filtros/ }));
  const selector = await screen.findByRole("listbox", { name: "Filtros" });
  const etiquetas = within(selector)
    .getAllByRole("option")
    .filter((o) => o.dataset.todos !== "true")
    .map((o) => o.textContent ?? "");
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("listbox", { name: "Filtros" })).toBeNull(),
  );
  return etiquetas;
}

/**
 * Pone y MARCA el interruptor «Eliminadas», y ESPERA a que el listado se haya vuelto a pedir con
 * el filtro puesto.
 *
 * La espera NO es decorativa: la barra de filtros emite su selección con retardo, y el cambio de
 * filtro LIMPIA la selección de filas de la tabla (`OrdenesModule`). Sin esperar aquí, marcar una
 * fila justo después la deja marcada un instante y el filtro se la lleva por delante — que es
 * exactamente lo que le pasa a una persona que haga las dos cosas seguidas, y por eso el helper
 * espera en vez de disimularlo con un `waitFor` en cada aserción.
 */
async function verEliminadas(user: ReturnType<typeof userEvent.setup>) {
  await ponerFiltros(user, FILTRO);
  await user.click(await screen.findByRole("checkbox", { name: FILTRO }));
  await waitFor(() => expect(ultimoFilter()?.eliminados).toBe(true));
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
  listarOrderStatusMock.mockResolvedValue({ status: "ok", estatus: CATALOGO_ESTADOS });
  listarOrdenesMock.mockResolvedValue(pagina([makeOrden({ id: "o1" })]));
  recuperarOrdenesMock.mockResolvedValue({ status: "ok", recuperadas: 1 });
});

afterEach(() => {
  cleanup();
});

describe("el interruptor «Eliminadas»", () => {
  it("solo se le ofrece a quien puede eliminar", async () => {
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote puedeEliminar catalogoFiltros={CATALOGO} />);

    expect(await filtrosOfrecidos(user)).toContain(FILTRO);
  });

  it("sin `puedeEliminar` no se ofrece ni se puede montar", async () => {
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote catalogoFiltros={CATALOGO} />);

    const ofrecidos = await filtrosOfrecidos(user);
    expect(ofrecidos).not.toContain(FILTRO);

    // Pidiendo TODO lo que se ofrece, el interruptor no aparece por ningún lado.
    await ponerFiltros(user, ...ofrecidos);
    expect(screen.queryByRole("checkbox", { name: FILTRO })).toBeNull();
  });

  it("marcado, viaja al backend como `eliminados: true`", async () => {
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote puedeEliminar catalogoFiltros={CATALOGO} />);

    await verEliminadas(user);

    await waitFor(() => expect(ultimoFilter()?.eliminados).toBe(true));
  });

  it("desmarcado, la clave NO viaja (no se manda `false`)", async () => {
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote puedeEliminar catalogoFiltros={CATALOGO} />);

    await ponerFiltros(user, FILTRO);
    await screen.findByRole("checkbox", { name: FILTRO });

    expect(ultimoFilter()?.eliminados).toBeUndefined();
  });
});

describe("la barra del listado de eliminadas", () => {
  it("ofrece Recuperar y NINGUNA acción del flujo", async () => {
    listarOrdenesMock.mockResolvedValue(
      pagina([makeOrden({ id: "o1", estatusValue: "en_bodega_central" })]),
    );
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote puedeEliminar catalogoFiltros={CATALOGO} />);

    await verEliminadas(user);
    await seleccionarFila(user, "REM-o1");

    // eslint-disable-next-line no-console
    console.log("BOTONES:", screen.queryAllByRole("button").map((b) => b.textContent));
    expect(await screen.findByRole("button", { name: ACCION })).toBeInTheDocument();
    // `en_bodega_central` ofrecería estas dos en el listado normal: sobre una orden borrada
    // serían transiciones que el servidor rechaza.
    expect(screen.queryByRole("button", { name: "Asignar mensajero" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Eliminar" })).toBeNull();
  });

  it("una sola llamada con el lote completo, y avisa cuántas recuperó el SERVIDOR", async () => {
    listarOrdenesMock.mockResolvedValue(
      pagina([makeOrden({ id: "o1" }), makeOrden({ id: "o2" })]),
    );
    recuperarOrdenesMock.mockResolvedValue({ status: "ok", recuperadas: 2 });
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote puedeEliminar catalogoFiltros={CATALOGO} />);

    await verEliminadas(user);
    await seleccionarFila(user, "REM-o1");
    await seleccionarFila(user, "REM-o2");
    await user.click(await screen.findByRole("button", { name: ACCION }));
    const dialogo = await screen.findByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: ACCION }));

    await waitFor(() => expect(recuperarOrdenesMock).toHaveBeenCalledTimes(1));
    expect(recuperarOrdenesMock).toHaveBeenCalledWith({ ordenIds: ["o1", "o2"] });
    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("2 orden(es) recuperada(s)."),
    );
  });

  it("UNA POR UNA: marcar una sola fila recupera exactamente esa", async () => {
    listarOrdenesMock.mockResolvedValue(
      pagina([makeOrden({ id: "o1" }), makeOrden({ id: "o2" })]),
    );
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote puedeEliminar catalogoFiltros={CATALOGO} />);

    await verEliminadas(user);
    await seleccionarFila(user, "REM-o2");
    await user.click(await screen.findByRole("button", { name: ACCION }));
    const dialogo = await screen.findByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: ACCION }));

    await waitFor(() => expect(recuperarOrdenesMock).toHaveBeenCalledTimes(1));
    expect(recuperarOrdenesMock).toHaveBeenCalledWith({ ordenIds: ["o2"] });
  });

  it("NO llama al borde hasta que se confirma (abrir el modal no recupera)", async () => {
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote puedeEliminar catalogoFiltros={CATALOGO} />);

    await verEliminadas(user);
    await seleccionarFila(user, "REM-o1");
    await user.click(await screen.findByRole("button", { name: ACCION }));
    await screen.findByRole("dialog");

    expect(recuperarOrdenesMock).not.toHaveBeenCalled();
  });

  it("un fallo se traduce a un mensaje accionable y NO se anuncia éxito", async () => {
    const fallo = {
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: MSG_ORDEN_NO_BORRADA }],
    };
    recuperarOrdenesMock.mockResolvedValue(fallo);
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote puedeEliminar catalogoFiltros={CATALOGO} />);

    await verEliminadas(user);
    await seleccionarFila(user, "REM-o1");
    await user.click(await screen.findByRole("button", { name: ACCION }));
    const dialogo = await screen.findByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: ACCION }));

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(recuperarOrdenErrorMessage(fallo)),
    );
    expect(successMock).not.toHaveBeenCalled();
  });
});

describe("traducción de errores", () => {
  it.each([
    ["forbidden", { status: "forbidden" }],
    ["unauthenticated", { status: "unauthenticated" }],
    ["validation_error", { status: "validation_error", fieldErrors: {} }],
    [
      "conflict/no existe",
      { status: "conflict", detalle: [{ ordenId: "o1", motivo: MSG_ORDEN_NO_EXISTE }] },
    ],
    [
      "conflict/no borrada",
      { status: "conflict", detalle: [{ ordenId: "o1", motivo: MSG_ORDEN_NO_BORRADA }] },
    ],
  ])("%s tiene un mensaje propio y sin identificadores internos", (_n, resultado) => {
    const mensaje = recuperarOrdenErrorMessage(resultado);
    expect(mensaje.length).toBeGreaterThan(0);
    expect(mensaje).not.toContain("o1");
    expect(mensaje).not.toContain("_");
  });

  it("los cinco mensajes son DISTINTOS entre sí", () => {
    const mensajes = [
      recuperarOrdenErrorMessage({ status: "forbidden" }),
      recuperarOrdenErrorMessage({ status: "unauthenticated" }),
      recuperarOrdenErrorMessage({ status: "validation_error", fieldErrors: {} }),
      recuperarOrdenErrorMessage({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo: MSG_ORDEN_NO_EXISTE }],
      }),
      recuperarOrdenErrorMessage({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo: MSG_ORDEN_NO_BORRADA }],
      }),
    ];
    expect(new Set(mensajes).size).toBe(mensajes.length);
  });
});
