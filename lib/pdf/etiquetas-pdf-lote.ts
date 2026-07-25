import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import bwipjs from "bwip-js/node";

import { formatMonto } from "@/lib/config/moneda";
import { buildPaqueteUrl } from "@/lib/utils/paquete-url";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

// Feature 112 (T1.2) — Builder SERVER-SIDE del PDF consolidado de etiquetas de
// guia. Corre en el runtime Node del endpoint de carga por API (R7): sin DOM, sin
// canvas del navegador. Replica la maqueta del generador de cliente (feature 32,
// app/(app)/ordenes/_components/etiquetas-pdf.ts) pero rasteriza el QR con
// `qrcode` (data URL) y el codigo de barras con `bwip-js` (PNG en buffer), ambas
// libs pure-JS. NO se importa el generador de cliente (usa document/canvas): ver
// design.md §4 (reuso descartado, riesgo de divergencia visual mitigado por test).

/** Lado de la etiqueta/pagina en mm (cuadrada, R2). */
const SIZE_MM = 100;
/** Margen interior en mm. */
const MARGIN = 6;
const CONTENT_WIDTH = SIZE_MM - MARGIN * 2;

/** Rasteriza el QR (URL del paquete) a PNG data URL en Node (R5). */
async function qrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, { margin: 0, width: 256 });
}

/** Rasteriza el codigo de barras CODE128 a PNG data URL en Node (R6). */
async function barcodeDataUrl(value: string): Promise<string> {
  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text: value,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: "center",
  });
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** Dibuja un par etiqueta/valor con ajuste de linea; devuelve la `y` siguiente. */
function drawField(doc: jsPDF, label: string, value: string, y: number): number {
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
  return [etiqueta.zonaNombre, etiqueta.provinciaNombre, etiqueta.cantonNombre, etiqueta.distritoNombre]
    .filter((parte): parte is string => Boolean(parte))
    .join(" / ");
}

/** Dibuja una etiqueta completa (cabecera + campos + QR + barcode) en la pagina activa. */
async function drawEtiqueta(doc: jsPDF, etiqueta: EtiquetaGuiaDTO): Promise<void> {
  // Cabecera: numero de guia (grande) + numero de remision (R4).
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("GUÍA", MARGIN, MARGIN + 2);
  doc.setFontSize(22);
  doc.text(String(etiqueta.numGuia), MARGIN, MARGIN + 10);

  doc.setFontSize(8);
  doc.text("REMISIÓN", SIZE_MM - MARGIN, MARGIN + 2, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(etiqueta.numRemision, SIZE_MM - MARGIN, MARGIN + 7, { align: "right" });

  // Campos de la orden (R4).
  let y = MARGIN + 18;
  y = drawField(doc, "Destinatario", etiqueta.destinatario, y);
  y = drawField(doc, "Teléfono", etiqueta.telefonoDest, y);
  y = drawField(doc, "Dirección", etiqueta.direccion ?? "—", y);
  y = drawField(doc, "Ubicación", geografiaLegible(etiqueta), y);
  y = drawField(doc, "Producto", etiqueta.producto, y);
  y = drawField(doc, "Monto a cobrar", formatMonto(etiqueta.montoCobrar), y);
  drawField(doc, "Tienda", etiqueta.tiendaNombre, y);

  // Codigos: QR de la URL del paquete (R5) + barcode del num_guia (R6).
  const qrSize = 26;
  const qrY = SIZE_MM - MARGIN - qrSize;
  const qr = await qrDataUrl(buildPaqueteUrl(etiqueta.numGuia));
  doc.addImage(qr, "PNG", MARGIN, qrY, qrSize, qrSize);

  const barcodeX = MARGIN + qrSize + 4;
  const barcodeWidth = SIZE_MM - MARGIN - barcodeX;
  const barcode = await barcodeDataUrl(etiqueta.barcodeValue);
  doc.addImage(barcode, "PNG", barcodeX, qrY + 6, barcodeWidth, 16);
}

/**
 * Construye el PDF consolidado del lote: una etiqueta por pagina de 100 x 100 mm
 * (R1-R6). Funcion pura (sin DOM, R7); el llamador garantiza `etiquetas.length > 0`
 * (nunca produce un PDF de 0 paginas). Devuelve los bytes del PDF como `Uint8Array`.
 */
export async function buildEtiquetasLotePdf(etiquetas: EtiquetaGuiaDTO[]): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: "mm", format: [SIZE_MM, SIZE_MM] });
  for (let i = 0; i < etiquetas.length; i++) {
    if (i > 0) doc.addPage([SIZE_MM, SIZE_MM]);
    await drawEtiqueta(doc, etiquetas[i]);
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
