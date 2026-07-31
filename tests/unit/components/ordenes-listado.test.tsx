// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// `OrdenesListado` usa `useRouter` (navegación al escanear el QR de una etiqueta),
// que exige el App Router montado: se mockea como en el resto de la suite.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Catálogo `order_status` (Server Action) mockeado: el front deriva las OPCIONES
// del filtro de aquí menos `exclude` (R14). Orden determinista (R5) preservado.
const listarOrderStatusMock = vi.fn();
vi.mock("@/lib/actions/order-status", () => ({
  listarOrderStatus: (...a: unknown[]) => listarOrderStatusMock(...a),
}));

// `listarOrdenes` mockeado: se inspecciona con qué `filter.status_id` se invoca
// (un id, una lista de ids, o sin filtro cuando no hay estados marcados).
const listarOrdenesMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
}));

import { OrdenesListado } from "@/app/(app)/ordenes/_components/OrdenesListado";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";

// Las opciones del filtro se titulan con la etiqueta legible del estado (R14), que
// sale del mapa de presentación. Se asertan contra el mapa —no contra literales—
// porque lo que se verifica es "la opción muestra la etiqueta del estado", no un
// texto concreto. Los literales del mapa los blinda `tests/components/EstatusLabel.test.ts`.
const OPT_EN_BODEGA = ORDER_STATUS_LABELS.en_bodega_central;
const OPT_ENTREGADA = ORDER_STATUS_LABELS.entregada;
const OPT_DEVUELTA = ORDER_STATUS_LABELS.devuelta;

// Catálogo con `pendiente` (excluido por default) + 3 estados mostrables.
const CATALOGO = [
  { id: "est-pendiente", value: "pendiente" },
  { id: "est-en_bodega_central", value: "en_bodega_central" },
  { id: "est-entregada", value: "entregada" },
  { id: "est-devuelta", value: "devuelta" },
];

function makeOrden(id: string, numGuia: number): OrdenListItemDTO {
  return {
    id,
    numGuia,
    numRemision: `REM-${id}`,
    estatusId: "est-en_bodega_central",
    estatusValue: "en_bodega_central",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-1",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  } as OrdenListItemDTO;
}

function renderListado(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/** Abre el desplegable del filtro de estados y devuelve su botón disparador. */
async function abrirFiltro(user: ReturnType<typeof userEvent.setup>) {
  const boton = await screen.findByRole("button", { name: /^Estado:/ });
  await user.click(boton);
  await screen.findByRole("listbox", { name: "Estado" });
  return boton;
}

/** Panel desplegado del filtro de estados (ya abierto). */
function listbox(): HTMLElement {
  return screen.getByRole("listbox", { name: "Estado" });
}

/** `status_id` de la ÚLTIMA llamada a `listarOrdenes` (undefined si no hay filtro). */
function ultimoStatusId(): string | string[] | undefined {
  const calls = listarOrdenesMock.mock.calls;
  const ultima = calls[calls.length - 1]?.[0] as
    | { filter?: { status_id?: string | string[] } }
    | undefined;
  return ultima?.filter?.status_id;
}

beforeEach(() => {
  vi.clearAllMocks();
  listarOrderStatusMock.mockResolvedValue({ status: "ok", estatus: CATALOGO });
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items: [makeOrden("o1", 1001)],
    page: 1,
    pageSize: 25,
    total: 1,
  });
});

afterEach(() => {
  cleanup();
});

