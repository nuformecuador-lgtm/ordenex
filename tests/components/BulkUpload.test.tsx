// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import {
  BulkUpload,
  type BulkUploadProps,
  type TemplateField,
} from "@/components/shared/BulkUpload";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Mock del generador XLSX: el componente lo carga con import dinámico (R6b). Se
// aísla de exceljs para observar el flujo de descarga de forma determinista.
const { buildXlsxTemplateMock } = vi.hoisted(() => ({
  buildXlsxTemplateMock: vi.fn<(fields: TemplateField[]) => Promise<ArrayBuffer>>(),
}));
// Mock PARCIAL: `XLSX_MIME` se conserva del módulo real, porque la feature 143 lo
// promovió a constante exportada y BulkUpload la importa de forma estática.
vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxTemplate: buildXlsxTemplateMock };
});

const fields: TemplateField[] = [
  { key: "num_remision", label: "Nº Remisión", example: "R-001" },
  { key: "telefono", example: "0999999999" },
];

/** Renderiza el componente con props por defecto sobreescribibles. */
function renderBulkUpload(props: Partial<BulkUploadProps> = {}) {
  const merged: BulkUploadProps = {
    accept: ["csv"],
    fields,
    onFileSelected: vi.fn(),
    ...props,
  };
  return { ...render(<BulkUpload {...merged} />), props: merged };
}

/** Dispara la selección de un archivo en el input, sin filtrado por `accept`. */
function selectFile(file: File) {
  const input = screen.getByLabelText("Archivo a cargar");
  fireEvent.change(input, { target: { files: [file] } });
}

function csvFile(
  name = "datos.csv",
  type = "text/csv",
  content = "a,b\n1,2",
): File {
  return new File([content], name, { type });
}

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let anchorClick: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  createObjectURL = vi.fn(() => "blob:mock-url");
  revokeObjectURL = vi.fn();
  // jsdom no implementa estos métodos: se stubbean para observar la descarga.
  Object.defineProperty(URL, "createObjectURL", {
    value: createObjectURL,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: revokeObjectURL,
    configurable: true,
  });
  anchorClick = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn());
  buildXlsxTemplateMock.mockReset();
  buildXlsxTemplateMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BulkUpload — configuración y accesibilidad (R1, R3, R17)", () => {
  it("R3/R17: expone input con label asociada, botón de plantilla con nombre accesible y accept derivado de props", () => {
    renderBulkUpload({ accept: ["csv", "xlsx"] });

    const input = screen.getByLabelText("Archivo a cargar");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ".csv,.xlsx");

    expect(
      screen.getByRole("button", { name: "Descargar plantilla" }),
    ).toBeInTheDocument();
  });

  it("R17: el label es parametrizable por prop y nombra al input (preparado para i18n)", () => {
    renderBulkUpload({ label: "Archivo de órdenes" });
    expect(screen.getByLabelText("Archivo de órdenes")).toHaveAttribute(
      "type",
      "file",
    );
  });

  it("el input de archivo real sigue en el árbol y enfocable: la zona punteada no lo sustituye", () => {
    renderBulkUpload();
    const input = screen.getByLabelText("Archivo a cargar");
    // No se usa `hidden`/`display:none` (que lo sacarían del orden de tabulación
    // y del árbol de accesibilidad): la zona es solo presentación.
    expect(input).not.toBeDisabled();
    input.focus();
    expect(input).toHaveFocus();
  });

  it("R1: acepta una lista no vacía de fields y habilita la descarga de plantilla", () => {
    renderBulkUpload();
    expect(
      screen.getByRole("button", { name: "Descargar plantilla" }),
    ).not.toBeDisabled();
  });
});

