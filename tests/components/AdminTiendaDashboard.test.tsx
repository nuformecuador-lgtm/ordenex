// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";

import { AdminTiendaDashboard } from "@/app/(app)/_components/AdminTiendaDashboard";
import { ToastProvider } from "@/providers/ToastProvider";
import { listarOrdenes } from "@/lib/actions/ordenes";
import type {
  ListarOrdenesResult,
  OrdenListItemDTO,
} from "@/lib/types/orden";

// La Server Action se mockea igual que en OrdenesPage.test: se afirma el render
// del dashboard sin DB ni sesión. El dashboard consume el MISMO módulo cliente
// (OrdenesModule) que /ordenes, por lo que sus estados dependen de esta action.
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: vi.fn(),
}));

// El dashboard monta LogoutButton, que usa useRouter; se mockea igual que en el
// resto de tests de componentes (patrón Sidebar/AppLayout).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const listarOrdenesMock = vi.mocked(listarOrdenes);

function makeOrden(
  overrides: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: 1000,
    numRemision: "REM-000",
    estatusId: "est-id",
    estatusValue: undefined,
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid-000",
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
    ...overrides,
  };
}

/**
 * AdminTiendaDashboard es un Server Component síncrono (encabezado + módulo
 * cliente). Se renderiza envolviendo el módulo cliente en ToastProvider + SWRConfig
 * aislado, igual que OrdenesPage.test.
 */
function renderDashboard(): void {
  render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        {AdminTiendaDashboard()}
      </SWRConfig>
    </ToastProvider>,
  );
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

describe("AdminTiendaDashboard (feature 26)", () => {
  it("R2: muestra un encabezado visible que identifica el apartado del admin de tienda", () => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });

    renderDashboard();

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Panel de tienda");
  });

  it("R6: monta el módulo de órdenes (tabla con aria-label 'Órdenes')", async () => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [makeOrden({ id: "o1", numGuia: 5001 })],
      page: 1,
      pageSize: 25,
      total: 1,
    });

    renderDashboard();

    const table = screen.getByRole("table", { name: "Órdenes" });
    expect(table).toBeInTheDocument();
    await screen.findByText("5001");
    expect(bodyRows()).toHaveLength(1);
  });

  it("R8: ofrece el botón de carga masiva", () => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });

    renderDashboard();

    expect(
      screen.getByRole("button", { name: /carga masiva/i }),
    ).toBeInTheDocument();
  });

  it("R11: NO incluye la columna 'Tienda' (redundante), pero SÍ 'Zona'; muestra el resto del listado del maestro", async () => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [
        makeOrden({ id: "o1", numGuia: 6001, tiendaNombre: "Tienda Secreta" }),
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });

    renderDashboard();

    await screen.findByText("6001");
    const headers = screen.getAllByRole("columnheader");
    // Se oculta SOLO "Tienda" (redundante: todas las órdenes son de la misma
    // tienda). "Zona" SÍ se muestra al adminTienda (decisión del humano
    // 2026-07-14). El resto —geografía, dinero (monto/flete/fulfillment/comisión)
    // y mensajero— se muestra igual que al maestro, independiente del rol.
    // Feature 160 (R22): "Intentos" entra a esta lista por herencia de
    // `ordenesColumns` (el dashboard deriva por `filter` de ids ocultos), en su
    // posición fija justo después de "Estado".
    expect(headers.map((h) => h.textContent)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Estado",
      "Intentos",
      "Destinatario",
      "Producto",
      "Dirección",
      "Zona",
      "Provincia",
      "Cantón",
      "Distrito",
      "Monto a cobrar",
      "Flete + IVA",
      "Fulfillment",
      "Comisión + IVA",
      "Mensajero",
      "Fecha de creación",
      "Tiempo",
    ]);
    // El nombre de la tienda no se renderiza en ninguna cabecera ni celda.
    expect(headers.map((h) => h.textContent)).not.toContain("Tienda");
    // La columna "Zona" SÍ está presente para el adminTienda.
    expect(headers.map((h) => h.textContent)).toContain("Zona");
    expect(screen.queryByText("Tienda Secreta")).toBeNull();
  });

  it("R9: delega los estados de carga/error/vacío en el módulo compartido", async () => {
    // Carga: promesa que no resuelve.
    listarOrdenesMock.mockReturnValue(
      new Promise<ListarOrdenesResult>(() => {}),
    );
    renderDashboard();
    expect(screen.getByRole("status")).toBeInTheDocument();
    cleanup();
    vi.clearAllMocks();

    // Error: resultado no-ok.
    listarOrdenesMock.mockResolvedValue({ status: "forbidden" });
    renderDashboard();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudieron cargar las órdenes");
    cleanup();
    vi.clearAllMocks();

    // Vacío: ok sin items.
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
    renderDashboard();
    await screen.findByText("No hay órdenes");
  });
});
