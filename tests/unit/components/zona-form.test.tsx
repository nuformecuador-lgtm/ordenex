// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef, act } from "react";
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

import type { ZonaDTO } from "@/lib/types/zona";

// --- Server Actions mockeadas (no se toca el backend real) ---------------------
const crearZonaMock = vi.fn();
const actualizarZonaMock = vi.fn();
const arbolZonasMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  crearZona: (...a: unknown[]) => crearZonaMock(...a),
  actualizarZona: (...a: unknown[]) => actualizarZonaMock(...a),
  arbolZonas: (...a: unknown[]) => arbolZonasMock(...a),
}));

const listarProvinciasMock = vi.fn();
const listarCantonesMock = vi.fn();
const listarDistritosMock = vi.fn();
vi.mock("@/lib/actions/geo", () => ({
  listarProvincias: (...a: unknown[]) => listarProvinciasMock(...a),
  listarCantones: (...a: unknown[]) => listarCantonesMock(...a),
  listarDistritos: (...a: unknown[]) => listarDistritosMock(...a),
}));

const listarVehiculosMock = vi.fn();
vi.mock("@/lib/actions/vehiculos", () => ({
  listarVehiculos: (...a: unknown[]) => listarVehiculosMock(...a),
}));

import {
  ZonaForm,
  type ZonaFormHandle,
} from "@/app/(app)/configuracion/_components/ZonaForm";

function renderIsolated(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {ui}
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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
    items: [
      { id: "d1", nombre: "Carmen", zonaId: null, zonaNombre: null },
      { id: "d2", nombre: "Merced", zonaId: "zOtra", zonaNombre: "Zona Norte" },
    ],
  });
  listarVehiculosMock.mockResolvedValue({
    status: "ok",
    items: [
      { id: "v1", name: "moto" },
      { id: "v2", name: "carro" },
    ],
  });
  // Por defecto el árbol de zonas (pre-carga en edición) viene vacío; cada test que
  // ejerce R9 lo sobreescribe con el nodo de la zona en edición.
  arbolZonasMock.mockResolvedValue({ status: "ok", arbol: {} });
});

afterEach(() => {
  cleanup();
});

/** Navega provincia → cantón para desplegar los checkboxes de distrito. */
async function navegarADistritos(
  user: ReturnType<typeof userEvent.setup>,
  scope: HTMLElement = document.body,
) {
  const q = within(scope);
  await user.click(q.getByRole("combobox", { name: "Provincia" }));
  await user.click(await screen.findByRole("option", { name: "San José" }));
  await user.click(q.getByRole("combobox", { name: "Cantón" }));
  await user.click(await screen.findByRole("option", { name: "Central" }));
}

// -----------------------------------------------------------------------------
// T4 — Campos escalares + toggles (R3, R4, R7)
// -----------------------------------------------------------------------------
describe("ZonaForm — escalares y toggles (R3/R4/R7)", () => {
  it("R7: en editar prefila el toggle esCentral activado", () => {
    const zona: ZonaDTO = {
      id: "z1",
      nombre: "Zona Sur",
      cobroVehiculo: false,
      distritosCount: 3,
      esCentral: true,
    };
    renderIsolated(<ZonaForm mode="editar" zona={zona} />);

    expect(screen.getByLabelText("Nombre")).toHaveValue("Zona Sur");
    expect(
      screen.getByRole("switch", { name: "Marcar como zona central" }),
    ).toBeChecked();
  });

  it("R3/R4: submit envía nombre, cobroVehiculo y esCentral", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({
      status: "ok",
      zona: { id: "z9" },
    });
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await user.type(screen.getByLabelText("Nombre"), "Zona Nueva");
    await user.click(
      screen.getByRole("switch", { name: "Marcar como zona central" }),
    );
    await navegarADistritos(user);
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));

    await act(async () => {
      await ref.current!.submit();
    });

    expect(crearZonaMock).toHaveBeenCalledTimes(1);
    const input = crearZonaMock.mock.calls[0][0] as Record<string, unknown>;
    expect(input.nombre).toBe("Zona Nueva");
    expect(input.cobroVehiculo).toBe(false);
    expect(input.esCentral).toBe(true);
    expect(input.distritoIds).toEqual(["d1"]);
  });
});

