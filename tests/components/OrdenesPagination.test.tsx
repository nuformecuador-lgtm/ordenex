// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import OrdenesPage from "@/app/(app)/ordenes/page";
import { ToastProvider } from "@/providers/ToastProvider";
import { listarOrdenes } from "@/lib/actions/ordenes";
import type { ListarOrdenesResult, OrdenListItemDTO } from "@/lib/types/orden";

// `OrdenesListado` usa `useRouter` (navegación al escanear el QR de una etiqueta),
// que exige el App Router montado: se mockea como en el resto de la suite.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// La Server Action se mockea y actúa como fetcher de SWR (server-side): la vista
// pasa { page, pageSize } y el mock segmenta un dataset en memoria.
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: vi.fn(),
}));

// Feature 17: page.tsx ramifica por rol server-side; se resuelve a null para
// mantener la rama del listado plano (paginación) SIN regresión.
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(async () => null),
}));

// Feature 57: el PageHeader del topbar monta el LogoutButton (client:
// useRouter/useToast). Se stubbea para aislar la página.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

const listarOrdenesMock = vi.mocked(listarOrdenes);

function makeOrden(id: string, numGuia: number): OrdenListItemDTO {
  return {
    id,
    numGuia,
    numRemision: `REM-${numGuia}`,
    estatusId: "est-id",
    estatusValue: "En bodega",
    destinatario: `Dest ${numGuia}`,
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
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
  };
}

/** Mockea `listarOrdenes` como backend paginado real sobre `total` órdenes. */
function mockDataset(total: number): void {
  const all = Array.from({ length: total }, (_, i) => makeOrden(`o${i + 1}`, 1001 + i));
  listarOrdenesMock.mockImplementation(async (input) => {
    const { page, pageSize } = input as { page: number; pageSize: number };
    const start = (page - 1) * pageSize;
    return {
      status: "ok",
      items: all.slice(start, start + pageSize),
      page,
      pageSize,
      total,
    };
  });
}

/** `OrdenesPage` es un Server Component async (feature 17): resuelve su árbol con `await`. */
async function renderPage(): Promise<void> {
  const page = await OrdenesPage();
  render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        {page}
      </SWRConfig>
    </ToastProvider>,
  );
}

function pagination(): HTMLElement {
  return screen.getByRole("navigation", { name: "Paginación" });
}

