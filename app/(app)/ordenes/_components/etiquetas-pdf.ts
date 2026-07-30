import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";

import { formatMonto } from "@/lib/config/moneda";
import type { HojaEtiqueta } from "@/lib/config/etiquetas-hoja";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

import {
  crearLayout,
  LIENZO_BASE_MM,
  MAQUETA_BASE,
  type EtiquetaLayout,
} from "./etiquetas-layout";

// Feature 32 (T2.2, decision F1.4 (c)) — Genera el PDF descargable de etiquetas
// de guia: cada etiqueta es EXACTAMENTE una pagina y el lote produce un PDF
// multipagina (una etiqueta por pagina). NO usa window.print() (superseded por
// (c)) ni html2canvas (Tailwind v4 usa colores `oklch` que el parser clasico
// rechaza): el QR se rasteriza desde el `<canvas>` de qrcode.react (`toDataURL`)
// y el codigo de barras se dibuja con jsbarcode sobre un `<canvas>` offscreen;
// el texto se maqueta con las APIs de jspdf.
//
// Feature 150 (T6) — El tamaño de pagina deja de ser fijo: llega como `hoja` del
// catalogo `lib/config/etiquetas-hoja.ts` y la maqueta se escala con
// `crearLayout` (factor unico, bloque cuadrado centrado; ver etiquetas-layout).
// Las coordenadas de dibujo se siguen expresando en el lienzo base de 100 mm y
// se mapean con `layout.x()/y()`, de modo que con `100x100` (s = 1, offsets 0)
// el dibujo es identico al de la feature 32. D1: UNA etiqueta por pagina,
// escalada; nunca mosaico. D3: el generador server-side del lote (feature 136)
// queda fuera de alcance y no comparte este modulo.

/** Rasteriza el codigo de barras (CODE128) a PNG con un `<canvas>` offscreen. */
function barcodeDataUrl(value: string, layout: EtiquetaLayout): string {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, {
    format: "CODE128",
    displayValue: true,
    margin: 0,
    // R18: densidad proporcional al factor de escala, redondeada hacia arriba.
    height: layout.barcodeRaster.height,
    width: layout.barcodeRaster.width,
    fontSize: layout.barcodeRaster.fontSize,
  });
  return canvas.toDataURL("image/png");
}

/**
 * Dibuja un par etiqueta/valor con ajuste de linea; devuelve la `y` siguiente.
 * `y` viaja en unidades del lienzo base (0-100) y se mapea al dibujar, para que
 * el interlineado y las separaciones escalen con el mismo factor (R16).
 */