// -----------------------------------------------------------------------------
// T5 — Selector de distritos (R10)
// -----------------------------------------------------------------------------
describe("ZonaForm — selector de distritos (R10)", () => {
  it("navega provincia→cantón y arma el conjunto completo de distritoIds", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({ status: "ok", zona: { id: "z9" } });
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await user.type(screen.getByLabelText("Nombre"), "Z");
    await navegarADistritos(user);
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));

    await act(async () => {
      await ref.current!.submit();
    });

    const input = crearZonaMock.mock.calls[0][0] as { distritoIds: string[] };
    expect(input.distritoIds).toEqual(["d1"]);
  });

  it("deshabilita un distrito asignado a otra zona mostrando su zonaNombre", async () => {
    const user = userEvent.setup();
    renderIsolated(<ZonaForm mode="crear" />);

    await navegarADistritos(user);

    const merced = await screen.findByRole("checkbox", { name: "Merced" });
    expect(merced).toBeDisabled();
    expect(screen.getByText(/asignado a Zona Norte/i)).toBeInTheDocument();
  });

  it("R10 (edición): pre-marca los distritos de ESTA zona vía onSuccess", async () => {
    const user = userEvent.setup();
    listarDistritosMock.mockResolvedValue({
      status: "ok",
      items: [
        { id: "d1", nombre: "Carmen", zonaId: "z1", zonaNombre: "Zona Sur" },
        { id: "d2", nombre: "Merced", zonaId: null, zonaNombre: null },
      ],
    });
    const zona: ZonaDTO = {
      id: "z1",
      nombre: "Zona Sur",
      cobroVehiculo: false,
      distritosCount: 1,
      esCentral: false,
    };
    renderIsolated(<ZonaForm mode="editar" zona={zona} />);

    await navegarADistritos(user);

    const carmen = await screen.findByRole("checkbox", { name: "Carmen" });
    await waitFor(() => expect(carmen).toBeChecked());
    // El distrito de la propia zona NO se deshabilita (es reseleccionable).
    expect(carmen).not.toBeDisabled();
  });
});

// -----------------------------------------------------------------------------
// T6 — Editor de tarifas condicionado por cobroVehiculo (R8)
// -----------------------------------------------------------------------------
describe("ZonaForm — tarifas condicionadas por cobroVehiculo (R8)", () => {
  it("cobroVehiculo=false: envía una tarifa SIN vehiculoId", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({ status: "ok", zona: { id: "z9" } });
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await user.type(screen.getByLabelText("Nombre"), "Z");
    await navegarADistritos(user);
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));

    await user.click(screen.getByRole("button", { name: "Agregar tarifa" }));
    await user.type(
      screen.getByLabelText("Cobro entregado tarifa 1"),
      "1000",
    );
    await user.type(
      screen.getByLabelText("Cobro rechazado tarifa 1"),
      "500",
    );

    await act(async () => {
      await ref.current!.submit();
    });

    expect(crearZonaMock).toHaveBeenCalledTimes(1);
    const input = crearZonaMock.mock.calls[0][0] as {
      tarifas: Array<Record<string, unknown>>;
    };
    expect(input.tarifas).toHaveLength(1);
    expect(input.tarifas[0]).toEqual({
      cobroEntregado: 1000,
      cobroRechazado: 500,
    });
    expect("vehiculoId" in input.tarifas[0]).toBe(false);
  });

  it("cobroVehiculo=true: envía tarifas con vehiculoId único", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({ status: "ok", zona: { id: "z9" } });
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await user.type(screen.getByLabelText("Nombre"), "Z");
    await user.click(
      screen.getByRole("switch", { name: "Cobra por tipo de vehículo" }),
    );
    await navegarADistritos(user);
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));

    await user.click(screen.getByRole("button", { name: "Agregar tarifa" }));
    await user.type(
      screen.getByLabelText("Cobro entregado tarifa 1"),
      "1200",
    );
    await user.type(
      screen.getByLabelText("Cobro rechazado tarifa 1"),
      "600",
    );
    await user.click(
      screen.getByRole("combobox", { name: "Vehículo tarifa 1" }),
    );
    await user.click(await screen.findByRole("option", { name: "moto" }));

    await act(async () => {
      await ref.current!.submit();
    });

    expect(crearZonaMock).toHaveBeenCalledTimes(1);
    const input = crearZonaMock.mock.calls[0][0] as {
      cobroVehiculo: boolean;
      tarifas: Array<Record<string, unknown>>;
    };
    expect(input.cobroVehiculo).toBe(true);
    expect(input.tarifas[0]).toEqual({
      cobroEntregado: 1200,
      cobroRechazado: 600,
      vehiculoId: "v1",
    });
  });

  it("cobroVehiculo=true sin tarifas → validation_error por campo, sin llamar backend", async () => {
    const user = userEvent.setup();
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await user.type(screen.getByLabelText("Nombre"), "Z");
    await user.click(
      screen.getByRole("switch", { name: "Cobra por tipo de vehículo" }),
    );
    await navegarADistritos(user);
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));

    let result: { status?: string } = {};
    await act(async () => {
      result = (await ref.current!.submit()) as { status?: string };
    });

    expect(result.status).toBe("validation_error");
    expect(crearZonaMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/al menos una tarifa/i),
    ).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// T7 — submit() real + errores por campo (R11)
