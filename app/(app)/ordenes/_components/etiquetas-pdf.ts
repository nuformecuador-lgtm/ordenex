import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";

import { formatMonto } from "@/lib/config/moneda";
import type { HojaEtiqueta } from "@/lib/config/etiquetas-hoja";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

import {
  lineasDisponibles,
  recortarConElipsis,
  repartirLineas,
} from "@/lib/pdf/etiquetas-ajuste";

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

/** Primera linea base del bloque de campos, en unidades del lienzo base. */
const CAMPOS_Y_INICIO = 18;
/** Aire entre la ultima linea de texto y el borde superior del QR, en mm base. */
const GAP_TEXTO_CODIGOS = 2;
/** Separacion entre la columna del rotulo y la del valor, en mm base. */
const GAP_ROTULO_VALOR = 2;

interface CampoEtiqueta {
  label: string;
  value: string;
}

/**
 * Dibuja el bloque de campos rotulo/valor EN LINEA (el rotulo en su columna, el
 * valor a la derecha) y garantiza que el texto nunca invada la banda del QR y
 * del codigo de barras.
 *
 * El rotulo va en la misma linea base que el valor —y no encima, como en la
 * maqueta original de la feature 32— por una razon geometrica: a dos lineas por
 * campo, los siete campos gastan ~66 mm desde `y = 24` y desbordan la banda de
 * codigos (que empieza en `y = 68`, fija), de modo que PRODUCTO / MONTO / TIENDA
 * se imprimian ENCIMA del QR. En linea gastan la mitad, y ademas coincide con la
 * vista previa DOM (`EtiquetaGuia.tsx`, `grid-cols-[auto_1fr]`).
 *
 * Lo que sobra tras el reparto se corta con puntos suspensivos: perder la cola
 * de una direccion larga es preferible a superponerla sobre el QR, que deja de
 * escanear (feature 33).
 */
function drawCampos(
  doc: jsPDF,
  layout: EtiquetaLayout,
  campos: CampoEtiqueta[],
  yLimite: number,
): void {
  const { margin, lineHeight, fieldGap } = MAQUETA_BASE;
  const xRotulo = layout.x(margin);

  // Columna del rotulo: la mide el rotulo mas ancho ("MONTO A COBRAR"), asi no
  // hay que mantener a mano un numero que depende de la fuente. `getTextWidth`
  // devuelve mm de PAGINA (la tipografia ya viene escalada), que es la unidad en
  // la que se usa: solo la `y` viaja en el lienzo base.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(layout.fontRotulo);
  const anchoRotulo =
    Math.max(...campos.map((c) => doc.getTextWidth(c.label.toUpperCase()))) +
    layout.escala(GAP_ROTULO_VALOR);
  // El ancho de corte va escalado: con 88 mm fijos sobre una hoja A4 el texto
  // se ajustaria a una columna angosta y quedaria "encogido" (design.md §4.3).
  const anchoValor = layout.contentWidth - anchoRotulo;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(layout.fontValor);
  const naturales = campos.map(
    (c) => doc.splitTextToSize(c.value, anchoValor) as string[],
  );
  const cupo = repartirLineas(
    naturales.map((l) => l.length),
    lineasDisponibles(
      CAMPOS_Y_INICIO,
      yLimite,
      lineHeight,
      fieldGap,
      campos.length,
    ),
  );
  const medir = (texto: string) => doc.getTextWidth(texto);

  let y = CAMPOS_Y_INICIO;
  campos.forEach((campo, i) => {
    const lineas = recortarConElipsis(naturales[i], cupo[i], anchoValor, medir);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(layout.fontRotulo);
    doc.text(campo.label.toUpperCase(), xRotulo, layout.y(y));

    doc.setFont("helvetica", "normal");
    doc.setFontSize(layout.fontValor);
    // Linea a linea con el interlineado de la maqueta: el avance automatico de
    // `doc.text(array)` usa el leading de la fuente y se desincronizaria del
    // `lineHeight` con el que aqui se calcula el cupo.
    lineas.forEach((linea, k) => {
      doc.text(linea, xRotulo + anchoRotulo, layout.y(y + k * lineHeight));
    });

    y += lineas.length * lineHeight + fieldGap;
  });
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

  // Codigos: QR (raster del canvas de qrcode.react) + barcode (jsbarcode).
  const qrSize = MAQUETA_BASE.qrSize;
  const qrY = LIENZO_BASE_MM - margin - qrSize;

  // R20: los nueve datos de la etiqueta, en cualquier tamaño del catalogo. El
  // limite es el borde superior del QR: el texto se ajusta a lo que queda libre.
  drawCampos(
    doc,
    layout,
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
