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
import type { ZonaDTO } from "@/lib/types/zona";

const listarZonasMock = vi.fn();
const obtenerZonaMock = vi.fn();
const crearZonaMock = vi.fn();
const actualizarZonaMock = vi.fn();
const listarProvinciasMock = vi.fn();
const listarCantonesMock = vi.fn();
const listarDistritosMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  listarZonas: (...a: unknown[]) => listarZonasMock(...a),
  obtenerZona: (...a: unknown[]) => obtenerZonaMock(...a),
  crearZona: (...a: unknown[]) => crearZonaMock(...a),
  actualizarZona: (...a: unknown[]) => actualizarZonaMock(...a),
  listarProvincias: (...a: unknown[]) => listarProvinciasMock(...a),
  listarCantones: (...a: unknown[]) => listarCantonesMock(...a),
  listarDistritos: (...a: unknown[]) => listarDistritosMock(...a),
}));

import { ZonasModule } from "@/app/(app)/configuracion/_components/ZonasModule";

const ITEM: ZonaDTO = {
  id: "z1",
  nombre: "Zona Sur",
  pagoEntrega: 1500,
  pagoRechazo: 750,
  esGam: false,
  distritosCount: 7,
};

const INITIAL = { items: [ITEM], total: 1, pageSize: 25 };

function renderModule(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarZonasMock.mockResolvedValue({
    status: "ok",
    items: [ITEM],
    page: 1,
    pageSize: 25,
    total: 1,
  });
  obtenerZonaMock.mockResolvedValue({ status: "ok", zona: ITEM });
  listarProvinciasMock.mockResolvedValue({ status: "ok", items: [] });
  listarCantonesMock.mockResolvedValue({ status: "ok", items: [] });
  listarDistritosMock.mockResolvedValue({ status: "ok", items: [] });
});

afterEach(() => {
  cleanup();
});

describe("ZonasModule — listado y paginación (R30)", () => {
  it("lista zonas en DataTable con paginación desde datos precargados", async () => {
    renderModule(<ZonasModule initialData={INITIAL} />);

    expect(screen.getByRole("table", { name: "Zonas" })).toBeInTheDocument();
    expect(await screen.findByText("Zona Sur")).toBeInTheDocument();
    // distritosCount visible.
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Paginación" }),
    ).toBeInTheDocument();
  });
});

describe("ZonasModule — crear/editar en Modal (R31)", () => {
  it("el botón Crear abre el Modal con el formulario de zona", async () => {
    const user = userEvent.setup();
    renderModule(<ZonasModule initialData={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Crear zona" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Crear zona")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Nombre")).toBeInTheDocument();
  });

  it("Editar carga la zona y abre el Modal en modo edición", async () => {
    const user = userEvent.setup();
    renderModule(<ZonasModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Editar" }));

    await waitFor(() => expect(obtenerZonaMock).toHaveBeenCalledWith("z1"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Editar zona")).toBeInTheDocument();
  });
});

describe("ZonasModule — feedback y refresco (R32)", () => {
  it("crear con éxito muestra toast de éxito y refresca el listado", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({ status: "ok", zona: ITEM });
    listarProvinciasMock.mockResolvedValue({
      status: "ok",
      items: [{ id: "p1", nombre: "San José" }],
    });
    listarCantonesMock.mockResolvedValue({
      status: "ok",
      items: [{ id: "c1", nombre: "Central" }],
    });
    listarDistritosMock.mockResolvedValue({
      status: "ok",
      items: [{ id: "d1", nombre: "Carmen", zonaId: null, zonaNombre: null }],
    });

    renderModule(<ZonasModule initialData={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Crear zona" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Nombre"), "Zona Nueva");
    await user.click(within(dialog).getByRole("combobox", { name: "Provincia" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "San José",
      }),
    );
    await user.click(within(dialog).getByRole("combobox", { name: "Cantón" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Central",
      }),
    );
    await user.click(await within(dialog).findByLabelText("Carmen"));

    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(crearZonaMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Zona creada")).toBeInTheDocument();
    // Refresco: listarZonas se vuelve a invocar tras el éxito (mutate).
    await waitFor(() =>
      expect(listarZonasMock.mock.calls.length).toBeGreaterThanOrEqual(1),
    );
  }, 25000);

  it("un error del backend al crear muestra toast de error (R32)", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({ status: "forbidden" });
    listarProvinciasMock.mockResolvedValue({
      status: "ok",
      items: [{ id: "p1", nombre: "San José" }],
    });
    listarCantonesMock.mockResolvedValue({
      status: "ok",
      items: [{ id: "c1", nombre: "Central" }],
    });
    listarDistritosMock.mockResolvedValue({
      status: "ok",
      items: [{ id: "d1", nombre: "Carmen", zonaId: null, zonaNombre: null }],
    });

    renderModule(<ZonasModule initialData={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Crear zona" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Nombre"), "Zona Nueva");
    await user.click(within(dialog).getByRole("combobox", { name: "Provincia" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "San José",
      }),
    );
    await user.click(within(dialog).getByRole("combobox", { name: "Cantón" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Central",
      }),
    );
    await user.click(await within(dialog).findByLabelText("Carmen"));

    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(crearZonaMock).toHaveBeenCalledTimes(1));
    expect(
      (await screen.findAllByText("No tienes permiso para esta acción.")).length,
    ).toBeGreaterThan(0);
  }, 25000);
});
