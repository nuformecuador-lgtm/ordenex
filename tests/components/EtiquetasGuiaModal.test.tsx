// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EtiquetasGuiaModal } from "@/app/(app)/ordenes/_components/EtiquetasGuiaModal";
import { generarEtiquetas } from "@/lib/actions/etiquetas-guia";
import { descargarEtiquetasPdf } from "@/app/(app)/ordenes/_components/etiquetas-pdf";
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
  render(
    <EtiquetasGuiaModal open ordenes={ordenes} onOpenChange={onOpenChange} />,
  );
  return { onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("EtiquetasGuiaModal", () => {
  it("R11: selección mixta renderiza M etiquetas y avisa de las N−M omitidas (no encontradas)", async () => {
    generarEtiquetasMock.mockResolvedValue({
      status: "ok",
      etiquetas: [
        makeEtiqueta({ ordenId: "o1", numGuia: 11 }),
        makeEtiqueta({ ordenId: "o2", numGuia: 12 }),
      ],
      omitidas: [{ ordenId: "o3", motivo: "no_encontrada" }],
    });

    renderModal([makeOrden("o1"), makeOrden("o2"), makeOrden("o3")]);

    const etiquetas = await screen.findAllByTestId("etiqueta-guia");
    expect(etiquetas).toHaveLength(2);
    expect(
      screen.getByText(/1 orden\(es\) omitida\(s\).*no encontrada/),
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
    expect(descargarEtiquetasPdfMock).toHaveBeenCalledWith(
      etiquetas,
      expect.any(Map),
    );
  });

  it("R12: sin imprimibles informa y NO genera/descarga PDF", async () => {
    generarEtiquetasMock.mockResolvedValue({
      status: "ok",
      etiquetas: [],
      omitidas: [
        { ordenId: "o1", motivo: "no_encontrada" },
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
