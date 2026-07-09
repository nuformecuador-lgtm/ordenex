// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import {
  BulkUpload,
  type BulkUploadProps,
  type TemplateField,
} from "@/components/shared/BulkUpload";

const fields: TemplateField[] = [
  { key: "num_remision", label: "Nº Remisión", example: "R-001" },
  { key: "telefono", example: "0999999999" },
];

/** Renderiza el componente con props por defecto sobreescribibles. */
function renderBulkUpload(props: Partial<BulkUploadProps> = {}) {
  const merged: BulkUploadProps = {
    endpoint: "/api/ordenes/carga-masiva",
    accept: ["csv"],
    fields,
    ...props,
  };
  return render(<BulkUpload {...merged} />);
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BulkUpload — configuración y accesibilidad (R1, R3, R17)", () => {
  it("R3/R17: expone input con label asociada, botones con nombre accesible y accept derivado de props", () => {
    renderBulkUpload({ accept: ["csv", "xlsx"] });

    const input = screen.getByLabelText("Archivo a cargar");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ".csv,.xlsx");

    expect(
      screen.getByRole("button", { name: "Descargar plantilla" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cargar archivo" }),
    ).toBeInTheDocument();
  });

  it("R1: acepta una lista no vacía de fields y habilita la descarga de plantilla", () => {
    renderBulkUpload();
    expect(
      screen.getByRole("button", { name: "Descargar plantilla" }),
    ).not.toBeDisabled();
  });
});