// -----------------------------------------------------------------------------
describe("ZonaForm — errores del backend (R11)", () => {
  it("validation_error del backend → mensaje por campo y valores conservados", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { nombre: ["Ya existe una zona con ese nombre."] },
    });
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await user.type(screen.getByLabelText("Nombre"), "Zona Dup");
    await navegarADistritos(user);
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));

    await act(async () => {
      await ref.current!.submit();
    });

    expect(crearZonaMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Ya existe una zona con ese nombre."),
    ).toBeInTheDocument();
    // Valores conservados (no se resetea el form).
    expect(screen.getByLabelText("Nombre")).toHaveValue("Zona Dup");
  });

  it("conflict del backend → mensaje genérico visible, valores conservados", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({ status: "conflict" });
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await user.type(screen.getByLabelText("Nombre"), "Zona X");
    await navegarADistritos(user);
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));

    let result: { status?: string } = {};
    await act(async () => {
      result = (await ref.current!.submit()) as { status?: string };
    });

    expect(result.status).toBe("conflict");
    expect(
      screen.getByText(/ya hay un conflicto/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Zona X");
  });

  it("ok del backend → devuelve el resultado ok (dispara toast+mutate en el módulo)", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({
      status: "ok",
      zona: { id: "z9", nombre: "Zona X" },
    });
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await user.type(screen.getByLabelText("Nombre"), "Zona X");
    await navegarADistritos(user);
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));

    let result: { status?: string } = {};
    await act(async () => {
      result = (await ref.current!.submit()) as { status?: string };
    });

    expect(result.status).toBe("ok");
  });
});

// -----------------------------------------------------------------------------
// T7 — edición: actualizarZona(id, input) + prefill de tarifas (R9)
// -----------------------------------------------------------------------------
describe("ZonaForm — edición (R9)", () => {
  it("prefila tarifas y llama actualizarZona con el id de la zona", async () => {
    const user = userEvent.setup();
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: { id: "z1" },
    });
    const zona: ZonaDTO = {
      id: "z1",
      nombre: "Zona Sur",
      cobroVehiculo: false,
      distritosCount: 1,
      esCentral: false,
      tarifas: [
        {
          id: "t1",
          cobroEntregado: 800,
          cobroRechazado: 400,
          vehiculoId: null,
        },
      ],
    };
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="editar" zona={zona} />);

    // Tarifa prefilada desde zona.tarifas.
    expect(screen.getByLabelText("Cobro entregado tarifa 1")).toHaveValue(800);

    // Se necesita al menos un distrito: navega y selecciona.
    await navegarADistritos(user);
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));

    await act(async () => {
      await ref.current!.submit();
    });

    expect(actualizarZonaMock).toHaveBeenCalledTimes(1);
    expect(actualizarZonaMock.mock.calls[0][0]).toBe("z1");
    expect(crearZonaMock).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// T8 — Confirmación de reasignación de central (R6-UI)