describe("BulkUpload — descarga de plantilla XLSX (R6, R8, R9, R10, R11)", () => {
  it("R8: al descargar genera el XLSX, crea un Blob con MIME XLSX y dispara la descarga sin llamar a la red", async () => {
    renderBulkUpload({ templateFileName: undefined });

    fireEvent.click(screen.getByRole("button", { name: "Descargar plantilla" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    // R6b: el generador (import dinámico de exceljs) se invoca con los fields.
    expect(buildXlsxTemplateMock).toHaveBeenCalledWith(fields);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    // R6: MIME XLSX.
    expect(blob.type).toBe(XLSX_MIME);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("R9: usa 'plantilla.xlsx' como nombre por defecto del archivo descargado", async () => {
    let downloadedName = "";
    anchorClick.mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    });

    renderBulkUpload({ templateFileName: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Descargar plantilla" }));

    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(downloadedName).toBe("plantilla.xlsx");
  });

  it("R9: usa templateFileName como nombre del archivo descargado cuando se provee", async () => {
    let downloadedName = "";
    anchorClick.mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    });

    renderBulkUpload({ templateFileName: "ordenes.xlsx" });
    fireEvent.click(screen.getByRole("button", { name: "Descargar plantilla" }));

    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(downloadedName).toBe("ordenes.xlsx");
  });

  it("R10: mientras la generación está pendiente el botón queda deshabilitado y no re-dispara", async () => {
    let resolveGen!: (buffer: ArrayBuffer) => void;
    buildXlsxTemplateMock.mockReturnValue(
      new Promise<ArrayBuffer>((res) => {
        resolveGen = res;
      }),
    );
    renderBulkUpload();

    const button = screen.getByRole("button", { name: "Descargar plantilla" });
    fireEvent.click(button);

    // Durante la promesa pendiente el botón está deshabilitado (R10).
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button); // clic repetido ignorado
    expect(buildXlsxTemplateMock).toHaveBeenCalledTimes(1);

    resolveGen(new ArrayBuffer(8));
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it("R11: deshabilita 'Descargar plantilla' cuando fields está vacío", () => {
    renderBulkUpload({ fields: [] });
    expect(
      screen.getByRole("button", { name: "Descargar plantilla" }),
    ).toBeDisabled();
  });
});

describe("BulkUpload — selección y validación (R9, R10, R21, R22, R23)", () => {
  it("R9: al seleccionar un archivo válido muestra su nombre y lo emite por onFileSelected", () => {
    const onFileSelected = vi.fn();
    renderBulkUpload({ onFileSelected });

    const file = csvFile("remisiones.csv");
    selectFile(file);

    expect(screen.getByText("remisiones.csv")).toBeInTheDocument();
    expect(onFileSelected).toHaveBeenCalledTimes(1);
    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it("R10: rechaza extensión no permitida con role=alert, no emite el archivo y no muestra su nombre", () => {
    const onFileSelected = vi.fn();
    renderBulkUpload({ accept: ["csv"], onFileSelected });

    selectFile(new File(["x"], "datos.pdf", { type: "application/pdf" }));

    // El mensaje debe contener "Tipo no permitido": los consumidores (p. ej. el
    // paso de carga masiva de órdenes) afirman sobre ese texto.
    expect(screen.getByRole("alert")).toHaveTextContent(/tipo no permitido/i);
    expect(onFileSelected).not.toHaveBeenCalled();
    expect(screen.queryByText("datos.pdf")).not.toBeInTheDocument();
  });

  it("R21: rechaza MIME contradictorio aunque la extensión sea válida", () => {
    const onFileSelected = vi.fn();
    renderBulkUpload({ accept: ["csv"], onFileSelected });

    selectFile(csvFile("datos.csv", "application/pdf"));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onFileSelected).not.toHaveBeenCalled();
  });

  it("R22: MIME vacío no rechaza; manda la extensión y el archivo se emite", () => {
    const onFileSelected = vi.fn();
    renderBulkUpload({ accept: ["csv"], onFileSelected });

    selectFile(csvFile("datos.csv", ""));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("datos.csv")).toBeInTheDocument();
    expect(onFileSelected).toHaveBeenCalledTimes(1);
  });

  it("validateMime=false: acepta MIME contradictorio y valida solo por extensión", () => {
    const onFileSelected = vi.fn();
    renderBulkUpload({ accept: ["csv"], validateMime: false, onFileSelected });

    selectFile(csvFile("datos.csv", "application/pdf"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onFileSelected).toHaveBeenCalledTimes(1);
  });

  it("validateMime=false: la extensión sigue siendo autoridad y rechaza el tipo no permitido", () => {
    const onFileSelected = vi.fn();
    renderBulkUpload({ accept: ["csv"], validateMime: false, onFileSelected });

    selectFile(new File(["x"], "datos.pdf", { type: "text/csv" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/tipo no permitido/i);
    expect(onFileSelected).not.toHaveBeenCalled();
  });

  it("R23: con maxSizeBytes, rechaza el archivo que lo excede con role=alert y no lo emite", () => {
    const onFileSelected = vi.fn();
    renderBulkUpload({ maxSizeBytes: 10, onFileSelected });

    selectFile(csvFile("grande.csv", "text/csv", "x".repeat(20)));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onFileSelected).not.toHaveBeenCalled();
  });

  it("R23: sin maxSizeBytes, no valida tamaño y el archivo grande se emite", () => {
    const onFileSelected = vi.fn();
    renderBulkUpload({ maxSizeBytes: undefined, onFileSelected });

    selectFile(csvFile("grande.csv", "text/csv", "x".repeat(20)));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onFileSelected).toHaveBeenCalledTimes(1);
  });

  it("R16: tras un error de selección, elegir un archivo válido limpia el alert y muestra el nombre", () => {
    renderBulkUpload({ accept: ["csv"] });

    selectFile(new File(["x"], "malo.pdf", { type: "application/pdf" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    selectFile(csvFile("bueno.csv"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("bueno.csv")).toBeInTheDocument();
  });
});

describe("BulkUpload — quitar archivo y estado del consumidor", () => {
  it("no ofrece 'Quitar archivo' mientras no hay archivo elegido", () => {
    renderBulkUpload();
    expect(
      screen.queryByRole("button", { name: /quitar archivo/i }),
    ).not.toBeInTheDocument();
  });

  it("al quitar el archivo limpia el nombre e invoca onClear para que el consumidor resetee", () => {
    const onClear = vi.fn();
    renderBulkUpload({ onClear });

    selectFile(csvFile("mi-archivo.csv"));
    expect(screen.getByText("mi-archivo.csv")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /quitar archivo/i }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("mi-archivo.csv")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /quitar archivo/i }),
    ).not.toBeInTheDocument();
  });

  it("busy: deshabilita el input, la plantilla y el quitar mientras el consumidor procesa", () => {
    renderBulkUpload({ busy: true });
    selectFile(csvFile());

    expect(screen.getByLabelText("Archivo a cargar")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Descargar plantilla" }),
    ).toBeDisabled();
  });

  it("muestra el error del consumidor por la prop error", () => {
    renderBulkUpload({ error: "Faltan columnas obligatorias: canton." });
    expect(screen.getByRole("alert")).toHaveTextContent(/faltan columnas/i);
  });

  it("el error local de selección tiene prioridad y nunca se muestran dos alerts a la vez", () => {
    renderBulkUpload({ accept: ["csv"], error: "Error del consumidor" });

    selectFile(new File(["x"], "malo.pdf", { type: "application/pdf" }));

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(/tipo no permitido/i);
  });

  it("renderiza el slot children (estado/progreso del consumidor)", () => {
    renderBulkUpload({ children: <span role="status">Validando archivo…</span> });
    expect(screen.getByRole("status")).toHaveTextContent("Validando archivo…");
  });

  it("hint: renderiza la ayuda provista por el consumidor", () => {
    renderBulkUpload({ hint: "Máximo 50.000 filas." });
    expect(screen.getByText("Máximo 50.000 filas.")).toBeInTheDocument();
  });
});

describe("BulkUpload — arrastrar y soltar", () => {
  /** Construye un evento de drop con la lista de archivos indicada. */
  function dropZone() {
    // La zona es el contenedor punteado que envuelve al input.
    return screen.getByLabelText("Archivo a cargar").parentElement as HTMLElement;
  }

  it("soltar un archivo válido lo valida y lo emite igual que el input", () => {
    const onFileSelected = vi.fn();
    renderBulkUpload({ onFileSelected });

    const file = csvFile("soltado.csv");
    fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } });

    expect(onFileSelected).toHaveBeenCalledWith(file);
    expect(screen.getByText("soltado.csv")).toBeInTheDocument();
  });

  it("soltar un archivo inválido aplica la misma validación y no lo emite", () => {
    const onFileSelected = vi.fn();
    renderBulkUpload({ accept: ["csv"], onFileSelected });

    fireEvent.drop(dropZone(), {
      dataTransfer: { files: [new File(["x"], "malo.pdf", { type: "application/pdf" })] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/tipo no permitido/i);
    expect(onFileSelected).not.toHaveBeenCalled();
  });

  it("busy: soltar un archivo no hace nada", () => {
    const onFileSelected = vi.fn();
    renderBulkUpload({ busy: true, onFileSelected });

    fireEvent.drop(dropZone(), { dataTransfer: { files: [csvFile()] } });

    expect(onFileSelected).not.toHaveBeenCalled();
  });
});
