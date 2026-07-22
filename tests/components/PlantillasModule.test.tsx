// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { PlantillaListItemDTO } from "@/lib/types/plantilla-mensaje";

// Feature 107 — módulo cliente de plantillas. Se mockean las Server Actions; SWR y
// el Modal/Toast reales para ejercitar la composición sin DB ni sesión.
const listarPlantillasMock = vi.fn();
const eliminarPlantillaMock = vi.fn();
const cambiarEstadoPlantillaMock = vi.fn();
const crearPlantillaMock = vi.fn();
const actualizarPlantillaMock = vi.fn();
const previewPlantillaMock = vi.fn();
vi.mock("@/lib/actions/plantillas", () => ({
  listarPlantillas: (...a: unknown[]) => listarPlantillasMock(...a),
  eliminarPlantilla: (...a: unknown[]) => eliminarPlantillaMock(...a),
  cambiarEstadoPlantilla: (...a: unknown[]) => cambiarEstadoPlantillaMock(...a),
  crearPlantilla: (...a: unknown[]) => crearPlantillaMock(...a),
  actualizarPlantilla: (...a: unknown[]) => actualizarPlantillaMock(...a),
  previewPlantilla: (...a: unknown[]) => previewPlantillaMock(...a),
}));

import { PlantillasModule } from "@/app/(app)/configuracion/plantillas/_components/PlantillasModule";

const ITEM: PlantillaListItemDTO = {
  id: "p1",
  nombre: "bienvenida",
  cuerpo: "Hola {{usuario}}, tu orden {{cod}}",
  estado: "pending",
  variables: ["usuario", "cod"],
  createdAt: new Date("2026-01-01T12:00:00Z"),
};

function renderModule(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

let items: PlantillaListItemDTO[];

beforeEach(() => {
  vi.clearAllMocks();
  items = [ITEM];
  listarPlantillasMock.mockImplementation(
    async ({ page, pageSize }: { page: number; pageSize: number }) => ({
      status: "ok",
      items: page === 1 ? items : [],
      page,
      pageSize,
      total: items.length,
    }),
  );
  eliminarPlantillaMock.mockImplementation(async () => {
    items = []; // R27/R28: soft delete → deja de aparecer en el listado.
    return { status: "ok" };
  });
});

afterEach(() => {
  cleanup();
});

describe("PlantillasModule — eliminar (R27/R28)", () => {
  it("R27: confirmar 'Eliminar' llama a eliminarPlantilla con el id de la fila", async () => {
    const user = userEvent.setup();
    renderModule(
      <PlantillasModule initialData={{ items: [ITEM], total: 1, pageSize: 25 }} />,
    );

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("bienvenida");

    await user.click(within(table).getByRole("button", { name: "Eliminar" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/se eliminará/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(eliminarPlantillaMock).toHaveBeenCalledWith("p1"));
  });

  it("R28: tras eliminar, revalida y la plantilla desaparece del listado", async () => {
    const user = userEvent.setup();
    renderModule(
      <PlantillasModule initialData={{ items: [ITEM], total: 1, pageSize: 25 }} />,
    );

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("bienvenida");

    await user.click(within(table).getByRole("button", { name: "Eliminar" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    // Éxito → toast + el listado revalidado ya no contiene la fila.
    expect(await screen.findByText("Plantilla eliminada.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("bienvenida")).toBeNull(),
    );
    expect(screen.getByText("No hay plantillas")).toBeInTheDocument();
  });

  it("not_found: informa que la plantilla ya no existe y refresca igualmente", async () => {
    eliminarPlantillaMock.mockImplementation(async () => {
      items = [];
      return { status: "not_found" };
    });
    const user = userEvent.setup();
    renderModule(
      <PlantillasModule initialData={{ items: [ITEM], total: 1, pageSize: 25 }} />,
    );

    const table = screen.getByRole("table", { name: "Plantillas de mensaje" });
    await within(table).findByText("bienvenida");

    await user.click(within(table).getByRole("button", { name: "Eliminar" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    expect(
      (await screen.findAllByText("La plantilla ya no existe.")).length,
    ).toBeGreaterThan(0);
  });
});
