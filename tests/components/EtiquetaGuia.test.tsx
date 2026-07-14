// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { EtiquetaGuia } from "@/app/(app)/ordenes/_components/EtiquetaGuia";
import { formatMonto } from "@/lib/config/moneda";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

// Feature 32 (T2.1) — Etiqueta presentacional. Se doblan qrcode.react y
// react-barcode con stubs que exponen el `value` recibido: así el test asserta
// que la etiqueta les pasa `qrValue`/`barcodeValue` (R7/R8) sin depender de
// canvas real (jsdom no lo soporta).
vi.mock("qrcode.react", () => ({
  QRCodeCanvas: ({ value }: { value: string }) => (
    <div data-testid="qr-stub" data-value={value} />
  ),
}));

vi.mock("react-barcode", () => ({
  default: ({ value, format }: { value: string; format?: string }) => (
    <div data-testid="barcode-stub" data-value={value} data-format={format} />
  ),
}));

function makeEtiqueta(
  overrides: Partial<EtiquetaGuiaDTO> = {},
): EtiquetaGuiaDTO {
  return {
    ordenId: "orden-uuid-1",
    numGuia: 4021,
    numRemision: "REM-777",
    destinatario: "María Solís",
    telefonoDest: "0999888777",
    direccion: "100m sur de la iglesia",
    producto: "Caja de zapatos",
    montoCobrar: 12345.5,
    tiendaNombre: "Tienda Central",
    zonaNombre: "Zona A",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: "San Rafael",
    qrValue: "orden-uuid-1",
    barcodeValue: "4021",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("EtiquetaGuia", () => {
  it("R9: renderiza todos los campos legibles de la orden", () => {
    const etiqueta = makeEtiqueta();
    render(<EtiquetaGuia etiqueta={etiqueta} />);

    expect(screen.getByText("4021")).toBeInTheDocument(); // num guía
    expect(screen.getByText("REM-777")).toBeInTheDocument();
    expect(screen.getByText("María Solís")).toBeInTheDocument();
    expect(screen.getByText("0999888777")).toBeInTheDocument();
    expect(screen.getByText("100m sur de la iglesia")).toBeInTheDocument();
    expect(
      screen.getByText("Zona A / San José / Escazú / San Rafael"),
    ).toBeInTheDocument();
    expect(screen.getByText("Caja de zapatos")).toBeInTheDocument();
    expect(screen.getByText("Tienda Central")).toBeInTheDocument();
  });

  it("R7: el QR codifica la URL del paquete (`/paquete/<ordenId>`), no el id pelado", () => {
    render(<EtiquetaGuia etiqueta={makeEtiqueta({ ordenId: "orden-uuid-1" })} />);
    const qr = screen.getByTestId("qr-stub");
    // La URL es absoluta (origin de jsdom) y termina en la ruta del paquete.
    expect(qr.getAttribute("data-value")).toMatch(/\/paquete\/orden-uuid-1$/);
  });

  it("R8: pasa `barcodeValue` (num_guia) al código de barras", () => {
    render(<EtiquetaGuia etiqueta={makeEtiqueta({ barcodeValue: "4021" })} />);
    const barcode = screen.getByTestId("barcode-stub");
    expect(barcode).toHaveAttribute("data-value", "4021");
    expect(barcode).toHaveAttribute("data-format", "CODE128");
  });

  it("R5: formatea el monto a cobrar con la config de moneda", () => {
    render(<EtiquetaGuia etiqueta={makeEtiqueta({ montoCobrar: 12345.5 })} />);
    // El formato de es-CR usa espacio no-rompible como separador de miles; se
    // comparan ignorando espacios para no acoplar a ese detalle de Intl.
    const esperado = formatMonto(12345.5).replace(/\s/g, "");
    expect(
      screen.getByText(
        (content) => content.replace(/\s/g, "") === esperado,
      ),
    ).toBeInTheDocument();
  });

  it("R5: monto null se muestra como '-'", () => {
    render(<EtiquetaGuia etiqueta={makeEtiqueta({ montoCobrar: null })} />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("R4: omite el distrito en la ubicación cuando es null", () => {
    render(
      <EtiquetaGuia etiqueta={makeEtiqueta({ distritoNombre: null })} />,
    );
    expect(
      screen.getByText("Zona A / San José / Escazú"),
    ).toBeInTheDocument();
  });
});
