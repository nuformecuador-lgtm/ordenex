// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrdenesCargaUpload } from "@/app/(app)/ordenes/_components/OrdenesCargaUpload";
import type { ArchivoParseado } from "@/app/(app)/ordenes/_components/carga-masiva-parser";
import type { RowResult } from "@/lib/types/carga-masiva";

// Se controlan el parseo y la orquestación de chunks; el resto (dedup, combinar,
// clasificar, errores) queda real para ejercitar la lógica del componente.
const { parseArchivoMock, procesarEnChunksMock } = vi.hoisted(() => ({
  parseArchivoMock: vi.fn(),
  procesarEnChunksMock: vi.fn(),
}));

vi.mock("@/app/(app)/ordenes/_components/carga-masiva-parser", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/app/(app)/ordenes/_components/carga-masiva-parser")
  >();
  return { ...actual, parseArchivo: parseArchivoMock };
});

vi.mock("@/app/(app)/ordenes/_components/carga-masiva-chunks", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/app/(app)/ordenes/_components/carga-masiva-chunks")
  >();
  return { ...actual, procesarEnChunks: procesarEnChunksMock };
});

const HEADERS_OK = ["num_remision", "destinatario", "telefono", "provincia", "canton"];

function archivo(numRemisiones: string[], headers = HEADERS_OK): ArchivoParseado {
  return {
    headers,
    filas: numRemisiones.map((num, i) => ({ row: { num_remision: num }, linea: i + 1 })),
  };
}

function csvFile(name = "carga.csv"): File {
  return new File(["num_remision\nREM-1"], name, { type: "text/csv" });
}

const fileInput = () => screen.getByLabelText(/archivo de órdenes/i);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe("OrdenesCargaUpload — validación automática", () => {
  it("al cargar un archivo válido valida solo y emite onValidated", async () => {
    const user = userEvent.setup();
    parseArchivoMock.mockResolvedValue(archivo(["REM-1", "REM-2"]));
    procesarEnChunksMock.mockResolvedValue([
      { fila: 1, numRemision: "REM-1", resultado: "creada" },
      { fila: 2, numRemision: "REM-2", resultado: "creada" },
    ] satisfies RowResult[]);
    const onValidated = vi.fn();

    render(<OrdenesCargaUpload onValidated={onValidated} />);
    await user.upload(fileInput(), csvFile());

    await waitFor(() => expect(onValidated).toHaveBeenCalledTimes(1));
    expect(procesarEnChunksMock).toHaveBeenCalledTimes(1);
    const [, opts] = procesarEnChunksMock.mock.calls[0];
    expect(opts.dryRun).toBe(true);
    expect(onValidated.mock.calls[0][0].clasificacion.numRemisionesNuevas).toEqual([
      "REM-1",
      "REM-2",
    ]);
  });

  it("muestra un loader mientras verifica", async () => {
    const user = userEvent.setup();
    parseArchivoMock.mockResolvedValue(archivo(["REM-1"]));
    let resolver: (v: RowResult[]) => void = () => {};
    procesarEnChunksMock.mockReturnValue(
      new Promise<RowResult[]>((res) => {
        resolver = res;
      }),
    );

    render(<OrdenesCargaUpload onValidated={vi.fn()} />);
    await user.upload(fileInput(), csvFile());

    expect(await screen.findByRole("status")).toHaveTextContent(/validando/i);
    resolver([{ fila: 1, numRemision: "REM-1", resultado: "creada" }]);
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });
});

describe("OrdenesCargaUpload — quitar archivo", () => {
  it("ofrece 'Quitar archivo' tras cargar y limpia el estado", async () => {
    const user = userEvent.setup();
    parseArchivoMock.mockResolvedValue(archivo(["REM-1"]));
    procesarEnChunksMock.mockResolvedValue([
      { fila: 1, numRemision: "REM-1", resultado: "creada" },
    ]);

    render(<OrdenesCargaUpload onValidated={vi.fn()} />);
    await user.upload(fileInput(), csvFile("mi-archivo.csv"));

    expect(await screen.findByText("mi-archivo.csv")).toBeInTheDocument();
    const quitar = screen.getByRole("button", { name: /quitar archivo/i });
    await user.click(quitar);

    expect(screen.queryByText("mi-archivo.csv")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /quitar archivo/i }),
    ).not.toBeInTheDocument();
  });
});

describe("OrdenesCargaUpload — validaciones de borde", () => {
  it("extensión no soportada → alerta, sin parsear ni validar", async () => {
    const onValidated = vi.fn();

    render(<OrdenesCargaUpload onValidated={onValidated} />);
    // fireEvent.change inyecta el archivo directo (userEvent.upload filtra por el
    // atributo accept), para ejercitar el guard de extensión en JS.
    fireEvent.change(fileInput(), {
      target: { files: [new File(["x"], "carga.txt", { type: "text/plain" })] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/tipo no permitido/i);
    expect(parseArchivoMock).not.toHaveBeenCalled();
    expect(onValidated).not.toHaveBeenCalled();
  });

  it("faltan columnas obligatorias → alerta, sin emitir onValidated", async () => {
    const user = userEvent.setup();
    parseArchivoMock.mockResolvedValue(archivo(["REM-1"], ["num_remision", "destinatario"]));
    const onValidated = vi.fn();

    render(<OrdenesCargaUpload onValidated={onValidated} />);
    await user.upload(fileInput(), csvFile());

    expect(await screen.findByRole("alert")).toHaveTextContent(/faltan columnas/i);
    expect(procesarEnChunksMock).not.toHaveBeenCalled();
    expect(onValidated).not.toHaveBeenCalled();
  });

  it("supera el tope de filas → alerta con el máximo, sin validar", async () => {
    const user = userEvent.setup();
    // 50.001 filas simuladas (sin construir el archivo real).
    const muchas = Array.from({ length: 50_001 }, (_, i) => ({
      row: { num_remision: `REM-${i}` },
      linea: i + 1,
    }));
    parseArchivoMock.mockResolvedValue({ headers: HEADERS_OK, filas: muchas });
    const onValidated = vi.fn();

    render(<OrdenesCargaUpload onValidated={onValidated} />);
    await user.upload(fileInput(), csvFile());

    expect(await screen.findByRole("alert")).toHaveTextContent(/máximo permitido/i);
    expect(procesarEnChunksMock).not.toHaveBeenCalled();
    expect(onValidated).not.toHaveBeenCalled();
  });
});
