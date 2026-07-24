// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function makeOrden(
  id: string,
  numGuia: number,
  overrides: Partial<OrdenListItemDTO> = {},
): OrdenListItemDTO {
  return {
    id,
    numGuia,
    numRemision: `REM-${id}`,
    estatusId: "est-1",
    estatusValue: "en_bodega_central",
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
    ...overrides,
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

// `bloqueoSeleccion`: deshabilita el checkbox de las filas que la acción del estado
// no puede procesar (tab `rechazada`: solo la bodega central devuelve a la tienda),
// en vez de dejar seleccionarlas y que el modal quede vacío/"bloqueado".
describe("OrdenesModule — bloqueoSeleccion por fila", () => {
  const acciones = [{ key: "devolver", label: "Devolver a la tienda", onRun: vi.fn() }];
  // Solo las NO centrales (zonaEsGam !== true) se bloquean, con su motivo.
  const bloqueoSeleccion = (o: OrdenListItemDTO) =>
    o.zonaEsGam === true ? null : "Orden de zona satélite: la devuelve el admin satélite.";

  beforeEach(() => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [
        makeOrden("gam", 5001, { zonaEsGam: true }),
        makeOrden("sat", 5002, { zonaEsGam: false }),
      ],
      page: 1,
      pageSize: 25,
      total: 2,
    });
  });

  it("deshabilita el checkbox de la fila bloqueada y habilita el de la seleccionable", async () => {
    renderModule(
      <OrdenesModule
        filter={{ status_id: "est-rechazada" }}
        selectable
        acciones={acciones}
        bloqueoSeleccion={bloqueoSeleccion}
      />,
    );

    await screen.findByText("5001");
    // La GAM se puede seleccionar; la satélite no.
    expect(
      screen.getByRole("checkbox", { name: "Seleccionar orden REM-gam" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("checkbox", {
        name: /No se puede seleccionar la orden REM-sat/,
      }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("marcar la fila seleccionable abre la barra de acciones; la bloqueada no se puede marcar", async () => {
    const user = userEvent.setup();
    renderModule(
      <OrdenesModule
        filter={{ status_id: "est-rechazada" }}
        selectable
        acciones={acciones}
        bloqueoSeleccion={bloqueoSeleccion}
      />,
    );

    await screen.findByText("5001");

    // Marcar la satélite (deshabilitada) no hace nada: no aparece la barra.
    await user.click(
      screen.getByRole("checkbox", {
        name: /No se puede seleccionar la orden REM-sat/,
      }),
    );
    expect(screen.queryByText(/seleccionada/)).toBeNull();

    // Marcar la GAM sí: aparece la barra con la acción "Devolver a la tienda".
    await user.click(
      screen.getByRole("checkbox", { name: "Seleccionar orden REM-gam" }),
    );
    const barra = await screen.findByText(/1 seleccionada/);
    expect(
      within(barra.parentElement as HTMLElement).getByRole("button", {
        name: "Devolver a la tienda",
      }),
    ).toBeInTheDocument();
  });

  it("sin `bloqueoSeleccion` todas las filas son seleccionables (sin regresión)", async () => {
    renderModule(
      <OrdenesModule
        filter={{ status_id: "est-rechazada" }}
        selectable
        acciones={acciones}
      />,
    );

    await screen.findByText("5001");
    for (const cb of screen.getAllByRole("checkbox")) {
      expect(cb).not.toHaveAttribute("aria-disabled", "true");
    }
  });
});
