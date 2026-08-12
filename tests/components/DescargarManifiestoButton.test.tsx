// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DescargarManifiestoButton } from "@/components/shared/DescargarManifiestoButton";
import { obtenerManifiesto } from "@/lib/actions/manifiesto";
import type { ManifiestoFilaDTO } from "@/lib/types/manifiesto";

// Feature 148 (T19) — botón compartido de descarga del manifiesto: R15 (blob en el
// navegador, sin subida), R16 (una sola generación en vuelo), R17 (sin lote no se
// ofrece) y R26 (mensaje accionable ante un fallo).

vi.mock("@/lib/actions/manifiesto", () => ({ obtenerManifiesto: vi.fn() }));
const obtenerManifiestoMock = vi.mocked(obtenerManifiesto);

// El generador se aísla de exceljs (mismo patrón que BulkUpload.test): el binario
// real lo verifica `tests/unit/utils/manifiesto-xlsx.test.ts`.
const { buildManifiestoXlsxMock } = vi.hoisted(() => ({
  buildManifiestoXlsxMock: vi.fn<() => Promise<ArrayBuffer>>(),
}));
vi.mock("@/lib/utils/manifiesto-xlsx", () => ({
  buildManifiestoXlsx: buildManifiestoXlsxMock,
  manifiestoFileName: (flujo: string, fecha: string) =>
    `manifiesto-${flujo}-${fecha}.xlsx`,
}));

