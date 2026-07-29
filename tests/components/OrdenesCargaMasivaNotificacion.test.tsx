// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrdenesCargaMasivaButton } from "@/app/(app)/ordenes/_components/OrdenesCargaMasivaButton";
import type { OrdenesCargaUploadProps } from "@/app/(app)/ordenes/_components/OrdenesCargaUpload";
import type { OrdenesCargaPreviewProps } from "@/app/(app)/ordenes/_components/OrdenesCargaPreview";
import type { FilaParseada } from "@/app/(app)/ordenes/_components/carga-masiva-parser";
import type { RowResult } from "@/lib/types/carga-masiva";

// ---------------------------------------------------------------------------
// Feature 146 · C4 (R39) — cierre de la carga masiva POR INTERFAZ. El servidor no
// sabe cuál es el último chunk (lo trocea el cliente), así que el cliente avisa con
// la Server Action, una sola vez, y sólo en la carga real.
// ---------------------------------------------------------------------------

const { notificarMock } = vi.hoisted(() => ({ notificarMock: vi.fn() }));
vi.mock("@/lib/actions/notificaciones", () => ({
  notificarCargaMasivaTerminada: notificarMock,
}));

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

vi.mock("@/app/(app)/ordenes/_components/OrdenesCargaPreview", () => ({
  OrdenesCargaPreview: (props: OrdenesCargaPreviewProps) => (
    <button type="button" onClick={() => props.onConfirmar()}>
      confirmar-double
    </button>
  ),
}));

const { procesarEnChunksMock } = vi.hoisted(() => ({ procesarEnChunksMock: vi.fn() }));
vi.mock("@/app/(app)/ordenes/_components/carga-masiva-chunks", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/app/(app)/ordenes/_components/carga-masiva-chunks")
  >();
  return { ...actual, procesarEnChunks: procesarEnChunksMock };
});

// Se espía la generación del loteId conservando la implementación real: permite
// comprobar que se genera UNA vez por carga (al validar), no una por reintento.
const { nuevoLoteIdSpy } = vi.hoisted(() => ({ nuevoLoteIdSpy: vi.fn() }));
vi.mock("@/app/(app)/ordenes/_components/lote-id", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/app/(app)/ordenes/_components/lote-id")
  >();
  nuevoLoteIdSpy.mockImplementation(actual.nuevoLoteId);
  return { ...actual, nuevoLoteId: nuevoLoteIdSpy };
});

vi.mock("swr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("swr")>();
  return { ...actual, useSWRConfig: () => ({ mutate: vi.fn() }) };
});

// ---------------------------------------------------------------------------

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const fila = (numRemision: string, linea: number): FilaParseada => ({
  row: { num_remision: numRemision },
  linea,
});

beforeEach(() => {
  vi.clearAllMocks();
  upload.props = null;
  notificarMock.mockResolvedValue({ status: "ok" });
});

afterEach(() => cleanup());

async function abrirModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /carga masiva/i }));
  return screen.findByRole("dialog");
}

function validar(filasUnicas: FilaParseada[], nuevas: string[]) {
  act(() => {
    upload.props?.onValidated({
      clasificacion: { numRemisionesNuevas: nuevas, existentes: [], errores: [] },
      filasUnicas,
    });
  });
}

describe("lote-id — identidad del lote de la carga por interfaz (R39)", () => {
  it("R39: genera un uuid v4 válido para el backend (z.uuid)", async () => {
    const { nuevoLoteId } = await import(
      "@/app/(app)/ordenes/_components/lote-id"
    );
    expect(nuevoLoteId()).toMatch(UUID_V4);
  });

  it("R39: dos lotes distintos no comparten identificador", async () => {
    const { nuevoLoteId } = await import(
      "@/app/(app)/ordenes/_components/lote-id"
    );
    expect(nuevoLoteId()).not.toBe(nuevoLoteId());
  });
});