// -----------------------------------------------------------------------------
describe("ZonaForm — reasignación de central (R6-UI)", () => {
  it("marcar central existiendo otra: avisa nombrándola y exige confirmación", async () => {
    const user = userEvent.setup();
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(
      <ZonaForm
        ref={ref}
        mode="crear"
        centralActual={{ id: "zC", nombre: "Zona Central" }}
      />,
    );

    await user.type(screen.getByLabelText("Nombre"), "Zona Nueva");
    await navegarADistritos(user);
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));
    await user.click(
      screen.getByRole("switch", { name: "Marcar como zona central" }),
    );

    // Aviso nombrando la central actual.
    expect(
      screen.getByText(/«Zona Central» dejará de ser la central/i),
    ).toBeInTheDocument();

    // Sin confirmar → validation_error en esCentral, sin mutar.
    let result: { status?: string } = {};
    await act(async () => {
      result = (await ref.current!.submit()) as { status?: string };
    });
    expect(result.status).toBe("validation_error");
    expect(crearZonaMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Confirma la reasignación/i),
    ).toBeInTheDocument();

    // Tras confirmar → sí muta.
    crearZonaMock.mockResolvedValue({ status: "ok", zona: { id: "z9" } });
    await user.click(
      screen.getByRole("checkbox", {
        name: "Entiendo que reasignaré la zona central",
      }),
    );
    await act(async () => {
      await ref.current!.submit();
    });
    expect(crearZonaMock).toHaveBeenCalledTimes(1);
    const input = crearZonaMock.mock.calls[0][0] as { esCentral: boolean };
    expect(input.esCentral).toBe(true);
  });

  it("no exige confirmación si no hay otra central distinta", async () => {
    const user = userEvent.setup();
    crearZonaMock.mockResolvedValue({ status: "ok", zona: { id: "z9" } });
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" centralActual={null} />);

    await user.type(screen.getByLabelText("Nombre"), "Zona Nueva");
    await navegarADistritos(user);
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));
    await user.click(
      screen.getByRole("switch", { name: "Marcar como zona central" }),
    );

    expect(
      screen.queryByText(/dejará de ser la central/i),
    ).not.toBeInTheDocument();

    await act(async () => {
      await ref.current!.submit();
    });
    expect(crearZonaMock).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------------
// Feature 59 — Selección de distritos de VARIOS cantones (R1..R11)
// -----------------------------------------------------------------------------

/** Elige una provincia por su nombre en el navegador de distritos. */
async function elegirProvincia(
  user: ReturnType<typeof userEvent.setup>,
  nombre: string,
) {
  await user.click(screen.getByRole("combobox", { name: "Provincia" }));
  await user.click(await screen.findByRole("option", { name: nombre }));
}

/** Elige un cantón por su nombre en el navegador de distritos. */
async function elegirCanton(
  user: ReturnType<typeof userEvent.setup>,
  nombre: string,
) {
  await user.click(screen.getByRole("combobox", { name: "Cantón" }));
  await user.click(await screen.findByRole("option", { name: nombre }));
}

/** Prepara un catálogo con 2 cantones (misma provincia) y sus distritos. */
function mockDosCantonesMismaProvincia() {
  listarCantonesMock.mockResolvedValue({
    status: "ok",
    items: [
      { id: "c1", nombre: "Central" },
      { id: "c2", nombre: "Escazú" },
    ],
  });
  listarDistritosMock.mockImplementation(async (cantonId: string) =>
    cantonId === "c1"
      ? {
          status: "ok",
          items: [{ id: "d1", nombre: "Carmen", zonaId: null, zonaNombre: null }],
        }
      : {
          status: "ok",
          items: [
            { id: "d3", nombre: "San Rafael", zonaId: null, zonaNombre: null },
          ],
        },
  );
}

