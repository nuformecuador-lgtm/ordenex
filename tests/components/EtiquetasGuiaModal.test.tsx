// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EtiquetasGuiaModal } from "@/app/(app)/ordenes/_components/EtiquetasGuiaModal";
import { generarEtiquetas } from "@/lib/actions/etiquetas-guia";
import { descargarEtiquetasPdf } from "@/app/(app)/ordenes/_components/etiquetas-pdf";
import { getHojaEtiqueta } from "@/lib/config/etiquetas-hoja";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// Feature 32 (T2.3) — Modal "Imprimir etiquetas". Se mockea la Server Action de
// lectura y el helper de PDF (jspdf no es testeable en jsdom: su salida binaria
// no se verifica aquí, solo que se invoca con las etiquetas correctas, R10/R12).
vi.mock("@/lib/actions/etiquetas-guia", () => ({
  generarEtiquetas: vi.fn(),
}));

vi.mock("@/app/(app)/ordenes/_components/etiquetas-pdf", () => ({
  descargarEtiquetasPdf: vi.fn(),
}));

// Stubs de QR/barcode: evitan canvas real y el warning de ref (forwardRef).
vi.mock("qrcode.react", () => ({
  QRCodeCanvas: () => <canvas data-testid="qr-stub" />,
}));
vi.mock("react-barcode", () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="barcode-stub" data-value={value} />
  ),
}));

const generarEtiquetasMock = vi.mocked(generarEtiquetas);
const descargarEtiquetasPdfMock = vi.mocked(descargarEtiquetasPdf);

