// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { OrdenesCargaResumenPaso } from "@/app/(app)/ordenes/_components/OrdenesCargaResumenPaso";
import type { ClasificacionCarga } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
import type { MensajeroDTO, ResumenCargaOrdenDTO } from "@/lib/types/asignacion-mensajero";

// ---------------------------------------------------------------------------
// Mocks (mismo patrón que OrdenesCargaResumen.test.tsx)
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
];

const CLASIFICACION: ClasificacionCarga = {
  numRemisionesNuevas: ["REM-0001"],
  existentes: [{ numRemision: "REM-0100", estatus: "en_bodega" }],
  errores: [
    { fila: 5, numRemision: "REM-0500", errores: { telefono: ["obligatorio"] } },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  listarMensajerosMock.mockResolvedValue({ status: "ok", mensajeros: MENSAJEROS });
  resumenCargaMasivaMock.mockResolvedValue({ status: "ok", ordenes: ORDENES });
  asignarMensajeroSugeridoMock.mockResolvedValue({ status: "ok", asignadas: 0 });
});

afterEach(() => {
  cleanup();
});

describe("OrdenesCargaResumenPaso — tres secciones (R4, R7, R8, R9, R10, R18)", () => {
  it("deja claro que solo se cargan las nuevas y muestra las tres secciones", async () => {
    render(<OrdenesCargaResumenPaso clasificacion={CLASIFICACION} />);

    // Aviso explícito (R7, R8).
    expect(
      screen.getByText(/solo se cargan las órdenes nuevas/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no se recarga/i)).toBeInTheDocument();

    // Sección de nuevas: OrdenesCargaResumen resuelve su fetch y pinta REM-0001.
    expect(await screen.findByText("REM-0001")).toBeInTheDocument();

    // Sección de existentes (solo lectura, etiqueta legible).
    expect(screen.getByText("REM-0100")).toBeInTheDocument();
    expect(screen.getByText("En bodega")).toBeInTheDocument();

    // Sección de errores (detalle por fila).
    expect(screen.getByText("REM-0500")).toBeInTheDocument();
    expect(screen.getByText("telefono: obligatorio")).toBeInTheDocument();
  });

  it("conserva el select de mensajero por fila para las nuevas (R9)", async () => {
    render(<OrdenesCargaResumenPaso clasificacion={CLASIFICACION} />);
    await screen.findByText("REM-0001");

    expect(
      screen.getByRole("combobox", { name: "Mensajero para la orden REM-0001" }),
    ).toBeInTheDocument();
    // Global select también presente.
    expect(
      screen.getByRole("combobox", { name: "Asignar mensajero a todas las órdenes" }),
    ).toBeInTheDocument();
  });

  it("con creadas===0 muestra solo existentes, sin resumen de mensajero (R11)", async () => {
    const soloExistentes: ClasificacionCarga = {
      numRemisionesNuevas: [],
      existentes: [{ numRemision: "REM-0100", estatus: "en_bodega" }],
      errores: [],
    };
    render(<OrdenesCargaResumenPaso clasificacion={soloExistentes} />);

    expect(screen.getByText("REM-0100")).toBeInTheDocument();
    // No se pide el resumen de asignación con lista vacía.
    expect(resumenCargaMasivaMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("combobox", { name: "Asignar mensajero a todas las órdenes" }),
    ).not.toBeInTheDocument();
  });
});
