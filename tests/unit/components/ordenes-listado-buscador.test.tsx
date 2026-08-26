// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { avisoMinimoCaracteres } from "@/components/shared/FilterComponent";
import { PLACEHOLDER_BUSQUEDA } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import { BUSQUEDA_MIN_CHARS } from "@/lib/types/orden";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";

// Feature 169 / T3.2 + T3.4 (R32, R34, R35, R36, R38) — el buscador CABLEADO en la
// superficie real: primer control de la barra y termino que llega a `listarOrdenes`.

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

const CATALOGO_ESTADOS = [
  { id: "est-pendiente", value: "pendiente" },
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

/** Filtro de la ULTIMA llamada a `listarOrdenes`. */
function ultimoFilter(): Record<string, unknown> | undefined {
  const ultima = listarOrdenesMock.mock.calls.at(-1)?.[0] as
    | { filter?: Record<string, unknown> }
    | undefined;
  return ultima?.filter;
}

/** El campo de busqueda de la barra. */
function buscador(): HTMLElement {
  return screen.getByRole("searchbox", { name: "Buscar" });
}

/**
 * Los OCHO controles que la barra ofrece ademas del buscador, en el orden en que se
 * declaran. El buscador NO esta en la lista a proposito: es la barra misma, no uno de
 * los filtros que se piden.
 */
const FILTROS_OFRECIDOS = [
  "Estado",
  "Zona",
  "Mensajero",
  "Tienda",
  "Provincia",
  "Cantón",
  "Distrito",
  "Fecha de creación",
  "Reasignables",
];

/**
 * Pone en la barra los filtros que se piden, por su etiqueta. Los controles ya NO nacen
 * montados: la barra arranca con el buscador solo y cada filtro se PIDE en el selector
 * "Filtros", asi que esto es la precondicion que antes daba el render.
 */
async function ponerFiltros(
  user: ReturnType<typeof userEvent.setup>,
  ...etiquetas: string[]
) {
  await user.click(await screen.findByRole("button", { name: /^Filtros/ }));
  const selector = await screen.findByRole("listbox", { name: "Filtros" });
  for (const etiqueta of etiquetas) {
    await user.click(within(selector).getByRole("option", { name: etiqueta }));
  }
  // Marcar NO cierra el selector (se piden varios del tiron); se cierra a mano para que
  // su panel no tape los controles recien montados.
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("listbox", { name: "Filtros" })).toBeNull(),
  );
}

// La barra emite con el debounce por defecto (500 ms): las esperas de este archivo
// tienen que sobrevivirlo con holgura.
const ESPERA = { timeout: 3000 };

beforeEach(() => {
  vi.clearAllMocks();
  listarOrderStatusMock.mockResolvedValue({
    status: "ok",
    estatus: CATALOGO_ESTADOS,
  });
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items: [makeOrden("o1")],
    page: 1,
    pageSize: 25,
    total: 1,
  });
});

afterEach(() => cleanup());

