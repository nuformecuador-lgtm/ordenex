// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AsignarBodegaModal } from "@/app/(app)/ordenes/_components/AsignarBodegaModal";
import { asignarDesdeBodega } from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

// Feature 17 (T19) — Modal "Asignar mensajero" desde en_bodega_central (R26): un único
// mensajero para todo el lote seleccionado.
vi.mock("@/lib/actions/ordenes-guia", () => ({
  asignarDesdeBodega: vi.fn(),
}));

const asignarDesdeBodegaMock = vi.mocked(asignarDesdeBodega);

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

const MENSAJEROS: MensajeroLiteDTO[] = [
  { id: "m1", nombre: "Ana Mensajera" },
  { id: "m2", nombre: "Beto Mensajero" },
];

function makeOrden(
  overrides: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: 100,
    numRemision: "REM-000",
    estatusId: "id-bodega",
    estatusValue: "en_bodega_central",
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
    <AsignarBodegaModal
      open
      ordenes={ordenes}
      mensajeros={MENSAJEROS}
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

describe("AsignarBodegaModal", () => {
  it("R26: llama asignarDesdeBodega({ ordenIds, mensajeroId }) con el lote completo", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", estado: "por_recoger" },
        { ordenId: "o2", estado: "por_recoger" },
      ],
    });

    const ordenes = [
      makeOrden({ id: "o1", numRemision: "REM-001" }),
      makeOrden({ id: "o2", numRemision: "REM-002" }),
    ];
    const { onSuccess } = renderModal(ordenes);

    const select = screen.getByRole("combobox", { name: "Mensajero para el lote" });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Ana Mensajera" }));

    await user.click(screen.getByRole("button", { name: "Asignar" }));

    expect(asignarDesdeBodegaMock).toHaveBeenCalledTimes(1);
    expect(asignarDesdeBodegaMock).toHaveBeenCalledWith({
      ordenIds: ["o1", "o2"],
      mensajeroId: "m1",
    });

    // Feature 148 (§9.7): tras el éxito el modal pasa a la fase "resultado" (con el
    // manifiesto del lote) y `onSuccess` se difiere al cierre de esa fase. La llamada
    // de negocio, su input y su toast NO cambian (R27).
    await user.click(await screen.findByRole("button", { name: "Cerrar" }));
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith("Mensajero asignado a 2 orden(es).");
  });

  it("R26: sin mensajero seleccionado no llama a la acción y muestra el error de validación", async () => {
    const user = userEvent.setup();
    const ordenes = [makeOrden({ id: "o1", numRemision: "REM-001" })];
    renderModal(ordenes);

    await user.click(screen.getByRole("button", { name: "Asignar" }));

    expect(asignarDesdeBodegaMock).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      // Feature 156: el mapper es compartido con "Generar guía", que ya no elige
      // mensajero, así que el texto es genérico.
      expect(errorMock).toHaveBeenCalledWith("Datos inválidos: revisa la selección y vuelve a intentarlo."),
    );
  });

  // Feature 97/R9: el gate de asignabilidad por coordenadas (#98) devuelve `conflict` con el
  // `motivo` = `EstadoAsignabilidad` por orden; la UI lo traduce a un mensaje claro.
  it("R9: conflict 'direccion_no_geocodificable' muestra 'Dirección no encontrada'", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "direccion_no_geocodificable" }],
    });

    const ordenes = [makeOrden({ id: "o1", numRemision: "REM-001" })];
    const { onSuccess } = renderModal(ordenes);

    const select = screen.getByRole("combobox", { name: "Mensajero para el lote" });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Ana Mensajera" }));
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("Dirección no encontrada"),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("R9: conflict 'geocodificacion_encolada' avisa que la dirección aún se valida", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "geocodificacion_encolada" }],
    });

    const ordenes = [makeOrden({ id: "o1", numRemision: "REM-001" })];
    renderModal(ordenes);

    const select = screen.getByRole("combobox", { name: "Mensajero para el lote" });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Ana Mensajera" }));
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "La dirección aún se está validando. Vuelve a intentarlo en unos minutos.",
      ),
    );
  });
});

// Feature 160 (T17, R18/R19/R23) — el diálogo lista las órdenes en un `<ul>`: el
// conteo va como DATO ETIQUETADO en la misma línea, con el markup del resto del `<li>`.
describe("AsignarBodegaModal — intentos de entrega (feature 160)", () => {
  it("R18: cada orden listada muestra el dato etiquetado junto a su remisión", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-A1", intentosEntrega: 2 })]);
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("REM-A1");
    expect(within(item).getByText("Intentos: 2")).toBeInTheDocument();
  });

  it("R19: con 0 intentos el dato SE MUESTRA igual (no se omite)", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-A0", intentosEntrega: 0 })]);
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Intentos: 0")).toBeInTheDocument();
  });

  it("R19: sin el campo (DTO viejo) el dato se muestra como 0", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-AX" })]);
    expect(
      within(screen.getByRole("listitem")).getByText("Intentos: 0"),
    ).toBeInTheDocument();
  });

  it("R19: cada orden lleva SU número, no el de la primera", () => {
    renderModal([
      makeOrden({ id: "o1", numRemision: "REM-B1", intentosEntrega: 3 }),
      makeOrden({ id: "o2", numRemision: "REM-B2", intentosEntrega: 0 }),
    ]);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Intentos: 3")).toBeInTheDocument();
    expect(within(items[1]).getByText("Intentos: 0")).toBeInTheDocument();
  });

  it("R20: el dato no incluye el umbral ('de N')", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-U", intentosEntrega: 2 })]);
    const dato = within(screen.getByRole("listitem")).getByText("Intentos: 2");
    expect(dato.textContent).toBe("Intentos: 2");
  });
});