describe("ZonaForm — selección multi-cantón (R1/R2)", () => {
  it("R1: conserva la selección del cantón A al cambiar a B y volver", async () => {
    const user = userEvent.setup();
    mockDosCantonesMismaProvincia();
    renderIsolated(<ZonaForm mode="crear" />);

    await elegirProvincia(user, "San José");
    await elegirCanton(user, "Central");
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));

    await elegirCanton(user, "Escazú");
    await user.click(await screen.findByRole("checkbox", { name: "San Rafael" }));

    expect(screen.getByTestId("distritos-seleccionados")).toHaveTextContent(
      "Distritos seleccionados: 2",
    );

    // Volver a A: Carmen sigue marcado y el total no baja.
    await elegirCanton(user, "Central");
    expect(await screen.findByRole("checkbox", { name: "Carmen" })).toBeChecked();
    expect(screen.getByTestId("distritos-seleccionados")).toHaveTextContent(
      "Distritos seleccionados: 2",
    );
  });

  it("R2/R10: agrega distritos de cantones de provincias distintas y los envía todos", async () => {
    const user = userEvent.setup();
    listarProvinciasMock.mockResolvedValue({
      status: "ok",
      items: [
        { id: "p1", nombre: "San José" },
        { id: "p2", nombre: "Alajuela" },
      ],
    });
    listarCantonesMock.mockImplementation(async (provinciaId: string) =>
      provinciaId === "p1"
        ? { status: "ok", items: [{ id: "c1", nombre: "Central" }] }
        : { status: "ok", items: [{ id: "c3", nombre: "Grecia" }] },
    );
    listarDistritosMock.mockImplementation(async (cantonId: string) =>
      cantonId === "c1"
        ? {
            status: "ok",
            items: [
              { id: "d1", nombre: "Carmen", zonaId: null, zonaNombre: null },
            ],
          }
        : {
            status: "ok",
            items: [
              { id: "d5", nombre: "San Isidro", zonaId: null, zonaNombre: null },
            ],
          },
    );
    crearZonaMock.mockResolvedValue({ status: "ok", zona: { id: "z9" } });
    const ref = createRef<ZonaFormHandle>();
    renderIsolated(<ZonaForm ref={ref} mode="crear" />);

    await user.type(screen.getByLabelText("Nombre"), "Z");
    await elegirProvincia(user, "San José");
    await elegirCanton(user, "Central");
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));

    await elegirProvincia(user, "Alajuela");
    await elegirCanton(user, "Grecia");
    await user.click(await screen.findByRole("checkbox", { name: "San Isidro" }));

    await act(async () => {
      await ref.current!.submit();
    });

    const input = crearZonaMock.mock.calls[0][0] as { distritoIds: string[] };
    expect([...input.distritoIds].sort()).toEqual(["d1", "d5"]);
  });
});

describe("ZonaForm — resumen agrupado (R3/R4/R5)", () => {
  it("R3/R4: el resumen lista y agrupa por provincia/cantón los distritos de 2 cantones", async () => {
    const user = userEvent.setup();
    mockDosCantonesMismaProvincia();
    renderIsolated(<ZonaForm mode="crear" />);

    await elegirProvincia(user, "San José");
    await elegirCanton(user, "Central");
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));
    await elegirCanton(user, "Escazú");
    await user.click(await screen.findByRole("checkbox", { name: "San Rafael" }));

    // R3: ambos aparecen aunque solo un cantón esté abierto.
    const resumen = screen.getByTestId("resumen-distritos");
    expect(within(resumen).getByText("San José")).toBeInTheDocument();

    // R4: cada distrito bajo el grupo de su cantón.
    const grupoCentral = within(resumen).getByRole("group", { name: "Central" });
    expect(within(grupoCentral).getByText("Carmen")).toBeInTheDocument();
    const grupoEscazu = within(resumen).getByRole("group", { name: "Escazú" });
    expect(within(grupoEscazu).getByText("San Rafael")).toBeInTheDocument();
  });

  it("R5: quitar un distrito desde el resumen lo elimina y baja el total", async () => {
    const user = userEvent.setup();
    mockDosCantonesMismaProvincia();
    renderIsolated(<ZonaForm mode="crear" />);

    await elegirProvincia(user, "San José");
    await elegirCanton(user, "Central");
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));
    await elegirCanton(user, "Escazú");
    await user.click(await screen.findByRole("checkbox", { name: "San Rafael" }));

    let resumen = screen.getByTestId("resumen-distritos");
    await user.click(within(resumen).getByRole("button", { name: "Quitar San Rafael" }));

    resumen = screen.getByTestId("resumen-distritos");
    expect(within(resumen).queryByText("San Rafael")).not.toBeInTheDocument();
    expect(screen.getByTestId("distritos-seleccionados")).toHaveTextContent(
      "Distritos seleccionados: 1",
    );
  });
});

