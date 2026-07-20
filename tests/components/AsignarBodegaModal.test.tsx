// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AsignarBodegaModal } from "@/app/(app)/ordenes/_components/AsignarBodegaModal";
import { asignarDesdeBodega } from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

// Feature 17 (T19) — Modal "Asignar mensajero" desde en_bodega (R26): un único
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
    estatusValue: "en_bodega",
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
        { ordenId: "o1", estado: "en_espera_aceptacion" },
        { ordenId: "o2", estado: "en_espera_aceptacion" },
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
      expect(errorMock).toHaveBeenCalledWith(
        "Datos inválidos: revisa la selección de mensajero.",
      ),
    );
  });

  /** Elige el mensajero del lote y confirma. */
  async function asignarConMensajero(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      screen.getByRole("combobox", { name: "Mensajero para el lote" }),
    );
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Ana Mensajera" }));
    await user.click(screen.getByRole("button", { name: "Asignar" }));
  }

  // Feature 93 (R9): el gate de coordenadas (92) devuelve `conflict` con un
  // `motivo` por orden. El toast debe DIFERENCIAR el desenlace definitivo del
  // transitorio en vez de caer en el mensaje genérico de `conflict`.
  it.each(["direccion_no_geocodificable", "geocodificacion_agotada"])(
    "R9: conflict con motivo %s → toast 'Dirección no encontrada'",
    async (motivo) => {
      const user = userEvent.setup();
      asignarDesdeBodegaMock.mockResolvedValue({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo }],
      });
      renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

      await asignarConMensajero(user);

      await vi.waitFor(() =>
        expect(errorMock).toHaveBeenCalledWith("Dirección no encontrada"),
      );
    },
  );

  it.each([
    "geocodificacion_en_curso",
    "geocodificacion_encolada",
    "geocodificacion_no_encolable",
  ])(
    "R9: conflict con motivo %s → mensaje DISTINTO (la dirección aún se valida)",
    async (motivo) => {
      const user = userEvent.setup();
      asignarDesdeBodegaMock.mockResolvedValue({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo }],
      });
      renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

      await asignarConMensajero(user);

      await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
      const msg = errorMock.mock.calls.at(-1)?.[0] as string;
      expect(msg).not.toBe("Dirección no encontrada");
      expect(msg).toMatch(/valid/i);
    },
  );
});
