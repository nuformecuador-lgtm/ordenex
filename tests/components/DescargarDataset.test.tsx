// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DataTable, type DataTableDescarga } from "@/components/shared/DataTable";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { construirDescarga } from "@/lib/utils/descarga-dataset";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";

// Feature 151 (T8) — prop `descarga` del DataTable + control genérico:
// R23 (dataset vacío), R24 (opt-in), R25 (obtener → generar → entregar), R26 (carga y
// sin reentrada), R27 (error accionable), R28 (formatos), R30 (nombre accesible),
// R31 (no toca página/selección/datos) y R32 (sin subida ni almacenamiento).

// El side effect de entrega se mockea y se verifica: aquí se prueba el flujo, no el
// anchor (que ya cubre la feature 148).
vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

// El generador común se aísla de exceljs; su contenido lo verifica
// `tests/unit/utils/descarga-dataset.test.ts`.
vi.mock("@/lib/utils/descarga-dataset", () => ({
  construirDescarga: vi.fn(),
}));
const construirDescargaMock = vi.mocked(construirDescarga);

const { errorMock, warningMock, successMock } = vi.hoisted(() => ({
  errorMock: vi.fn(),
  warningMock: vi.fn(),
  successMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: warningMock,
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface FilaTabla {
  id: string;
  nombre: string;
}

const COLUMNAS_TABLA = [{ id: "nombre", value: "Nombre" }];
const DATOS: FilaTabla[] = [
  { id: "a", nombre: "Ana" },
  { id: "b", nombre: "Beto" },
];

const COLUMNAS_EXPORT: DescargaColumna[] = [
  { clave: "nombre", encabezado: "Nombre" },
  { clave: "monto", encabezado: "Monto" },
];

const FILAS_EXPORT: DescargaFila[] = [
  { nombre: "Ana", monto: 100 },
  { nombre: "Beto", monto: 200 },
  { nombre: "Caro", monto: null },
];

function descargaConfig(
  over: Partial<DataTableDescarga> = {},
): DataTableDescarga {
  return {
    titulo: "Órdenes",
    columnas: COLUMNAS_EXPORT,
    obtenerFilas: vi.fn(async () => ({
      status: "ok" as const,
      filas: FILAS_EXPORT,
    })),
    ...over,
  };
}

function renderTabla(descarga?: DataTableDescarga) {
  return render(
    <DataTable<FilaTabla>
      columns={COLUMNAS_TABLA}
      data={DATOS}
      ariaLabel="Tabla de prueba"
      descarga={descarga}
    />,
  );
}

function boton() {
  return screen.getByRole("button", { name: /descargar órdenes/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  construirDescargaMock.mockResolvedValue({
    contenido: new ArrayBuffer(8),
    mime: XLSX_MIME,
    nombreArchivo: "ordenes-2026-07-29.xlsx",
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DataTable · descarga del dataset completo", () => {
  it("sin la prop descarga la tabla no renderiza control de descarga", () => {
    renderTabla();

    expect(screen.queryByRole("button", { name: /descargar/i })).toBeNull();
    // R24: el resto de la tabla se comporta exactamente igual que antes.
    expect(screen.getByRole("table", { name: "Tabla de prueba" })).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Beto")).toBeInTheDocument();
  });

  it("con la prop descarga renderiza el control con su nombre accesible", () => {
    renderTabla(descargaConfig());

    // R30: el nombre accesible identifica la acción Y el dataset.
    const control = screen.getByRole("button", { name: "Descargar Órdenes" });
    expect(control).toBeInTheDocument();
    expect(control).not.toBeDisabled();
  });

  it("al pulsar llama a obtenerFilas y entrega el archivo generado", async () => {
    const user = userEvent.setup();
    const config = descargaConfig();
    renderTabla(config);

    await user.click(boton());

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    expect(config.obtenerFilas).toHaveBeenCalledTimes(1);
    // R25: lo obtenido viaja tal cual al generador común, con título y columnas.
    expect(construirDescargaMock).toHaveBeenCalledWith({
      tipo: "xlsx",
      titulo: "Órdenes",
      columnas: COLUMNAS_EXPORT,
      filas: FILAS_EXPORT,
    });
    const [contenido, mime, nombreArchivo] = descargarBlobMock.mock.calls[0];
    expect(contenido).toBeInstanceOf(ArrayBuffer);
    expect(mime).toBe(XLSX_MIME);
    expect(nombreArchivo).toBe("ordenes-2026-07-29.xlsx");
  });

  it("mientras la descarga está en curso el control queda deshabilitado y en carga, y un segundo click no dispara una segunda obtención", async () => {
    const user = userEvent.setup();
    let resolver!: (r: { status: "ok"; filas: DescargaFila[] }) => void;
    const obtenerFilas = vi.fn(
      () =>
        new Promise<{ status: "ok"; filas: DescargaFila[] }>((res) => {
          resolver = res;
        }),
    );
    renderTabla(descargaConfig({ obtenerFilas }));

    const control = boton();
    await user.click(control);

    // R26: estado de carga visible y sin admitir una segunda ejecución.
    await waitFor(() => expect(control).toBeDisabled());
    expect(control).toHaveAttribute("aria-busy", "true");
    await user.click(control);
    expect(obtenerFilas).toHaveBeenCalledTimes(1);

    resolver({ status: "ok", filas: FILAS_EXPORT });
    await waitFor(() => expect(control).not.toBeDisabled());
    expect(descargarBlobMock).toHaveBeenCalledTimes(1);
  });

  it("muestra el mensaje accionable y no descarga archivo cuando obtenerFilas devuelve error", async () => {
    const user = userEvent.setup();
    const obtenerFilas = vi.fn(async () => ({
      status: "error" as const,
      mensaje:
        "La descarga supera el máximo de 5000 filas. Acota los filtros y vuelve a intentarlo.",
    }));
    renderTabla(descargaConfig({ obtenerFilas }));

    await user.click(boton());

    await waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    // R27: se muestra el mensaje del consumidor, que dice QUÉ hacer.
    expect(errorMock.mock.calls[0][0]).toMatch(/acota los filtros/i);
    expect(construirDescargaMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
    // El control se rehabilita: el usuario puede reintentar tras acotar.
    await waitFor(() => expect(boton()).not.toBeDisabled());
  });

  it("no descarga archivo y avisa cuando el dataset viene vacío", async () => {
    const user = userEvent.setup();
    const obtenerFilas = vi.fn(async () => ({
      status: "ok" as const,
      filas: [] as DescargaFila[],
    }));
    renderTabla(descargaConfig({ obtenerFilas }));

    await user.click(boton());

    await waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    // R23: informa que no hay datos que descargar y no produce archivo alguno.
    expect(errorMock.mock.calls[0][0]).toMatch(/no hay datos que descargar/i);
    expect(construirDescargaMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("descarga en xlsx sin pedir elección cuando no se declaran formatos", async () => {
    const user = userEvent.setup();
    renderTabla(descargaConfig());

    await user.click(boton());

    // R28: un solo click, sin menú intermedio, y en el formato por defecto.
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    expect(construirDescargaMock.mock.calls[0][0].tipo).toBe("xlsx");
  });

  it("ofrece elegir entre los formatos declarados cuando hay más de uno", async () => {
    const user = userEvent.setup();
    const config = descargaConfig({ formatos: ["xlsx", "csv"] });
    renderTabla(config);

    const control = boton();
    expect(control).toHaveAttribute("aria-haspopup", "menu");
    await user.click(control);

    // R28: el primer click abre la elección; todavía no descarga nada.
    const opciones = screen.getAllByRole("menuitem");
    expect(opciones.map((o) => o.textContent)).toEqual([
      "Excel (.xlsx)",
      "CSV (.csv)",
    ]);
    expect(config.obtenerFilas).not.toHaveBeenCalled();

    await user.click(screen.getByRole("menuitem", { name: /csv/i }));

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    expect(construirDescargaMock.mock.calls[0][0].tipo).toBe("csv");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("la descarga no cambia la página, la selección ni las filas visibles", async () => {
    const user = userEvent.setup();
    // Consumidor con selección y paginación PROPIAS: si la descarga las tocara, se
    // vería aquí. El dataset descargado (3 filas) difiere de la página visible (2).
    function Consumidor() {
      const [pagina, setPagina] = useState(1);
      const [seleccion, setSeleccion] = useState<string[]>([]);
      return (
        <>
          <span data-testid="pagina">{pagina}</span>
          <span data-testid="seleccion">{seleccion.join(",")}</span>
          <button type="button" onClick={() => setPagina((p) => p + 1)}>
            Siguiente página
          </button>
          <DataTable<FilaTabla>
            columns={[
              {
                id: "sel",
                value: "Sel",
                render: (row) => (
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${row.nombre}`}
                    checked={seleccion.includes(row.id)}
                    onChange={() => setSeleccion([row.id])}
                  />
                ),
              },
              ...COLUMNAS_TABLA,
            ]}
            data={DATOS}
            ariaLabel="Tabla de prueba"
            descarga={descargaConfig()}
          />
        </>
      );
    }
    render(<Consumidor />);

    await user.click(screen.getByRole("button", { name: "Siguiente página" }));
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar Beto" }));
    await user.click(boton());
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    // R31: página, selección y filas visibles intactas tras descargar.
    expect(screen.getByTestId("pagina")).toHaveTextContent("2");
    expect(screen.getByTestId("seleccion")).toHaveTextContent("b");
    expect(screen.getByRole("checkbox", { name: "Seleccionar Beto" })).toBeChecked();
    expect(screen.getAllByRole("row")).toHaveLength(DATOS.length + 1); // + cabecera
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.queryByText("Caro")).toBeNull();
  });

  it("el archivo se entrega por el mecanismo de descarga del navegador, sin ninguna subida ni almacenamiento", async () => {
    const user = userEvent.setup();
    const xhrOpen = vi
      .spyOn(XMLHttpRequest.prototype, "open")
      .mockImplementation(() => {});
    renderTabla(descargaConfig());

    await user.click(boton());

    // R32: el único destino del archivo es `descargarBlob` (anchor del navegador).
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    expect(fetch).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    xhrOpen.mockRestore();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
