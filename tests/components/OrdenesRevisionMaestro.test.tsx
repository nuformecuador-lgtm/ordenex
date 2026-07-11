// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { OrdenesRevisionMaestro } from "@/app/(app)/ordenes/_components/OrdenesRevisionMaestro";
import { ToastProvider } from "@/providers/ToastProvider";
import { listarOrdenes } from "@/lib/actions/ordenes";
import {
  listarCatalogoEstatus,
  listarMensajerosParaAsignacion,
  generarGuia,
  asignarDesdeBodega,
} from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { EstatusLiteDTO, MensajeroLiteDTO } from "@/lib/types/orden-guia";

// Feature 17 (T16/T17) — orquestador de la vista de revisión del maestro. Se
// mockean las Server Actions consumidas (catálogo, mensajeros, listado por
// apartado y las dos acciones de escritura que montan los modales hijos
// REALES, sin doblarlos, para verificar la composición completa).
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: vi.fn(),
}));

vi.mock("@/lib/actions/ordenes-guia", () => ({
  listarCatalogoEstatus: vi.fn(),
  listarMensajerosParaAsignacion: vi.fn(),
  generarGuia: vi.fn(),
  asignarDesdeBodega: vi.fn(),
}));

const listarOrdenesMock = vi.mocked(listarOrdenes);
const listarCatalogoEstatusMock = vi.mocked(listarCatalogoEstatus);
const listarMensajerosMock = vi.mocked(listarMensajerosParaAsignacion);
const generarGuiaMock = vi.mocked(generarGuia);
const asignarDesdeBodegaMock = vi.mocked(asignarDesdeBodega);

const ESTATUS: EstatusLiteDTO[] = [
  { id: "id-fulfillment", value: "en_fulfillment" },
  { id: "id-preparacion", value: "en_preparacion" },
  { id: "id-espera", value: "en_espera_aceptacion" },
  { id: "id-bodega", value: "en_bodega" },
];

const MENSAJEROS: MensajeroLiteDTO[] = [{ id: "m1", nombre: "Juan Mensajero" }];

function makeOrden(
  overrides: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: null,
    numRemision: "REM-000",
    estatusId: "est",
    estatusValue: undefined,
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    mensajeroSugeridoId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const ORDENES_POR_ESTATUS: Record<string, OrdenListItemDTO[]> = {
  "id-fulfillment": [
    makeOrden({ id: "of1", numRemision: "REM-F1", estatusId: "id-fulfillment" }),
    makeOrden({ id: "of2", numRemision: "REM-F2", estatusId: "id-fulfillment" }),
  ],
  "id-preparacion": [
    makeOrden({ id: "op1", numRemision: "REM-P1", estatusId: "id-preparacion" }),
  ],
  "id-espera": [
    makeOrden({ id: "oe1", numRemision: "REM-E1", estatusId: "id-espera" }),
  ],
  "id-bodega": [
    makeOrden({ id: "ob1", numRemision: "REM-B1", estatusId: "id-bodega" }),
  ],
};

function renderComponent(readOnly = false) {
  render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <OrdenesRevisionMaestro readOnly={readOnly} />
      </SWRConfig>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarCatalogoEstatusMock.mockResolvedValue({ status: "ok", estatus: ESTATUS });
  listarMensajerosMock.mockResolvedValue({ status: "ok", mensajeros: MENSAJEROS });
  listarOrdenesMock.mockImplementation(async (input) => {
    const { estatusId, page, pageSize } = input as {
      estatusId?: string;
      page: number;
      pageSize: number;
    };
    const items = estatusId ? (ORDENES_POR_ESTATUS[estatusId] ?? []) : [];
    return { status: "ok", items, page, pageSize, total: items.length };
  });
});

afterEach(() => {
  cleanup();
});

describe("OrdenesRevisionMaestro", () => {
  it("R15: muestra los apartados en_fulfillment y en_preparacion como secciones separadas", async () => {
    renderComponent();

    await screen.findByText("REM-F1");
    expect(
      screen.getByRole("region", { name: "En fulfillment" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "En preparación" }),
    ).toBeInTheDocument();
  });

  it("R16: muestra los apartados en_espera_aceptacion y en_bodega", async () => {
    renderComponent();

    await screen.findByText("REM-F1");
    expect(
      screen.getByRole("region", {
        name: "En espera de aceptación del mensajero",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "En bodega" })).toBeInTheDocument();
  });

  it("R12-UI: readOnly (admin) no muestra checkboxes ni botones de acción", async () => {
    renderComponent(true);

    await screen.findByText("REM-F1");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Generar guía" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Asignar mensajero" }),
    ).toBeNull();
  });

  it("R17: permite seleccionar por checkbox varias órdenes de un mismo apartado", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("REM-F1");
    const fulfillment = screen.getByRole("region", { name: "En fulfillment" });
    const checkboxes = within(fulfillment).getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);

    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);

    expect(checkboxes[0]).toHaveAttribute("aria-checked", "true");
    expect(checkboxes[1]).toHaveAttribute("aria-checked", "true");
  });

  it("R18: el botón 'Generar guía' de en_fulfillment abre el modal con la selección", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("REM-F1");
    const fulfillment = screen.getByRole("region", { name: "En fulfillment" });
    const checkbox = within(fulfillment).getAllByRole("checkbox")[0];
    await user.click(checkbox);
    await user.click(
      within(fulfillment).getByRole("button", { name: "Generar guía" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Generar guía" }),
    ).toBeInTheDocument();
    // No dispara la acción de escritura solo por abrir el modal.
    expect(generarGuiaMock).not.toHaveBeenCalled();
  });

  it("R18: el botón 'Generar guía' de en_preparacion también abre el modal (ambos estados de revisión)", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("REM-P1");
    const preparacion = screen.getByRole("region", { name: "En preparación" });
    await user.click(within(preparacion).getAllByRole("checkbox")[0]);
    await user.click(
      within(preparacion).getByRole("button", { name: "Generar guía" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Generar guía" }),
    ).toBeInTheDocument();
  });

  it("no ofrece selección ni acción en el apartado en_espera_aceptacion (fuera de alcance, feature 36)", async () => {
    renderComponent();

    await screen.findByText("REM-E1");
    const espera = screen.getByRole("region", {
      name: "En espera de aceptación del mensajero",
    });
    expect(within(espera).queryAllByRole("checkbox")).toHaveLength(0);
    // Sin botón de acción por lote (solo los controles de paginación, que sí existen).
    expect(
      within(espera).queryByRole("button", { name: "Generar guía" }),
    ).toBeNull();
    expect(
      within(espera).queryByRole("button", { name: "Asignar mensajero" }),
    ).toBeNull();
  });

  it("R26 (composición): el botón 'Asignar mensajero' de en_bodega abre AsignarBodegaModal", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("REM-B1");
    const bodega = screen.getByRole("region", { name: "En bodega" });
    await user.click(within(bodega).getAllByRole("checkbox")[0]);
    await user.click(
      within(bodega).getByRole("button", { name: "Asignar mensajero" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Asignar mensajero" }),
    ).toBeInTheDocument();
    expect(asignarDesdeBodegaMock).not.toHaveBeenCalled();
  });
});
