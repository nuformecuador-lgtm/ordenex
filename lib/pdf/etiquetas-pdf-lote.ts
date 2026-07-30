import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import bwipjs from "bwip-js/node";

import { formatMonto } from "@/lib/config/moneda";
import { buildPaqueteUrl } from "@/lib/utils/paquete-url";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

import {
  lineasDisponibles,
  recortarConElipsis,
  repartirLineas,
} from "./etiquetas-ajuste";

// Feature 136 (T1.2) — Builder SERVER-SIDE del PDF consolidado de etiquetas de
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

/** Tipografias e interlineado de la maqueta (pt y mm), espejo del generador de cliente. */
const FONT_ROTULO = 8;
const FONT_VALOR = 9;
const LINE_HEIGHT = 4;
const FIELD_GAP = 1.0;
/** Primera linea base del bloque de campos, en mm. */
const CAMPOS_Y_INICIO = 18;
/** Aire entre la ultima linea de texto y el borde superior del QR, en mm. */
const GAP_TEXTO_CODIGOS = 2;
/** Separacion entre la columna del rotulo y la del valor, en mm. */
const GAP_ROTULO_VALOR = 2;

interface CampoEtiqueta {
  label: string;
  value: string;
}

/**
 * Dibuja los campos rotulo/valor EN LINEA, sin pasar de `yLimite`.
 *
 * Espejo exacto de `drawCampos` en el generador de cliente
 * (`app/(app)/ordenes/_components/etiquetas-pdf.ts`); ver alli el porque de la
 * maqueta en linea: a dos lineas por campo el texto desbordaba la banda fija del
 * QR y los ultimos campos (producto, monto, tienda) se imprimian ENCIMA del QR.
 * La aritmetica del reparto se comparte de verdad (`etiquetas-ajuste.ts`), que es
 * lo que evita que las dos maquetas vuelvan a divergir en este punto.
 */
function drawCampos(doc: jsPDF, campos: CampoEtiqueta[], yLimite: number): void {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT_ROTULO);
  const anchoRotulo =
    Math.max(...campos.map((c) => doc.getTextWidth(c.label.toUpperCase()))) +
    GAP_ROTULO_VALOR;
  const anchoValor = CONTENT_WIDTH - anchoRotulo;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT_VALOR);
  const naturales = campos.map(
    (c) => doc.splitTextToSize(c.value, anchoValor) as string[],
  );
  const cupo = repartirLineas(
    naturales.map((l) => l.length),
    lineasDisponibles(
      CAMPOS_Y_INICIO,
      yLimite,
      LINE_HEIGHT,
      FIELD_GAP,
      campos.length,
    ),
  );
  const medir = (texto: string) => doc.getTextWidth(texto);

  let y = CAMPOS_Y_INICIO;
  campos.forEach((campo, i) => {
    const lineas = recortarConElipsis(naturales[i], cupo[i], anchoValor, medir);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT_ROTULO);
    doc.text(campo.label.toUpperCase(), MARGIN, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT_VALOR);
    lineas.forEach((linea, k) => {
      doc.text(linea, MARGIN + anchoRotulo, y + k * LINE_HEIGHT);
    });

    y += lineas.length * LINE_HEIGHT + FIELD_GAP;
  });
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

  // Codigos: QR de la URL del paquete (R5) + barcode del num_guia (R6).
  const qrSize = 26;
  const qrY = SIZE_MM - MARGIN - qrSize;

  // Campos de la orden (R4), ajustados a lo que queda libre sobre el QR.
  drawCampos(
    doc,
    [
      { label: "Destinatario", value: etiqueta.destinatario },
      { label: "Teléfono", value: etiqueta.telefonoDest },
      { label: "Dirección", value: etiqueta.direccion ?? "—" },
      { label: "Ubicación", value: geografiaLegible(etiqueta) },
      { label: "Producto", value: etiqueta.producto },
      { label: "Monto a cobrar", value: formatMonto(etiqueta.montoCobrar) },
      { label: "Tienda", value: etiqueta.tiendaNombre },
    ],
    qrY - GAP_TEXTO_CODIGOS,
  );

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
 *
 * `compress: true` (BLOQ-1 del review de la 136) NO es cosmetico: sin el, jsPDF
 * escribe los mapas de bits del QR y del barcode SIN comprimir. Medido con las
 * deps reales: 262.8 KB por etiqueta sin compresion vs 3.3 KB con ella (~80x), y
 * ~65 MB menos de RSS cada 50 etiquetas. Deja de ser el tamaño el factor que
 * limita el lote; el que queda (tiempo, ~18 ms/etiqueta) lo acota el tope
 * `etiquetasConfig.MAX_ETIQUETAS_POR_PDF` que aplica el borde. Efecto colateral
 * a tener presente en tests: los content streams pasan a estar deflateados, asi
 * que el texto NO se lee escaneando los bytes en crudo (hay que inflarlos).
 */
export async function buildEtiquetasLotePdf(etiquetas: EtiquetaGuiaDTO[]): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: "mm", format: [SIZE_MM, SIZE_MM], compress: true });
  for (let i = 0; i < etiquetas.length; i++) {
    if (i > 0) doc.addPage([SIZE_MM, SIZE_MM]);
    await drawEtiqueta(doc, etiquetas[i]);
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
