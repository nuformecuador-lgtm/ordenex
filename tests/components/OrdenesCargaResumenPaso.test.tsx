// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { OrdenesCargaResumenPaso } from "@/app/(app)/ordenes/_components/OrdenesCargaResumenPaso";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import type { ClasificacionCarga } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// `DescargarManifiestoButton` (sección de nuevas) consume useToast.
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLASIFICACION: ClasificacionCarga = {
  numRemisionesNuevas: ["REM-0001"],
  existentes: [{ numRemision: "REM-0100", estatus: "en_bodega_central" }],
  errores: [
    { fila: 5, numRemision: "REM-0500", errores: { telefono: ["obligatorio"] } },
  ],
};

afterEach(() => {
  cleanup();
});

describe("OrdenesCargaResumenPaso — secciones (R4, R7, R8, R18)", () => {
  it("deja claro que solo se cargan las nuevas y muestra existentes y errores", () => {
    render(<OrdenesCargaResumenPaso clasificacion={CLASIFICACION} />);

    // Aviso explícito (R7, R8).
    expect(
      screen.getByText(/solo se cargan las órdenes nuevas/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no se recarga/i)).toBeInTheDocument();

    // Sección de existentes (solo lectura, etiqueta legible del mapa de
    // presentación — no el value crudo `en_bodega_central`).
    expect(screen.getByText("REM-0100")).toBeInTheDocument();
    expect(screen.getByText(ORDER_STATUS_LABELS.en_bodega_central)).toBeInTheDocument();

    // Sección de errores (detalle por fila).
    expect(screen.getByText("REM-0500")).toBeInTheDocument();
    expect(screen.getByText("telefono: obligatorio")).toBeInTheDocument();
  });

  it("retirado el mensajero sugerido: ninguna sección ofrece asignar mensajero", () => {
    render(<OrdenesCargaResumenPaso clasificacion={CLASIFICACION} />);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sugerir asignación/i }),
    ).not.toBeInTheDocument();
  });

  it("con creadas===0 muestra solo existentes (R11)", () => {
    const soloExistentes: ClasificacionCarga = {
      numRemisionesNuevas: [],
      existentes: [{ numRemision: "REM-0100", estatus: "en_bodega_central" }],
      errores: [],
    };
    render(<OrdenesCargaResumenPaso clasificacion={soloExistentes} />);

    expect(screen.getByText("REM-0100")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
