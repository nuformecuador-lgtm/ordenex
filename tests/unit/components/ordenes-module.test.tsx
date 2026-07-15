// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// Feature 63/R19: la Server Action se mockea; el test observa CON QUÉ argumentos
// se invoca `listarOrdenes` según haya o no `filter` (sin regresión R10/R19).
const listarOrdenesMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
}));

import { OrdenesModule } from "@/app/(app)/ordenes/_components/OrdenesModule";

function makeOrden(id: string, numGuia: number): OrdenListItemDTO {
  return {
    id,
    numGuia,
    numRemision: `REM-${id}`,
    estatusId: "est-1",
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

function renderModule(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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

describe("OrdenesModule — prop `filter` opcional (R19, sin regresión R10)", () => {
  it("SIN `filter`: invoca `listarOrdenes` con { page, pageSize } (comportamiento previo)", async () => {
    renderModule(<OrdenesModule />);

    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
    // No filtra `filter` cuando no se pasa (input idéntico al listado plano).
    const arg = listarOrdenesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("filter");
    expect(await screen.findByText("1001")).toBeInTheDocument();
  });

  it("CON `filter`: inyecta `filter.status_id` al `listarOrdenes` (R15)", async () => {
    renderModule(<OrdenesModule filter={{ status_id: "est-42" }} />);

    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalled());
    expect(listarOrdenesMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      filter: { status_id: "est-42" },
    });
  });

  it("renderiza tabla y paginación en ambos casos (reuso de DataTable/Pagination, R19)", async () => {
    renderModule(<OrdenesModule filter={{ status_id: "est-1" }} />);

    expect(screen.getByRole("table", { name: "Órdenes" })).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Paginación" }),
    ).toBeInTheDocument();
    await screen.findByText("1001");
  });
});
