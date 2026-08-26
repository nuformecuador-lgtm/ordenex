import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";

import type { HojaEtiqueta } from "@/lib/config/etiquetas-hoja";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

import { drawEtiqueta } from "@/lib/pdf/etiquetas-dibujo";
import {
  registrarFuente,
  type FuenteEmbebida,
} from "@/lib/pdf/etiquetas-fuente-registro";
import { crearLayout, type EtiquetaLayout } from "@/lib/pdf/etiquetas-layout";

import { cargarFuenteEtiqueta } from "./etiquetas-fuente-carga";

// Feature 32 (T2.2, decision F1.4 (c)) — Genera el PDF descargable de etiquetas
// de guia: cada etiqueta es EXACTAMENTE una pagina y el lote produce un PDF
// multipagina (una etiqueta por pagina). NO usa window.print() (superseded por
// (c)) ni html2canvas (Tailwind v4 usa colores `oklch` que el parser clasico
// rechaza): el QR se rasteriza desde el `<canvas>` de qrcode.react (`toDataURL`)
// y el codigo de barras se dibuja con jsbarcode sobre un `<canvas>` offscreen.
//
// Feature 150 (T6) — El tamaño de pagina deja de ser fijo: llega como `hoja` del
// catalogo `lib/config/etiquetas-hoja.ts` y la maqueta se escala con
// `crearLayout` (factor unico, bloque cuadrado centrado). Las coordenadas de
// dibujo se siguen expresando en el lienzo base de 100 mm, de modo que con
// `100x100` (s = 1, offsets 0) el dibujo es identico al de la feature 32. D1:
// UNA etiqueta por pagina, escalada; nunca mosaico.
//
// Feature 282 (T17/T18) — La maqueta y el dibujo del texto YA NO viven aqui:
// son `lib/pdf/etiquetas-maqueta.ts` y `lib/pdf/etiquetas-dibujo.ts`,
// COMPARTIDOS con el generador server-side del lote. Lo unico propio de este
// modulo es lo que necesita el DOM: rasterizar el codigo de barras con jsbarcode
// y sacar el QR del canvas de la vista previa. D3 de la 150 queda revisada por
// Q1: el defecto vivia en los dos generadores y se arregla una sola vez.

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
 * `hoja` y `fuente` son parametros OBLIGATORIOS a proposito: con un default
 * silencioso, un llamador que olvidase propagar la eleccion del usuario
 * produciria siempre 100x100, y uno que olvidase la fuente volveria a imprimir
 * el importe sin simbolo. Los dos bugs pasarian inadvertidos; asi los caza el
 * compilador.
 *
 * La funcion sigue siendo SINCRONA y pura respecto de la fuente: se puede probar
 * con la fuente real sin tocar el `import()` diferido. Quien cruza ese borde es
 * `descargarEtiquetasPdf`.
 */
export function buildEtiquetasPdf(
  etiquetas: EtiquetaGuiaDTO[],
  qrCanvases: Map<string, HTMLCanvasElement>,
  hoja: HojaEtiqueta,
  fuente: FuenteEmbebida,
): jsPDF {
  const layout = crearLayout(hoja);
  const format: [number, number] = [hoja.anchoMm, hoja.altoMm];
  const doc = new jsPDF({ unit: "mm", format });
  // Una sola vez por documento: `addFont` descodifica y parsea el TTF entero.
  registrarFuente(doc, fuente);
  etiquetas.forEach((etiqueta, index) => {
    if (index > 0) doc.addPage(format);
    const qrCanvas = qrCanvases.get(etiqueta.ordenId);
    drawEtiqueta(
      doc,
      layout,
      etiqueta,
      {
        qr: qrCanvas ? qrCanvas.toDataURL("image/png") : null,
        barcode: barcodeDataUrl(etiqueta.barcodeValue, layout),
      },
      fuente,
    );
  });
  return doc;
}

/**
 * Ensambla y descarga el PDF multipagina de etiquetas. Se llama SOLO cuando hay
 * al menos una etiqueta imprimible (R10/R12 de la feature 32; el modal garantiza
 * la precondicion) y con la hoja elegida en el selector (R9).
 *
 * Es `async` desde la feature 282 porque la fuente embebida viaja en un chunk
 * diferido: aqui, y solo aqui, se cruza ese borde. Si la fuente no puede
 * cargarse el error SE PROPAGA y no se descarga nada (R16): degradar en silencio
 * a Helvetica seria volver a imprimir «¡ 8 0» sin que nadie se entere, que es
 * exactamente el defecto que esta ficha cierra.
 */
export async function descargarEtiquetasPdf(
  etiquetas: EtiquetaGuiaDTO[],
  qrCanvases: Map<string, HTMLCanvasElement>,
  hoja: HojaEtiqueta,
): Promise<void> {
  const fuente = await cargarFuenteEtiqueta();
  const doc = buildEtiquetasPdf(etiquetas, qrCanvases, hoja, fuente);
  doc.save(etiquetasPdfFilename(hoja));
}