describe("ZonaForm — sincronización resumen↔checkbox (R6)", () => {
  it("quitar desde el resumen desmarca el checkbox del cantón abierto; y desmarcar el checkbox lo saca del resumen", async () => {
    const user = userEvent.setup();
    renderIsolated(<ZonaForm mode="crear" />);

    await navegarADistritos(user);
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));

    const resumen = screen.getByTestId("resumen-distritos");
    expect(within(resumen).getByText("Carmen")).toBeInTheDocument();

    // Quitar desde el resumen ⇒ el checkbox del cantón abierto se desmarca.
    await user.click(within(resumen).getByRole("button", { name: "Quitar Carmen" }));
    expect(screen.getByRole("checkbox", { name: "Carmen" })).not.toBeChecked();
    expect(screen.queryByTestId("resumen-distritos")).not.toBeInTheDocument();

    // Marcar de nuevo y luego desmarcar el checkbox ⇒ desaparece del resumen.
    await user.click(screen.getByRole("checkbox", { name: "Carmen" }));
    expect(
      within(screen.getByTestId("resumen-distritos")).getByText("Carmen"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Carmen" }));
    expect(screen.queryByTestId("resumen-distritos")).not.toBeInTheDocument();
  });
});

describe("ZonaForm — R10 heredada en el resumen (R8)", () => {
  it("un distrito de otra zona sigue deshabilitado y nunca aparece en el resumen", async () => {
    const user = userEvent.setup();
    renderIsolated(<ZonaForm mode="crear" />);

    await navegarADistritos(user);
    expect(await screen.findByRole("checkbox", { name: "Merced" })).toBeDisabled();

    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));
    const resumen = screen.getByTestId("resumen-distritos");
    expect(within(resumen).getByText("Carmen")).toBeInTheDocument();
    expect(within(resumen).queryByText("Merced")).not.toBeInTheDocument();
  });
});

describe("ZonaForm — pre-carga multi-cantón en edición (R9)", () => {
  it("lista TODOS los distritos de la zona (varios cantones) desde el inicio vía arbolZonas", async () => {
    arbolZonasMock.mockResolvedValue({
      status: "ok",
      arbol: {
        "zona sur": {
          id: "z1",
          value: "Zona Sur",
          cantones: {
            central: {
              id: "c1",
              value: "Central",
              distritos: { carmen: { id: "d1", value: "Carmen" } },
            },
            escazu: {
              id: "c2",
              value: "Escazú",
              distritos: { "san rafael": { id: "d3", value: "San Rafael" } },
            },
          },
        },
      },
    });
    const zona: ZonaDTO = {
      id: "z1",
      nombre: "Zona Sur",
      cobroVehiculo: false,
      distritosCount: 2,
      esCentral: false,
    };
    renderIsolated(<ZonaForm mode="editar" zona={zona} />);

    // Sin navegar ningún cantón, el resumen ya lista los distritos de ambos.
    const resumen = await screen.findByTestId("resumen-distritos");
    expect(within(resumen).getByText("Carmen")).toBeInTheDocument();
    expect(within(resumen).getByText("San Rafael")).toBeInTheDocument();
    expect(
      within(resumen).getByRole("group", { name: "Central" }),
    ).toBeInTheDocument();
    expect(
      within(resumen).getByRole("group", { name: "Escazú" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("distritos-seleccionados")).toHaveTextContent(
      "Distritos seleccionados: 2",
    );
  });
});

describe("ZonaForm — accesibilidad del resumen (R11)", () => {
  it("cada distrito del resumen tiene un botón 'Quitar' accesible por nombre y el contenedor no desborda", async () => {
    const user = userEvent.setup();
    renderIsolated(<ZonaForm mode="crear" />);

    await navegarADistritos(user);
    await user.click(await screen.findByRole("checkbox", { name: "Carmen" }));

    const resumen = screen.getByTestId("resumen-distritos");
    expect(
      within(resumen).getByRole("button", { name: "Quitar Carmen" }),
    ).toBeInTheDocument();
    expect(resumen.className).toMatch(/overflow/);
  });
});
