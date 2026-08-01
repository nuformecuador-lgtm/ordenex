// @vitest-environment jsdom
// Feature 170 (T A.1) — descarga del apartado de órdenes por estado. Cubre R1, R3, R9 y R10.
//
// El apartado es el caso más barato de todo el rollout: no estrena backend. Su listado ya
// filtra por `estatusId` y `listarOrdenesCompletoSchema` deriva del schema del listado, así
// que la misma Server Action del dataset completo sirve pasándole ese estado. Estos tests
// afirman justo eso: que el archivo trae el apartado ENTERO (no la página) y que lleva el
// estado del apartado como filtro.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { ordenesConfig } from "@/lib/config/ordenes";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows, XLSX_MIME } from "@/lib/utils/xlsx-template";

const listarOrdenesMock = vi.fn();
const listarOrdenesCompletoMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
  listarOrdenesCompleto: (...a: unknown[]) => listarOrdenesCompletoMock(...a),
}));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

// Se aísla SOLO el codificador binario (exceljs): el despachador `construirDescarga` corre
// REAL, así que el MIME y el nombre del archivo son los de producción.
vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { OrdenesApartado } from "@/app/(app)/ordenes/_components/OrdenesApartado";

const TITULO = "En bodega central";
const ESTATUS_ID = "est-en-bodega-central";

function makeOrden(i: number): OrdenListItemDTO {
  return {
    id: `orden-${i}`,
    numGuia: 900 + i,
    numRemision: `REM-${String(i).padStart(3, "0")}`,
    estatusId: ESTATUS_ID,
    estatusValue: "en_bodega_central",
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
    montoCobrar: 500 + i,
    intentosEntrega: 0,
    createdAt: new Date("2026-07-15T20:00:00Z"),
    updatedAt: new Date("2026-07-16T10:00:00Z"),
  } as OrdenListItemDTO;
}

/** Página visible (lo que devuelve `listarOrdenes` con paginación). */
const PAGINA_VISIBLE = [makeOrden(1), makeOrden(2)];
/** Dataset COMPLETO del apartado (lo que devuelve `listarOrdenesCompleto`). */
const DATASET_COMPLETO = Array.from({ length: 6 }, (_, i) => makeOrden(i + 1));

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

function botonDescarga() {
  return screen.getByRole("button", { name: `Descargar ${TITULO}` });
}

beforeEach(() => {
  vi.clearAllMocks();
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items: PAGINA_VISIBLE,
    page: 1,
    pageSize: ordenesConfig.DEFAULT_PAGE_SIZE,
    total: 42,
  });
  listarOrdenesCompletoMock.mockResolvedValue({
    status: "ok",
    items: DATASET_COMPLETO,
    total: DATASET_COMPLETO.length,
  });
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Apartado de órdenes por estado · descarga", () => {
  it("ofrece la descarga del dataset completo del apartado", async () => {
    const user = userEvent.setup();
    envolver(<OrdenesApartado titulo={TITULO} estatusValue="en_bodega_central" estatusId={ESTATUS_ID} />);

    // R1: el control existe y su nombre accesible identifica al apartado.
    await waitFor(() => expect(botonDescarga()).toBeInTheDocument());
    await user.click(botonDescarga());

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    const [, mime, nombreArchivo] = descargarBlobMock.mock.calls[0];
    expect(mime).toBe(XLSX_MIME);
    expect(nombreArchivo).toMatch(/^en-bodega-central-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("el archivo contiene una fila por orden del apartado, no solo la página visible", async () => {
    const user = userEvent.setup();
    envolver(<OrdenesApartado titulo={TITULO} estatusValue="en_bodega_central" estatusId={ESTATUS_ID} />);

    await screen.findByText("Destinatario 1");
    const tabla = screen.getByRole("table", { name: TITULO });
    expect(within(tabla).getAllByRole("row")).toHaveLength(PAGINA_VISIBLE.length + 1);

    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    // R9: las 6 del dataset completo, no las 2 de la página, y en el mismo orden.
    const [columnas, filas, titulo] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(DATASET_COMPLETO.length);
    expect(filas.map((f) => f.numRemision)).toEqual(
      DATASET_COMPLETO.map((o) => o.numRemision),
    );
    expect(columnas.map((c) => c.header)).toContain("Nº Remisión");
    expect(titulo).toBe(TITULO);
  });

  it("envía el estado del apartado como filtro vigente", async () => {
    const user = userEvent.setup();
    envolver(<OrdenesApartado titulo={TITULO} estatusValue="en_bodega_central" estatusId={ESTATUS_ID} />);

    await screen.findByText("Destinatario 1");
    await user.click(botonDescarga());

    // R10: el estado del apartado viaja como filtro, y NADA de paginación: la acción
    // del dataset completo no acepta `page`/`pageSize`.
    await waitFor(() => expect(listarOrdenesCompletoMock).toHaveBeenCalledTimes(1));
    expect(listarOrdenesCompletoMock.mock.calls[0][0]).toEqual({ estatusId: ESTATUS_ID });
  });

  it("el listado paginado sigue comportándose igual", async () => {
    const user = userEvent.setup();
    envolver(<OrdenesApartado titulo={TITULO} estatusValue="en_bodega_central" estatusId={ESTATUS_ID} />);

    // R3: la primera petición del listado es IDÉNTICA a la previa a esta feature.
    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalledTimes(1));
    expect(listarOrdenesMock.mock.calls[0][0]).toEqual({
      page: 1,
      pageSize: ordenesConfig.DEFAULT_PAGE_SIZE,
      estatusId: ESTATUS_ID,
    });

    await user.click(screen.getByRole("button", { name: "Página siguiente" }));

    await waitFor(() => expect(listarOrdenesMock).toHaveBeenCalledTimes(2));
    expect(listarOrdenesMock.mock.calls[1][0]).toEqual({
      page: 2,
      pageSize: ordenesConfig.DEFAULT_PAGE_SIZE,
      estatusId: ESTATUS_ID,
    });
    // Mientras no se descarga, la acción del dataset completo no se llama nunca (R32).
    expect(listarOrdenesCompletoMock).not.toHaveBeenCalled();
    expect(screen.getByRole("table", { name: TITULO })).toBeInTheDocument();
  });

  it("sin estado resuelto no ofrece el control: descargar traería órdenes de otros estados", async () => {
    envolver(<OrdenesApartado titulo={TITULO} estatusValue="en_bodega_central" estatusId={undefined} />);

    // Mientras el catálogo no resuelve el `estatusId`, el apartado no lista nada; ofrecer
    // la descarga ahí enviaría un filtro vacío (R10).
    expect(screen.queryByRole("button", { name: /descargar/i })).toBeNull();
    expect(listarOrdenesCompletoMock).not.toHaveBeenCalled();
  });
});
