// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// Catálogo `order_status` (Server Action) mockeado: el front deriva las tabs de
// aquí menos `exclude` (R14). Orden determinista (R5) preservado en el mock.
const listarOrderStatusMock = vi.fn();
vi.mock("@/lib/actions/order-status", () => ({
  listarOrderStatus: (...a: unknown[]) => listarOrderStatusMock(...a),
}));

// `listarOrdenes` mockeado: clave para R16 (lazy loading duro) — se cuenta con
// qué `status_id` se invoca y para verificar que las tabs no visitadas NO llaman.
const listarOrdenesMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
}));

import { OrdenesTabs } from "@/app/(app)/ordenes/_components/OrdenesTabs";

// Catálogo con `pendiente` (excluido por default) + 3 estados mostrables.
const CATALOGO = [
  { id: "est-pendiente", value: "pendiente" },
  { id: "est-en_bodega", value: "en_bodega" },
  { id: "est-entregada", value: "entregada" },
  { id: "est-devuelta", value: "devuelta" },
];

function makeOrden(id: string, numGuia: number): OrdenListItemDTO {
  return {
    id,
    numGuia,
    numRemision: `REM-${id}`,
    estatusId: "est-en_bodega",
    estatusValue: "en_bodega",
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

function renderTabs(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
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

/** Los `<TabsTrigger>` de base-ui exponen `role="tab"`. */
function tabs(): HTMLElement[] {
  return screen.getAllByRole("tab");
}

describe("OrdenesTabs — derivación de tabs (R12/R14)", () => {
  it("R12: renderiza una tab por estado mostrado (contenedor tablist)", async () => {
    renderTabs(<OrdenesTabs />);

    await screen.findByRole("tablist", { name: "Órdenes por estado" });
    // 4 en catálogo − 1 excluido (pendiente) = 3 tabs.
    await waitFor(() => expect(tabs()).toHaveLength(3));
  });

  it("R14: las tabs se derivan del catálogo (etiquetas legibles de cada estado)", async () => {
    renderTabs(<OrdenesTabs />);

    expect(await screen.findByRole("tab", { name: "En bodega" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Entregada" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Devuelta" })).toBeInTheDocument();
  });
});

describe("OrdenesTabs — exclude (R13)", () => {
  it("R13: el estado por default `pendiente` NO genera tab", async () => {
    renderTabs(<OrdenesTabs />);

    await screen.findByRole("tab", { name: "En bodega" });
    expect(screen.queryByRole("tab", { name: /pendiente/i })).toBeNull();
  });

  it("R13: `exclude` por `value` omite exactamente esos estados", async () => {
    renderTabs(<OrdenesTabs exclude={["pendiente", "devuelta"]} />);

    await screen.findByRole("tab", { name: "En bodega" });
    expect(tabs()).toHaveLength(2); // en_bodega + entregada
    expect(screen.queryByRole("tab", { name: "Devuelta" })).toBeNull();
  });
});

describe("OrdenesTabs — lazy loading duro (R16) + tab activa (R15)", () => {
  it("R15/R16: solo la tab activa (primera) consulta `listarOrdenes`; las no visitadas NO", async () => {
    renderTabs(<OrdenesTabs />);

    await screen.findByRole("tab", { name: "En bodega" });
    // La tab activa (primera: en_bodega) consulta con su `status_id`.
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    expect(listarOrdenesMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      filter: { status_id: "est-en_bodega" },
    });
    // R16 (duro): NUNCA se consultó por las tabs no visitadas.
    const statusIds = listarOrdenesMock.mock.calls.map(
      (c) => (c[0] as { filter?: { status_id?: string } }).filter?.status_id,
    );
    expect(statusIds).not.toContain("est-entregada");
    expect(statusIds).not.toContain("est-devuelta");
  });

  it("R16: al activar una segunda tab, recién entonces se consulta ESE estado", async () => {
    const user = userEvent.setup();
    renderTabs(<OrdenesTabs />);

    await screen.findByRole("tab", { name: "En bodega" });
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    // Antes de visitarla, "entregada" no se consultó.
    expect(
      listarOrdenesMock.mock.calls.some(
        (c) =>
          (c[0] as { filter?: { status_id?: string } }).filter?.status_id ===
          "est-entregada",
      ),
    ).toBe(false);

    await user.click(screen.getByRole("tab", { name: "Entregada" }));

    // Ahora sí se consulta el estado recién activado.
    await waitFor(() =>
      expect(
        listarOrdenesMock.mock.calls.some(
          (c) =>
            (c[0] as { filter?: { status_id?: string } }).filter?.status_id ===
            "est-entregada",
        ),
      ).toBe(true),
    );
  });
});

describe("OrdenesTabs — paginación independiente por tab (R17)", () => {
  it("R17: cada tab monta su propio OrdenesModule (paginación propia por status)", async () => {
    const user = userEvent.setup();
    renderTabs(<OrdenesTabs />);

    await screen.findByRole("tab", { name: "En bodega" });
    // Cada tab tiene su navegación de paginación (una por tab visitada).
    expect(
      await screen.findByRole("navigation", { name: "Paginación" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Entregada" }));
    // La segunda tab también consulta con su propio status_id (caché/paginación
    // separada, key SWR por status).
    await waitFor(() =>
      expect(
        listarOrdenesMock.mock.calls.some(
          (c) =>
            (c[0] as { filter?: { status_id?: string } }).filter?.status_id ===
            "est-entregada",
        ),
      ).toBe(true),
    );
  });
});

describe("OrdenesTabs — overflow accesible (R18)", () => {
  it("R18: el `TabsList` es scrollable horizontalmente y no oculta tabs", async () => {
    renderTabs(<OrdenesTabs />);

    const list = await screen.findByRole("tablist", {
      name: "Órdenes por estado",
    });
    expect(list.className).toContain("overflow-x-auto");
    // Todas las tabs derivadas quedan presentes/accesibles (ninguna oculta).
    expect(within(list).getAllByRole("tab")).toHaveLength(3);
  });
});

describe("OrdenesTabs — carga masiva a nivel contenedor (adminTienda)", () => {
  it("ofrece Carga masiva cuando `puedeCargarMasiva`", async () => {
    renderTabs(<OrdenesTabs puedeCargarMasiva />);

    expect(
      await screen.findByRole("button", { name: /carga masiva/i }),
    ).toBeInTheDocument();
  });

  it("NO ofrece Carga masiva por default", async () => {
    renderTabs(<OrdenesTabs />);

    await screen.findByRole("tab", { name: "En bodega" });
    expect(
      screen.queryByRole("button", { name: /carga masiva/i }),
    ).toBeNull();
  });
});

// R20 se verifica en OrdenesPage.test.tsx (el mensajero NO monta OrdenesTabs; el
// wiring de page.tsx enruta solo maestro/admin/adminTienda a las tabs). Aquí se
// documenta el contrato: el mensajero nunca instancia este componente.
describe("OrdenesTabs — mensajero (R20)", () => {
  it("R20: es un componente opt-in; sin catálogo autorizado degrada sin romper", async () => {
    // Simula el forbidden del backend (rol no autorizado): sin tabs, sin crash.
    listarOrderStatusMock.mockResolvedValue({ status: "forbidden" });
    renderTabs(<OrdenesTabs />);

    expect(
      await screen.findByText("No hay estados disponibles."),
    ).toBeInTheDocument();
    // Nunca se consultó `listarOrdenes` sin tabs que montar (R16 + R20).
    expect(listarOrdenesMock).not.toHaveBeenCalled();
  });
});
