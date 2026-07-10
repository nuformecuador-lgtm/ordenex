// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrdenesCargaMasivaButton } from "@/app/(app)/ordenes/_components/OrdenesCargaMasivaButton";
import type { BulkUploadProps } from "@/components/shared/BulkUpload";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

const bulk = vi.hoisted(() => ({
  props: null as BulkUploadProps | null,
}));

vi.mock("@/components/shared/BulkUpload", () => ({
  BulkUpload: (props: BulkUploadProps) => {
    bulk.props = props;
    return <div data-testid="bulk-upload-double" />;
  },
}));

const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));

vi.mock("swr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("swr")>();
  return {
    ...actual,
    useSWRConfig: () => ({ mutate: mutateMock }),
  };
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  bulk.props = null;
});

afterEach(() => {
  cleanup();
});

const openButton = () =>
  screen.getByRole("button", { name: /carga masiva/i });

async function openModal() {
  const user = userEvent.setup();
  await user.click(openButton());
  return screen.findByRole("dialog");
}

/** Props reales capturadas del doble de `BulkUpload` (no-null tras abrir el modal). */
function bulkProps(): BulkUploadProps {
  if (!bulk.props) throw new Error("BulkUpload aún no fue montado");
  return bulk.props;
}

const EXPECTED_FIELD_KEYS = [
  "num_remision",
  "destinatario",
  "telefono",
  "provincia",
  "canton",
  "distrito",
  "direccion",
  "producto",
  "notas",
  "monto_cobrar",
  "mensajero_sugerido_id",
];

// ---------------------------------------------------------------------------
// R1, R2 — Disparador (botón)
// ---------------------------------------------------------------------------
describe("OrdenesCargaMasivaButton — disparador (R1, R2)", () => {
  it("R1: renderiza el botón 'Carga masiva'", () => {
    render(<OrdenesCargaMasivaButton />);
    expect(openButton()).toBeInTheDocument();
  });

  it("R2: el botón es type=button", () => {
    render(<OrdenesCargaMasivaButton />);
    expect(openButton()).toHaveAttribute("type", "button");
  });
});

