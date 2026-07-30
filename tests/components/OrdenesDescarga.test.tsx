// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { ordenesConfig } from "@/lib/config/ordenes";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows, XLSX_MIME } from "@/lib/utils/xlsx-template";
import type { OrdenesFilterUI } from "@/app/(app)/ordenes/_components/serializar-filtro";

// Feature 151 (T11/T12) — cableado del PRIMER consumidor: el listado de órdenes.
// R33 (ofrece la descarga), R34 (dataset completo, no la página visible), R36
// (filtros vigentes), R37 (nombre del archivo), R20 (error de tope) y R24 (opt-in),
// más R38 (el listado paginado sigue igual cuando no se descarga).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const listarOrdenesMock = vi.fn();
const listarOrdenesCompletoMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
  listarOrdenesCompleto: (...a: unknown[]) => listarOrdenesCompletoMock(...a),
}));

const listarOrderStatusMock = vi.fn();
vi.mock("@/lib/actions/order-status", () => ({
  listarOrderStatus: (...a: unknown[]) => listarOrderStatusMock(...a),
}));

// El side effect de entrega se mockea y se verifica: el anchor de descarga ya lo
// cubren las features 143/148 y `DescargarDataset.test.tsx`.
vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

// Se aísla SOLO el codificador binario (exceljs): el despachador
// `construirDescarga` corre REAL, así que el tipo, el MIME y el nombre del archivo
// que se afirman aquí son los de producción. Las filas que llegan al generador son
// las que produjo el cableado, que es justo lo que estos tests juzgan.
vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