describe("OrdenesListado — el buscador es el PRIMER control (R32)", () => {
  it("R32: la barra monta UN campo de busqueda, con su placeholder de los cinco datos", async () => {
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);

    const campo = await screen.findByRole("searchbox", { name: "Buscar" });
    expect(campo).toHaveAttribute("placeholder", PLACEHOLDER_BUSQUEDA);
    expect(screen.getAllByRole("searchbox", { name: "Buscar" })).toHaveLength(1);
  });

  // ATENCION al traducir este caso: lo que afirmaba —el campo DELANTE de los ocho
  // controles en el DOM— dejo de ser cierto A PROPOSITO. En la barra nueva los filtros
  // PEDIDOS se pintan a la izquierda del campo (`BuscadorFiltros` pinta sus `children`
  // antes del `Input`), asi que la comparacion de posiciones ya no tiene sujeto.
  //
  // Lo que SI sobrevive de R32, y es lo que se vigila aqui, es la primacia del
  // buscador: es el UNICO control permanente de la barra. Nace solo —ninguno de los
  // ocho, el de estado incluido, compite con el de entrada—, los ocho se siguen
  // ofreciendo, y pedir uno lo suma a la barra sin desplazar ni sustituir al campo.
  it("R32: es el UNICO control permanente; los demas se piden, el de estado incluido", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("searchbox", { name: "Buscar" });

    // Barra recien abierta: ni un disparador de filtro, ni el calendario, ni el
    // interruptor.
    for (const etiqueta of FILTROS_OFRECIDOS) {
      expect(
        screen.queryByRole("button", { name: new RegExp(`^${etiqueta}:`) }),
      ).toBeNull();
    }
    expect(screen.queryByRole("group", { name: "Fecha de creación" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Reasignables" })).toBeNull();

    // ...y ninguno se perdio por el camino: todos se OFRECEN, en su orden.
    await user.click(screen.getByRole("button", { name: /^Filtros/ }));
    const selector = await screen.findByRole("listbox", { name: "Filtros" });
    expect(
      within(selector)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(FILTROS_OFRECIDOS);

    // Pedir uno lo MONTA, y el campo sigue ahi: el filtro se suma a la barra, no la
    // sustituye ni la desaloja.
    await user.click(within(selector).getByRole("option", { name: "Estado" }));
    await user.keyboard("{Escape}");
    expect(
      await screen.findByRole("button", { name: /^Estado:/ }),
    ).toBeInTheDocument();
    expect(buscador()).toBeEnabled();
  });

  it("R64: si el catalogo geografico no cargo, el buscador sigue OPERATIVO", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={null} />);

    expect(await screen.findByRole("searchbox", { name: "Buscar" })).toBeEnabled();
    // Y los que si dependen del catalogo, una vez puestos, siguen deshabilitados (sin
    // regresion): el fallo del catalogo no se lleva por delante la busqueda.
    await ponerFiltros(user, "Zona");
    expect(screen.getByRole("button", { name: /^Zona:/ })).toBeDisabled();
    expect(buscador()).toBeEnabled();
  });
});

describe("OrdenesListado — el termino llega a `listarOrdenes` (R34, R36)", () => {
  it("R34: teclear un termino lo envia como ESCALAR `q`, en una sola consulta", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("searchbox", { name: "Buscar" });
    const llamadasPrevias = listarOrdenesMock.mock.calls.length;

    await user.type(buscador(), "juan perez");

    await waitFor(() => expect(ultimoFilter()).toEqual({ q: "juan perez" }), ESPERA);
    // Una rafaga de 10 pulsaciones = UNA consulta nueva.
    expect(listarOrdenesMock.mock.calls.length).toBe(llamadasPrevias + 1);
  });

  it("R35: por debajo del minimo no se consulta nada y se avisa del minimo", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("searchbox", { name: "Buscar" });
    const llamadasPrevias = listarOrdenesMock.mock.calls.length;

    await user.type(buscador(), "ju");
    await new Promise((r) => setTimeout(r, 700)); // mas que el debounce

    expect(listarOrdenesMock.mock.calls.length).toBe(llamadasPrevias);
    expect(ultimoFilter()).toBeUndefined();
    expect(screen.getByRole("status")).toHaveTextContent(
      avisoMinimoCaracteres(BUSQUEDA_MIN_CHARS),
    );
  });

  it("R36: vaciar el campo devuelve el listado a la consulta SIN busqueda", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("searchbox", { name: "Buscar" });

    await user.type(buscador(), "juan");
    await waitFor(() => expect(ultimoFilter()).toEqual({ q: "juan" }), ESPERA);

    await user.clear(buscador());

    await waitFor(() => expect(ultimoFilter()).toBeUndefined(), ESPERA);
    expect(listarOrdenesMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25 });
  });

  it("R14: el termino se COMBINA con el resto de filtros, sin anularlos", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await ponerFiltros(user, "Zona");

    await user.click(screen.getByRole("button", { name: /^Zona:/ }));
    await user.click(screen.getByRole("option", { name: "GAM" }));
    await user.keyboard("{Escape}");
    await user.type(buscador(), "juan");

    await waitFor(
      () => expect(ultimoFilter()).toEqual({ zona_id: ["z1"], q: "juan" }),
      ESPERA,
    );
  });

  it("R37: 'Limpiar todo' vacia tambien el buscador y su clave sale de la consulta", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("searchbox", { name: "Buscar" });

    await user.type(buscador(), "juan");
    await waitFor(() => expect(ultimoFilter()).toEqual({ q: "juan" }), ESPERA);

    await user.click(screen.getByRole("button", { name: "Limpiar todo" }));

    await waitFor(() => expect(ultimoFilter()).toBeUndefined(), ESPERA);
    expect(buscador()).toHaveValue("");
  });
});
