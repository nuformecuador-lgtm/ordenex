// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { OrdenesListado } from "@/app/(app)/ordenes/_components/OrdenesListado";
import { ToastProvider } from "@/providers/ToastProvider";
import { listarOrdenes } from "@/lib/actions/ordenes";
import { listarOrderStatus } from "@/lib/actions/order-status";
import {
  listarMensajerosParaAsignacion,
  listarZonasBloqueadasPorCierre,
  generarGuia,
  asignarDesdeBodega,
} from "@/lib/actions/ordenes-guia";
import { generarEtiquetas } from "@/lib/actions/etiquetas-guia";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// Feature 95 — encadenado: al terminar "Generar guía" / "Asignar mensajero", el
// flujo abre automáticamente el modal de etiquetas con el MISMO lote (re-derivado
// por id, ya con num_guia). Se ejercita OrdenesListado con los modales REALES; solo se
// stubean las dependencias no testeables en jsdom (server actions, PDF, QR/barcode)
// y DevolverATiendaModal (fuera de este flujo; su server action no se carga).
vi.mock("@/lib/actions/ordenes", () => ({ listarOrdenes: vi.fn() }));
vi.mock("@/lib/actions/order-status", () => ({ listarOrderStatus: vi.fn() }));
vi.mock("@/lib/actions/ordenes-guia", () => ({
  listarMensajerosParaAsignacion: vi.fn(),
  listarZonasBloqueadasPorCierre: vi.fn(),
  generarGuia: vi.fn(),
  asignarDesdeBodega: vi.fn(),
}));
vi.mock("@/lib/actions/etiquetas-guia", () => ({
  generarEtiquetas: vi.fn(),
  obtenerEtiquetaPorGuia: vi.fn(),
}));
vi.mock("@/app/(app)/ordenes/_components/etiquetas-pdf", () => ({
  descargarEtiquetasPdf: vi.fn(),
}));
vi.mock("@/app/(app)/ordenes/_components/DevolverATiendaModal", () => ({
  DevolverATiendaModal: () => null,
}));
// Stubs de QR/barcode: evitan canvas real y el warning de ref (como en
// EtiquetasGuiaModal.test.tsx).
vi.mock("qrcode.react", () => ({
  QRCodeCanvas: () => <canvas data-testid="qr-stub" />,
}));
vi.mock("react-barcode", () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="barcode-stub" data-value={value} />
  ),
}));

const listarOrdenesMock = vi.mocked(listarOrdenes);
const listarOrderStatusMock = vi.mocked(listarOrderStatus);
const listarMensajerosMock = vi.mocked(listarMensajerosParaAsignacion);
const listarZonasBloqueadasMock = vi.mocked(listarZonasBloqueadasPorCierre);
const generarGuiaMock = vi.mocked(generarGuia);
const asignarDesdeBodegaMock = vi.mocked(asignarDesdeBodega);
const generarEtiquetasMock = vi.mocked(generarEtiquetas);

