// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DevolverATiendaModal } from "@/app/(app)/ordenes/_components/DevolverATiendaModal";
import { devolverATienda } from "@/lib/actions/devolucion-origen";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// Feature 48 (T8.1) — Modal "Devolver a la tienda". Se mockea la Server Action del
// retorno y el toast (patrón AsignarSateliteModal.test).
vi.mock("@/lib/actions/devolucion-origen", () => ({
  devolverATienda: vi.fn(),
}));

const devolverATiendaMock = vi.mocked(devolverATienda);

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

function makeOrden(
  overrides: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-000",
    estatusId: "id-rechazada",
    estatusValue: "rechazada",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-central",
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    zonaNombre: "Central",
    zonaEsGam: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function renderModal(
  ordenes: OrdenListItemDTO[],
  onSuccess = vi.fn(),
  onOpenChange = vi.fn(),
) {
  render(
    <DevolverATiendaModal
      open
      ordenes={ordenes}
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />,
  );
  return { onSuccess, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("DevolverATiendaModal", () => {
  it("R4: al confirmar dispara devolverATienda con el ordenId de cada orden y refleja éxito (onSuccess)", async () => {
    const user = userEvent.setup();
    devolverATiendaMock.mockResolvedValue({ status: "ok" });

    const ordenes = [
      makeOrden({ id: "o1", numRemision: "REM-001" }),
      makeOrden({ id: "o2", numRemision: "REM-002" }),
    ];
    const { onSuccess } = renderModal(ordenes);

    await user.click(
      screen.getByRole("button", { name: "Devolver a la tienda" }),
    );

    expect(devolverATiendaMock).toHaveBeenCalledTimes(2);
    expect(devolverATiendaMock).toHaveBeenNthCalledWith(1, { ordenId: "o1" });
    expect(devolverATiendaMock).toHaveBeenNthCalledWith(2, { ordenId: "o2" });

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith(
      "2 orden(es) devuelta(s) a la tienda.",
    );
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("lote vacío (sin órdenes de zona central tras el filtro): avisa y NO llama la acción", async () => {
    const user = userEvent.setup();
    const { onSuccess } = renderModal([]);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /selecciona órdenes de zona central/i,
    );
    const confirmar = screen.getByRole("button", {
      name: "Devolver a la tienda",
    });
    expect(confirmar).toBeDisabled();

    await user.click(confirmar);
    expect(devolverATiendaMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("un resultado no-ok muestra el error y NO invoca onSuccess", async () => {
    const user = userEvent.setup();
    devolverATiendaMock.mockResolvedValue({ status: "conflict", motivo: "estado" });

    const { onSuccess } = renderModal([
      makeOrden({ id: "o1", numRemision: "REM-001" }),
    ]);

    await user.click(
      screen.getByRole("button", { name: "Devolver a la tienda" }),
    );

    expect(devolverATiendaMock).toHaveBeenCalledWith({ ordenId: "o1" });
    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        expect.stringMatching(/rechazada/i),
      ),
    );
    expect(onSuccess).not.toHaveBeenCalled();
    expect(successMock).not.toHaveBeenCalled();
  });

  it("lista las órdenes seleccionadas por su Nº Remisión", () => {
    renderModal([
      makeOrden({ id: "o1", numRemision: "REM-CENTRAL-1" }),
      makeOrden({ id: "o2", numRemision: "REM-CENTRAL-2" }),
    ]);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/REM-CENTRAL-1/)).toBeInTheDocument();
    expect(within(dialog).getByText(/REM-CENTRAL-2/)).toBeInTheDocument();
  });
});