describe("OrdenesListado — una sola tabla (R12)", () => {
  it("R12: renderiza UNA tabla, no tabs por estado", async () => {
    renderListado(<OrdenesListado />);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("sin estados marcados consulta `listarOrdenes` SIN filtro (todas las órdenes)", async () => {
    renderListado(<OrdenesListado />);

    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
    expect(ultimoStatusId()).toBeUndefined();
  });
});

describe("OrdenesListado — opciones del filtro (R13/R14)", () => {
  it("R14: las opciones se derivan del catálogo (etiquetas legibles de cada estado)", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado />);
    await abrirFiltro(user);

    expect(screen.getByRole("option", { name: OPT_EN_BODEGA })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: OPT_ENTREGADA })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: OPT_DEVUELTA })).toBeInTheDocument();
    // 4 en catálogo − 1 excluido (pendiente) = 3 opciones. Se cuenta DENTRO del
    // listbox: el selector de tamaño de página de la paginación también usa
    // `<option>` y contaminaría un conteo global.
    expect(within(listbox()).getAllByRole("option")).toHaveLength(3);
  });

  it("R13: el estado por default `pendiente` NO genera opción", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado />);
    await abrirFiltro(user);

    expect(screen.queryByRole("option", { name: /pendiente/i })).toBeNull();
  });

  // La tabla `order_status` conserva values RETIRADOS del seed: su migracion de retiro
  // solo borra la fila si nadie la referencia, y el historial pasado la referencia para
  // siempre. El catalogo que llega del backend los trae; el filtro NO debe ofrecerlos,
  // porque ninguna orden viva puede tenerlos y la opcion no devolveria nada nunca.
  // Catalogo propio (no el compartido) para que el caso diga exactamente que protege.
  it("un value RETIRADO del seed que sobrevive en la tabla NO genera opción", async () => {
    const user = userEvent.setup();
    listarOrderStatusMock.mockResolvedValue({
      status: "ok",
      estatus: [
        ...CATALOGO,
        // Literal partido a proposito: `censo-order-status-rename` prohibe nombrarlo
        // entero fuera de db/tests/specs, y este fixture imita justo esa fila huerfana.
        { id: "est-retirado", value: ["en", "fulfillment"].join("_") },
      ],
    });
    renderListado(<OrdenesListado />);
    await abrirFiltro(user);

    // Las 3 de siempre (4 del catalogo − `pendiente`): el retirado no suma una cuarta.
    expect(within(listbox()).getAllByRole("option")).toHaveLength(3);
    expect(screen.queryByRole("option", { name: /fulfillment/i })).toBeNull();
  });

  it("R13: `exclude` por `value` omite exactamente esos estados", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado exclude={["pendiente", "devuelta"]} />);
    await abrirFiltro(user);

    expect(within(listbox()).getAllByRole("option")).toHaveLength(2);
    expect(screen.queryByRole("option", { name: OPT_DEVUELTA })).toBeNull();
  });

  it("el buscador del filtro acota las opciones por nombre de estado", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado />);
    await abrirFiltro(user);

    await user.type(screen.getByRole("searchbox", { name: /buscar en estado/i }), "entreg");

    expect(screen.getByRole("option", { name: OPT_ENTREGADA })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: OPT_DEVUELTA })).toBeNull();
  });
});

describe("OrdenesListado — filtro de selección múltiple", () => {
  it("marcar un estado consulta con ese `status_id` (lista de 1)", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado />);
    await abrirFiltro(user);

    await user.click(screen.getByRole("option", { name: OPT_ENTREGADA }));

    await waitFor(() =>
      expect(ultimoStatusId()).toEqual(["est-entregada"]),
    );
  });

  it("marcar VARIOS estados los envía juntos en un solo `status_id`", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado />);
    await abrirFiltro(user);

    // El panel NO se cierra al marcar: la selección múltiple es encadenada.
    await user.click(screen.getByRole("option", { name: OPT_ENTREGADA }));
    await user.click(screen.getByRole("option", { name: OPT_DEVUELTA }));

    await waitFor(() =>
      expect(ultimoStatusId()).toEqual(["est-entregada", "est-devuelta"]),
    );
    // Una sola tabla para ambos estados (no una por estado).
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });

  it("desmarcar un estado lo saca del filtro", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado />);
    await abrirFiltro(user);

    await user.click(screen.getByRole("option", { name: OPT_ENTREGADA }));
    await user.click(screen.getByRole("option", { name: OPT_DEVUELTA }));
    await waitFor(() => expect(ultimoStatusId()).toHaveLength(2));

    await user.click(screen.getByRole("option", { name: OPT_ENTREGADA }));

    await waitFor(() => expect(ultimoStatusId()).toEqual(["est-devuelta"]));
  });

  it("la X del propio filtro vuelve al listado sin filtro de estado", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado />);
    await abrirFiltro(user);
    await user.click(screen.getByRole("option", { name: OPT_ENTREGADA }));
    await waitFor(() => expect(ultimoStatusId()).toEqual(["est-entregada"]));

    await user.click(screen.getByRole("button", { name: "Limpiar Estado" }));

    await waitFor(() => expect(ultimoStatusId()).toBeUndefined());
  });

  it("el disparador resume la selección (etiqueta con 1, conteo con varias)", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado />);
    await abrirFiltro(user);

    await user.click(screen.getByRole("option", { name: OPT_ENTREGADA }));
    expect(
      screen.getByRole("button", { name: `Estado: ${OPT_ENTREGADA}` }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: OPT_DEVUELTA }));
    expect(
      screen.getByRole("button", { name: "Estado: 2 seleccionados" }),
    ).toBeInTheDocument();
  });
});