function makeOrden(
  overrides: Partial<OrdenListItemDTO> & { id: string; estatusId: string },
): OrdenListItemDTO {
  return {
    numGuia: null,
    numRemision: "REM-000",
    estatusValue: "en_fulfillment",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-libre",
    zonaEsGam: true,
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

function makeEtiqueta(
  overrides: Partial<EtiquetaGuiaDTO> & { ordenId: string },
): EtiquetaGuiaDTO {
  return {
    numGuia: 5000,
    numRemision: "REM-000",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    direccion: "Dir",
    producto: "Producto",
    montoCobrar: 100,
    tiendaNombre: "Tienda X",
    zonaNombre: "Zona A",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: null,
    qrValue: String(overrides.numGuia ?? 5000),
    barcodeValue: String(overrides.numGuia ?? 5000),
    ...overrides,
  };
}

/** Monta el listado del maestro sirviendo `items` (estados con accion por lote). */
function renderListado(estatus: { id: string; value: string }, items: OrdenListItemDTO[]) {
  listarOrderStatusMock.mockResolvedValue({ status: "ok", estatus: [estatus] });
  listarOrdenesMock.mockImplementation(async (input) => {
    const { page, pageSize } = input as { page: number; pageSize: number };
    return { status: "ok", items, page, pageSize, total: items.length };
  });
  render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <OrdenesListado accionesLote />
      </SWRConfig>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarMensajerosMock.mockResolvedValue({
    status: "ok",
    mensajeros: [{ id: "m1", nombre: "Ana Mensajera" }],
    bloqueadosIds: [],
  });
  // Sin zonas bloqueadas: los checkbox de las órdenes de asignación quedan habilitados.
  listarZonasBloqueadasMock.mockResolvedValue({
    status: "ok",
    zonasBloqueadasIds: [],
  });
});

afterEach(() => {
  cleanup();
});

describe("OrdenesListado — feature 95: encadenar etiquetas tras generar guía / asignar", () => {
  it("tras el éxito de 'Generar guía' abre el modal de etiquetas con el MISMO lote (re-derivado por id)", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "id-o1", numGuia: 5001, estado: "en_bodega_central" }],
    });
    generarEtiquetasMock.mockResolvedValue({
      status: "ok",
      etiquetas: [makeEtiqueta({ ordenId: "id-o1", numGuia: 5001 })],
      omitidas: [],
    });

    renderListado(
      { id: "est-fulfillment", value: "en_fulfillment" },
      [makeOrden({ id: "id-o1", numRemision: "REM-1", estatusId: "est-fulfillment" })],
    );

    // Selecciona la orden -> aparece la barra de acciones por lote.
    await user.click(
      await screen.findByRole("checkbox", { name: "Seleccionar orden REM-1" }),
    );
    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    // Confirma dentro del modal "Generar guía" (sin mensajero -> en_bodega_central).
    const guiaDialog = await screen.findByRole("dialog", { name: "Generar guía" });
    await user.click(
      within(guiaDialog).getByRole("button", { name: "Generar guía" }),
    );

    expect(generarGuiaMock).toHaveBeenCalledTimes(1);

    // Feature 148 (§9.7): tras confirmar, el modal de guía pasa a su fase
    // "resultado" (manifiesto del lote) y el encadenado a etiquetas ocurre al
    // CERRAR esa fase, no al confirmar. El lote encadenado es el mismo.
    await user.click(within(guiaDialog).getByRole("button", { name: "Cerrar" }));

    // Encadena: el modal de etiquetas se abre con el lote (re-fetch por id).
    const etiquetasDialog = await screen.findByRole("dialog", {
      name: "Imprimir etiquetas",
    });
    expect(
      await within(etiquetasDialog).findByTestId("etiqueta-guia"),
    ).toBeInTheDocument();
    expect(generarEtiquetasMock).toHaveBeenCalledWith({ ordenIds: ["id-o1"] });

    // El modal de generar guía ya no está montado (se cerró al encadenar).
    expect(
      screen.queryByRole("dialog", { name: "Generar guía" }),
    ).not.toBeInTheDocument();
  });

  it("tras el éxito de 'Asignar mensajero' (bodega) abre el modal de etiquetas con el lote", async () => {
    const user = userEvent.setup();
    asignarDesdeBodegaMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "id-o2", estado: "por_recoger" }],
    });
    generarEtiquetasMock.mockResolvedValue({
      status: "ok",
      etiquetas: [makeEtiqueta({ ordenId: "id-o2", numGuia: 5002 })],
      omitidas: [],
    });

    renderListado(
      { id: "est-bodega", value: "en_bodega_central" },
      [
        makeOrden({
          id: "id-o2",
          numRemision: "REM-2",
          estatusId: "est-bodega",
          estatusValue: "en_bodega_central",
          numGuia: 5002,
        }),
      ],
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "Seleccionar orden REM-2" }),
    );
    await user.click(screen.getByRole("button", { name: "Asignar mensajero" }));

    // Elige mensajero y confirma en el modal "Asignar mensajero".
    const asignarDialog = await screen.findByRole("dialog", {
      name: "Asignar mensajero",
    });
    await user.click(
      within(asignarDialog).getByRole("combobox", {
        name: "Mensajero para el lote",
      }),
    );
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Ana Mensajera",
      }),
    );
    await user.click(within(asignarDialog).getByRole("button", { name: "Asignar" }));

    expect(asignarDesdeBodegaMock).toHaveBeenCalledTimes(1);

    // Feature 148 (§9.7): tras confirmar, el modal de asignación pasa a su fase
    // "resultado" (manifiesto del lote) y el encadenado a etiquetas ocurre al
    // CERRAR esa fase, no al confirmar. El lote encadenado es el mismo.
    await user.click(
      within(asignarDialog).getByRole("button", { name: "Cerrar" }),
    );

    const etiquetasDialog = await screen.findByRole("dialog", {
      name: "Imprimir etiquetas",
    });
    expect(
      await within(etiquetasDialog).findByTestId("etiqueta-guia"),
    ).toBeInTheDocument();
    expect(generarEtiquetasMock).toHaveBeenCalledWith({ ordenIds: ["id-o2"] });
  });

  it("cerrar el modal de etiquetas termina el flujo (no re-encadena)", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "id-o1", numGuia: 5001, estado: "en_bodega_central" }],
    });
    generarEtiquetasMock.mockResolvedValue({
      status: "ok",
      etiquetas: [makeEtiqueta({ ordenId: "id-o1", numGuia: 5001 })],
      omitidas: [],
    });

    renderListado(
      { id: "est-fulfillment", value: "en_fulfillment" },
      [makeOrden({ id: "id-o1", numRemision: "REM-1", estatusId: "est-fulfillment" })],
    );

    await user.click(
      await screen.findByRole("checkbox", { name: "Seleccionar orden REM-1" }),
    );
    await user.click(screen.getByRole("button", { name: "Generar guía" }));
    const guiaDialog = await screen.findByRole("dialog", { name: "Generar guía" });
    await user.click(
      within(guiaDialog).getByRole("button", { name: "Generar guía" }),
    );

    // Feature 148 (§9.7): tras confirmar, el modal de guía pasa a su fase
    // "resultado" (manifiesto del lote) y el encadenado a etiquetas ocurre al
    // CERRAR esa fase, no al confirmar. El lote encadenado es el mismo.
    await user.click(within(guiaDialog).getByRole("button", { name: "Cerrar" }));

    const etiquetasDialog = await screen.findByRole("dialog", {
      name: "Imprimir etiquetas",
    });
    // "Cerrar" (cancelar) cierra el modal de etiquetas y corta el flujo.
    await user.click(within(etiquetasDialog).getByRole("button", { name: "Cerrar" }));

    await vi.waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Imprimir etiquetas" }),
      ).not.toBeInTheDocument(),
    );
    // No se reabrió ningún modal (no re-encadenó).
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
