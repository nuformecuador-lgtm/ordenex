// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrdenesCargaMasivaButton } from "@/app/(app)/ordenes/_components/OrdenesCargaMasivaButton";
import type { OrdenesCargaUploadProps } from "@/app/(app)/ordenes/_components/OrdenesCargaUpload";
import type { OrdenesCargaPreviewProps } from "@/app/(app)/ordenes/_components/OrdenesCargaPreview";
import type { FilaParseada } from "@/app/(app)/ordenes/_components/carga-masiva-parser";
import type { RowResult } from "@/lib/types/carga-masiva";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { successMock, errorMock, warningMock, infoMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  warningMock: vi.fn(),
  infoMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: warningMock,
    info: infoMock,
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const upload = vi.hoisted(() => ({ props: null as OrdenesCargaUploadProps | null }));
vi.mock("@/app/(app)/ordenes/_components/OrdenesCargaUpload", () => ({
  OrdenesCargaUpload: (props: OrdenesCargaUploadProps) => {
    upload.props = props;
    return <div data-testid="upload-double" />;
  },
}));

const preview = vi.hoisted(() => ({ props: null as OrdenesCargaPreviewProps | null }));
vi.mock("@/app/(app)/ordenes/_components/OrdenesCargaPreview", () => ({
  OrdenesCargaPreview: (props: OrdenesCargaPreviewProps) => {
    preview.props = props;
    return (
      <div data-testid="preview-double">
        <button type="button" onClick={() => props.onConfirmar()}>
          confirmar-double
        </button>
      </div>
    );
  },
}));

const asignacion = vi.hoisted(() => ({ props: null as { numRemisiones: string[] } | null }));
vi.mock("@/app/(app)/ordenes/_components/OrdenesCargaResumen", () => ({
  OrdenesCargaResumen: (props: { numRemisiones: string[] }) => {
    asignacion.props = props;
    return <div data-testid="asignacion-double" />;
  },
}));

// Orquestación de chunks: se espía `procesarEnChunks`; el resto (combinar, error)
// se conserva del módulo real para que la clasificación sea la de producción.
const { procesarEnChunksMock } = vi.hoisted(() => ({ procesarEnChunksMock: vi.fn() }));
vi.mock("@/app/(app)/ordenes/_components/carga-masiva-chunks", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/app/(app)/ordenes/_components/carga-masiva-chunks")
  >();
  return { ...actual, procesarEnChunks: procesarEnChunksMock };
});

const { listarMensajerosMock } = vi.hoisted(() => ({ listarMensajerosMock: vi.fn() }));
vi.mock("@/lib/actions/mensajeros", () => ({ listarMensajeros: listarMensajerosMock }));

const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));
vi.mock("swr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("swr")>();
  return { ...actual, useSWRConfig: () => ({ mutate: mutateMock }) };
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  upload.props = null;
  preview.props = null;
  asignacion.props = null;
  listarMensajerosMock.mockResolvedValue({ status: "ok", mensajeros: [] });
});

afterEach(() => cleanup());

function footerCerrarButton(): HTMLElement {
  const botones = screen.getAllByRole("button", { name: /cerrar/i });
  const footer = botones.find((b) => b.textContent?.trim() === "Cerrar");
  if (!footer) throw new Error("No se encontró el botón 'Cerrar' del pie");
  return footer;
}

const openButton = () => screen.getByRole("button", { name: /carga masiva/i });

async function openModal() {
  const user = userEvent.setup();
  await user.click(openButton());
  return screen.findByRole("dialog");
}

const fila = (numRemision: string, linea: number): FilaParseada => ({
  row: { num_remision: numRemision },
  linea,
});

function validar(payload: {
  numRemisionesNuevas?: string[];
  existentes?: { numRemision: string; estatus: string | null }[];
  errores?: RowResult[];
  filasUnicas?: FilaParseada[];
}) {
  act(() => {
    upload.props?.onValidated({
      clasificacion: {
        numRemisionesNuevas: payload.numRemisionesNuevas ?? [],
        existentes: payload.existentes ?? [],
        errores:
          (payload.errores as unknown as {
            fila: number | null;
            numRemision: string;
            errores: Record<string, string[]>;
          }[]) ?? [],
      },
      filasUnicas: payload.filasUnicas ?? [fila("REM-A", 1)],
    });
  });
}