describe("BulkUpload — descarga de plantilla (R4, R8, R20)", () => {
  it("R4/R8: al descargar crea un Blob y dispara la descarga con el nombre por defecto, sin llamar al endpoint", () => {
    renderBulkUpload({ templateFileName: undefined });

    fireEvent.click(screen.getByRole("button", { name: "Descargar plantilla" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("R4: usa templateFileName como nombre del archivo descargado cuando se provee", () => {
    let downloadedName = "";
    anchorClick.mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    });

    renderBulkUpload({ templateFileName: "ordenes.csv" });
    fireEvent.click(screen.getByRole("button", { name: "Descargar plantilla" }));

    expect(downloadedName).toBe("ordenes.csv");
  });

  it("R20: deshabilita 'Descargar plantilla' cuando fields está vacío", () => {
    renderBulkUpload({ fields: [] });
    expect(
      screen.getByRole("button", { name: "Descargar plantilla" }),
    ).toBeDisabled();
  });
});

describe("BulkUpload — selección y validación (R9, R10, R11, R19, R21, R22, R23)", () => {
  it("R9: al seleccionar un archivo válido muestra su nombre", () => {
    renderBulkUpload();
    selectFile(csvFile("remisiones.csv"));
    expect(screen.getByText("remisiones.csv")).toBeInTheDocument();
  });

  it("R10: rechaza extensión no permitida con role=alert y mantiene la subida deshabilitada", () => {
    renderBulkUpload({ accept: ["csv"] });

    selectFile(new File(["x"], "datos.pdf", { type: "application/pdf" }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar archivo" })).toBeDisabled();
    expect(screen.queryByText("datos.pdf")).not.toBeInTheDocument();
  });

  it("R11: 'Cargar archivo' está deshabilitado mientras no haya archivo válido", () => {
    renderBulkUpload();
    expect(screen.getByRole("button", { name: "Cargar archivo" })).toBeDisabled();
  });

  it("R19: sin endpoint, 'Cargar archivo' sigue deshabilitado aun con archivo válido", () => {
    renderBulkUpload({ endpoint: undefined });
    selectFile(csvFile());
    expect(screen.getByText("datos.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar archivo" })).toBeDisabled();
  });

  it("R21: rechaza MIME contradictorio aunque la extensión sea válida", () => {
    renderBulkUpload({ accept: ["csv"] });

    selectFile(csvFile("datos.csv", "application/pdf"));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar archivo" })).toBeDisabled();
  });

  it("R22: MIME vacío no rechaza; manda la extensión y el archivo queda habilitable", () => {
    renderBulkUpload({ accept: ["csv"] });

    selectFile(csvFile("datos.csv", ""));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("datos.csv")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cargar archivo" }),
    ).not.toBeDisabled();
  });

  it("R23: con maxSizeBytes, rechaza el archivo que lo excede con role=alert y no habilita la subida", () => {
    renderBulkUpload({ maxSizeBytes: 10 });

    selectFile(csvFile("grande.csv", "text/csv", "x".repeat(20)));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar archivo" })).toBeDisabled();
  });

  it("R23: sin maxSizeBytes, no valida tamaño y el archivo grande queda habilitable", () => {
    renderBulkUpload({ maxSizeBytes: undefined });

    selectFile(csvFile("grande.csv", "text/csv", "x".repeat(20)));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cargar archivo" }),
    ).not.toBeDisabled();
  });
});

describe("BulkUpload — subida multipart (R2, R12, R13, R14, R15, R16, R18)", () => {
  function mockFetchResolved(value: {
    ok: boolean;
    status: number;
    data?: unknown;
  }) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: value.ok,
      status: value.status,
      json: () => Promise.resolve(value.data),
    });
  }

  it("R2/R12: envía POST multipart al endpoint con el archivo bajo el fieldName por defecto", async () => {
    mockFetchResolved({ ok: true, status: 200, data: {} });
    renderBulkUpload({ endpoint: "/api/carga" });

    selectFile(csvFile("datos.csv"));
    fireEvent.click(screen.getByRole("button", { name: "Cargar archivo" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("/api/carga");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const sent = (init.body as FormData).get("file");
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe("datos.csv");
    // No se fija Content-Type manual (lo pone el navegador con el boundary).
    expect(init.headers).toBeUndefined();
  });

  it("R12: usa el fieldName custom en el FormData", async () => {
    mockFetchResolved({ ok: true, status: 200, data: {} });
    renderBulkUpload({ fieldName: "archivo" });

    selectFile(csvFile());
    fireEvent.click(screen.getByRole("button", { name: "Cargar archivo" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect((init.body as FormData).get("archivo")).toBeInstanceOf(File);
  });

  it("R13: mientras la petición está en curso muestra role=status y deshabilita ambos botones", async () => {
    let resolveFetch!: (v: unknown) => void;
    (fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((res) => {
        resolveFetch = res;
      }),
    );
    renderBulkUpload();

    selectFile(csvFile());
    fireEvent.click(screen.getByRole("button", { name: "Cargar archivo" }));

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar archivo" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Descargar plantilla" }),
    ).toBeDisabled();

    resolveFetch({ ok: true, status: 200, json: () => Promise.resolve({}) });
    await waitFor(() =>
      expect(screen.queryByText("Cargando…")).not.toBeInTheDocument(),
    );
  });

  it("R14/R18: en éxito muestra role=status e invoca onSuccess con status y data", async () => {
    mockFetchResolved({ ok: true, status: 200, data: { inserted: 3 } });
    const onSuccess = vi.fn();
    renderBulkUpload({ onSuccess });

    selectFile(csvFile());
    fireEvent.click(screen.getByRole("button", { name: "Cargar archivo" }));

    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({
        status: 200,
        data: { inserted: 3 },
      }),
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R15/R18: en error HTTP muestra role=alert e invoca onError con el status", async () => {
    mockFetchResolved({ ok: false, status: 422 });
    const onError = vi.fn();
    renderBulkUpload({ onError });

    selectFile(csvFile());
    fireEvent.click(screen.getByRole("button", { name: "Cargar archivo" }));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ status: 422 }),
      ),
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("R15: en fallo de red muestra role=alert e invoca onError sin status, sin propagar excepción", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("boom"),
    );
    const onError = vi.fn();
    renderBulkUpload({ onError });

    selectFile(csvFile());
    fireEvent.click(screen.getByRole("button", { name: "Cargar archivo" }));

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    const arg = onError.mock.calls[0][0];
    expect(arg.status).toBeUndefined();
    expect(arg.message).toContain("boom");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("R16: tras un error, seleccionar otro archivo válido limpia el alert y rehabilita la subida", async () => {
    mockFetchResolved({ ok: false, status: 500 });
    renderBulkUpload();

    selectFile(csvFile("primero.csv"));
    fireEvent.click(screen.getByRole("button", { name: "Cargar archivo" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    selectFile(csvFile("segundo.csv"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("segundo.csv")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cargar archivo" }),
    ).not.toBeDisabled();
  });
});
