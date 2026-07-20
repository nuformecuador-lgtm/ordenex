// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrdenesCargaResumen } from "@/app/(app)/ordenes/_components/OrdenesCargaResumen";
import type { MensajeroDTO, ResumenCargaOrdenDTO } from "@/lib/types/asignacion-mensajero";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { successMock, errorMock, warningMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  warningMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: warningMock,
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));

vi.mock("swr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("swr")>();
  return {
    ...actual,
    useSWRConfig: () => ({ mutate: mutateMock }),
  };
});

const {
  listarMensajerosMock,
  resumenCargaMasivaMock,
  asignarMensajeroSugeridoMock,
} = vi.hoisted(() => ({
  listarMensajerosMock: vi.fn(),
  resumenCargaMasivaMock: vi.fn(),
  asignarMensajeroSugeridoMock: vi.fn(),
}));

vi.mock("@/lib/actions/mensajeros", () => ({
  listarMensajeros: listarMensajerosMock,
  resumenCargaMasiva: resumenCargaMasivaMock,
  asignarMensajeroSugerido: asignarMensajeroSugeridoMock,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Ana y Beto en la zona "z1" (Norte); Carla en "z2" (Sur), para verificar el
// filtrado por zona del select de cada fila.
const MENSAJEROS: MensajeroDTO[] = [
  { id: "u1", nombre: "Ana", zonaId: "z1", zonaNombre: "Norte" },
  { id: "u2", nombre: "Beto", zonaId: "z1", zonaNombre: "Norte" },
  { id: "u3", nombre: "Carla", zonaId: "z2", zonaNombre: "Sur" },
];

const ORDENES: ResumenCargaOrdenDTO[] = [
  {
    id: "o1",
    numGuia: 1,
    numRemision: "REM-0001",
    destinatario: "Juan Pérez",
    telefonoDest: "0999999999",
    producto: "Camiseta",
    montoCobrar: 25.9,
    direccion: "Av. Amazonas",
    estatusValue: "en_preparacion",
    zonaId: "z1",
    zonaNombre: "Norte",
    mensajeroSugeridoId: "u1",
    mensajeroSugeridoNombre: "Ana",
  },
  {
    id: "o2",
    numGuia: 2,
    numRemision: "REM-0002",
    destinatario: "María Ruiz",
    telefonoDest: "0988888888",
    producto: "Pantalón",
    montoCobrar: null,
    direccion: null,
    estatusValue: "en_preparacion",
    zonaId: "z1",
    zonaNombre: "Norte",
    mensajeroSugeridoId: null,
    mensajeroSugeridoNombre: null,
  },
];

/** Promesa diferida controlada por el test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Azar determinista: 0.6 * (2 mensajeros en z1) = índice 1 -> Beto.
  vi.spyOn(Math, "random").mockReturnValue(0.6);
  listarMensajerosMock.mockResolvedValue({ status: "ok", mensajeros: MENSAJEROS });
  resumenCargaMasivaMock.mockResolvedValue({ status: "ok", ordenes: ORDENES });
  asignarMensajeroSugeridoMock.mockResolvedValue({ status: "ok", asignadas: 0 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rowSelect = (numRemision: string) =>
  screen.getByRole("combobox", { name: `Mensajero para la orden ${numRemision}` });

async function pickOption(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, label: string) {
  await user.click(trigger);
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: label }));
}

// ---------------------------------------------------------------------------
// R22, R23 — DataTable con num_remision visible, rowKey = id
// ---------------------------------------------------------------------------
describe("OrdenesCargaResumen — DataTable del resumen (R22, R23)", () => {
  it("renderiza una fila por orden con num_remision visible", async () => {
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);

    expect(await screen.findByText("REM-0001")).toBeInTheDocument();
    expect(screen.getByText("REM-0002")).toBeInTheDocument();
    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
    expect(screen.getByText("María Ruiz")).toBeInTheDocument();
  });

  it("invoca resumenCargaMasiva con los numRemisiones recibidos por props", async () => {
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    expect(resumenCargaMasivaMock).toHaveBeenCalledWith({
      numRemisiones: ["REM-0001", "REM-0002"],
    });
  });
});

// ---------------------------------------------------------------------------
// R31 — carga de mensajeros por Server Action, error/deshabilitado si falla
// ---------------------------------------------------------------------------
describe("OrdenesCargaResumen — carga de mensajeros (R31)", () => {
  it("carga los mensajeros vía Server Action y los ofrece como opciones", async () => {
    const user = userEvent.setup();
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    expect(listarMensajerosMock).toHaveBeenCalledTimes(1);

    await user.click(rowSelect("REM-0001"));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "Ana" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Beto" })).toBeInTheDocument();
  });

  it("si listarMensajeros falla, los selects quedan deshabilitados y se avisa", async () => {
    listarMensajerosMock.mockResolvedValue({ status: "forbidden" });
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);

    await screen.findByText("REM-0001");

    expect(rowSelect("REM-0001")).toBeDisabled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(errorMock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Filtrado por zona — el select de cada fila solo ofrece mensajeros de la zona
// de la orden, y la zona se muestra en el listado.
// ---------------------------------------------------------------------------
describe("OrdenesCargaResumen — filtrado de mensajeros por zona de la orden", () => {
  it("el select de la fila solo ofrece mensajeros de la zona de la orden", async () => {
    const user = userEvent.setup();
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    await user.click(rowSelect("REM-0001"));
    const listbox = await screen.findByRole("listbox");
    // z1: Ana y Beto sí; Carla (z2) no.
    expect(within(listbox).getByRole("option", { name: "Ana" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Beto" })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: "Carla" })).not.toBeInTheDocument();
  });

  it("muestra la zona de la orden en el listado", async () => {
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    expect(screen.getAllByText("Norte").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// R26, R27 — override por fila y valor inicial (sugerido o azar de la zona)
// ---------------------------------------------------------------------------
describe("OrdenesCargaResumen — override por fila y valor inicial (R26, R27)", () => {
  it("respeta el mensajeroSugeridoId y sortea uno de la zona para las demás (R27)", async () => {
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    // o1 trae sugerido u1 (Ana); o2 no, así que arranca con un mensajero al azar
    // de su zona z1 (con Math.random=0.6 -> índice 1 -> Beto), nunca "Sin asignar".
    expect(within(rowSelect("REM-0001")).getByText("Ana")).toBeInTheDocument();
    expect(within(rowSelect("REM-0002")).getByText("Beto")).toBeInTheDocument();
  });

  it("cambiar el select de una fila no afecta a las demás (R26)", async () => {
    const user = userEvent.setup();
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    // Igualamos ambas filas a Beto y luego cambiamos SOLO la fila 2 a Ana; si el
    // cambio se filtrara a otras filas, la fila 1 dejaría de ser Beto.
    await pickOption(user, rowSelect("REM-0001"), "Beto");
    await pickOption(user, rowSelect("REM-0002"), "Ana");

    expect(within(rowSelect("REM-0002")).getByText("Ana")).toBeInTheDocument();
    expect(within(rowSelect("REM-0001")).getByText("Beto")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// R28, R33 — confirmar: asignarMensajeroSugerido + toast.success + mutate
// ---------------------------------------------------------------------------
describe("OrdenesCargaResumen — confirmar asignación (R28, R33)", () => {
  it("llama a asignarMensajeroSugerido con las asignaciones resueltas y refresca la lista", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    asignarMensajeroSugeridoMock.mockResolvedValue({ status: "ok", asignadas: 2 });

    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} onDone={onDone} />);
    await screen.findByText("REM-0001");

    // Confirma con la selección inicial: o1 = sugerido u1; o2 = azar de su zona
    // (Math.random=0.6 -> u2/Beto).
    await user.click(screen.getByRole("button", { name: /confirmar asignación/i }));

    expect(asignarMensajeroSugeridoMock).toHaveBeenCalledWith({
      asignaciones: [
        { ordenId: "o1", mensajeroId: "u1" },
        { ordenId: "o2", mensajeroId: "u2" },
      ],
    });
    expect(successMock).toHaveBeenCalledTimes(1);

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const matcher = mutateMock.mock.calls[0][0];
    expect(matcher(["ordenes:list", 1, 10])).toBe(true);
    expect(matcher(["otra:key"])).toBe(false);

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("excluye las filas sin mensajero (zona sin mensajeros) de las asignaciones", async () => {
    const user = userEvent.setup();
    // o1 (z1) trae sugerido u1; la orden en z9 no tiene mensajeros -> queda "".
    resumenCargaMasivaMock.mockResolvedValue({
      status: "ok",
      ordenes: [
        ORDENES[0],
        {
          ...ORDENES[1],
          id: "o9",
          numRemision: "REM-9999",
          zonaId: "z9",
          zonaNombre: "Sin cobertura",
          mensajeroSugeridoId: null,
          mensajeroSugeridoNombre: null,
        },
      ],
    });
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-9999"]} />);
    await screen.findByText("REM-0001");

    await user.click(screen.getByRole("button", { name: /confirmar asignación/i }));

    expect(asignarMensajeroSugeridoMock).toHaveBeenCalledWith({
      asignaciones: [{ ordenId: "o1", mensajeroId: "u1" }],
    });
  });
});

// ---------------------------------------------------------------------------
// R29 — fallo de asignación: toast.error, sin indicar éxito
// ---------------------------------------------------------------------------
describe("OrdenesCargaResumen — fallo de asignación (R29)", () => {
  it("status !== 'ok' → toast.error, sin toast.success ni mutate", async () => {
    const user = userEvent.setup();
    asignarMensajeroSugeridoMock.mockResolvedValue({ status: "forbidden" });

    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    await user.click(screen.getByRole("button", { name: /confirmar asignación/i }));

    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(successMock).not.toHaveBeenCalled();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("excepción durante la asignación → toast.error, sin éxito", async () => {
    const user = userEvent.setup();
    asignarMensajeroSugeridoMock.mockRejectedValue(new Error("network"));

    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    await user.click(screen.getByRole("button", { name: /confirmar asignación/i }));

    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(successMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R30 — bloqueo durante el envío / anti doble-submit
// ---------------------------------------------------------------------------
describe("OrdenesCargaResumen — bloqueo durante el envío (R30)", () => {
  it("el botón confirmar se deshabilita mientras la asignación está en curso y evita doble envío", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ status: "ok"; asignadas: number }>();
    asignarMensajeroSugeridoMock.mockReturnValue(pending.promise);

    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    const confirmBtn = screen.getByRole("button", { name: /confirmar asignación/i });
    await user.click(confirmBtn);

    expect(confirmBtn).toBeDisabled();

    // Segundo click mientras está pendiente no debe disparar una segunda llamada.
    await user.click(confirmBtn);
    expect(asignarMensajeroSugeridoMock).toHaveBeenCalledTimes(1);

    pending.resolve({ status: "ok", asignadas: 1 });
    await screen.findByText("Confirmar asignación");
    expect(confirmBtn).not.toBeDisabled();
  });
});
