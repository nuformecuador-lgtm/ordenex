// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import {
  ETIQUETA_ORDEN_CREACION,
  OPCIONES_ORDEN_CREACION,
} from "@/app/(app)/ordenes/_components/ordenamiento-creacion";

// FICHA 356 — el control CABLEADO en la superficie real de `/ordenes`.
//
// El encargo no era «que el listado admita un orden» (eso ya lo hacía desde la 352), era que
// hubiera un BOTÓN a la vista con el que pedirlo. Por eso estos casos miran la pantalla: que
// el control esté en la barra de filtros nada más entrar, que diga en qué orden está, y que
// pulsarlo llegue hasta la petición.

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

/** El conmutador de orden, por su nombre accesible. */
function control(): HTMLElement {
  return screen.getByRole("group", { name: ETIQUETA_ORDEN_CREACION });
}

/** La ÚLTIMA entrada con la que se llamó a `listarOrdenes`. */
function ultimaLlamada(): { page?: number; sortBy?: string; sortDir?: string } {
  return listarOrdenesMock.mock.calls.at(-1)?.[0] ?? {};
}

const ETIQUETA_RECIENTES = OPCIONES_ORDEN_CREACION[0].etiqueta;
const ETIQUETA_ANTIGUAS = OPCIONES_ORDEN_CREACION[1].etiqueta;

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
    expect(await screen.findByRole("group", { name: ETIQUETA_ORDEN_CREACION }))
      .toBeInTheDocument();
  });

  it("no se ofrece como un filtro más del selector (no es un filtro: no oculta filas)", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("searchbox", { name: "Buscar" });

    await user.click(screen.getByRole("button", { name: /^Filtros/ }));
    const selector = await screen.findByRole("listbox", { name: "Filtros" });
    expect(
      within(selector).queryByRole("option", { name: ETIQUETA_ORDEN_CREACION }),
    ).toBeNull();
  });

  it("enseña las DOS direcciones y marca la puesta", async () => {
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    const grupo = await screen.findByRole("group", {
      name: ETIQUETA_ORDEN_CREACION,
    });

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
      within(control()).getByRole("button", { name: ETIQUETA_ANTIGUAS }),
    );

    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("asc"));
    expect(
      within(control()).getByRole("button", { name: ETIQUETA_ANTIGUAS }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("y volver a «Más recientes» pide `desc` otra vez", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(
      within(control()).getByRole("button", { name: ETIQUETA_ANTIGUAS }),
    );
    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("asc"));

    await user.click(
      within(control()).getByRole("button", { name: ETIQUETA_RECIENTES }),
    );
    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("desc"));
  });

  it("cambiar el orden desde la página 2 vuelve a la 1", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(ultimaLlamada().page).toBe(2));

    await user.click(
      within(control()).getByRole("button", { name: ETIQUETA_ANTIGUAS }),
    );

    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("asc"));
    expect(ultimaLlamada().page).toBe(1);
  });

  it("«Limpiar todo» no toca el orden: no es un filtro", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("searchbox", { name: "Buscar" });

    await user.click(
      within(control()).getByRole("button", { name: ETIQUETA_ANTIGUAS }),
    );
    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("asc"));

    // Se pone un filtro para que la barra ofrezca "Limpiar todo".
    await user.click(screen.getByRole("button", { name: /^Filtros/ }));
    const selector = await screen.findByRole("listbox", { name: "Filtros" });
    await user.click(within(selector).getByRole("option", { name: "Zona" }));
    await user.keyboard("{Escape}");
    await user.click(
      await screen.findByRole("button", { name: "Limpiar todo" }),
    );

    expect(
      within(control()).getByRole("button", { name: ETIQUETA_ANTIGUAS }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(ultimaLlamada().sortDir).toBe("asc"));
  });
});