describe("OrdenesCargaMasivaButton — aviso de carga terminada (R39)", () => {
  it("R39: al terminar la carga real invoca la acción UNA sola vez con creadas, total y loteId", async () => {
    const user = userEvent.setup();
    procesarEnChunksMock.mockResolvedValue([
      { fila: 1, numRemision: "REM-A", resultado: "creada" },
      { fila: 2, numRemision: "REM-B", resultado: "creada" },
    ] satisfies RowResult[]);

    render(<OrdenesCargaMasivaButton />);
    await abrirModal(user);
    validar([fila("REM-A", 1), fila("REM-B", 2), fila("REM-C", 3)], [
      "REM-A",
      "REM-B",
    ]);

    await user.click(screen.getByRole("button", { name: "confirmar-double" }));

    await waitFor(() => expect(notificarMock).toHaveBeenCalledTimes(1));
    const [payload] = notificarMock.mock.calls[0];
    expect(payload.creadas).toBe(2);
    expect(payload.total).toBe(3);
    expect(payload.loteId).toMatch(UUID_V4);
  });

  it("R39: la validación en dry-run NO avisa (nada persistido todavía)", async () => {
    const user = userEvent.setup();
    render(<OrdenesCargaMasivaButton />);
    await abrirModal(user);

    validar([fila("REM-A", 1)], ["REM-A"]);

    expect(procesarEnChunksMock).not.toHaveBeenCalled();
    expect(notificarMock).not.toHaveBeenCalled();
  });

  it("R39: un reintento de la confirmación reusa el MISMO loteId (idempotencia)", async () => {
    const user = userEvent.setup();
    procesarEnChunksMock.mockRejectedValueOnce(new Error("caída de red"));
    procesarEnChunksMock.mockResolvedValueOnce([
      { fila: 1, numRemision: "REM-A", resultado: "creada" },
    ] satisfies RowResult[]);

    render(<OrdenesCargaMasivaButton />);
    await abrirModal(user);
    validar([fila("REM-A", 1)], ["REM-A"]);

    // Primer intento: falla la carga, no hay aviso.
    await user.click(screen.getByRole("button", { name: "confirmar-double" }));
    await waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    expect(notificarMock).not.toHaveBeenCalled();

    // Segundo intento sobre la MISMA carga: avisa con el loteId original.
    await user.click(screen.getByRole("button", { name: "confirmar-double" }));
    await waitFor(() => expect(notificarMock).toHaveBeenCalledTimes(1));
    expect(notificarMock.mock.calls[0][0].loteId).toMatch(UUID_V4);

    // El loteId se generó UNA sola vez, al iniciar la carga: el reintento no
    // acuñó uno nuevo, así que el servidor puede deduplicar por (evento, lote).
    expect(nuevoLoteIdSpy).toHaveBeenCalledTimes(1);
  });

  it("R39: cada carga nueva estrena su propio loteId", async () => {
    const user = userEvent.setup();
    render(<OrdenesCargaMasivaButton />);
    await abrirModal(user);

    validar([fila("REM-A", 1)], ["REM-A"]);
    const primero = nuevoLoteIdSpy.mock.results[0].value as string;

    // Cerrar y volver a validar = otra carga distinta.
    await user.click(
      screen.getAllByRole("button", { name: /cerrar/i }).at(-1) as HTMLElement,
    );
    await abrirModal(user);
    validar([fila("REM-B", 1)], ["REM-B"]);

    expect(nuevoLoteIdSpy).toHaveBeenCalledTimes(2);
    expect(nuevoLoteIdSpy.mock.results[1].value).not.toBe(primero);
  });

  it("R39/R25: si la acción de aviso falla, la carga no se ve afectada", async () => {
    const user = userEvent.setup();
    notificarMock.mockRejectedValue(new Error("aviso caído"));
    procesarEnChunksMock.mockResolvedValue([
      { fila: 1, numRemision: "REM-A", resultado: "creada" },
    ] satisfies RowResult[]);

    render(<OrdenesCargaMasivaButton />);
    await abrirModal(user);
    validar([fila("REM-A", 1)], ["REM-A"]);

    await user.click(screen.getByRole("button", { name: "confirmar-double" }));

    await screen.findByRole("button", { name: /carga masiva/i });
    expect(successMock).toHaveBeenCalledTimes(1);
    expect(errorMock).not.toHaveBeenCalled();
  });
});
