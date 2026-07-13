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
  rutearABodegaSatelite,
} from "@/lib/actions/ordenes-guia";
import { generarEtiquetas } from "@/lib/actions/etiquetas-guia";
import { obtenerHistorialOrden } from "@/lib/actions/orden-historial";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { EstatusLiteDTO, MensajeroLiteDTO } from "@/lib/types/orden-guia";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

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
  rutearABodegaSatelite: vi.fn(),
}));

// Feature 32: el orquestador monta ahora `EtiquetasGuiaModal`, que consume la
// action de lectura y arma un PDF. Se mockean la action, el helper de PDF (no
// testeable en jsdom) y los stubs de QR/barcode (canvas no soportado).
vi.mock("@/lib/actions/etiquetas-guia", () => ({
  generarEtiquetas: vi.fn(),
}));

// Feature 49 (R27/R29): los apartados montan `HistorialOrdenSheet` ("Ver historial"),
// que importa esta Server Action de forma perezosa al abrir el drawer. Se mockea para
// que el import dinámico no arrastre `next/headers`/prisma en jsdom.
vi.mock("@/lib/actions/orden-historial", () => ({
  obtenerHistorialOrden: vi.fn(),
}));
vi.mock("@/app/(app)/ordenes/_components/etiquetas-pdf", () => ({
  descargarEtiquetasPdf: vi.fn(),
}));
vi.mock("qrcode.react", () => ({
  QRCodeCanvas: () => <canvas data-testid="qr-stub" />,
}));
vi.mock("react-barcode", () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="barcode-stub" data-value={value} />
  ),
}));

const listarOrdenesMock = vi.mocked(listarOrdenes);
const listarCatalogoEstatusMock = vi.mocked(listarCatalogoEstatus);
const listarMensajerosMock = vi.mocked(listarMensajerosParaAsignacion);
const generarGuiaMock = vi.mocked(generarGuia);
const asignarDesdeBodegaMock = vi.mocked(asignarDesdeBodega);
const rutearABodegaSateliteMock = vi.mocked(rutearABodegaSatelite);
const generarEtiquetasMock = vi.mocked(generarEtiquetas);
const obtenerHistorialMock = vi.mocked(obtenerHistorialOrden);

const HISTORIAL_ENTRADA: OrdenHistorialEntradaDTO = {
  estatusOrigenValue: "en_reparto",
  estatusDestinoValue: "en_bodega",
  origenTipo: "liberacion_reprogramada",
  actorNombre: null,
  motivo: null,
  createdAt: new Date("2026-01-03T08:00:00Z"),
};

