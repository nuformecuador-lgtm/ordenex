// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";

// FICHA 356 + FICHA 423 — el control CABLEADO en la superficie real de `/ordenes`.
//
// El encargo de la 356 no era «que el listado admita un orden» (eso ya lo hacía desde la 352),
// era que hubiera un BOTÓN a la vista con el que pedirlo. El de la 423 es la segunda dimensión
// del mismo control: elegir TAMBIÉN el campo, sin desplegar nada (R1), conservando la dirección
// puesta (R10). Por eso estos casos miran la pantalla: que los dos grupos estén en la barra
// nada más entrar, que digan en qué orden está, y que pulsarlos llegue hasta la petición.
//
// LOS NOMBRES ACCESIBLES Y LAS ETIQUETAS VAN ESCRITOS A MANO, no importados del módulo que los
// declara: importarlos dejaría estos casos comparándose con su propia fuente, verdes aunque el
// control dijera cualquier cosa (memoria del repo: «aserción contra su propia fuente»).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const listarOrderStatusMock = vi.fn();
vi.mock("@/lib/actions/order-status", () => ({
  listarOrderStatus: (...a: unknown[]) => listarOrderStatusMock(...a),
}));

const listarOrdenesMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
}));

import { OrdenesListado } from "@/app/(app)/ordenes/_components/OrdenesListado";

const CATALOGO: CatalogoFiltrosOrdenesDTO = {
  mensajeros: [],
  zonas: [{ id: "z1", nombre: "GAM" }],
  tiendas: [{ id: "t1", nombre: "Tienda Uno", esApiKey: false, activa: true }],
  provincias: [{ id: "p1", nombre: "San José", disponible: true }],
  cantones: [{ id: "c1", nombre: "Escazú", padreId: "p1", disponible: true }],
  distritos: [{ id: "d1", nombre: "San Rafael", padreId: "c1", disponible: true }],
};

function makeOrden(id: string): OrdenListItemDTO {
  return {
    id,
    numGuia: 1001,
    numRemision: `REM-${id}`,
    estatusId: "est-entregada",
    estatusValue: "entregada",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "t1",
    tiendaNombre: "Tienda Uno",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: "d1",
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

/** Nombre accesible del grupo de CAMPO. */
const GRUPO_CAMPO = "Ordenar por";
/** Nombre accesible del grupo de DIRECCIÓN, uno por campo. */
const GRUPO_DIR_FECHA = "Dirección del orden por fecha de creación";
const GRUPO_DIR_REMISION = "Dirección del orden por número de remisión";

const ETIQUETA_FECHA = "Fecha de creación";
const ETIQUETA_REMISION = "Número de remisión";
const ETIQUETA_RECIENTES = "Más recientes";
const ETIQUETA_ANTIGUAS = "Más antiguas";
const ETIQUETA_ALTAS = "Más altas";
const ETIQUETA_BAJAS = "Más bajas";

/** El conmutador de CAMPO, por su nombre accesible. */
function grupoCampo(): HTMLElement {
  return screen.getByRole("group", { name: GRUPO_CAMPO });
}

/** El conmutador de DIRECCIÓN del campo que esté puesto. */
function grupoDireccion(nombre: string): HTMLElement {
  return screen.getByRole("group", { name: nombre });
}

/** La ÚLTIMA entrada con la que se llamó a `listarOrdenes`. */
function ultimaLlamada(): { page?: number; sortBy?: string; sortDir?: string } {
  return listarOrdenesMock.mock.calls.at(-1)?.[0] ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  listarOrderStatusMock.mockResolvedValue({
    status: "ok",
    estatus: [
      { id: "est-pendiente", value: "pendiente" },
      { id: "est-entregada", value: "entregada" },
    ],
  });
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items: [makeOrden("o1")],
    page: 1,
    pageSize: 25,
    total: 60,
  });
});

afterEach(() => cleanup());