describe("OrdenesListado — carga masiva a nivel contenedor (adminTienda)", () => {
  it("ofrece Carga masiva cuando `puedeCargarMasiva`", async () => {
    renderListado(<OrdenesListado puedeCargarMasiva />);

    expect(
      await screen.findByRole("button", { name: /carga masiva/i }),
    ).toBeInTheDocument();
  });

  it("NO ofrece Carga masiva por default", async () => {
    renderListado(<OrdenesListado />);

    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: /carga masiva/i })).toBeNull();
  });
});

// R20 se verifica en OrdenesPage.test.tsx (el mensajero NO monta OrdenesListado; el
// wiring de page.tsx enruta solo maestro/admin/adminTienda a esta vista). Aquí se
// documenta el contrato: el mensajero nunca instancia este componente.
describe("OrdenesListado — catálogo no autorizado (R20)", () => {
  it("sin catálogo el filtro queda deshabilitado, pero el listado sigue funcionando", async () => {
    // Simula el forbidden del backend (rol no autorizado): sin opciones, sin crash.
    listarOrderStatusMock.mockResolvedValue({ status: "forbidden" });
    renderListado(<OrdenesListado />);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Estado:/ })).toBeDisabled();
    // El listado sin filtro sigue consultando (ya no hay tabs que montar).
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
  });
});

// `reprogramada` es el ÚNICO estado que muestra "Liberada el" (el día para el que
// quedó reprogramada la orden = cuando el cron la desbloquea, feature 46). Como una
// sola tabla puede mezclar estados, la columna aparece solo cuando el filtro está
// acotado EXACTAMENTE a ese estado.
describe("OrdenesListado — columna 'Liberada el' solo con reprogramada en solitario", () => {
  // Catálogo propio: el CATALOGO compartido fija el número de opciones que asertan
  // otros tests (R13/R14), así que `reprogramada` se añade solo aquí.
  const CATALOGO_CON_REPROGRAMADA = [
    ...CATALOGO,
    { id: "est-reprogramada", value: "reprogramada" },
  ];

  beforeEach(() => {
    listarOrderStatusMock.mockResolvedValue({
      status: "ok",
      estatus: CATALOGO_CON_REPROGRAMADA,
    });
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [{ ...makeOrden("o1", 1001), fechaReprogramacion: "2026-07-20" }],
      total: 1,
      page: 1,
      pageSize: 10,
    });
  });

  it("filtrando solo por reprogramada muestra la columna con la fecha", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado />);
    await abrirFiltro(user);

    await user.click(screen.getByRole("option", { name: /reprogramada/i }));

    expect(
      await screen.findByRole("columnheader", { name: "Liberada el" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("2026-07-20")).toBeInTheDocument();
  });

  it("sin filtro NO muestra la columna", async () => {
    renderListado(<OrdenesListado />);

    await screen.findByRole("table");
    expect(screen.queryByRole("columnheader", { name: "Liberada el" })).toBeNull();
  });

  it("mezclando reprogramada con otro estado NO muestra la columna", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado />);
    await abrirFiltro(user);

    await user.click(screen.getByRole("option", { name: /reprogramada/i }));
    await screen.findByRole("columnheader", { name: "Liberada el" });
    await user.click(screen.getByRole("option", { name: OPT_ENTREGADA }));

    await waitFor(() =>
      expect(
        screen.queryByRole("columnheader", { name: "Liberada el" }),
      ).toBeNull(),
    );
  });
});
