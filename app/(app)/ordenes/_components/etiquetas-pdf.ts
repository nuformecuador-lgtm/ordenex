import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";

import { formatMonto } from "@/lib/config/moneda";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

// Feature 32 (T2.2, decision F1.4 (c)) — Genera el PDF descargable de etiquetas
// de guia: cada etiqueta es EXACTAMENTE una pagina cuadrada de 100mm x 100mm y el
// lote produce un PDF multipagina (una etiqueta por pagina). NO usa
// window.print() (superseded por (c)) ni html2canvas (Tailwind v4 usa colores
// `oklch` que el parser clasico rechaza): el QR se rasteriza desde el `<canvas>`
// de qrcode.react (`toDataURL`) y el codigo de barras se dibuja con jsbarcode
// sobre un `<canvas>` offscreen; el texto se maqueta con las APIs de jspdf.

/** Lado de la etiqueta/pagina en mm (cuadrada, decision F1.4 (c)). */
const SIZE_MM = 100;
/** Margen interior en mm. */
const MARGIN = 6;
const CONTENT_WIDTH = SIZE_MM - MARGIN * 2;
/** Nombre del archivo descargado. */
export const ETIQUETAS_PDF_FILENAME = "etiquetas-guia.pdf";

/** Rasteriza el codigo de barras (CODE128) a PNG con un `<canvas>` offscreen. */
function barcodeDataUrl(value: string): string {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, {
    format: "CODE128",
    displayValue: true,
    margin: 0,
    height: 60,
    width: 2,
    fontSize: 18,
  });
  return canvas.toDataURL("image/png");
}

/** Dibuja un par etiqueta/valor con ajuste de linea; devuelve la `y` siguiente. */
function drawField(
  doc: jsPDF,
  label: string,
  value: string,
  y: number,
): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(label.toUpperCase(), MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(value, CONTENT_WIDTH) as string[];
  doc.text(lines, MARGIN, y + 4);
  return y + 4 + lines.length * 4 + 1.5;
}

/** Une la geografia disponible; omite el distrito si es null (R4). */
function geografiaLegible(etiqueta: EtiquetaGuiaDTO): string {
  return [
    etiqueta.zonaNombre,
    etiqueta.provinciaNombre,
    etiqueta.cantonNombre,
    etiqueta.distritoNombre,
  ]
    .filter((parte): parte is string => Boolean(parte))
    .join(" / ");
}

/** Dibuja una etiqueta completa en la pagina activa del documento. */
function drawEtiqueta(
  doc: jsPDF,
  etiqueta: EtiquetaGuiaDTO,
  qrCanvas: HTMLCanvasElement | undefined,
): void {
  // Cabecera: numero de guia (grande) + numero de remision.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("GUÍA", MARGIN, MARGIN + 2);
  doc.setFontSize(22);
  // Sin guía asignada aún -> "Pendiente" (patrón de la vista previa / columna).
  doc.text(etiqueta.numGuia === null ? "Pendiente" : String(etiqueta.numGuia), MARGIN, MARGIN + 10);

  doc.setFontSize(8);
  doc.text("REMISIÓN", SIZE_MM - MARGIN, MARGIN + 2, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(etiqueta.numRemision, SIZE_MM - MARGIN, MARGIN + 7, {
    align: "right",
  });

  let y = MARGIN + 18;
  y = drawField(doc, "Destinatario", etiqueta.destinatario, y);
  y = drawField(doc, "Teléfono", etiqueta.telefonoDest, y);
  y = drawField(doc, "Dirección", etiqueta.direccion ?? "—", y);
  y = drawField(doc, "Ubicación", geografiaLegible(etiqueta), y);
  y = drawField(doc, "Producto", etiqueta.producto, y);
  y = drawField(doc, "Monto a cobrar", formatMonto(etiqueta.montoCobrar), y);
  drawField(doc, "Tienda", etiqueta.tiendaNombre, y);

  // Codigos: QR (raster del canvas de qrcode.react) + barcode (jsbarcode).
  const qrSize = 26;
  const qrY = SIZE_MM - MARGIN - qrSize;
  if (qrCanvas) {
    doc.addImage(
      qrCanvas.toDataURL("image/png"),
      "PNG",
      MARGIN,
      qrY,
      qrSize,
      qrSize,
    );
  }
  // Sin guía no hay código de barras (barcodeValue null): se omite en el PDF.
  if (etiqueta.barcodeValue !== null) {
    const barcodeX = MARGIN + qrSize + 4;
    const barcodeWidth = SIZE_MM - MARGIN - barcodeX;
    doc.addImage(
      barcodeDataUrl(etiqueta.barcodeValue),
      "PNG",
      barcodeX,
      qrY + 6,
      barcodeWidth,
      16,
    );
  }
}

/**
 * Construye el documento PDF (100x100 mm por etiqueta, una por pagina). Se separa
 * de la descarga para poder probar el ensamblado sin tocar el DOM de descarga.
 */
export function buildEtiquetasPdf(
  etiquetas: EtiquetaGuiaDTO[],
  qrCanvases: Map<string, HTMLCanvasElement>,
): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: [SIZE_MM, SIZE_MM] });
  etiquetas.forEach((etiqueta, index) => {
    if (index > 0) doc.addPage([SIZE_MM, SIZE_MM]);
    drawEtiqueta(doc, etiqueta, qrCanvases.get(etiqueta.ordenId));
  });
  return doc;
}

/**
 * Ensambla y descarga el PDF multipagina de etiquetas. Se llama SOLO cuando hay
 * al menos una etiqueta imprimible (R10/R12; el modal garantiza la precondicion).
 */
export function descargarEtiquetasPdf(
  etiquetas: EtiquetaGuiaDTO[],
  qrCanvases: Map<string, HTMLCanvasElement>,
): void {
  const doc = buildEtiquetasPdf(etiquetas, qrCanvases);
  doc.save(ETIQUETAS_PDF_FILENAME);
}
