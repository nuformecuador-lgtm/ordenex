// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import { ultimosNDiasCalendarioCR } from "@/lib/utils/fecha-cr";

// Feature 144 / TB4.1 (R46, R55, R57, R59, R62, R63, R64) — cableado del listado.

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
  zonas: [
    { id: "z1", nombre: "GAM" },
    { id: "z2", nombre: "Satélite Norte" },
  ],
  tiendas: [
    { id: "t1", nombre: "Tienda Uno", esApiKey: false, activa: true },
    { id: "t2", nombre: "Integración", esApiKey: true, activa: true },
  ],
  provincias: [
    { id: "p1", nombre: "San José" },
    { id: "p2", nombre: "Alajuela" },
  ],
  cantones: [
    { id: "c1", nombre: "Escazú", padreId: "p1" },
    { id: "c2", nombre: "Grecia", padreId: "p2" },
  ],
  distritos: [
    { id: "d1", nombre: "San Rafael", padreId: "c1" },
    { id: "d2", nombre: "Puente Piedra", padreId: "c2" },
  ],
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

/** Filtro de la ÚLTIMA llamada a `listarOrdenes`. */
function ultimoFilter(): Record<string, unknown> | undefined {
  const ultima = listarOrdenesMock.mock.calls.at(-1)?.[0] as
    | { filter?: Record<string, unknown> }
    | undefined;
  return ultima?.filter;
}

/** Abre (si hace falta) el panel de un filtro de la barra genérica. */
async function abrir(user: ReturnType<typeof userEvent.setup>, label: string) {
  const abierto = screen.queryByRole("listbox", { name: label });
  if (abierto) return abierto;
  await user.click(screen.getByRole("button", { name: new RegExp(`^${label}:`) }));
  return screen.getByRole("listbox", { name: label });
}

async function marcar(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  opcion: string,
) {
  const lista = await abrir(user, label);
  await user.click(within(lista).getByRole("option", { name: opcion }));
}

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

describe("OrdenesListado — barra de filtros (R55, R63)", () => {
  it("R55: monta los SEIS filtros sobre el componente genérico", async () => {
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);

    for (const etiqueta of ["Zona", "Tienda", "Provincia", "Cantón", "Distrito"]) {
      expect(
        await screen.findByRole("button", { name: new RegExp(`^${etiqueta}:`) }),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByRole("group", { name: "Fecha de creación" }),
    ).toBeInTheDocument();
  });

  it("R63: la barra ofrece 'Limpiar todo' además de la limpieza individual", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("button", { name: /^Zona:/ });

    // Sin ningún filtro activo no hay nada que limpiar: el botón no se ofrece.
    expect(screen.queryByRole("button", { name: "Limpiar todo" })).toBeNull();

    await marcar(user, "Zona", "GAM");
    await waitFor(() => expect(ultimoFilter()).toEqual({ zona_id: ["z1"] }));

    await user.click(screen.getByRole("button", { name: "Limpiar todo" }));
    await waitFor(() => expect(ultimoFilter()).toBeUndefined());
  });

  it("R62: sin el filtro de tienda, la barra monta cinco filtros", async () => {
    renderListado(
      <OrdenesListado catalogoFiltros={CATALOGO} incluirFiltroTienda={false} />,
    );
    await screen.findByRole("button", { name: /^Zona:/ });

    expect(screen.queryByRole("button", { name: /^Tienda:/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Provincia:/ })).toBeInTheDocument();
  });

  it("R51: las cuentas por API key se ofrecen en un grupo aparte", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("button", { name: /^Tienda:/ });

    const lista = await abrir(user, "Tienda");
    expect(
      within(lista)
        .getAllByRole("group")
        .map((g) => g.getAttribute("aria-label")),
    ).toEqual(["Cuentas tienda", "Integraciones (API)"]);
  });
});

