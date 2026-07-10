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

const MENSAJEROS: MensajeroDTO[] = [
  { id: "u1", nombre: "Ana" },
  { id: "u2", nombre: "Beto" },
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
  listarMensajerosMock.mockResolvedValue({ status: "ok", mensajeros: MENSAJEROS });
  resumenCargaMasivaMock.mockResolvedValue({ status: "ok", ordenes: ORDENES });
  asignarMensajeroSugeridoMock.mockResolvedValue({ status: "ok", asignadas: 0 });
});

afterEach(() => {
  cleanup();
});

const rowSelect = (numRemision: string) =>
  screen.getByRole("combobox", { name: `Mensajero para la orden ${numRemision}` });

const globalSelect = () =>
  screen.getByRole("combobox", { name: "Asignar mensajero a todas las órdenes" });

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

    await user.click(globalSelect());
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "Ana" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Beto" })).toBeInTheDocument();
  });

  it("si listarMensajeros falla, los selects quedan deshabilitados y se avisa", async () => {
    listarMensajerosMock.mockResolvedValue({ status: "forbidden" });
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);

    await screen.findByText("REM-0001");

    expect(globalSelect()).toBeDisabled();
    expect(rowSelect("REM-0001")).toBeDisabled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(errorMock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R24, R25 — select global aplica a todas las filas
// ---------------------------------------------------------------------------
describe("OrdenesCargaResumen — select global (R24, R25)", () => {
  it("elegir un mensajero en el global lo aplica a todas las filas", async () => {
    const user = userEvent.setup();
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    await pickOption(user, globalSelect(), "Beto");

    expect(within(rowSelect("REM-0001")).getByText("Beto")).toBeInTheDocument();
    expect(within(rowSelect("REM-0002")).getByText("Beto")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// R26, R27 — override por fila y valor inicial = mensajeroSugeridoId
// ---------------------------------------------------------------------------
describe("OrdenesCargaResumen — override por fila y valor inicial (R26, R27)", () => {
  it("cada fila inicia con su mensajeroSugeridoId (R27)", async () => {
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    expect(within(rowSelect("REM-0001")).getByText("Ana")).toBeInTheDocument();
    expect(rowSelect("REM-0002")).toHaveTextContent("Sin asignar");
  });

  it("cambiar el select de una fila no afecta a las demás (R26)", async () => {
    const user = userEvent.setup();
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    await pickOption(user, globalSelect(), "Ana");
    expect(within(rowSelect("REM-0002")).getByText("Ana")).toBeInTheDocument();

    await pickOption(user, rowSelect("REM-0002"), "Beto");

    expect(within(rowSelect("REM-0002")).getByText("Beto")).toBeInTheDocument();
    expect(within(rowSelect("REM-0001")).getByText("Ana")).toBeInTheDocument();
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

    await pickOption(user, globalSelect(), "Beto");
    await user.click(screen.getByRole("button", { name: /confirmar asignación/i }));

    expect(asignarMensajeroSugeridoMock).toHaveBeenCalledWith({
      asignaciones: [
        { ordenId: "o1", mensajeroId: "u2" },
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

  it("solo incluye filas con mensajero elegido en las asignaciones", async () => {
    const user = userEvent.setup();
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    // Solo la fila 1 tiene mensajero sugerido (u1); la fila 2 queda sin elegir.
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
