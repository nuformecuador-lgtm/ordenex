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

/**
 * Pone en la barra el filtro que se pide, por su etiqueta.
 *
 * La barra ya NO nace con los controles montados: arranca con el buscador solo y cada
 * filtro se PIDE en el selector "Filtros". Sin este paso no existe el disparador
 * `"<Etiqueta>: …"` que abren los tests, así que el paso no es decoración: es la
 * precondición que antes daba el render.
 */
async function ponerFiltro(
  user: ReturnType<typeof userEvent.setup>,
  etiqueta: string,
) {
  await user.click(await screen.findByRole("button", { name: /^Filtros/ }));
  const selector = await screen.findByRole("listbox", { name: "Filtros" });
  await user.click(within(selector).getByRole("option", { name: etiqueta }));
  // Marcar NO cierra el selector (se pueden pedir varios del tirón); se cierra a mano
  // para que su panel no tape el control recién montado.
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("listbox", { name: "Filtros" })).toBeNull(),
  );
}

/** Abre el desplegable del filtro de estados y devuelve su botón disparador. */
async function abrirFiltro(user: ReturnType<typeof userEvent.setup>) {
  await ponerFiltro(user, "Estado");
  const boton = await screen.findByRole("button", { name: /^Estado:/ });
  await user.click(boton);
  await screen.findByRole("listbox", { name: "Estado" });
  return boton;
}

/** Panel desplegado del filtro de estados (ya abierto). */
function listbox(): HTMLElement {
  return screen.getByRole("listbox", { name: "Estado" });
}

/**
 * Las opciones DEL CATÁLOGO del panel abierto. Excluye la opción «Todos» (2026-08-19), que
 * es `role="option"` porque se marca como una más, pero no sale del catálogo: contarla aquí
 * haría que estos casos midieran la barra en vez de los estados que ofrece.
 */
function opcionesDeCatalogo(): HTMLElement[] {
  return within(listbox())
    .getAllByRole("option")
    .filter((o) => o.dataset.todos !== "true");
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
    // FICHA 356: desde que la barra tiene el control de orden, la direccion por defecto
    // («Mas recientes») viaja EXPLICITA en cada peticion. Lo que este caso vigila —que sin
    // seleccion no se inyecte ninguna clave de FILTRO— sigue en pie: la igualdad es exacta,
    // asi que una clave de mas que nadie eligio lo pone rojo igual que antes.
    expect(listarOrdenesMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      sortBy: "created_at",
      sortDir: "desc",
    });
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
    expect(opcionesDeCatalogo()).toHaveLength(3);
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
    expect(opcionesDeCatalogo()).toHaveLength(3);
    expect(screen.queryByRole("option", { name: /fulfillment/i })).toBeNull();
  });

  it("R13: `exclude` por `value` omite exactamente esos estados", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado exclude={["pendiente", "devuelta"]} />);
    await abrirFiltro(user);

    expect(opcionesDeCatalogo()).toHaveLength(2);
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
    const user = userEvent.setup();
    // Simula el forbidden del backend (rol no autorizado): sin opciones, sin crash.
    listarOrderStatusMock.mockResolvedValue({ status: "forbidden" });
    renderListado(<OrdenesListado />);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    // El filtro se sigue OFRECIENDO (el selector no sabe si su catálogo cargó): lo que
    // se comprueba es que, una vez puesto, su control nace inerte en vez de ofrecer una
    // lista vacía.
    await ponerFiltro(user, "Estado");
    expect(screen.getByRole("button", { name: /^Estado:/ })).toBeDisabled();
    // El listado sin filtro sigue consultando (ya no hay tabs que montar).
    // FICHA 356: desde que la barra tiene el control de orden, la direccion por defecto
    // («Mas recientes») viaja EXPLICITA en cada peticion. Lo que este caso vigila —que sin
    // seleccion no se inyecte ninguna clave de FILTRO— sigue en pie: la igualdad es exacta,
    // asi que una clave de mas que nadie eligio lo pone rojo igual que antes.
    expect(listarOrdenesMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      sortBy: "created_at",
      sortDir: "desc",
    });
  });
});

// FICHA 367 — "Reprogramada para" (antes "Liberada el") es SIEMPRE visible en el
// listado. El dato (`fechaReprogramacion`) viaja en TODAS las filas desde el repo
// (gestión `reprogramada` vigente no anulada), así que la columna deja de estar
// atada a que el filtro esté acotado a exactamente el estado `reprogramada`. Antes
// de esta ficha desaparecía sin filtro, mezclando estados, y en cuanto el cron de
// liberación sacaba la orden de `reprogramada` no se volvía a ver nunca.
describe("OrdenesListado — columna 'Reprogramada para' siempre visible", () => {
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

  it("sin ningún filtro de estado ya muestra la columna con la fecha del DTO", async () => {
    renderListado(<OrdenesListado />);

    expect(
      await screen.findByRole("columnheader", { name: "Reprogramada para" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("2026-07-20")).toBeInTheDocument();
  });

  it("filtrando solo por reprogramada también muestra la columna con la fecha", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado />);
    await abrirFiltro(user);

    await user.click(screen.getByRole("option", { name: /reprogramada/i }));

    expect(
      await screen.findByRole("columnheader", { name: "Reprogramada para" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("2026-07-20")).toBeInTheDocument();
  });

  it("mezclando reprogramada con otro estado la columna se queda", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado />);
    await abrirFiltro(user);

    await user.click(screen.getByRole("option", { name: /reprogramada/i }));
    await screen.findByRole("columnheader", { name: "Reprogramada para" });
    await user.click(screen.getByRole("option", { name: OPT_ENTREGADA }));

    // Ya no depende de que el filtro esté acotado a un único estado: sigue montada.
    await waitFor(() =>
      expect(
        screen.getByRole("columnheader", { name: "Reprogramada para" }),
      ).toBeInTheDocument(),
    );
  });
});