function makeOrden(id: string): OrdenListItemDTO {
  return {
    id,
    numGuia: 1,
    numRemision: `REM-${id}`,
    estatusId: "est",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "t1",
    tiendaNombre: "Tienda X",
    zonaId: "z1",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function makeEtiqueta(
  overrides: Partial<EtiquetaGuiaDTO> & { ordenId: string },
): EtiquetaGuiaDTO {
  return {
    numGuia: 1,
    numRemision: "REM-1",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    direccion: "Dir",
    producto: "Producto",
    montoCobrar: 100,
    tiendaNombre: "Tienda X",
    zonaNombre: "Zona A",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: null,
    qrValue: overrides.ordenId,
    barcodeValue: "1",
    ...overrides,
  };
}

function renderModal(ordenes: OrdenListItemDTO[], onOpenChange = vi.fn()) {
  const utils = render(
    <EtiquetasGuiaModal open ordenes={ordenes} onOpenChange={onOpenChange} />,
  );
  return { onOpenChange, ...utils };
}

const NOMBRE_SELECTOR = "Tamaño de hoja";

/** Selecciona una opción en el Select de base-ui por su nombre accesible. */
async function elegirTamano(
  user: ReturnType<typeof userEvent.setup>,
  optionName: string,
) {
  await user.click(screen.getByRole("combobox", { name: NOMBRE_SELECTOR }));
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: optionName }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("EtiquetasGuiaModal", () => {
  it("R11: selección mixta renderiza M etiquetas y avisa de las N−M omitidas (sin guía)", async () => {
    generarEtiquetasMock.mockResolvedValue({
      status: "ok",
      etiquetas: [
        makeEtiqueta({ ordenId: "o1", numGuia: 11 }),
        makeEtiqueta({ ordenId: "o2", numGuia: 12 }),
      ],
      omitidas: [{ ordenId: "o3", motivo: "sin_guia" }],
    });

    renderModal([makeOrden("o1"), makeOrden("o2"), makeOrden("o3")]);

    const etiquetas = await screen.findAllByTestId("etiqueta-guia");
    expect(etiquetas).toHaveLength(2);
    expect(
      screen.getByText(/1 orden\(es\) omitida\(s\).*sin guía/),
    ).toBeInTheDocument();
    expect(generarEtiquetasMock).toHaveBeenCalledWith({
      ordenIds: ["o1", "o2", "o3"],
    });
  });

  it("R10: 'Descargar etiquetas' invoca el helper de PDF con las etiquetas imprimibles", async () => {
    const user = userEvent.setup();
    const etiquetas = [makeEtiqueta({ ordenId: "o1", numGuia: 11 })];
    generarEtiquetasMock.mockResolvedValue({
      status: "ok",
      etiquetas,
      omitidas: [],
    });

    renderModal([makeOrden("o1")]);

    await screen.findAllByTestId("etiqueta-guia");
    await user.click(
      screen.getByRole("button", { name: "Descargar etiquetas" }),
    );

    expect(descargarEtiquetasPdfMock).toHaveBeenCalledTimes(1);
    // Feature 150 (T10): la llamada gana un tercer argumento —la hoja elegida—,
    // sin relajar la aserción original sobre las etiquetas imprimibles.
    expect(descargarEtiquetasPdfMock).toHaveBeenCalledWith(
      etiquetas,
      expect.any(Map),
      getHojaEtiqueta("100x100"),
    );
  });

  it("R12: sin imprimibles informa y NO genera/descarga PDF", async () => {
    generarEtiquetasMock.mockResolvedValue({
      status: "ok",
      etiquetas: [],
      omitidas: [
        { ordenId: "o1", motivo: "sin_guia" },
        { ordenId: "o2", motivo: "no_encontrada" },
      ],
    });

    renderModal([makeOrden("o1"), makeOrden("o2")]);

    expect(
      await screen.findByText(/no hay etiquetas\s+para imprimir/i),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId("etiqueta-guia")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Descargar etiquetas" }),
    ).toBeNull();
    expect(descargarEtiquetasPdfMock).not.toHaveBeenCalled();
  });

  it("R13/R14-UI: un resultado 'forbidden' muestra un mensaje y no descarga", async () => {
    generarEtiquetasMock.mockResolvedValue({ status: "forbidden" });

    renderModal([makeOrden("o1")]);

    expect(
      await screen.findByText("No tienes permiso para generar etiquetas."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Descargar etiquetas" }),
    ).toBeNull();
    expect(descargarEtiquetasPdfMock).not.toHaveBeenCalled();
  });
});

// Feature 150 (T9) — Selector de tamaño de hoja en el modal. Cubre R6-R11.
describe("EtiquetasGuiaModal — tamaño de hoja (feature 150)", () => {
  function conUnaEtiqueta() {
    const etiquetas = [makeEtiqueta({ ordenId: "o1", numGuia: 11 })];
    generarEtiquetasMock.mockResolvedValue({
      status: "ok",
      etiquetas,
      omitidas: [],
    });
    return etiquetas;
  }

  it("R6: muestra el selector «Tamaño de hoja» con las cuatro opciones del catálogo, en orden", async () => {
    const user = userEvent.setup();
    conUnaEtiqueta();
    renderModal([makeOrden("o1")]);
    await screen.findAllByTestId("etiqueta-guia");

    const combo = screen.getByRole("combobox", { name: NOMBRE_SELECTOR });
    expect(combo).toBeInTheDocument();
    // El rótulo visible también está (no solo el nombre accesible).
    expect(screen.getByText(NOMBRE_SELECTOR)).toBeInTheDocument();

    await user.click(combo);
    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((o) => o.textContent?.trim()),
    ).toEqual(["100 × 100 mm", "4 × 6 pulgadas", "A4", "Carta"]);
  });

  it("R7: al abrir, el tamaño seleccionado es el default (100 × 100 mm)", async () => {
    conUnaEtiqueta();
    renderModal([makeOrden("o1")]);
    await screen.findAllByTestId("etiqueta-guia");

    expect(
      screen.getByRole("combobox", { name: NOMBRE_SELECTOR }),
    ).toHaveTextContent("100 × 100 mm");
  });

  it("R7: reabrir el modal vuelve al default aunque antes se hubiera elegido otro", async () => {
    const user = userEvent.setup();
    conUnaEtiqueta();
    const { rerender } = render(
      <EtiquetasGuiaModal open ordenes={[makeOrden("o1")]} onOpenChange={vi.fn()} />,
    );
    await screen.findAllByTestId("etiqueta-guia");
    await elegirTamano(user, "A4");
    expect(
      screen.getByRole("combobox", { name: NOMBRE_SELECTOR }),
    ).toHaveTextContent("A4");

    rerender(
      <EtiquetasGuiaModal
        open={false}
        ordenes={[makeOrden("o1")]}
        onOpenChange={vi.fn()}
      />,
    );
    rerender(
      <EtiquetasGuiaModal open ordenes={[makeOrden("o1")]} onOpenChange={vi.fn()} />,
    );
    await screen.findAllByTestId("etiqueta-guia");

    expect(
      screen.getByRole("combobox", { name: NOMBRE_SELECTOR }),
    ).toHaveTextContent("100 × 100 mm");
  });

  it("R8: la descripción del modal muestra la etiqueta visible y los mm del tamaño elegido", async () => {
    const user = userEvent.setup();
    conUnaEtiqueta();
    renderModal([makeOrden("o1")]);
    await screen.findAllByTestId("etiqueta-guia");

    expect(
      screen.getByText(/una página de 100 × 100 mm \(100 × 100 mm\)/),
    ).toBeInTheDocument();

    await elegirTamano(user, "Carta");
    // Coma decimal, sin depender del locale del runner.
    expect(
      screen.getByText(/una página de Carta \(215,9 × 279,4 mm\)/),
    ).toBeInTheDocument();

    await elegirTamano(user, "4 × 6 pulgadas");
    expect(
      screen.getByText(/una página de 4 × 6 pulgadas \(101,6 × 152,4 mm\)/),
    ).toBeInTheDocument();
  });

  it("R9: la descarga usa el tamaño seleccionado en ese momento", async () => {
    const user = userEvent.setup();
    const etiquetas = conUnaEtiqueta();
    renderModal([makeOrden("o1")]);
    await screen.findAllByTestId("etiqueta-guia");

    await elegirTamano(user, "A4");
    await user.click(
      screen.getByRole("button", { name: "Descargar etiquetas" }),
    );

    expect(descargarEtiquetasPdfMock).toHaveBeenCalledTimes(1);
    expect(descargarEtiquetasPdfMock).toHaveBeenCalledWith(
      etiquetas,
      expect.any(Map),
      getHojaEtiqueta("a4"),
    );
    expect(descargarEtiquetasPdfMock.mock.calls[0][2]).toEqual({
      id: "a4",
      label: "A4",
      anchoMm: 210,
      altoMm: 297,
    });
  });

  it("R10: elegir y descargar NO persiste el tamaño en el navegador ni lo manda al servidor", async () => {
    const user = userEvent.setup();
    conUnaEtiqueta();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const cookieSet = vi.spyOn(document, "cookie", "set");
    renderModal([makeOrden("o1")]);
    await screen.findAllByTestId("etiqueta-guia");

    await elegirTamano(user, "Carta");
    await user.click(
      screen.getByRole("button", { name: "Descargar etiquetas" }),
    );

    expect(setItem).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
    // La única llamada al servidor sigue siendo la lectura inicial, sin tamaño.
    expect(generarEtiquetasMock).toHaveBeenCalledTimes(1);
    expect(generarEtiquetasMock).toHaveBeenCalledWith({ ordenIds: ["o1"] });
    setItem.mockRestore();
    cookieSet.mockRestore();
  });

  it("R11: sin etiquetas imprimibles no hay selector de tamaño ni descarga", async () => {
    generarEtiquetasMock.mockResolvedValue({
      status: "ok",
      etiquetas: [],
      omitidas: [{ ordenId: "o1", motivo: "sin_guia" }],
    });

    renderModal([makeOrden("o1")]);
    await screen.findByText(/no hay etiquetas\s+para imprimir/i);

    expect(
      screen.queryByRole("combobox", { name: NOMBRE_SELECTOR }),
    ).toBeNull();
    expect(screen.queryByText(NOMBRE_SELECTOR)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Descargar etiquetas" }),
    ).toBeNull();
    expect(descargarEtiquetasPdfMock).not.toHaveBeenCalled();
  });
});

// Feature 160 (T17/T23, R30) — DISCREPANCIA DECLARADA con `tasks.md` T17, que lista
// este diálogo entre los que reciben el dato etiquetado. No lo recibe, por dos razones
// verificadas contra el código: (1) NO lista las órdenes seleccionadas —renderiza la
// VISTA PREVIA de las etiquetas imprimibles—, y (2) lo que se ve aquí es la etiqueta
// física, que R30 deja explícitamente fuera del alcance. Este test fija esa ausencia
// para que nadie la "arregle" sin querer.
describe("EtiquetasGuiaModal — R30: la etiqueta NO muestra los intentos", () => {
  it("la vista previa no trae la etiqueta 'Intentos' ni su columna", async () => {
    generarEtiquetasMock.mockResolvedValue({
      status: "ok",
      etiquetas: [makeEtiqueta({ ordenId: "o1", numRemision: "REM-o1" })],
      omitidas: [],
    });

    renderModal([makeOrden("o1")]);
    await screen.findByText("REM-o1");

    expect(screen.queryByText(/Intentos/)).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Intentos" })).toBeNull();
  });
});
