// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { OrdenesRevisionMaestro } from "@/app/(app)/ordenes/_components/OrdenesRevisionMaestro";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
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

// Feature 139/R9: el apartado "Rechazadas" YA NO ofrece la salida manual "Devolver a
// la tienda" (se retiró; la única salida de `rechazada` es la aprobación del cierre).
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
  estatusDestinoValue: "en_bodega_central",
  origenTipo: "liberacion_reprogramada",
  actorNombre: null,
  motivo: null,
  createdAt: new Date("2026-01-03T08:00:00Z"),
};

const ESTATUS: EstatusLiteDTO[] = [
  { id: "id-fulfillment", value: "en_fulfillment" },
  { id: "id-preparacion", value: "en_preparacion" },
  { id: "id-espera", value: "por_recoger" },
  { id: "id-bodega", value: "en_bodega_central" },
  { id: "id-satelite", value: "en_ruta_bodega_satelite" },
  // Feature 48 (T8): apartados "Rechazadas" y "Devueltas a origen".
  { id: "id-rechazada", value: "rechazada" },
  { id: "id-devuelta-origen", value: "devolviendo_a_tienda" },
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

/** aria-label del checkbox "seleccionar todo" de la cabecera (SelectAllCheckbox). */
const ARIA_SELECCIONAR_TODAS = "Seleccionar todas las órdenes";

/**
 * Checkboxes de FILA de un apartado, excluyendo el de la cabecera.
 *
 * Un apartado seleccionable renderiza N+1 checkboxes: el "seleccionar todo" que
 * `OrdenesApartado` monta como `renderHeader`, mas uno por fila. Sin este filtro
 * `getAllByRole("checkbox")[0]` deja de ser la primera fila y pasa a ser la
 * cabecera, que alterna la seleccion COMPLETA: indexar sobre la lista cruda
 * selecciona todo y luego deselecciona una fila, dejando seleccionada la fila
 * equivocada sin que ninguna asercion de conteo lo delate.
 */
function checkboxesDeFila(scope: HTMLElement): HTMLElement[] {
  return within(scope)
    .getAllByRole("checkbox")
    .filter((c) => c.getAttribute("aria-label") !== ARIA_SELECCIONAR_TODAS);
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
  // Feature 47 (R15): el `ok` incluye ahora el conteo de intentos derivado y el
  // umbral. Con `intentos: 0` no se pinta el badge (R16) → estos tests conservan su
  // comportamiento observable.
  obtenerHistorialMock.mockResolvedValue({
    status: "ok",
    entradas: [HISTORIAL_ENTRADA],
    intentos: 0,
    umbral: 3,
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

  it("R16: muestra los apartados por_recoger y en_bodega_central", async () => {
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
    // Se asevera contra ORDER_STATUS_LABELS y no contra un literal: lo que este
    // caso verifica es que se muestre la etiqueta legible en vez del `value`
    // crudo, no una redacción concreta (que ya cambió una vez y rompió 27 tests).
    expect(
      await within(dialog).findByText(ORDER_STATUS_LABELS.en_bodega_central),
    ).toBeInTheDocument();
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
    expect(
      await within(dialog).findByText(ORDER_STATUS_LABELS.en_bodega_central),
    ).toBeInTheDocument();
    expect(obtenerHistorialMock).toHaveBeenCalledWith("ob1");
  });

  it("R17: permite seleccionar por checkbox varias órdenes de un mismo apartado", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("REM-F1");
    const fulfillment = screen.getByRole("region", { name: "En fulfillment" });
    const checkboxes = checkboxesDeFila(fulfillment);
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
    const checkbox = checkboxesDeFila(fulfillment)[0];
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
    await user.click(checkboxesDeFila(preparacion)[0]);
    await user.click(
      within(preparacion).getByRole("button", { name: "Generar guía" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Generar guía" }),
    ).toBeInTheDocument();
  });

  it("por_recoger: solo ofrece 'Imprimir etiquetas' (la respuesta del mensajero sigue fuera de alcance, feature 36)", async () => {
    renderComponent();

    await screen.findByText("REM-E1");
    const espera = screen.getByRole("region", {
      name: "En espera de aceptación del mensajero",
    });
    // Feature 32/R13/F1.4(f): sus órdenes ya tienen guía → seleccionable para imprimir.
    expect(checkboxesDeFila(espera)).toHaveLength(1);
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

  it("R26 (composición): el botón 'Asignar mensajero' de en_bodega_central abre AsignarBodegaModal", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("REM-B1");
    const bodega = screen.getByRole("region", { name: "En bodega" });
    await user.click(checkboxesDeFila(bodega)[0]);
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
    expect(checkboxesDeFila(satelite)).toHaveLength(1);
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

  it("Feature 32/R11: 'Imprimir etiquetas' de en_bodega_central abre el modal de etiquetas con la selección", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("REM-B1");
    const bodega = screen.getByRole("region", { name: "En bodega" });
    await user.click(checkboxesDeFila(bodega)[0]);
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
                zonaEsGam: false,
                zonaNombre: "Limón",
              }),
              makeOrden({
                id: "gam-1",
                numRemision: "REM-GAM",
                estatusId: "id-fulfillment",
                zonaEsGam: true,
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
    const checkboxes = checkboxesDeFila(fulfillment);
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

  // ---------- Feature 48 (T8) — retorno a la tienda de origen ----------

  it("Feature 48/R4/R14: monta los apartados 'Rechazadas' y 'Devueltas a origen'", async () => {
    renderComponent();

    await screen.findByText("REM-F1");
    expect(
      screen.getByRole("region", { name: "Rechazadas" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Devueltas a origen" }),
    ).toBeInTheDocument();
  });

  it("Feature 139/R9: el apartado 'Rechazadas' NO ofrece la salida manual 'Devolver a la tienda'", async () => {
    // La única salida de `rechazada` es ahora la aprobación del cierre (backend); la
    // acción manual se retiró de esta vista (y de OrdenesListado). El apartado sigue
    // listando las órdenes, pero sin acción de escritura ni modal.
    listarOrdenesMock.mockImplementation(async (input) => {
      const { estatusId, page, pageSize } = input as {
        estatusId?: string;
        page: number;
        pageSize: number;
      };
      const items =
        estatusId === "id-rechazada"
          ? [
              makeOrden({
                id: "central-1",
                numRemision: "REM-CENTRAL",
                estatusId: "id-rechazada",
                zonaEsGam: true,
                zonaNombre: "GAM",
              }),
            ]
          : [];
      return { status: "ok", items, page, pageSize, total: items.length };
    });

    renderComponent();

    await screen.findByText("REM-CENTRAL");
    const rechazadas = screen.getByRole("region", { name: "Rechazadas" });
    // Se lista la orden, pero NO hay botón de devolución manual.
    expect(within(rechazadas).getAllByText(/REM-CENTRAL/).length).toBeGreaterThan(0);
    expect(
      within(rechazadas).queryByRole("button", { name: "Devolver a la tienda" }),
    ).toBeNull();
    // Y no se monta ningún diálogo de devolución.
    expect(
      screen.queryByRole("dialog", { name: "Devolver a la tienda" }),
    ).toBeNull();
  });

  it("Feature 48/R14: el apartado 'Devueltas a origen' es de solo lectura (sin acción de escritura)", async () => {
    listarOrdenesMock.mockImplementation(async (input) => {
      const { estatusId, page, pageSize } = input as {
        estatusId?: string;
        page: number;
        pageSize: number;
      };
      const items =
        estatusId === "id-devuelta-origen"
          ? [
              makeOrden({
                id: "dev-1",
                numRemision: "REM-DEVUELTA",
                estatusId: "id-devuelta-origen",
              }),
            ]
          : [];
      return { status: "ok", items, page, pageSize, total: items.length };
    });

    renderComponent();

    const region = await screen.findByRole("region", {
      name: "Devueltas a origen",
    });
    await within(region).findByText("REM-DEVUELTA");
    // Sin botón de acción (no re-transiciona); solo listado + "Ver historial".
    expect(
      within(region).queryByRole("button", { name: "Devolver a la tienda" }),
    ).toBeNull();
  });
});

// Feature 160 (T16/T21, R22/R27) — la revisión del maestro es el 4.º consumidor de
// `ordenesColumns` (vía `OrdenesApartado`) y el SEGUNDO montaje del aviso "Liberadas
// hoy". Ninguno de los dos archivos se toca: heredan la columna y el dato.
describe("OrdenesRevisionMaestro — intentos de entrega (feature 160)", () => {
  it("R22: cada apartado del maestro monta la columna 'Intentos' con su número", async () => {
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
                id: "of1",
                numRemision: "REM-F1",
                estatusId: "id-fulfillment",
                intentosEntrega: 2,
              }),
              makeOrden({
                id: "of2",
                numRemision: "REM-F2",
                estatusId: "id-fulfillment",
                intentosEntrega: 0,
              }),
            ]
          : [];
      return { status: "ok", items, page, pageSize, total: items.length };
    });

    renderComponent();
    await screen.findByText("REM-F1");

    const apartado = screen.getByRole("region", { name: "En fulfillment" });
    expect(
      within(apartado).getAllByRole("columnheader", { name: "Intentos" }).length,
    ).toBeGreaterThan(0);
    const celda = (rem: string) =>
      within(within(apartado).getByRole("row", { name: new RegExp(rem) }))
        .getAllByRole("cell")
        // El apartado prepende su checkbox de selección: la columna de intentos
        // (índice 3 en `ordenesColumns`) queda en el índice 4.
        .at(4);
    expect(celda("REM-F1")).toHaveTextContent(/^2$/);
    expect(celda("REM-F2")).toHaveTextContent(/^0$/);
  });

  it("R27: el aviso 'Liberadas hoy' del maestro muestra el dato etiquetado", async () => {
    render(
      <ToastProvider>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <OrdenesRevisionMaestro
            readOnly
            liberadasHoy={[
              {
                id: "l1",
                numGuia: 5001,
                numRemision: "REM-L1",
                destinatario: "Ana Pérez",
                liberadaReprogramadaAt: new Date("2026-07-13T06:00:00.000Z"),
                intentosEntrega: 3,
              },
              {
                id: "l2",
                numGuia: 5002,
                numRemision: "REM-L2",
                destinatario: "Beto Ruiz",
                liberadaReprogramadaAt: new Date("2026-07-13T06:00:00.000Z"),
                intentosEntrega: 0,
              },
            ]}
          />
        </SWRConfig>
      </ToastProvider>,
    );

    const region = await screen.findByRole("region", {
      name: "Liberadas hoy (reprogramación)",
    });
    const items = within(region).getAllByRole("listitem");
    expect(within(items[0]).getByText("Intentos: 3")).toBeInTheDocument();
    expect(within(items[1]).getByText("Intentos: 0")).toBeInTheDocument();
  });
});