describe("OrdenesListado — el control de orden está A LA VISTA", () => {
  it("nace en la barra, sin pedirlo en el selector de filtros", async () => {
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    // Los filtros hay que PEDIRLOS; el orden no. Es la diferencia que arregla «no veo un
    // botón con el cual organizar los datos».
    expect(await screen.findByRole("group", { name: GRUPO_DIR_FECHA }))
      .toBeInTheDocument();
    expect(screen.getByRole("group", { name: GRUPO_CAMPO })).toBeInTheDocument();
  });

  it("R1 — ofrece los DOS campos sin desplegar nada, y ninguno más", async () => {
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    const grupo = await screen.findByRole("group", { name: GRUPO_CAMPO });

    const botones = within(grupo)
      .getAllByRole("button")
      .map((b) => b.textContent?.trim());
    expect(botones).toEqual([ETIQUETA_FECHA, ETIQUETA_REMISION]);
  });

  it("abre por la fecha de creación, que es el default del contrato", async () => {
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    const grupo = await screen.findByRole("group", { name: GRUPO_CAMPO });

    expect(
      within(grupo).getByRole("button", { name: ETIQUETA_FECHA }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(grupo).getByRole("button", { name: ETIQUETA_REMISION }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("no se ofrece como un filtro más del selector (no es un filtro: no oculta filas)", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("searchbox", { name: "Buscar" });

    await user.click(screen.getByRole("button", { name: /^Filtros/ }));
    const selector = await screen.findByRole("listbox", { name: "Filtros" });
    expect(
      within(selector).queryByRole("option", { name: GRUPO_CAMPO }),
    ).toBeNull();
    expect(
      within(selector).queryByRole("option", { name: GRUPO_DIR_FECHA }),
    ).toBeNull();
  });

  it("enseña las DOS direcciones y marca la puesta", async () => {
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    const grupo = await screen.findByRole("group", { name: GRUPO_DIR_FECHA });

    const recientes = within(grupo).getByRole("button", {
      name: ETIQUETA_RECIENTES,
    });
    const antiguas = within(grupo).getByRole("button", {
      name: ETIQUETA_ANTIGUAS,
    });
    // La opción no elegida sigue visible: es lo que hace que el control se lea de un vistazo.
    expect(recientes).toHaveAttribute("aria-pressed", "true");
    expect(antiguas).toHaveAttribute("aria-pressed", "false");
  });
});

describe("OrdenesListado — pulsar el control llega hasta la petición", () => {
  it("de entrada pide el orden por defecto del contrato", async () => {
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    expect(ultimaLlamada().sortBy).toBe("created_at");
    expect(ultimaLlamada().sortDir).toBe("desc");
  });

  it("«Más antiguas» pide `asc` y deja el control marcado ahí", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(
      within(grupoDireccion(GRUPO_DIR_FECHA)).getByRole("button", {
        name: ETIQUETA_ANTIGUAS,
      }),
    );

    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("asc"));
    expect(
      within(grupoDireccion(GRUPO_DIR_FECHA)).getByRole("button", {
        name: ETIQUETA_ANTIGUAS,
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("y volver a «Más recientes» pide `desc` otra vez", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(
      within(grupoDireccion(GRUPO_DIR_FECHA)).getByRole("button", {
        name: ETIQUETA_ANTIGUAS,
      }),
    );
    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("asc"));

    await user.click(
      within(grupoDireccion(GRUPO_DIR_FECHA)).getByRole("button", {
        name: ETIQUETA_RECIENTES,
      }),
    );
    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("desc"));
  });

  it("R2 — «Número de remisión» pide `sortBy: num_remision` al servidor", async () => {
    // El orden lo resuelve la CONSULTA, no el navegador: ordenar en el cliente reordenaría
    // las 25 filas de la página y parecería correcto. Por eso lo que se mide es la petición.
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(
      within(grupoCampo()).getByRole("button", { name: ETIQUETA_REMISION }),
    );

    await waitFor(() => expect(ultimaLlamada().sortBy).toBe("num_remision"));
    expect(
      within(grupoCampo()).getByRole("button", { name: ETIQUETA_REMISION }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("y volver a «Fecha de creación» pide `created_at` otra vez", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(
      within(grupoCampo()).getByRole("button", { name: ETIQUETA_REMISION }),
    );
    await waitFor(() => expect(ultimaLlamada().sortBy).toBe("num_remision"));

    await user.click(
      within(grupoCampo()).getByRole("button", { name: ETIQUETA_FECHA }),
    );
    await waitFor(() => expect(ultimaLlamada().sortBy).toBe("created_at"));
  });
});

describe("OrdenesListado — las etiquetas de la dirección cambian con el campo", () => {
  it("con la remisión puesta el conmutador dice «Más altas»/«Más bajas», no «Más recientes»", async () => {
    // «Más recientes» sugeriría que un número mayor es más nuevo, y con cuatro series
    // conviviendo eso es falso. El control describiría mal lo que hace.
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(
      within(grupoCampo()).getByRole("button", { name: ETIQUETA_REMISION }),
    );

    const grupo = await screen.findByRole("group", {
      name: GRUPO_DIR_REMISION,
    });
    const botones = within(grupo)
      .getAllByRole("button")
      .map((b) => b.textContent?.trim());
    expect(botones).toEqual([ETIQUETA_ALTAS, ETIQUETA_BAJAS]);
    expect(screen.queryByRole("group", { name: GRUPO_DIR_FECHA })).toBeNull();
    expect(screen.queryByText(ETIQUETA_RECIENTES)).toBeNull();
  });

  it("volver a la fecha devuelve las etiquetas temporales", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(
      within(grupoCampo()).getByRole("button", { name: ETIQUETA_REMISION }),
    );
    await screen.findByRole("group", { name: GRUPO_DIR_REMISION });

    await user.click(
      within(grupoCampo()).getByRole("button", { name: ETIQUETA_FECHA }),
    );

    const grupo = await screen.findByRole("group", { name: GRUPO_DIR_FECHA });
    expect(
      within(grupo).getByRole("button", { name: ETIQUETA_RECIENTES }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: GRUPO_DIR_REMISION })).toBeNull();
  });
});

describe("OrdenesListado — cambiar de campo CONSERVA la dirección (R10)", () => {
  it("desde «Más antiguas», elegir la remisión sigue pidiendo `asc`", async () => {
    // Decisión cerrada del 2026-09-14: mover campo y dirección con un solo clic daría dos
    // cambios que el usuario no pidió, y el segundo sería invisible hasta mirar el listado.
    // El conmutador de dirección está al lado, a un clic, para quien quiera invertirlo.
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(
      within(grupoDireccion(GRUPO_DIR_FECHA)).getByRole("button", {
        name: ETIQUETA_ANTIGUAS,
      }),
    );
    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("asc"));

    await user.click(
      within(grupoCampo()).getByRole("button", { name: ETIQUETA_REMISION }),
    );

    await waitFor(() => expect(ultimaLlamada().sortBy).toBe("num_remision"));
    expect(ultimaLlamada().sortDir).toBe("asc");
    // Y el control lo dice: la opción `asc` de la remisión es la que queda marcada.
    expect(
      within(grupoDireccion(GRUPO_DIR_REMISION)).getByRole("button", {
        name: ETIQUETA_BAJAS,
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("desde «Más recientes» (`desc`), elegir la remisión cae en «Más altas»", async () => {
    // Consecuencia asumida de conservar la dirección: quien viene del default cae en «las
    // remisiones más altas primero». Está escrita en la spec, así que se ancla.
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(
      within(grupoCampo()).getByRole("button", { name: ETIQUETA_REMISION }),
    );

    await waitFor(() => expect(ultimaLlamada().sortBy).toBe("num_remision"));
    expect(ultimaLlamada().sortDir).toBe("desc");
    expect(
      within(grupoDireccion(GRUPO_DIR_REMISION)).getByRole("button", {
        name: ETIQUETA_ALTAS,
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("y volver al campo de la fecha también conserva la dirección", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(
      within(grupoDireccion(GRUPO_DIR_FECHA)).getByRole("button", {
        name: ETIQUETA_ANTIGUAS,
      }),
    );
    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("asc"));

    await user.click(
      within(grupoCampo()).getByRole("button", { name: ETIQUETA_REMISION }),
    );
    await waitFor(() => expect(ultimaLlamada().sortBy).toBe("num_remision"));

    await user.click(
      within(grupoCampo()).getByRole("button", { name: ETIQUETA_FECHA }),
    );
    await waitFor(() => expect(ultimaLlamada().sortBy).toBe("created_at"));
    expect(ultimaLlamada().sortDir).toBe("asc");
  });
});

describe("OrdenesListado — el orden y la paginación", () => {
  it("cambiar la dirección desde la página 2 vuelve a la 1", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(ultimaLlamada().page).toBe(2));

    await user.click(
      within(grupoDireccion(GRUPO_DIR_FECHA)).getByRole("button", {
        name: ETIQUETA_ANTIGUAS,
      }),
    );

    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("asc"));
    expect(ultimaLlamada().page).toBe(1);
  });

  it("R11 — cambiar de CAMPO desde la página 2 vuelve a la 1", async () => {
    // La página 2 del orden por fecha no es la página 2 del orden por remisión: son otras
    // filas. Quedarse en la 2 enseñaría un tramo arbitrario del conjunto nuevo.
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(ultimaLlamada().page).toBe(2));

    await user.click(
      within(grupoCampo()).getByRole("button", { name: ETIQUETA_REMISION }),
    );

    await waitFor(() => expect(ultimaLlamada().sortBy).toBe("num_remision"));
    expect(ultimaLlamada().page).toBe(1);
  });

  it("«Limpiar todo» no toca el orden: no es un filtro", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("searchbox", { name: "Buscar" });

    await user.click(
      within(grupoDireccion(GRUPO_DIR_FECHA)).getByRole("button", {
        name: ETIQUETA_ANTIGUAS,
      }),
    );
    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("asc"));
    await user.click(
      within(grupoCampo()).getByRole("button", { name: ETIQUETA_REMISION }),
    );
    await waitFor(() => expect(ultimaLlamada().sortBy).toBe("num_remision"));

    // Se pone un filtro para que la barra ofrezca "Limpiar todo".
    await user.click(screen.getByRole("button", { name: /^Filtros/ }));
    const selector = await screen.findByRole("listbox", { name: "Filtros" });
    await user.click(within(selector).getByRole("option", { name: "Zona" }));
    await user.keyboard("{Escape}");
    await user.click(
      await screen.findByRole("button", { name: "Limpiar todo" }),
    );

    expect(
      within(grupoCampo()).getByRole("button", { name: ETIQUETA_REMISION }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(grupoDireccion(GRUPO_DIR_REMISION)).getByRole("button", {
        name: ETIQUETA_BAJAS,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(ultimaLlamada().sortBy).toBe("num_remision"));
    expect(ultimaLlamada().sortDir).toBe("asc");
  });
});
