// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// `OrdenesTabs` usa `useRouter` (navegación al escanear el QR de una etiqueta),
// que exige el App Router montado: se mockea como en el resto de la suite.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";

// Las tabs se titulan con la etiqueta legible del estado (R14), que sale del mapa
// de presentación. Se asertan contra el mapa —no contra literales— porque lo que
// se verifica es "la tab muestra la etiqueta del estado", no un texto concreto:
// así un rebrand de etiquetas no rompe este archivo. Los literales del mapa los
// blinda `tests/components/EstatusLabel.test.ts`.
const TAB_EN_BODEGA = ORDER_STATUS_LABELS.en_bodega;
const TAB_ENTREGADA = ORDER_STATUS_LABELS.entregada;
const TAB_DEVUELTA = ORDER_STATUS_LABELS.devuelta;

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

    expect(await screen.findByRole("tab", { name: TAB_EN_BODEGA })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: TAB_ENTREGADA })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: TAB_DEVUELTA })).toBeInTheDocument();
  });
});

describe("OrdenesTabs — exclude (R13)", () => {
  it("R13: el estado por default `pendiente` NO genera tab", async () => {
    renderTabs(<OrdenesTabs />);

    await screen.findByRole("tab", { name: TAB_EN_BODEGA });
    expect(screen.queryByRole("tab", { name: /pendiente/i })).toBeNull();
  });

  it("R13: `exclude` por `value` omite exactamente esos estados", async () => {
    renderTabs(<OrdenesTabs exclude={["pendiente", "devuelta"]} />);

    await screen.findByRole("tab", { name: TAB_EN_BODEGA });
    expect(tabs()).toHaveLength(2); // en_bodega + entregada
    expect(screen.queryByRole("tab", { name: TAB_DEVUELTA })).toBeNull();
  });
});

describe("OrdenesTabs — lazy loading duro (R16) + tab activa (R15)", () => {
  it("R15/R16: solo la tab activa (primera) consulta `listarOrdenes`; las no visitadas NO", async () => {
    renderTabs(<OrdenesTabs />);

    await screen.findByRole("tab", { name: TAB_EN_BODEGA });
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

    await screen.findByRole("tab", { name: TAB_EN_BODEGA });
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    // Antes de visitarla, "entregada" no se consultó.
    expect(
      listarOrdenesMock.mock.calls.some(
        (c) =>
          (c[0] as { filter?: { status_id?: string } }).filter?.status_id ===
          "est-entregada",
      ),
    ).toBe(false);

    await user.click(screen.getByRole("tab", { name: TAB_ENTREGADA }));

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

describe("OrdenesTabs — tab 'Todas' (maestro)", () => {
  it("con `incluirTodas` antepone 'Todas', activa por default y sin filtro de estado", async () => {
    renderTabs(<OrdenesTabs incluirTodas />);

    expect(await screen.findByRole("tab", { name: "Todas" })).toBeInTheDocument();
    // Todas + 3 estados mostrables del catálogo.
    await waitFor(() => expect(tabs()).toHaveLength(4));

    // La tab activa por default ("Todas") consulta `listarOrdenes` SIN filtro.
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
    // Lazy (R16): ninguna tab de estado se consultó todavía (sin `filter`).
    const algunaConFiltro = listarOrdenesMock.mock.calls.some(
      (c) => (c[0] as { filter?: unknown }).filter !== undefined,
    );
    expect(algunaConFiltro).toBe(false);
  });

  it("sin `incluirTodas` NO aparece la tab 'Todas'", async () => {
    renderTabs(<OrdenesTabs />);

    await screen.findByRole("tab", { name: TAB_EN_BODEGA });
    expect(screen.queryByRole("tab", { name: "Todas" })).toBeNull();
  });
});

describe("OrdenesTabs — paginación independiente por tab (R17)", () => {
  it("R17: cada tab monta su propio OrdenesModule (paginación propia por status)", async () => {
    const user = userEvent.setup();
    renderTabs(<OrdenesTabs />);

    await screen.findByRole("tab", { name: TAB_EN_BODEGA });
    // Cada tab tiene su navegación de paginación (una por tab visitada).
    expect(
      await screen.findByRole("navigation", { name: "Paginación" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: TAB_ENTREGADA }));
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

describe("OrdenesTabs — orientación vertical con filtro (maestro)", () => {
  it("por default (horizontal) NO ofrece el filtro de estados", async () => {
    renderTabs(<OrdenesTabs />);

    await screen.findByRole("tab", { name: TAB_EN_BODEGA });
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("vertical: filtra las tabs por nombre de estado", async () => {
    const user = userEvent.setup();
    renderTabs(<OrdenesTabs orientation="vertical" />);

    await screen.findByRole("tab", { name: TAB_EN_BODEGA });
    await user.type(screen.getByRole("searchbox"), "entreg");

    expect(screen.getByRole("tab", { name: TAB_ENTREGADA })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: TAB_DEVUELTA })).toBeNull();
  });

  it("vertical: filtrar NO monta las tabs filtradas ni dispara su fetch (R16)", async () => {
    const user = userEvent.setup();
    renderTabs(<OrdenesTabs orientation="vertical" />);

    await screen.findByRole("tab", { name: TAB_EN_BODEGA });
    listarOrdenesMock.mockClear();

    await user.type(screen.getByRole("searchbox"), "entreg");

    expect(listarOrdenesMock).not.toHaveBeenCalled();
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

    await screen.findByRole("tab", { name: TAB_EN_BODEGA });
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

// La tab `reprogramada` es la ÚNICA que muestra "Liberada el" (el día para el que
// quedó reprogramada la orden = cuando el cron la desbloquea, feature 46).
describe("OrdenesTabs — columna 'Liberada el' solo en la tab reprogramada", () => {
  // Catálogo propio: el CATALOGO compartido fija el número de tabs que asertan
  // otros tests (R12/R13), así que `reprogramada` se añade solo aquí.
  const CATALOGO_CON_REPROGRAMADA = [
    ...CATALOGO,
    { id: "est-reprogramada", value: "reprogramada" },
  ];

  beforeEach(() => {
    listarOrderStatusMock.mockResolvedValue({
      status: "ok",
      estatus: CATALOGO_CON_REPROGRAMADA,
    });
  });

  it("la tab reprogramada muestra la columna con la fecha de la orden", async () => {
    const user = userEvent.setup();
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [{ ...makeOrden("o1", 1001), fechaReprogramacion: "2026-07-20" }],
      total: 1,
      page: 1,
      pageSize: 10,
    });
    renderTabs(<OrdenesTabs />);

    await user.click(await screen.findByRole("tab", { name: /reprogramada/i }));

    expect(
      await screen.findByRole("columnheader", { name: "Liberada el" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("2026-07-20")).toBeInTheDocument();
  });

  it("otra tab NO muestra la columna", async () => {
    const user = userEvent.setup();
    renderTabs(<OrdenesTabs />);

    await user.click(await screen.findByRole("tab", { name: TAB_EN_BODEGA }));
    await screen.findByRole("table");

    expect(
      screen.queryByRole("columnheader", { name: "Liberada el" }),
    ).toBeNull();
  });
});