// ---------------------------------------------------------------------------
// R3, R4, R5 — Apertura del modal
// ---------------------------------------------------------------------------
describe("OrdenesCargaMasivaButton — apertura del modal (R3, R4, R5)", () => {
  it("R3: al hacer clic aparece el dialog", async () => {
    render(<OrdenesCargaMasivaButton />);
    const dialog = await openModal();
    expect(dialog).toBeInTheDocument();
  });

  it("R4: el modal muestra el título 'Carga masiva de órdenes'", async () => {
    render(<OrdenesCargaMasivaButton />);
    const dialog = await openModal();
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toBe(
      "Carga masiva de órdenes",
    );
  });

  it("R5: el cuerpo del modal contiene BulkUpload", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();
    expect(screen.getByTestId("bulk-upload-double")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// R6, R7, R18 — Modal como contenedor puro, cierre y accesibilidad delegada
// ---------------------------------------------------------------------------
describe("OrdenesCargaMasivaButton — contenedor puro y cierre (R6, R7, R18)", () => {
  it("R6: el pie tiene un único botón 'Cerrar' y no 'Confirmar'", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();
    expect(screen.getByRole("button", { name: /cerrar/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /confirmar/i }),
    ).not.toBeInTheDocument();
  });

  it("R7a: clic en 'Cerrar' cierra el modal", async () => {
    const user = userEvent.setup();
    render(<OrdenesCargaMasivaButton />);
    await openModal();

    await user.click(screen.getByRole("button", { name: /cerrar/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("R7b: Escape cierra el modal", async () => {
    const user = userEvent.setup();
    render(<OrdenesCargaMasivaButton />);
    await openModal();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("R18: el dialog abierto expone aria-modal", async () => {
    render(<OrdenesCargaMasivaButton />);
    const dialog = await openModal();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});

// ---------------------------------------------------------------------------
// R8-R12 — Props pasadas a BulkUpload
// ---------------------------------------------------------------------------
describe("OrdenesCargaMasivaButton — props de BulkUpload (R8-R12)", () => {
  it("R8: endpoint = /api/ordenes/carga-masiva", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();
    expect(bulkProps().endpoint).toBe("/api/ordenes/carga-masiva");
  });

  it("R9: accept = ['csv','xlsx']", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();
    expect(bulkProps().accept).toEqual(["csv", "xlsx"]);
  });

  it("R10: fieldName = 'file'", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();
    expect(bulkProps().fieldName).toBe("file");
  });

  it("R11: fields tiene las 11 keys en orden", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();
    expect(bulkProps().fields.map((f: { key: string }) => f.key)).toEqual(
      EXPECTED_FIELD_KEYS,
    );
  });

  it("R12: templateFileName = 'plantilla-ordenes-carga-masiva.csv'", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();
    expect(bulkProps().templateFileName).toBe(
      "plantilla-ordenes-carga-masiva.csv",
    );
  });
});

// ---------------------------------------------------------------------------
// R13-R15, R17 — onSuccess: refresh + toast, sin cerrar el modal
// ---------------------------------------------------------------------------
describe("OrdenesCargaMasivaButton — onSuccess (R13, R14, R15, R17)", () => {
  it("R13: onSuccess llama a mutate con matcher de 'ordenes:list'", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();

    act(() => {
      bulkProps().onSuccess?.({
        status: 200,
        data: { total: 3, creadas: 2, duplicadas: 1, conError: 0, filas: [] },
      });
    });

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const matcher = mutateMock.mock.calls[0][0];
    expect(matcher(["ordenes:list", 1, 10])).toBe(true);
    expect(matcher(["otra:key"])).toBe(false);
  });

  it("R14: onSuccess conError=0 → toast.success con conteos", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();

    act(() => {
      bulkProps().onSuccess?.({
        status: 200,
        data: { total: 3, creadas: 2, duplicadas: 1, conError: 0, filas: [] },
      });
    });

    expect(successMock).toHaveBeenCalledTimes(1);
    const message = successMock.mock.calls[0][0] as string;
    expect(message).toContain("2");
    expect(message).toContain("1");
    expect(message).toContain("0");
    expect(warningMock).not.toHaveBeenCalled();
  });

  it("R15a: onSuccess conError>0 → toast.warning", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();

    act(() => {
      bulkProps().onSuccess?.({
        status: 200,
        data: { total: 3, creadas: 1, duplicadas: 0, conError: 2, filas: [] },
      });
    });

    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(successMock).not.toHaveBeenCalled();
  });

  it("R15b: onSuccess con data no parseable → toast.warning", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();

    act(() => {
      bulkProps().onSuccess?.({ status: 200, data: undefined });
    });

    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(successMock).not.toHaveBeenCalled();
  });

  it("R17: onSuccess NO cierra el modal", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();

    act(() => {
      bulkProps().onSuccess?.({
        status: 200,
        data: { total: 3, creadas: 2, duplicadas: 1, conError: 0, filas: [] },
      });
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// R16 — onError: toast de error, sin refresh
// ---------------------------------------------------------------------------
describe("OrdenesCargaMasivaButton — onError (R16)", () => {
  it("R16: onError → toast.error con message, sin mutate", async () => {
    render(<OrdenesCargaMasivaButton />);
    await openModal();

    act(() => {
      bulkProps().onError?.({ message: "boom" });
    });

    expect(errorMock).toHaveBeenCalledTimes(1);
    const message = errorMock.mock.calls[0][0] as string;
    expect(message).toContain("boom");
    expect(mutateMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sin llamadas reales al endpoint (composición pura, sin fetch)
// ---------------------------------------------------------------------------
describe("OrdenesCargaMasivaButton — sin llamadas reales al backend", () => {
  it("no invoca fetch global", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<OrdenesCargaMasivaButton />);
    await openModal();

    act(() => {
      bulkProps().onSuccess?.({
        status: 200,
        data: { total: 1, creadas: 1, duplicadas: 0, conError: 0, filas: [] },
      });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
