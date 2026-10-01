// @vitest-environment jsdom
// Ficha 465 (T8) — control «Descargar cobertura». Cubre R1, R3, R4, R16, R17, R18, R19 y R20
// con el control común REAL (`DescargarDatasetButton`): solo se doblan la action, el generador
// del xlsx, la entrega del blob y el toast.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import { nombreArchivoDescarga } from "@/lib/utils/descarga-dataset";
import type { CoberturaDistritoDTO } from "@/lib/types/cobertura";

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

const { errorToastMock, listarMock } = vi.hoisted(() => ({
  errorToastMock: vi.fn(),
  listarMock: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorToastMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("@/lib/actions/cobertura", () => ({
  listarCoberturaDistritos: (...a: unknown[]) => listarMock(...a),
}));

import { DescargarCoberturaButton } from "@/app/(app)/configuracion/tarifas/_components/DescargarCoberturaButton";

const CLAVE_PREFERENCIA = "ordenex:descarga-columnas:tarifas-cobertura";

const ITEM: CoberturaDistritoDTO = {
  provincia: "San José",
  canton: "Escazú",
  distrito: "San Rafael",
  disponible: true,
  cobertura: true,
  motivo: null,
  zonas: ["Central"],
  // GAM y tarifa general DISTINTOS a propósito: si el botón cruzara las dos columnas, el
  // archivo diría «No»/«Sí» y este test lo vería (revisión 465, B1).
  zonaUnica: { nombre: "Central", esCentral: true, tieneTarifaGeneral: false },
  zonaEspecial: null,
};

function boton() {
  return screen.getByRole("button", { name: "Descargar cobertura Cobertura por distrito" });
}

function encabezadosDelArchivo(): string[] {
  const llamada = buildXlsxRowsMock.mock.calls.at(-1);
  expect(llamada).toBeDefined();
  return llamada![0].map((c) => c.header);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  listarMock.mockResolvedValue({ status: "ok", items: [ITEM], total: 1 });
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("465/R1 — control y ayuda", () => {
  it("muestra «Descargar cobertura» y la línea que explica el contenido", () => {
    render(<DescargarCoberturaButton />);
    expect(boton()).toHaveTextContent("Descargar cobertura");
    expect(
      screen.getByText("Descarga un Excel con cada distrito, si llegamos a él y con qué zona."),
    ).toBeInTheDocument();
    // Montar el control no lee nada: la lectura ocurre al pulsar (R4).
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("solo Excel: descarga directa, sin menú de formato", async () => {
    render(<DescargarCoberturaButton />);
    expect(boton()).not.toHaveAttribute("aria-haspopup");
    await userEvent.setup().click(boton());
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("465/R4 + R17 — lee al pulsar y nombra el archivo", () => {
  it("cada clic vuelve a llamar a la action y entrega un .xlsx con el nombre de R17", async () => {
    const user = userEvent.setup();
    render(<DescargarCoberturaButton />);

    await user.click(boton());
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    await user.click(boton());
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(2));

    expect(listarMock).toHaveBeenCalledTimes(2);
    const [, mime, nombre] = descargarBlobMock.mock.calls[0]!;
    expect(mime).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(nombre).toMatch(/^cobertura-por-distrito-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("R17 — la fecha del nombre es el día de Costa Rica, no el del reloj UTC", () => {
    // 2026-10-02T04:30Z = 2026-10-01 22:30 en Costa Rica (UTC−6).
    expect(
      nombreArchivoDescarga("Cobertura por distrito", "xlsx", new Date("2026-10-02T04:30:00Z")),
    ).toBe("cobertura-por-distrito-2026-10-01.xlsx");
  });

  it("emite las filas con los textos de la proyección", async () => {
    render(<DescargarCoberturaButton />);
    await userEvent.setup().click(boton());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    const [, filas] = buildXlsxRowsMock.mock.calls[0]!;
    expect(filas).toEqual([
      {
        provincia: "San José",
        canton: "Escazú",
        distrito: "San Rafael",
        activo: "Sí",
        cobertura: "Sí",
        motivo: null,
        zona: "Central",
        gam: "Sí",
        zona_especial: "Sin definir",
        tarifa_general: "No",
      },
    ]);
  });
});

describe("465/R16 — selector de columnas recordado en el navegador", () => {
  it("ofrece el selector de columnas junto al botón", () => {
    render(<DescargarCoberturaButton />);
    expect(
      screen.getByRole("button", { name: "Elegir columnas de la descarga" }),
    ).toBeInTheDocument();
  });

  it("sin preferencia guardada salen las 10 columnas en el orden de R5", async () => {
    render(<DescargarCoberturaButton />);
    await userEvent.setup().click(boton());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    expect(encabezadosDelArchivo()).toEqual([
      "Provincia",
      "Cantón",
      "Distrito",
      "Activo",
      "Cobertura",
      "Motivo sin cobertura",
      "Zona",
      "GAM",
      "Zona especial",
      "Tarifa general de la zona",
    ]);
  });

  it("con la preferencia guardada: solo las marcadas y en el orden fijado", async () => {
    window.localStorage.setItem(
      CLAVE_PREFERENCIA,
      JSON.stringify({
        ocultas: ["activo", "motivo", "gam", "zona_especial", "tarifa_general", "canton"],
        orden: ["zona", "distrito", "provincia", "cobertura"],
      }),
    );
    render(<DescargarCoberturaButton />);
    await userEvent.setup().click(boton());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    expect(encabezadosDelArchivo()).toEqual(["Zona", "Distrito", "Provincia", "Cobertura"]);
  });

  it("desmarcar en el selector se guarda en el ámbito propio y aplica a la descarga", async () => {
    const user = userEvent.setup();
    render(<DescargarCoberturaButton />);
    await user.click(screen.getByRole("button", { name: "Elegir columnas de la descarga" }));
    await screen.findAllByText("Columnas del archivo");
    await user.click(screen.getByRole("checkbox", { name: "GAM" }));

    const guardado = window.localStorage.getItem(CLAVE_PREFERENCIA);
    expect(guardado).not.toBeNull();
    expect(JSON.parse(guardado!).ocultas).toContain("gam");

    await user.keyboard("{Escape}");
    await user.click(boton());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    expect(encabezadosDelArchivo()).not.toContain("GAM");
    expect(encabezadosDelArchivo()).toHaveLength(9);
  });
});

describe("465/R3, R18, R19 — sin archivo y con mensaje", () => {
  it("R3 — sesión no válida: pide volver a iniciar sesión, sin archivo", async () => {
    listarMock.mockResolvedValue({ status: "unauthenticated" });
    render(<DescargarCoberturaButton />);
    await userEvent.setup().click(boton());
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    expect(errorToastMock.mock.calls[0]![0]).toBe(
      "Tu sesión ya no es válida. Vuelve a iniciar sesión y descarga de nuevo.",
    );
    expect(descargarBlobMock).not.toHaveBeenCalled();
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
  });

  it("R18 — la lectura falla: mensaje que dice volver a intentarlo, sin archivo", async () => {
    listarMock.mockResolvedValue({ status: "forbidden" });
    render(<DescargarCoberturaButton />);
    await userEvent.setup().click(boton());
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    expect(errorToastMock.mock.calls[0]![0]).toMatch(/vuelve a intentarlo/i);
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("R18 — la action lanza: mensaje accionable, sin archivo", async () => {
    listarMock.mockRejectedValue(new Error("red caída"));
    render(<DescargarCoberturaButton />);
    await userEvent.setup().click(boton());
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    expect(errorToastMock.mock.calls[0]![0]).toMatch(/vuelve a intentarlo/i);
    expect(errorToastMock.mock.calls[0]![0]).not.toMatch(/red caída/);
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("R18 — supera el tope: mensaje con el total, sin archivo", async () => {
    listarMock.mockResolvedValue({ status: "limite_excedido", total: 6000, limite: 5000 });
    render(<DescargarCoberturaButton />);
    await userEvent.setup().click(boton());
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    expect(errorToastMock.mock.calls[0]![0]).toMatch(/6000/);
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("R19 — catálogo sin distritos: avisa que no hay datos, sin archivo", async () => {
    listarMock.mockResolvedValue({ status: "ok", items: [], total: 0 });
    render(<DescargarCoberturaButton />);
    await userEvent.setup().click(boton());
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    expect(errorToastMock.mock.calls[0]![0]).toMatch(/no hay datos que descargar/i);
    expect(descargarBlobMock).not.toHaveBeenCalled();
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
  });
});

describe("465/R20 — una sola descarga en curso", () => {
  it("dos clics mientras la primera lectura no termina → una sola lectura", async () => {
    let resolver!: (v: unknown) => void;
    listarMock.mockImplementation(
      () => new Promise((r) => {
        resolver = r;
      }),
    );
    render(<DescargarCoberturaButton />);
    const b = boton();
    act(() => {
      b.click();
      b.click();
    });
    expect(listarMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(b).toBeDisabled());

    await act(async () => {
      resolver({ status: "ok", items: [ITEM], total: 1 });
    });
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    expect(listarMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(boton()).not.toBeDisabled());
  });
});
