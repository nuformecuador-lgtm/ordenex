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
vi.mock("@/lib/actions/zonas", () => ({
  listarZonas: (...a: unknown[]) => listarZonasMock(...a),
  obtenerZona: (...a: unknown[]) => obtenerZonaMock(...a),
  crearZona: (...a: unknown[]) => crearZonaMock(...a),
  actualizarZona: (...a: unknown[]) => actualizarZonaMock(...a),
}));

import { ZonasModule } from "@/app/(app)/configuracion/_components/ZonasModule";

const ITEM: ZonaDTO = {
  id: "z1",
  nombre: "Zona Sur",
  cobroVehiculo: false,
  distritosCount: 7,
  esCentral: false,
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

  it("muestra la columna Central con el guion cuando esCentral es false", async () => {
    renderModule(<ZonasModule initialData={INITIAL} />);

    const fila = await screen.findByRole("row", { name: /Zona Sur/ });
    // Sin badge central: se muestra el guion neutro.
    expect(within(fila).getByText("—")).toBeInTheDocument();
    // Ya no hay columnas de pago en la tabla.
    expect(screen.queryByText("Pago entrega")).not.toBeInTheDocument();
    expect(screen.queryByText("Pago rechazo")).not.toBeInTheDocument();
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
    // El campo Nombre se prefila con la zona cargada.
    expect(within(dialog).getByLabelText("Nombre")).toHaveValue("Zona Sur");
  });
});

describe("ZonasModule — feedback del submit (R32)", () => {
  // Nota: el ZonaForm está stubbeado en esta reconciliación (solo campo Nombre;
  // el submit devuelve validation_error). El módulo debe traducir ese resultado
  // a un toast de error sin invocar la acción de crear.
  it("al guardar, el form stub devuelve validation_error y se muestra toast de error", async () => {
    const user = userEvent.setup();
    renderModule(<ZonasModule initialData={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Crear zona" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Nombre"), "Zona Nueva");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    // El stub no llama a crearZona; el módulo muestra el toast genérico de error.
    expect(crearZonaMock).not.toHaveBeenCalled();
    expect(
      (await screen.findAllByText("Revisa los datos e inténtalo de nuevo."))
        .length,
    ).toBeGreaterThan(0);
    // El modal sigue abierto (closeOnConfirm=false y submit no fue ok).
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  }, 15000);
});