function drawField(
  doc: jsPDF,
  layout: EtiquetaLayout,
  label: string,
  value: string,
  y: number,
): number {
  const { margin, lineHeight, fieldGap } = MAQUETA_BASE;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(layout.fontRotulo);
  doc.text(label.toUpperCase(), layout.x(margin), layout.y(y));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(layout.fontValor);
  // El ancho de corte va escalado: con 88 mm fijos sobre una hoja A4 el texto
  // se ajustaria a una columna angosta y quedaria "encogido" (design.md §4.3).
  const lines = doc.splitTextToSize(value, layout.contentWidth) as string[];
  doc.text(lines, layout.x(margin), layout.y(y + lineHeight));
  return y + lineHeight + lines.length * lineHeight + fieldGap;
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
  layout: EtiquetaLayout,
  etiqueta: EtiquetaGuiaDTO,
  qrCanvas: HTMLCanvasElement | undefined,
): void {
  // Coordenadas en el lienzo base de 100 mm; `layout.x/y` las lleva a la hoja.
  const { margin } = MAQUETA_BASE;
  const derecha = LIENZO_BASE_MM - margin;

  // Cabecera: numero de guia (grande) + numero de remision.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(layout.fontRotulo);
  doc.text("GUÍA", layout.x(margin), layout.y(margin + 2));
  doc.setFontSize(layout.fontGuia);
  doc.text(String(etiqueta.numGuia), layout.x(margin), layout.y(margin + 10));

  doc.setFontSize(layout.fontRotulo);
  doc.text("REMISIÓN", layout.x(derecha), layout.y(margin + 2), {
    align: "right",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(layout.fontRemision);
  doc.text(etiqueta.numRemision, layout.x(derecha), layout.y(margin + 7), {
    align: "right",
  });

  // R20: los nueve datos de la etiqueta, en cualquier tamaño del catalogo.
  let y = margin + 18;
  y = drawField(doc, layout, "Destinatario", etiqueta.destinatario, y);
  y = drawField(doc, layout, "Teléfono", etiqueta.telefonoDest, y);
  y = drawField(doc, layout, "Dirección", etiqueta.direccion ?? "—", y);
  y = drawField(doc, layout, "Ubicación", geografiaLegible(etiqueta), y);
  y = drawField(doc, layout, "Producto", etiqueta.producto, y);
  y = drawField(doc, layout, "Monto a cobrar", formatMonto(etiqueta.montoCobrar), y);
  drawField(doc, layout, "Tienda", etiqueta.tiendaNombre, y);

  // Codigos: QR (raster del canvas de qrcode.react) + barcode (jsbarcode).
  const qrSize = MAQUETA_BASE.qrSize;
  const qrY = LIENZO_BASE_MM - margin - qrSize;
  if (qrCanvas) {
    doc.addImage(
      qrCanvas.toDataURL("image/png"),
      "PNG",
      layout.x(margin),
      layout.y(qrY),
      layout.qrSize,
      layout.qrSize,
    );
  }
  const barcodeX = margin + qrSize + MAQUETA_BASE.gapQrBarcode;
  const barcodeWidth = derecha - barcodeX;
  doc.addImage(
    barcodeDataUrl(etiqueta.barcodeValue, layout),
    "PNG",
    layout.x(barcodeX),
    layout.y(qrY + 6),
    layout.escala(barcodeWidth),
    layout.barcodeHeight,
  );
}

/**
 * Nombre del archivo descargado, con el identificador del tamaño elegido (R19):
 * el caso real es descargar el mismo lote en dos tamaños para compararlos, y con
 * un nombre fijo el navegador entregaria "etiquetas-guia (1).pdf" y el operador
 * ya no sabria cual es cual.
 */
export function etiquetasPdfFilename(hoja: HojaEtiqueta): string {
  return `etiquetas-guia-${hoja.id}.pdf`;
}

/**
 * Construye el documento PDF (una etiqueta por pagina, R12) con el tamaño de
 * hoja indicado (R13). Se separa de la descarga para poder probar el ensamblado
 * sin tocar el DOM de descarga.
 *
 * `hoja` es un parametro OBLIGATORIO a proposito: con un default silencioso, un
 * llamador que olvidase propagar la eleccion del usuario produciria siempre
 * 100x100 y el bug pasaria inadvertido; asi lo caza el compilador.
 */
export function buildEtiquetasPdf(
  etiquetas: EtiquetaGuiaDTO[],
  qrCanvases: Map<string, HTMLCanvasElement>,
  hoja: HojaEtiqueta,
): jsPDF {
  const layout = crearLayout(hoja);
  const format: [number, number] = [hoja.anchoMm, hoja.altoMm];
  const doc = new jsPDF({ unit: "mm", format });
  etiquetas.forEach((etiqueta, index) => {
    if (index > 0) doc.addPage(format);
    drawEtiqueta(doc, layout, etiqueta, qrCanvases.get(etiqueta.ordenId));
  });
  return doc;
}

/**
 * Ensambla y descarga el PDF multipagina de etiquetas. Se llama SOLO cuando hay
 * al menos una etiqueta imprimible (R10/R12 de la feature 32; el modal garantiza
 * la precondicion) y con la hoja elegida en el selector (R9).
 */
export function descargarEtiquetasPdf(
  etiquetas: EtiquetaGuiaDTO[],
  qrCanvases: Map<string, HTMLCanvasElement>,
  hoja: HojaEtiqueta,
): void {
  const doc = buildEtiquetasPdf(etiquetas, qrCanvases, hoja);
  doc.save(etiquetasPdfFilename(hoja));
}