const { successMock, errorMock, warningMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  warningMock: vi.fn(),
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

function makeFila(over: Partial<ManifiestoFilaDTO> = {}): ManifiestoFilaDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Ana Pérez",
    telefono: "88880000",
    direccion: "Calle 1",
    zona: "Limón",
    producto: "Camiseta talla M",
    monto: 15000,
    intentos: 0, // feature 160/R28a: dato de la orden, numerico y no nullable
    origen: "Bodega central",
    destino: "Limón",
    responsable: "Beto Mensajero",
    fecha: "2026-07-28",
    ...over,
  };
}

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let anchorClick: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
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
  buildManifiestoXlsxMock.mockResolvedValue(new ArrayBuffer(8));
  obtenerManifiestoMock.mockResolvedValue({
    status: "ok",
    filas: [makeFila()],
    omitidas: [],
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function boton() {
  return screen.getByRole("button", { name: /descargar manifiesto/i });
}

describe("DescargarManifiestoButton", () => {
  it("R15: arma el blob en el navegador y dispara la descarga SIN llamar a ninguna API de subida", async () => {
    const user = userEvent.setup();
    render(
      <DescargarManifiestoButton
        flujo="generacion_guia"
        seleccion={{ ordenIds: ["o1", "o2"] }}
      />,
    );

    await user.click(boton());

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    // La selección viaja tal cual a la acción de LECTURA (design.md §2).
    expect(obtenerManifiestoMock).toHaveBeenCalledWith({
      flujo: "generacion_guia",
      ordenIds: ["o1", "o2"],
    });
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(XLSX_MIME);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    // R15: nada se sube ni se persiste; no hay tráfico de archivos.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("R14: descarga con el nombre manifiesto-<flujo>-<fecha de las filas>.xlsx", async () => {
    const user = userEvent.setup();
    let downloadedName = "";
    anchorClick.mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    });
    obtenerManifiestoMock.mockResolvedValue({
      status: "ok",
      filas: [makeFila({ fecha: "2026-03-04" })],
      omitidas: [],
    });

    render(
      <DescargarManifiestoButton
        flujo="carga_masiva"
        seleccion={{ numRemisiones: ["REM-001"] }}
      />,
    );
    await user.click(boton());

    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(downloadedName).toBe("manifiesto-carga_masiva-2026-03-04.xlsx");
  });

  it("R16: queda deshabilitado mientras genera y un segundo clic no dispara otra generación", async () => {
    const user = userEvent.setup();
    let resolver!: (r: Awaited<ReturnType<typeof obtenerManifiesto>>) => void;
    obtenerManifiestoMock.mockReturnValue(
      new Promise((res) => {
        resolver = res;
      }),
    );

    render(
      <DescargarManifiestoButton
        flujo="ruteo_satelite"
        seleccion={{ ordenIds: ["o1"] }}
      />,
    );
    const button = boton();
    await user.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    await user.click(button); // clic repetido ignorado
    expect(obtenerManifiestoMock).toHaveBeenCalledTimes(1);

    resolver({ status: "ok", filas: [makeFila()], omitidas: [] });
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(buildManifiestoXlsxMock).toHaveBeenCalledTimes(1);
  });

  it("R17: no ofrece la descarga con selección vacía (ni por ids ni por remisiones)", () => {
    const { unmount } = render(
      <DescargarManifiestoButton
        flujo="generacion_guia"
        seleccion={{ ordenIds: [] }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /descargar manifiesto/i }),
    ).toBeNull();
    unmount();

    render(
      <DescargarManifiestoButton
        flujo="carga_masiva"
        seleccion={{ numRemisiones: [] }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /descargar manifiesto/i }),
    ).toBeNull();
    expect(obtenerManifiestoMock).not.toHaveBeenCalled();
  });

  it("R17: si el lote no devuelve ninguna fila NO genera archivo y avisa", async () => {
    const user = userEvent.setup();
    obtenerManifiestoMock.mockResolvedValue({
      status: "ok",
      filas: [],
      omitidas: [{ ref: "o1", motivo: "no_encontrada" }],
    });

    render(
      <DescargarManifiestoButton
        flujo="envio_tienda"
        seleccion={{ ordenIds: ["o1"] }}
      />,
    );
    await user.click(boton());

    await waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    expect(buildManifiestoXlsxMock).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("R26: un fallo de la acción muestra un mensaje accionable y no descarga nada", async () => {
    const user = userEvent.setup();
    obtenerManifiestoMock.mockResolvedValue({ status: "unauthenticated" });

    render(
      <DescargarManifiestoButton
        flujo="asignacion_satelite"
        seleccion={{ ordenIds: ["o1"] }}
      />,
    );
    await user.click(boton());

    await waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    // Accionable: dice QUÉ hacer, no solo que falló.
    expect(errorMock.mock.calls[0][0]).toMatch(/vuelve a iniciar sesión/i);
    expect(createObjectURL).not.toHaveBeenCalled();
    // El botón vuelve a estar disponible: el usuario puede reintentar (R26).
    await waitFor(() => expect(boton()).not.toBeDisabled());
  });

  it("R26: si la generación del binario lanza, se informa y el botón se rehabilita", async () => {
    const user = userEvent.setup();
    buildManifiestoXlsxMock.mockRejectedValue(new Error("exceljs caído"));

    render(
      <DescargarManifiestoButton
        flujo="devolucion_central"
        seleccion={{ ordenIds: ["o1"] }}
      />,
    );
    await user.click(boton());

    await waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    expect(errorMock.mock.calls[0][0]).toMatch(/vuelve a intentarlo/i);
    expect(createObjectURL).not.toHaveBeenCalled();
    await waitFor(() => expect(boton()).not.toBeDisabled());
  });

  it("R12: descarga igual e informa cuántas órdenes quedaron fuera del manifiesto", async () => {
    const user = userEvent.setup();
    obtenerManifiestoMock.mockResolvedValue({
      status: "ok",
      filas: [makeFila()],
      omitidas: [{ ref: "o2", motivo: "no_encontrada" }],
    });

    render(
      <DescargarManifiestoButton
        flujo="generacion_guia"
        seleccion={{ ordenIds: ["o1", "o2"] }}
      />,
    );
    await user.click(boton());

    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("el texto del botón es parametrizable por prop (preparado para i18n)", () => {
    render(
      <DescargarManifiestoButton
        flujo="generacion_guia"
        seleccion={{ ordenIds: ["o1"] }}
        label="Descargar manifiesto del lote"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Descargar manifiesto del lote" }),
    ).toBeInTheDocument();
  });
});
