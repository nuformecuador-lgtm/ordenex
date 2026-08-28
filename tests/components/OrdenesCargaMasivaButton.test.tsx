// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrdenesCargaMasivaButton } from "@/app/(app)/ordenes/_components/OrdenesCargaMasivaButton";
import type { OrdenesCargaUploadProps } from "@/app/(app)/ordenes/_components/OrdenesCargaUpload";
import type { OrdenesCargaPreviewProps } from "@/app/(app)/ordenes/_components/OrdenesCargaPreview";
import type { FilaParseada } from "@/app/(app)/ordenes/_components/carga-masiva-parser";
import type { OrdenMontoAjustado } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
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

// Tercer paso (R12): el resumen del lote en solo lectura. Se dobla para no
// arrastrar su Server Action; lo que verifica este archivo es el CABLEADO (que se
// monte y con qué `numRemisiones`), no su render.
interface ResumenDobleProps {
  numRemisiones: string[];
  /** Feature 304: las creadas con el monto redondeado que el paso 3 debe recibir. */
  ajustadas?: { fila: number | null; numRemision: string; original: number; aplicado: number }[];
}
const resumen = vi.hoisted(() => ({ props: null as ResumenDobleProps | null }));
vi.mock("@/app/(app)/ordenes/_components/OrdenesCargaResumen", () => ({
  OrdenesCargaResumen: (props: ResumenDobleProps) => {
    resumen.props = props;
    return <div data-testid="resumen-double" />;
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
  resumen.props = null;
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
  ajustadas?: OrdenMontoAjustado[];
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
        // Feature 304: las creadas con el monto redondeado. Vacías salvo que el caso las pida.
        ajustadas: payload.ajustadas ?? [],
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

  it("R15: el indicador anuncia 3 pasos y ninguno es de asignación de mensajero", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();

    const pasos = screen.getByRole("list", { name: /progreso de la carga masiva/i });
    const etiquetas = within(pasos)
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(etiquetas).toHaveLength(3);
    expect(etiquetas[2]).toContain("Resultado");
    // R13/R15: ni el indicador ni el subtítulo del modal prometen asignar mensajero.
    expect(etiquetas.some((e) => /mensajero|asign/i.test(e))).toBe(false);
    expect(screen.queryByText(/mensajero/i)).not.toBeInTheDocument();
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
  it("confirma → procesarEnChunks(dryRun:false), mutate, toast y resumen del lote", async () => {
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

    // R12: tras la carga real el modal NO cierra — muestra el resumen de las
    // órdenes creadas. El toast es un conteo, no el resumen.
    expect(await screen.findByTestId("resumen-double")).toBeInTheDocument();
    expect(resumen.props?.numRemisiones).toEqual(["REM-A"]);
    // R13: el paso es solo lectura — no recibe ningún callback de confirmación.
    expect(resumen.props).not.toHaveProperty("onDone");
  });

  it("feature 304: el aviso de monto redondeado de la carga REAL llega al paso 'resultado'", async () => {
    // El cableado de punta a punta con la clasificación de PRODUCCIÓN (solo se dobla el
    // transporte de chunks): el `montoAjustado` que emite el backend (feature 299) sale del
    // resultado de la carga real y tiene que llegar al paso que la tienda ve al final, que es
    // el único donde se pinta la columna «Monto».
    const user = userEvent.setup();
    procesarEnChunksMock.mockResolvedValue([
      {
        fila: 1,
        numRemision: "REM-A",
        resultado: "creada",
        montoAjustado: { original: 11898.81, aplicado: 11899 },
      },
      { fila: 2, numRemision: "REM-B", resultado: "creada" },
    ] satisfies RowResult[]);

    render(<OrdenesCargaMasivaButton />);
    await openModal();
    validar({
      numRemisionesNuevas: ["REM-A", "REM-B"],
      filasUnicas: [fila("REM-A", 1), fila("REM-B", 2)],
    });

    await user.click(screen.getByRole("button", { name: "confirmar-double" }));
    expect(await screen.findByTestId("resumen-double")).toBeInTheDocument();

    // Las dos se crearon (el ajuste NO saca a la fila de las creadas)...
    expect(resumen.props?.numRemisiones).toEqual(["REM-A", "REM-B"]);
    // ...y solo la ajustada llega con sus dos montos.
    expect(resumen.props?.ajustadas).toEqual([
      { fila: 1, numRemision: "REM-A", original: 11898.81, aplicado: 11899 },
    ]);
  });

  it("feature 304: sin ajustes, el paso 'resultado' recibe la lista vacía (nada que decir)", async () => {
    const user = userEvent.setup();
    procesarEnChunksMock.mockResolvedValue([
      { fila: 1, numRemision: "REM-A", resultado: "creada" },
    ] satisfies RowResult[]);

    render(<OrdenesCargaMasivaButton />);
    await openModal();
    validar({ numRemisionesNuevas: ["REM-A"], filasUnicas: [fila("REM-A", 1)] });

    await user.click(screen.getByRole("button", { name: "confirmar-double" }));
    expect(await screen.findByTestId("resumen-double")).toBeInTheDocument();
    expect(resumen.props?.ajustadas).toEqual([]);
  });

  it("R20 (feature 143): en el paso 'resultado' no existe ningún botón de descarga de errores", async () => {
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
    expect(await screen.findByTestId("resumen-double")).toBeInTheDocument();

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
    // Sin órdenes nuevas no hay resumen que mostrar: el paso 3 no se monta.
    expect(screen.queryByTestId("resumen-double")).not.toBeInTheDocument();
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
