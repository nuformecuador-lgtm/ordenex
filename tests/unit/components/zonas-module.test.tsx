// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { forwardRef, useImperativeHandle } from "react";
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
import type {
  CentralActual,
  ZonaFormHandle,
} from "@/app/(app)/configuracion/_components/ZonaForm";

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

// El ZonaForm real se ejercita en zona-form.test.tsx. Aquí se stubbea para probar
// EN AISLAMIENTO el cableado del módulo (submit imperativo → mutate+toast+cierre) y
// que se le pase la prop `centralActual` derivada del listado (R6-UI/R12).
const submitMock = vi.fn();
let lastFormProps: {
  mode: string;
  zona?: ZonaDTO | null;
  centralActual?: CentralActual | null;
} = { mode: "crear" };
vi.mock("@/app/(app)/configuracion/_components/ZonaForm", () => ({
  ZonaForm: forwardRef<ZonaFormHandle, Record<string, unknown>>(
    function ZonaFormStub(props, ref) {
      lastFormProps = props as typeof lastFormProps;
      useImperativeHandle(ref, () => ({ submit: () => submitMock() }));
      return <div data-testid="zona-form-stub">form</div>;
    },
  ),
}));

import { ZonasModule } from "@/app/(app)/configuracion/_components/ZonasModule";

const ITEM: ZonaDTO = {
  id: "z1",
  nombre: "Zona Sur",
  cobroVehiculo: false,
  distritosCount: 7,
  esCentral: false,
};

const CENTRAL: ZonaDTO = {
  id: "z2",
  nombre: "Zona Central",
  cobroVehiculo: false,
  distritosCount: 4,
  esCentral: true,
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
  lastFormProps = { mode: "crear" };
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
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Paginación" }),
    ).toBeInTheDocument();
  });

  it("muestra la columna Central con el guion cuando esCentral es false", async () => {
    renderModule(<ZonasModule initialData={INITIAL} />);

    const fila = await screen.findByRole("row", { name: /Zona Sur/ });
    expect(within(fila).getByText("—")).toBeInTheDocument();
  });
});

describe("ZonasModule — crear/editar en Modal (R31)", () => {
  it("el botón Crear abre el Modal con el formulario de zona", async () => {
    const user = userEvent.setup();
    renderModule(<ZonasModule initialData={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Crear zona" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Crear zona")).toBeInTheDocument();
    expect(within(dialog).getByTestId("zona-form-stub")).toBeInTheDocument();
    expect(lastFormProps.mode).toBe("crear");
  });

  it("Editar carga la zona y abre el Modal en modo edición pasando la zona", async () => {
    const user = userEvent.setup();
    renderModule(<ZonasModule initialData={INITIAL} />);

    await user.click(await screen.findByRole("button", { name: "Editar" }));

    await waitFor(() => expect(obtenerZonaMock).toHaveBeenCalledWith("z1"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Editar zona")).toBeInTheDocument();
    expect(lastFormProps.mode).toBe("editar");
    expect(lastFormProps.zona?.id).toBe("z1");
  });
});

describe("ZonasModule — feedback del submit (R12)", () => {
  it("éxito al crear: refresca listado (mutate) + toast + cierra el modal", async () => {
    const user = userEvent.setup();
    submitMock.mockResolvedValue({ status: "ok", zona: { id: "z9" } });
    renderModule(<ZonasModule initialData={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Crear zona" }));
    const dialog = await screen.findByRole("dialog");

    const callsBefore = listarZonasMock.mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    // Toast de éxito.
    expect(await screen.findByText("Zona creada")).toBeInTheDocument();
    // mutate() revalida el listado (nueva llamada a listarZonas).
    await waitFor(() =>
      expect(listarZonasMock.mock.calls.length).toBeGreaterThan(callsBefore),
    );
    // Modal cerrado.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("error de validación: toast de error y el modal permanece abierto", async () => {
    const user = userEvent.setup();
    submitMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { nombre: ["x"] },
    });
    renderModule(<ZonasModule initialData={INITIAL} />);

    await user.click(screen.getByRole("button", { name: "Crear zona" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(
      (await screen.findAllByText("Revisa los datos e inténtalo de nuevo."))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(crearZonaMock).not.toHaveBeenCalled();
  }, 15000);
});

describe("ZonasModule — central derivada (R6-UI)", () => {
  it("pasa centralActual al form cuando el listado tiene una zona central", async () => {
    const user = userEvent.setup();
    listarZonasMock.mockResolvedValue({
      status: "ok",
      items: [ITEM, CENTRAL],
      page: 1,
      pageSize: 25,
      total: 2,
    });
    renderModule(
      <ZonasModule
        initialData={{ items: [ITEM, CENTRAL], total: 2, pageSize: 25 }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Crear zona" }));
    await screen.findByRole("dialog");

    expect(lastFormProps.centralActual).toEqual({
      id: "z2",
      nombre: "Zona Central",
    });
  });
});