describe("OrdenesListado — inyección en el `filter` (R46, R58, R59)", () => {
  it("R59: SIN selección, `listarOrdenes` se invoca con la entrada previa a esta feature", async () => {
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);

    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
    expect(ultimoFilter()).toBeUndefined();
  });

  it("R58: con una zona marcada, el `filter` lleva su clave y su lista de ids", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("button", { name: /^Zona:/ });

    await marcar(user, "Zona", "GAM");

    await waitFor(() => expect(ultimoFilter()).toEqual({ zona_id: ["z1"] }));
  });

  it("R58: el filtro de tiempo se traduce a `created_desde`/`created_hasta`", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("button", { name: /^Zona:/ });

    // El rango se elige en el calendario, que abre en el mes actual; el primer clic
    // deja un rango de un dia (`desde === hasta`).
    await user.click(screen.getByRole("button", { name: "Fecha de creación" }));
    const cuadriculas = await screen.findAllByRole("grid");
    await user.click(within(cuadriculas[0]).getByText("1"));

    const hoy = new Date();
    const primero = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
    await waitFor(() =>
      expect(ultimoFilter()).toEqual({
        created_desde: primero,
        created_hasta: primero,
      }),
    );
  });

  it("R58: 'Reasignables' marcado viaja al `filter` como bandera booleana", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("button", { name: /^Zona:/ });

    await user.click(screen.getByRole("checkbox", { name: "Reasignables" }));

    await waitFor(() => expect(ultimoFilter()).toEqual({ reasignables: true }));
  });

  it("R58: al desmarcar 'Reasignables' el filtro DESAPARECE de la consulta", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("button", { name: /^Zona:/ });

    const casilla = screen.getByRole("checkbox", { name: "Reasignables" });
    await user.click(casilla);
    await waitFor(() => expect(ultimoFilter()).toEqual({ reasignables: true }));

    await user.click(casilla);
    await waitFor(() => expect(ultimoFilter()).toBeUndefined());
  });

  it("R58: el atajo de antigüedad se traduce al RANGO que representa", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("button", { name: /^Zona:/ });

    // Los atajos son botones dentro del propio calendario, no un control aparte, y no
    // emiten un valor propio: fijan el rango (30 días calendario CR incluido hoy).
    await user.click(screen.getByRole("button", { name: "Fecha de creación" }));
    const predefinidos = await screen.findByRole("group", {
      name: "Rangos predefinidos",
    });
    await user.click(
      within(predefinidos).getByRole("button", { name: "Últimos 30 días" }),
    );

    const esperado = ultimosNDiasCalendarioCR(30);
    await waitFor(() =>
      expect(ultimoFilter()).toEqual({
        created_desde: esperado.desde,
        created_hasta: esperado.hasta,
      }),
    );
  });

  it("R46: los filtros nuevos se COMBINAN con el de estado, sin anularse", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("button", { name: /^Estado:/ });

    await marcar(user, "Estado", "Entregada");
    await marcar(user, "Zona", "GAM");

    await waitFor(() =>
      expect(ultimoFilter()).toEqual({
        status_id: ["est-entregada"],
        zona_id: ["z1"],
      }),
    );
  });
});

describe("OrdenesListado — cadena geográfica en el cliente (R57)", () => {
  it("R57: marcar una provincia acota los cantones SIN consultar al servidor", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("button", { name: /^Provincia:/ });

    // Sin provincia marcada, el cantón ofrece los dos.
    let cantones = await abrir(user, "Cantón");
    expect(within(cantones).getAllByRole("option")).toHaveLength(2);
    await user.keyboard("{Escape}");

    const llamadasCatalogo = listarOrderStatusMock.mock.calls.length;
    await marcar(user, "Provincia", "San José");

    cantones = await abrir(user, "Cantón");
    expect(
      within(cantones).getAllByRole("option").map((o) => o.textContent),
    ).toEqual(["Escazú"]);
    // Ninguna consulta de catálogo extra: el acotamiento es puro cliente.
    expect(listarOrderStatusMock.mock.calls.length).toBe(llamadasCatalogo);
  });

  it("R57: la cadena acota de punta a punta (provincia -> cantón -> distrito)", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("button", { name: /^Provincia:/ });

    await marcar(user, "Provincia", "Alajuela");

    const distritos = await abrir(user, "Distrito");
    expect(
      within(distritos).getAllByRole("option").map((o) => o.textContent),
    ).toEqual(["Puente Piedra"]);
  });

  it("R57/R26: al cambiar la provincia, el cantón huérfano desaparece del `filter`", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={CATALOGO} />);
    await screen.findByRole("button", { name: /^Provincia:/ });

    await marcar(user, "Provincia", "San José");
    await marcar(user, "Cantón", "Escazú");
    await waitFor(() =>
      expect(ultimoFilter()).toEqual({
        provincia_id: ["p1"],
        canton_id: ["c1"],
      }),
    );

    await marcar(user, "Provincia", "Alajuela");
    await marcar(user, "Provincia", "San José");

    await waitFor(() => expect(ultimoFilter()).toEqual({ provincia_id: ["p2"] }));
  });
});

describe("OrdenesListado — catálogo no disponible (R64)", () => {
  it("R64: con `catalogoFiltros` null la barra va deshabilitada y la tabla sigue viva", async () => {
    renderListado(<OrdenesListado catalogoFiltros={null} />);

    expect(await screen.findByRole("button", { name: /^Zona:/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Provincia:/ })).toBeDisabled();
    expect(screen.getByRole("table", { name: "Órdenes" })).toBeInTheDocument();
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
  });

  it("R64: el filtro de ESTADO sigue operativo aunque falte el catálogo nuevo", async () => {
    const user = userEvent.setup();
    renderListado(<OrdenesListado catalogoFiltros={null} />);
    await screen.findByRole("button", { name: /^Estado:/ });

    await marcar(user, "Estado", "Entregada");

    await waitFor(() =>
      expect(ultimoFilter()).toEqual({ status_id: ["est-entregada"] }),
    );
  });
});
