// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GenerarGuiaModal } from "@/app/(app)/ordenes/_components/GenerarGuiaModal";
import { generarGuia } from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

// Feature 17 (T18) — Modal async "Generar guía": agrupa por sugerido/sin
// sugerido (R20) y resuelve el lote mixto en UNA sola llamada (R24).
vi.mock("@/lib/actions/ordenes-guia", () => ({
  generarGuia: vi.fn(),
}));

const generarGuiaMock = vi.mocked(generarGuia);

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
    numGuia: null,
    numRemision: "REM-000",
    estatusId: "id-fulfillment",
    estatusValue: "en_fulfillment",
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

function renderModal(
  ordenes: OrdenListItemDTO[],
  onSuccess = vi.fn(),
  onOpenChange = vi.fn(),
) {
  render(
    <GenerarGuiaModal
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

describe("GenerarGuiaModal", () => {
  it("R20: agrupa la selección en 'con sugerido' y 'sin sugerido'", () => {
    const ordenes = [
      makeOrden({ id: "o1", numRemision: "REM-001", mensajeroSugeridoId: "m1" }),
      makeOrden({ id: "o2", numRemision: "REM-002", mensajeroSugeridoId: null }),
    ];
    renderModal(ordenes);

    expect(screen.getByText("Con mensajero sugerido")).toBeInTheDocument();
    expect(screen.getByText("Sin mensajero sugerido")).toBeInTheDocument();

    const conSugeridoTable = screen.getByRole("table", {
      name: "Órdenes con mensajero sugerido",
    });
    expect(within(conSugeridoTable).getByText("REM-001")).toBeInTheDocument();

    const sinSugeridoTable = screen.getByRole("table", {
      name: "Órdenes sin mensajero sugerido",
    });
    expect(within(sinSugeridoTable).getByText("REM-002")).toBeInTheDocument();
  });

  it("R24: caso mixto (sugerido + override + sin mensajero) resuelve en UNA sola llamada a generarGuia", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", numGuia: 1, estado: "por_recoger" },
        { ordenId: "o2", numGuia: 2, estado: "por_recoger" },
        { ordenId: "o3", numGuia: 3, estado: "en_bodega_central" },
      ],
    });

    const ordenes = [
      // (a) con sugerido: se confirma el sugerido tal cual.
      makeOrden({ id: "o1", numRemision: "REM-001", mensajeroSugeridoId: "m1" }),
      // (b) sin sugerido: el maestro elige otro mensajero (override).
      makeOrden({ id: "o2", numRemision: "REM-002", mensajeroSugeridoId: null }),
      // (b) sin sugerido: el maestro deja "sin mensajero" -> en_bodega_central.
      makeOrden({ id: "o3", numRemision: "REM-003", mensajeroSugeridoId: null }),
    ];
    const { onSuccess } = renderModal(ordenes);

    // o2: elige mensajero override (Select por click + listbox, no <select> nativo).
    const selectO2 = screen.getByRole("combobox", {
      name: "Mensajero para la orden REM-002",
    });
    await user.click(selectO2);
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Beto Mensajero" }));

    // o3 queda sin mensajero (placeholder "Sin mensajero").
    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    expect(generarGuiaMock).toHaveBeenCalledTimes(1);
    expect(generarGuiaMock).toHaveBeenCalledWith({
      decisiones: [
        { ordenId: "o1", mensajeroId: "m1" }, // sugerido confirmado
        { ordenId: "o2", mensajeroId: "m2" }, // override
        { ordenId: "o3", mensajeroId: null }, // sin mensajero -> en_bodega_central
      ],
    });

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("R7/R8: una orden NO-GAM no muestra select de mensajero y aparece en el grupo 'bodega satélite'; al confirmar envía mensajeroId=null para ella", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", numGuia: 1, estado: "por_recoger" },
        { ordenId: "o2", numGuia: 2, estado: "en_ruta_bodega_satelite" },
      ],
    });

    const ordenes = [
      // GAM: conserva el camino de la feature 17 (con select de mensajero).
      makeOrden({
        id: "o1",
        numRemision: "REM-GAM",
        zonaEsGam: true,
        zonaNombre: "GAM",
        mensajeroSugeridoId: "m1",
      }),
      // NO-GAM: se rutea a la bodega satélite de su zona, SIN select.
      makeOrden({
        id: "o2",
        numRemision: "REM-NOGAM",
        zonaEsGam: false,
        zonaNombre: "Limón",
      }),
    ];
    const { onSuccess } = renderModal(ordenes);

    // El grupo de bodega satélite de la zona aparece.
    const grupoSatelite = screen.getByRole("table", {
      name: "Se enviarán a la bodega satélite de Limón",
    });
    expect(within(grupoSatelite).getByText("REM-NOGAM")).toBeInTheDocument();

    // La orden NO-GAM NO ofrece select de mensajero.
    expect(
      screen.queryByRole("combobox", {
        name: "Mensajero para la orden REM-NOGAM",
      }),
    ).toBeNull();
    // La orden GAM sí conserva su select.
    expect(
      screen.getByRole("combobox", { name: "Mensajero para la orden REM-GAM" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    expect(generarGuiaMock).toHaveBeenCalledTimes(1);
    expect(generarGuiaMock).toHaveBeenCalledWith({
      decisiones: [
        { ordenId: "o1", mensajeroId: "m1" }, // GAM: sugerido confirmado
        { ordenId: "o2", mensajeroId: null }, // NO-GAM: siempre null (→ satélite)
      ],
    });

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("R25: si generarGuia responde un status no-ok, no se refresca (permanece abierto vía onError del Modal)", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "estado inválido" }],
    });

    const ordenes = [makeOrden({ id: "o1", numRemision: "REM-001" })];
    const { onSuccess } = renderModal(ordenes);

    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(errorMock).toHaveBeenCalledWith(
      "Alguna orden ya no está en un estado válido para esta acción.",
    );
  });

  // Feature 97/R9: el gate de asignabilidad por coordenadas (#98) devuelve `conflict` con un
  // `motivo` por orden que es LITERALMENTE el `EstadoAsignabilidad`. La UI lo traduce a un
  // mensaje claro según la clase del motivo.
  it("R9: un conflict con motivo 'direccion_no_geocodificable' muestra 'Dirección no encontrada'", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "direccion_no_geocodificable" }],
    });

    const ordenes = [makeOrden({ id: "o1", numRemision: "REM-001" })];
    const { onSuccess } = renderModal(ordenes);

    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("Dirección no encontrada"),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("R9: un conflict con motivo 'geocodificacion_agotada' también es 'Dirección no encontrada'", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "geocodificacion_agotada" }],
    });

    const ordenes = [makeOrden({ id: "o1", numRemision: "REM-001" })];
    renderModal(ordenes);

    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("Dirección no encontrada"),
    );
  });

  it("R9: un conflict con motivo 'geocodificacion_en_curso' avisa que la dirección aún se valida", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "geocodificacion_en_curso" }],
    });

    const ordenes = [makeOrden({ id: "o1", numRemision: "REM-001" })];
    renderModal(ordenes);

    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "La dirección aún se está validando. Intenta de nuevo en unos minutos.",
      ),
    );
  });
});