const ESTATUS: EstatusLiteDTO[] = [
  { id: "id-fulfillment", value: "en_fulfillment" },
  { id: "id-preparacion", value: "en_preparacion" },
  { id: "id-espera", value: "en_espera_aceptacion" },
  { id: "id-bodega", value: "en_bodega" },
  { id: "id-satelite", value: "en_ruta_bodega_satelite" },
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
  "id-satelite": [
    makeOrden({ id: "os1", numRemision: "REM-S1", estatusId: "id-satelite" }),
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
  generarEtiquetasMock.mockResolvedValue({
    status: "ok",
    etiquetas: [],
    omitidas: [],
  });
  obtenerHistorialMock.mockResolvedValue({
    status: "ok",
    entradas: [HISTORIAL_ENTRADA],
  });
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

  it("R12-UI: readOnly (admin) no muestra checkboxes ni botones de ESCRITURA", async () => {
    renderComponent(true);

    await screen.findByText("REM-F1");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Generar guía" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Asignar mensajero" }),
    ).toBeNull();
    // Feature 32/R13/F1.4(f): admin (readOnly) tampoco ve "Imprimir etiquetas".
    expect(
      screen.queryByRole("button", { name: "Imprimir etiquetas" }),
    ).toBeNull();
    // Feature 49 (R27): la acción de solo LECTURA "Ver historial" SÍ está, pese a readOnly.
    expect(
      screen.getAllByRole("button", { name: /Ver historial de la orden/i })
        .length,
    ).toBeGreaterThan(0);
  });

  it("Feature 49/R27: el maestro tiene 'Ver historial' por fila en un apartado y abre el drawer", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("REM-F1");
    const fulfillment = screen.getByRole("region", { name: "En fulfillment" });
    // Un disparador por fila del apartado (2 órdenes en_fulfillment).
    const triggers = within(fulfillment).getAllByRole("button", {
      name: /Ver historial de la orden/i,
    });
    expect(triggers).toHaveLength(2);

    await user.click(
      within(fulfillment).getByRole("button", {
        name: "Ver historial de la orden REM-F1",
      }),
    );

    const dialog = await screen.findByRole("dialog");
    // R29/R30: la línea de tiempo con la etiqueta legible del estado destino.
    expect(await within(dialog).findByText("En bodega")).toBeInTheDocument();
    expect(obtenerHistorialMock).toHaveBeenCalledWith("of1");
  });

  it("Feature 49/R27: el admin (readOnly) también tiene 'Ver historial' por fila y abre el drawer", async () => {
    const user = userEvent.setup();
    renderComponent(true);

    await screen.findByText("REM-B1");
    const bodega = screen.getByRole("region", { name: "En bodega" });
    await user.click(
      within(bodega).getByRole("button", {
        name: "Ver historial de la orden REM-B1",
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("En bodega")).toBeInTheDocument();
    expect(obtenerHistorialMock).toHaveBeenCalledWith("ob1");
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

  it("en_espera_aceptacion: solo ofrece 'Imprimir etiquetas' (la respuesta del mensajero sigue fuera de alcance, feature 36)", async () => {
    renderComponent();

    await screen.findByText("REM-E1");
    const espera = screen.getByRole("region", {
      name: "En espera de aceptación del mensajero",
    });
    // Feature 32/R13/F1.4(f): sus órdenes ya tienen guía → seleccionable para imprimir.
    expect(within(espera).getAllByRole("checkbox")).toHaveLength(1);
    expect(
      within(espera).getByRole("button", { name: "Imprimir etiquetas" }),
    ).toBeInTheDocument();
    // Pero NO las acciones de generación/asignación (no aplican a este estado).
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

  it("R15: monta el 5.º apartado 'En ruta a bodega satélite' (imprimible: sus órdenes ya tienen guía)", async () => {
    renderComponent();

    const satelite = screen.getByRole("region", {
      name: "En ruta a bodega satélite",
    });
    expect(satelite).toBeInTheDocument();
    await within(satelite).findByText("REM-S1");
    // Feature 32/R13/F1.4(f): seleccionable para "Imprimir etiquetas"...
    expect(within(satelite).getAllByRole("checkbox")).toHaveLength(1);
    expect(
      within(satelite).getByRole("button", { name: "Imprimir etiquetas" }),
    ).toBeInTheDocument();
    // ...pero sin acciones de escritura (no se rutea ni se asigna desde aquí).
    expect(
      within(satelite).queryByRole("button", {
        name: "Rutear a bodega satélite",
      }),
    ).toBeNull();
    expect(
      within(satelite).queryByRole("button", { name: "Asignar mensajero" }),
    ).toBeNull();
  });

  it("Feature 32/R11: 'Imprimir etiquetas' de en_bodega abre el modal de etiquetas con la selección", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("REM-B1");
    const bodega = screen.getByRole("region", { name: "En bodega" });
    await user.click(within(bodega).getAllByRole("checkbox")[0]);
    await user.click(
      within(bodega).getByRole("button", { name: "Imprimir etiquetas" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Imprimir etiquetas" }),
    ).toBeInTheDocument();
    // Abre consultando la action de lectura con la selección (no muta nada).
    await vi.waitFor(() =>
      expect(generarEtiquetasMock).toHaveBeenCalledWith({ ordenIds: ["ob1"] }),
    );
    expect(asignarDesdeBodegaMock).not.toHaveBeenCalled();
  });

  it("R13: 'Rutear a bodega satélite' invoca la action con los ordenIds NO-GAM seleccionados", async () => {
    const user = userEvent.setup();
    // En fulfillment: una orden NO-GAM (ruteable) y una GAM (no debe ir al lote).
    listarOrdenesMock.mockImplementation(async (input) => {
      const { estatusId, page, pageSize } = input as {
        estatusId?: string;
        page: number;
        pageSize: number;
      };
      const items =
        estatusId === "id-fulfillment"
          ? [
              makeOrden({
                id: "no-gam-1",
                numRemision: "REM-NOGAM",
                estatusId: "id-fulfillment",
                zonaEsCentral: false,
                zonaNombre: "Limón",
              }),
              makeOrden({
                id: "gam-1",
                numRemision: "REM-GAM",
                estatusId: "id-fulfillment",
                zonaEsCentral: true,
                zonaNombre: "GAM",
              }),
            ]
          : [];
      return { status: "ok", items, page, pageSize, total: items.length };
    });
    rutearABodegaSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "no-gam-1", estado: "en_ruta_bodega_satelite" }],
    });

    renderComponent();

    await screen.findByText("REM-NOGAM");
    const fulfillment = screen.getByRole("region", { name: "En fulfillment" });
    // Selecciona AMBAS órdenes; solo la NO-GAM debe rutearse.
    const checkboxes = within(fulfillment).getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);

    await user.click(
      within(fulfillment).getByRole("button", {
        name: "Rutear a bodega satélite",
      }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Rutear a bodega satélite",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Rutear a bodega satélite" }),
    );

    await vi.waitFor(() =>
      expect(rutearABodegaSateliteMock).toHaveBeenCalledTimes(1),
    );
    expect(rutearABodegaSateliteMock).toHaveBeenCalledWith({
      ordenIds: ["no-gam-1"],
    });
  });
});