const { errorMock } = vi.hoisted(() => ({ errorMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { OrdenesModule } from "@/app/(app)/ordenes/_components/OrdenesModule";
import { OrdenesListado } from "@/app/(app)/ordenes/_components/OrdenesListado";

const CATALOGO_ESTADOS = [
  { id: "est-entregada", value: "entregada" },
  { id: "est-en-bodega", value: "en_bodega_central" },
];

const CATALOGO_FILTROS: CatalogoFiltrosOrdenesDTO = {
  zonas: [{ id: "z1", nombre: "GAM" }],
  tiendas: [{ id: "t1", nombre: "Tienda Uno", esApiKey: false, activa: true }],
  provincias: [{ id: "p1", nombre: "San José" }],
  cantones: [{ id: "c1", nombre: "Escazú", padreId: "p1" }],
  distritos: [{ id: "d1", nombre: "San Rafael", padreId: "c1" }],
};

function makeOrden(i: number): OrdenListItemDTO {
  return {
    id: `orden-${i}`,
    numGuia: 1000 + i,
    numRemision: `REM-${String(i).padStart(3, "0")}`,
    estatusId: "est-entregada",
    estatusValue: "entregada",
    destinatario: `Destinatario ${i}`,
    telefonoDest: "0999999999",
    tiendaId: "t1",
    tiendaNombre: "Tienda Uno",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: "d1",
    producto: `Producto ${i}`,
    peso: 1.5,
    notas: null,
    direccion: `Calle ${i}`,
    montoCobrar: 1000 + i,
    intentosEntrega: 0,
    createdAt: new Date("2026-07-15T20:00:00Z"),
    updatedAt: new Date("2026-07-16T10:00:00Z"),
  } as OrdenListItemDTO;
}

/** Página visible del listado paginado (lo que devuelve `listarOrdenes`). */
const PAGINA_VISIBLE = [makeOrden(1), makeOrden(2)];
/** Dataset COMPLETO (lo que devuelve `listarOrdenesCompleto`): más que una página. */
const DATASET_COMPLETO = Array.from({ length: 7 }, (_, i) => makeOrden(i + 1));

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

function botonDescarga() {
  return screen.getByRole("button", { name: "Descargar Órdenes" });
}

/** Fecha local de hoy en `YYYY-MM-DD`, misma convención que el nombre de archivo. */
function hoyISO(): string {
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items: PAGINA_VISIBLE,
    page: 1,
    pageSize: ordenesConfig.DEFAULT_PAGE_SIZE,
    total: 100,
  });
  listarOrdenesCompletoMock.mockResolvedValue({
    status: "ok",
    items: DATASET_COMPLETO,
    total: DATASET_COMPLETO.length,
  });
  listarOrderStatusMock.mockResolvedValue({
    status: "ok",
    estatus: CATALOGO_ESTADOS,
  });
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Listado de órdenes · descarga del dataset completo", () => {
  it("el listado de órdenes ofrece la descarga del dataset completo", async () => {
    const user = userEvent.setup();
    envolver(<OrdenesListado catalogoFiltros={CATALOGO_FILTROS} />);

    // R33: el control existe en la superficie real del listado (/ordenes), sin que
    // la página tenga que declarar nada.
    await waitFor(() => expect(botonDescarga()).toBeInTheDocument());
    await user.click(botonDescarga());

    // La ÚNICA vía al dato es la Server Action del dataset completo.
    await waitFor(() => expect(listarOrdenesCompletoMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    const [, mime] = descargarBlobMock.mock.calls[0];
    expect(mime).toBe(XLSX_MIME);
  });

  it("el archivo contiene una fila por orden del dataset completo, no solo la página visible", async () => {
    const user = userEvent.setup();
    envolver(<OrdenesModule permitirDescarga />);

    // La tabla muestra la PÁGINA (2 filas + cabecera); el dataset tiene 7 órdenes.
    await screen.findByText("Destinatario 1");
    const tabla = screen.getByRole("table", { name: "Órdenes" });
    expect(within(tabla).getAllByRole("row")).toHaveLength(
      PAGINA_VISIBLE.length + 1,
    );

    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    // R34: una fila por orden del dataset completo (7), no las 2 visibles.
    const [columnas, filas, titulo] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(DATASET_COMPLETO.length);
    expect(filas.map((f) => f.numRemision)).toEqual(
      DATASET_COMPLETO.map((o) => o.numRemision),
    );
    // R35 (refuerzo): las celdas son crudas y salen de las columnas de export.
    expect(columnas.map((c) => c.header)).toContain("Nº Remisión");
    expect(filas[0].destinatario).toBe("Destinatario 1");
    expect(titulo).toBe("Órdenes");
  });

  it("la descarga envía los filtros vigentes en el momento de descargar", async () => {
    const user = userEvent.setup();
    const filtroInicial: OrdenesFilterUI = { status_id: ["est-entregada"] };
    const { rerender } = envolver(
      <OrdenesModule permitirDescarga filter={filtroInicial} />,
    );

    await screen.findByText("Destinatario 1");
    await user.click(botonDescarga());
    await waitFor(() => expect(listarOrdenesCompletoMock).toHaveBeenCalledTimes(1));
    // La action recibe el filtro, y NADA de paginación: es el dataset completo.
    expect(listarOrdenesCompletoMock.mock.calls[0][0]).toEqual({
      filter: filtroInicial,
    });

    // Cambian los filtros del listado: la SIGUIENTE descarga debe reflejarlos.
    const filtroNuevo: OrdenesFilterUI = {
      zona_id: ["z1"],
      created_preset: "ultimos_30",
    };
    rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ToastProvider>
          <OrdenesModule permitirDescarga filter={filtroNuevo} />
        </ToastProvider>
      </SWRConfig>,
    );
    await user.click(botonDescarga());

    // R36: se envían los filtros VIGENTES, no los del render anterior.
    await waitFor(() => expect(listarOrdenesCompletoMock).toHaveBeenCalledTimes(2));
    expect(listarOrdenesCompletoMock.mock.calls[1][0]).toEqual({
      filter: filtroNuevo,
    });
  });

  it("el nombre del archivo identifica el listado y la fecha", async () => {
    const user = userEvent.setup();
    envolver(<OrdenesModule permitirDescarga />);

    await screen.findByText("Destinatario 1");
    await user.click(botonDescarga());

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    // R37: `ordenes-YYYY-MM-DD.xlsx` — el listado y el día de la descarga.
    const [, , nombreArchivo] = descargarBlobMock.mock.calls[0];
    expect(nombreArchivo).toBe(`ordenes-${hoyISO()}.xlsx`);
  });

  it("muestra el error de tope, con total y límite, y no descarga archivo", async () => {
    const user = userEvent.setup();
    listarOrdenesCompletoMock.mockResolvedValue({
      status: "limite_excedido",
      total: 12480,
      limite: 5000,
    });
    envolver(<OrdenesModule permitirDescarga />);

    await screen.findByText("Destinatario 1");
    await user.click(botonDescarga());

    await waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    // R20: total encontrado, tope vigente y la instrucción de acotar los filtros.
    const mensaje = String(errorMock.mock.calls[0][0]);
    expect(mensaje).toContain("12480");
    expect(mensaje).toContain("5000");
    expect(mensaje).toMatch(/acota los filtros/i);
    // Sin archivo: ni generación ni entrega.
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("un consumidor sin permitirDescarga no muestra el control", async () => {
    envolver(<OrdenesModule />);

    await screen.findByText("Destinatario 1");
    // R24: el módulo es opt-in; el resto de superficies (p. ej. el dashboard del
    // adminTienda) no cambian y la tabla se comporta igual que antes.
    expect(screen.queryByRole("button", { name: /descargar/i })).toBeNull();
    expect(screen.getByRole("table", { name: "Órdenes" })).toBeInTheDocument();
  });

  it("el listado paginado sigue pidiendo página y tamaño de página como antes cuando no se descarga", async () => {
    const user = userEvent.setup();
    envolver(<OrdenesModule permitirDescarga />);

    // R38: la primera petición del listado es IDÉNTICA a la previa a esta feature.
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalledTimes(1));
    expect(listarOrdenesMock.mock.calls[0][0]).toEqual({
      page: 1,
      pageSize: ordenesConfig.DEFAULT_PAGE_SIZE,
    });

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));

    // Misma paginación: la página avanza y se vuelve a pedir con page/pageSize.
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalledTimes(2));
    expect(listarOrdenesMock.mock.calls[1][0]).toEqual({
      page: 2,
      pageSize: ordenesConfig.DEFAULT_PAGE_SIZE,
    });
    // Mientras no se descarga, la action del dataset completo no se llama nunca.
    expect(listarOrdenesCompletoMock).not.toHaveBeenCalled();
    expect(screen.getByRole("table", { name: "Órdenes" })).toBeInTheDocument();
  });
});