// ---------------------------------------------------------------------------
// Estructura básica
// ---------------------------------------------------------------------------
describe("OrdenesCargaMasivaButton — estructura", () => {
  it("renderiza el botón 'Carga masiva' type=button", () => {
    render(<OrdenesCargaMasivaButton />);
    expect(openButton()).toHaveAttribute("type", "button");
  });

  it("al abrir muestra el modal con el paso de subida", async () => {
    render(<OrdenesCargaMasivaButton />);
    const dialog = await openModal();
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId("upload-double")).toBeInTheDocument();
  });

  it("Escape cierra el modal", async () => {
    const user = userEvent.setup();
    render(<OrdenesCargaMasivaButton />);
    await openModal();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Fase 1 — validación (dry-run por chunks, en el hijo de subida)
// ---------------------------------------------------------------------------
describe("OrdenesCargaMasivaButton — validación", () => {
  it("onValidated → avanza al preview con la clasificación e informa por toast", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();

    validar({
      numRemisionesNuevas: ["REM-A", "REM-B"],
      existentes: [{ numRemision: "REM-C", estatus: "en_bodega_central" }],
    });

    expect(screen.getByTestId("preview-double")).toBeInTheDocument();
    expect(screen.queryByTestId("upload-double")).not.toBeInTheDocument();
    expect(preview.props?.clasificacion.numRemisionesNuevas).toEqual(["REM-A", "REM-B"]);
    // Feature 143: las filas CRUDAS llegan al preview para poder exportarlas.
    expect(preview.props?.filas).toEqual([fila("REM-A", 1)]);
    expect(infoMock).toHaveBeenCalledTimes(1);
    // Validar NO persiste: sin mutate ni carga real.
    expect(mutateMock).not.toHaveBeenCalled();
    expect(procesarEnChunksMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fase 2 — confirmar (carga real por chunks)
// ---------------------------------------------------------------------------
describe("OrdenesCargaMasivaButton — confirmar carga real", () => {
  it("confirma → procesarEnChunks(dryRun:false), mutate, toast y asignación", async () => {
    const user = userEvent.setup();
    procesarEnChunksMock.mockResolvedValue([
      { fila: 1, numRemision: "REM-A", resultado: "creada" },
    ] satisfies RowResult[]);

    render(<OrdenesCargaMasivaButton />);
    await openModal();
    validar({ numRemisionesNuevas: ["REM-A"], filasUnicas: [fila("REM-A", 1)] });

    await user.click(screen.getByRole("button", { name: "confirmar-double" }));

    expect(procesarEnChunksMock).toHaveBeenCalledTimes(1);
    const [, opts] = procesarEnChunksMock.mock.calls[0];
    expect(opts.dryRun).toBe(false);

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(successMock).toHaveBeenCalledTimes(1);

    expect(await screen.findByTestId("asignacion-double")).toBeInTheDocument();
    expect(asignacion.props?.numRemisiones).toEqual(["REM-A"]);
  });

  it("R20 (feature 143): en el paso 'asignacion' no existe ningún botón de descarga de errores", async () => {
    // Decisión de gate G-1: la descarga vive SOLO en la vista previa. Tras la
    // carga real el modal no ofrece exportar nada.
    const user = userEvent.setup();
    procesarEnChunksMock.mockResolvedValue([
      { fila: 1, numRemision: "REM-A", resultado: "creada" },
      { fila: 2, numRemision: "REM-B", resultado: "error", errores: { telefono: ["x"] } },
    ] satisfies RowResult[]);

    render(<OrdenesCargaMasivaButton />);
    await openModal();
    validar({
      numRemisionesNuevas: ["REM-A"],
      filasUnicas: [fila("REM-A", 1), fila("REM-B", 2)],
    });

    await user.click(screen.getByRole("button", { name: "confirmar-double" }));
    expect(await screen.findByTestId("asignacion-double")).toBeInTheDocument();

    // Aunque la carga real dejó una fila con error, el paso no ofrece descarga.
    expect(
      screen.queryByRole("button", { name: /descargar filas con error/i }),
    ).toBeNull();
    expect(screen.queryByTestId("preview-double")).not.toBeInTheDocument();
  });

  it("si la carga real no crea nada → cierra el modal", async () => {
    const user = userEvent.setup();
    procesarEnChunksMock.mockResolvedValue([
      { fila: 1, numRemision: "REM-A", resultado: "duplicada", estatus: "x" },
    ] satisfies RowResult[]);

    render(<OrdenesCargaMasivaButton />);
    await openModal();
    validar({ filasUnicas: [fila("REM-A", 1)] });

    await user.click(screen.getByRole("button", { name: "confirmar-double" }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    await screen.findByRole("button", { name: /carga masiva/i });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("error en la carga → toast.error y permanece en el preview", async () => {
    const user = userEvent.setup();
    procesarEnChunksMock.mockRejectedValue(new Error("boom"));

    render(<OrdenesCargaMasivaButton />);
    await openModal();
    validar({ numRemisionesNuevas: ["REM-A"], filasUnicas: [fila("REM-A", 1)] });

    await user.click(screen.getByRole("button", { name: "confirmar-double" }));

    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("preview-double")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Reset — al cerrar, el siguiente open vuelve a 'upload'
// ---------------------------------------------------------------------------
describe("OrdenesCargaMasivaButton — reset del flujo", () => {
  it("al cerrar tras el preview, el siguiente open vuelve a 'upload'", async () => {
    const user = userEvent.setup();
    render(<OrdenesCargaMasivaButton />);
    await openModal();
    validar({ numRemisionesNuevas: ["REM-A"] });
    expect(screen.getByTestId("preview-double")).toBeInTheDocument();

    await user.click(footerCerrarButton());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await openModal();
    expect(screen.getByTestId("upload-double")).toBeInTheDocument();
  });
});
