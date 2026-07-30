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
    estatusId: "id-por-devolver-a-tienda",
    estatusValue: "por_devolver_a_tienda",
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

describe("DevolverATiendaModal (feature 139/R15: 'Enviar a la tienda')", () => {
  it("R15: al confirmar dispara devolverATienda con el ordenId de cada orden y refleja éxito (onSuccess)", async () => {
    const user = userEvent.setup();
    devolverATiendaMock.mockResolvedValue({ status: "ok" });

    const ordenes = [
      makeOrden({ id: "o1", numRemision: "REM-001" }),
      makeOrden({ id: "o2", numRemision: "REM-002" }),
    ];
    const { onSuccess } = renderModal(ordenes);

    await user.click(
      screen.getByRole("button", { name: "Enviar a la tienda" }),
    );

    expect(devolverATiendaMock).toHaveBeenCalledTimes(2);
    expect(devolverATiendaMock).toHaveBeenNthCalledWith(1, { ordenId: "o1" });
    expect(devolverATiendaMock).toHaveBeenNthCalledWith(2, { ordenId: "o2" });

    // Feature 148 (§9.7): tras el éxito el modal pasa a la fase "resultado" (con el
    // manifiesto del lote) y `onSuccess` se difiere al cierre de esa fase. La llamada
    // de negocio, su input y su toast NO cambian (R27).
    await user.click(await screen.findByRole("button", { name: "Cerrar" }));
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith(
      "2 orden(es) enviada(s) a la tienda.",
    );
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("lote vacío: avisa y NO llama la acción", async () => {
    const user = userEvent.setup();
    const { onSuccess } = renderModal([]);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /selecciona al menos una orden/i,
    );
    const confirmar = screen.getByRole("button", {
      name: "Enviar a la tienda",
    });
    expect(confirmar).toBeDisabled();

    await user.click(confirmar);
    expect(devolverATiendaMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("un resultado no-ok muestra el error (origen 'Por devolver a tienda') y NO invoca onSuccess", async () => {
    const user = userEvent.setup();
    devolverATiendaMock.mockResolvedValue({ status: "conflict", motivo: "estado" });

    const { onSuccess } = renderModal([
      makeOrden({ id: "o1", numRemision: "REM-001" }),
    ]);

    await user.click(
      screen.getByRole("button", { name: "Enviar a la tienda" }),
    );

    expect(devolverATiendaMock).toHaveBeenCalledWith({ ordenId: "o1" });
    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        expect.stringMatching(/por devolver a tienda/i),
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

// Feature 160 (T17, R18/R19/R23) — el diálogo lista las órdenes en un `<ul>`: el
// conteo va como DATO ETIQUETADO en la misma línea, con el markup del resto del `<li>`.
describe("DevolverATiendaModal — intentos de entrega (feature 160)", () => {
  it("R18: cada orden listada muestra el dato etiquetado junto a su remisión", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-I1", intentosEntrega: 2 })]);
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("REM-I1");
    expect(within(item).getByText("Intentos: 2")).toBeInTheDocument();
  });

  it("R19: con 0 intentos el dato SE MUESTRA igual (no se omite)", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-I0", intentosEntrega: 0 })]);
    expect(
      within(screen.getByRole("listitem")).getByText("Intentos: 0"),
    ).toBeInTheDocument();
  });

  it("R19: sin el campo (DTO viejo) el dato se muestra como 0", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-IX" })]);
    expect(
      within(screen.getByRole("listitem")).getByText("Intentos: 0"),
    ).toBeInTheDocument();
  });

  it("R19: cada orden lleva SU número, no el de la primera", () => {
    renderModal([
      makeOrden({ id: "o1", numRemision: "REM-M1", intentosEntrega: 3 }),
      makeOrden({ id: "o2", numRemision: "REM-M2", intentosEntrega: 0 }),
    ]);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Intentos: 3")).toBeInTheDocument();
    expect(within(items[1]).getByText("Intentos: 0")).toBeInTheDocument();
  });

  it("R32: el dato no desplaza al resto de la línea (remisión y zona siguen)", () => {
    renderModal([
      makeOrden({
        id: "o1",
        numRemision: "REM-Z1",
        zonaNombre: "Limón",
        intentosEntrega: 1,
      }),
    ]);
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("REM-Z1");
    expect(item).toHaveTextContent("Limón");
    expect(within(item).getByText("Intentos: 1")).toBeInTheDocument();
  });

  it("R20: el dato no incluye el umbral ('de N')", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-U", intentosEntrega: 2 })]);
    const dato = within(screen.getByRole("listitem")).getByText("Intentos: 2");
    expect(dato.textContent).toBe("Intentos: 2");
  });
});