function bodyRows(): HTMLElement[] {
  const tbody = screen.getByRole("table").querySelector("tbody");
  if (!tbody) throw new Error("tbody no encontrado");
  return within(tbody).getAllByRole("row");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("OrdenesPage — paginación", () => {
  it("E1: compone DataTable + Pagination como hermanos y pide la primera página vía SWR (R19, R20)", async () => {
    mockDataset(45);
    await renderPage();

    await screen.findByText("REM-1001");

    // Primera consulta con el pageSize por defecto (25) y página 1.
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
    // 25 filas en la página 1.
    expect(bodyRows()).toHaveLength(25);
    // El nav de paginación es HERMANO de la tabla, no vive dentro de ella.
    const nav = pagination();
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("table").contains(nav)).toBe(false);
    expect(within(nav).getByText("1-25 de 45")).toBeInTheDocument();
  });

  it("E2: al cambiar de página re-consulta listarOrdenes con la nueva page y renderiza sus filas (R21)", async () => {
    const user = userEvent.setup();
    mockDataset(45);
    await renderPage();

    await screen.findByText("REM-1001");
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));

    await screen.findByText("REM-1026"); // primera fila de la página 2
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 2, pageSize: 25 });
    expect(screen.queryByText("REM-1001")).toBeNull();
    // Última página: 45 elementos en páginas de 25 ⇒ la 2ª va del 26 al 45, no al 50.
    expect(within(pagination()).getByText("26-45 de 45")).toBeInTheDocument();
  });

  it("E3: el selector ofrece [10,25,50] y cambiar de tamaño vuelve a la página 1 (R33, R34)", async () => {
    const user = userEvent.setup();
    mockDataset(90);
    await renderPage();

    await screen.findByText("REM-1001");
    // Estando en página 2...
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await screen.findByText("REM-1026");

    const select = screen.getByRole("combobox", { name: "Elementos por página" });
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      "10",
      "25",
      "50",
    ]);

    // Cambiar a 50 (distinto del default 25) → vuelve a página 1 con el nuevo tamaño.
    await user.selectOptions(select, "50");
    // Se espera la CONSULTA, no el texto del indicador: el rango se recalcula en cuanto el
    // pageSize local cambia, así que un texto sería un ancla que depende de en qué punto del
    // ciclo de SWR caiga la comprobación. Lo que este caso afirma es la re-consulta.
    await waitFor(() =>
      expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 1, pageSize: 50 }),
    );
  });

  it("E4: durante la carga muestra el estado de DataTable y deshabilita los controles sin perder el indicador (R23)", async () => {
    listarOrdenesMock.mockReturnValue(new Promise<ListarOrdenesResult>(() => {}));
    await renderPage();

    expect(screen.getByRole("status")).toBeInTheDocument();
    for (const button of within(pagination()).getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
    // El indicador de posición sigue presente. Durante la carga no hay `total` todavía, así
    // que dice "Sin resultados": es el mismo texto que el conjunto vacío, y no miente en
    // ninguno de los dos casos porque no hay nada que rangear.
    expect(within(pagination()).getByText("Sin resultados")).toBeInTheDocument();
  });

  it("E5: total 0 muestra 'No hay órdenes' y el Pagination vacío con controles disabled (R24)", async () => {
    mockDataset(0);
    await renderPage();

    await screen.findByText("No hay órdenes");
    const nav = pagination();
    expect(within(nav).getByText("Sin resultados")).toBeInTheDocument();
    for (const button of within(nav).getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("E6: el total mostrado proviene del backend, no se recalcula desde items.length (R25)", async () => {
    // El backend autoriza un subconjunto (2 items) pero informa total=45.
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [makeOrden("a", 5001), makeOrden("b", 5002)],
      page: 1,
      pageSize: 25,
      total: 45,
    });
    await renderPage();

    await screen.findByText("REM-5001");
    // El rango sale del total del backend (45), no de los 2 items: `1-25 de 45`. El `25` es
    // el pageSize, no las filas pintadas — un backend que devuelve MENOS items que el
    // pageSize en una página que no es la última se está contradiciendo a sí mismo, y el
    // control no puede detectarlo porque no recibe los items (solo page/pageSize/total).
    expect(within(pagination()).getByText("1-25 de 45")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(2);
  });

  it("E7: primera/última activos: navegan a la última y primera página server-side (R32)", async () => {
    const user = userEvent.setup();
    mockDataset(90);
    await renderPage();

    await screen.findByText("REM-1001");
    // Cambiar a tamaño 10 → 9 páginas.
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Elementos por página" }),
      "10",
    );
    await screen.findByText("1-10 de 90");

    await user.click(screen.getByRole("button", { name: "Última página" }));
    await screen.findByText("81-90 de 90");
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 9, pageSize: 10 });

    await user.click(screen.getByRole("button", { name: "Primera página" }));
    await screen.findByText("1-10 de 90");
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 1, pageSize: 10 });
  });

  it("E8: la ventana numérica marca la página actual con aria-current y sus botones re-consultan (R32, R28, R29)", async () => {
    const user = userEvent.setup();
    mockDataset(90);
    await renderPage();

    await screen.findByText("REM-1001");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Elementos por página" }),
      "10",
    );
    await screen.findByText("1-10 de 90");

    // Navegar hasta la página 5.
    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    }
    await screen.findByText("41-50 de 90");

    // El botón "5" es la página actual (aria-current); hay elipsis en la ventana.
    const current = within(pagination())
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("Ir a la página 5");
    expect(within(pagination()).getAllByText("…").length).toBeGreaterThan(0);

    // Click en un botón numérico visible (6) re-consulta esa página.
    await user.click(screen.getByRole("button", { name: "Ir a la página 6" }));
    await screen.findByText("51-60 de 90");
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 6, pageSize: 10 });
  });
});
