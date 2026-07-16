// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { OrdenesTabs } from "@/app/(app)/ordenes/_components/OrdenesTabs";
import { ToastProvider } from "@/providers/ToastProvider";
import { listarOrdenes } from "@/lib/actions/ordenes";
import { listarOrderStatus } from "@/lib/actions/order-status";
import { listarMensajerosParaAsignacion } from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// Solo se ejercita la deshabilitación del checkbox de asignación; los modales de
// acción (montados por `accionesLote`) se stubean para no arrastrar sus
// dependencias (PDF, QR, next/headers) en jsdom.
vi.mock("@/lib/actions/ordenes", () => ({ listarOrdenes: vi.fn() }));
vi.mock("@/lib/actions/order-status", () => ({ listarOrderStatus: vi.fn() }));
vi.mock("@/lib/actions/ordenes-guia", () => ({
  listarMensajerosParaAsignacion: vi.fn(),
}));
vi.mock("@/app/(app)/ordenes/_components/GenerarGuiaModal", () => ({
  GenerarGuiaModal: () => null,
}));
vi.mock("@/app/(app)/ordenes/_components/AsignarBodegaModal", () => ({
  AsignarBodegaModal: () => null,
}));
vi.mock("@/app/(app)/ordenes/_components/RutearSateliteModal", () => ({
  RutearSateliteModal: () => null,
}));
vi.mock("@/app/(app)/ordenes/_components/EtiquetasGuiaModal", () => ({
  EtiquetasGuiaModal: () => null,
}));
vi.mock("@/app/(app)/ordenes/_components/DevolverATiendaModal", () => ({
  DevolverATiendaModal: () => null,
}));

const listarOrdenesMock = vi.mocked(listarOrdenes);
const listarOrderStatusMock = vi.mocked(listarOrderStatus);
const listarMensajerosMock = vi.mocked(listarMensajerosParaAsignacion);

const CATALOGO = [
  { id: "id-fulfillment", value: "en_fulfillment" },
  { id: "id-preparacion", value: "en_preparacion" },
];

function makeOrden(id: string, estatusId: string): OrdenListItemDTO {
  return {
    id,
    numGuia: null,
    numRemision: `REM-${id}`,
    estatusId,
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    zonaEsGam: true,
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    mensajeroSugeridoId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function renderTabs() {
  render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <OrdenesTabs accionesLote />
      </SWRConfig>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarOrderStatusMock.mockResolvedValue({ status: "ok", estatus: CATALOGO });
  listarOrdenesMock.mockImplementation(async (input) => {
    const { filter, page, pageSize } = input as {
      filter?: { status_id: string };
      page: number;
      pageSize: number;
    };
    const items = filter ? [makeOrden("f1", filter.status_id)] : [];
    return { status: "ok", items, page, pageSize, total: items.length };
  });
});

afterEach(() => {
  cleanup();
});

describe("OrdenesTabs — bloqueo de asignación por cierre de mensajero abierto", () => {
  it("deshabilita el checkbox de la tab en_fulfillment cuando la bodega tiene ≥1 cierre abierto", async () => {
    listarMensajerosMock.mockResolvedValue({
      status: "ok",
      mensajeros: [{ id: "m1", nombre: "Juan" }],
      bloqueadosIds: ["m1"],
    });

    renderTabs();

    const checkbox = await screen.findByRole("checkbox", {
      name: /No se puede seleccionar la orden REM-f1/i,
    });
    // base-ui marca el deshabilitado con aria-disabled/data-disabled (span, no el
    // atributo nativo `disabled`).
    expect(checkbox).toHaveAttribute("aria-disabled", "true");
    expect(checkbox).toHaveAttribute("aria-checked", "false");

    // Lo esencial: al hacer click NO se marca ni aparece la barra de acciones.
    await userEvent.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText(/seleccionada/i)).not.toBeInTheDocument();
  });

  it("mantiene el checkbox habilitado cuando NO hay cierres abiertos", async () => {
    listarMensajerosMock.mockResolvedValue({
      status: "ok",
      mensajeros: [{ id: "m1", nombre: "Juan" }],
      bloqueadosIds: [],
    });

    renderTabs();

    const checkbox = await screen.findByRole("checkbox", {
      name: /Seleccionar orden REM-f1/i,
    });
    expect(checkbox).toBeEnabled();
  });
});
