import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import bwipjs from "bwip-js/node";

import { buildPaqueteUrl } from "@/lib/utils/paquete-url";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

import { drawEtiqueta } from "./etiquetas-dibujo";
import { fuenteEtiqueta } from "./etiquetas-fuente";
import { registrarFuente } from "./etiquetas-fuente-registro";
import { crearLayoutBase } from "./etiquetas-layout";
import { LIENZO_BASE_MM } from "./etiquetas-maqueta";

// Feature 136 (T1.2) — Builder SERVER-SIDE del PDF consolidado de etiquetas de
// guia. Corre en el runtime Node del endpoint de carga por API (R7): sin DOM, sin
// canvas del navegador. Rasteriza el QR con `qrcode` (data URL) y el codigo de
// barras con `bwip-js` (PNG en buffer), ambas libs pure-JS.
//
// Feature 282 (T17/T20) — Este archivo YA NO declara su propia maqueta.
//
// Lo que habia antes: una copia de las constantes y del `drawCampos` del
// generador de cliente, con una cabecera que la declaraba «espejo EXACTO» de
// aquel. **No lo era, y se pudo medir**: la feature 150 llevo el de cliente a
// constantes escaladas y aqui seguian `8`, `22` y `10` escritos a mano. Un
// espejo mantenido a mano diverge en cuanto alguien toca un lado, y esta ficha
// existe porque el mismo defecto —la guia pisando la primera fila y el simbolo
// del colon sin imprimir— vivia por duplicado. Ahora la geometria sale de
// `etiquetas-maqueta.ts` y el dibujo de `etiquetas-dibujo.ts`, compartidos con
// el generador de cliente; lo unico propio de este archivo es el rasterizado,
// que es distinto POR RUNTIME.
//
// El catalogo de tamaños de la feature 150 sigue siendo del cliente: aqui se usa
// `crearLayoutBase()` (100 x 100, `s = 1`, offsets 0), asi que el PDF que reciben
// los integradores por API conserva su pagina fija y su firma de un solo
// parametro (R18).

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
 *
 * Feature 282 — La fuente embebida se registra UNA VEZ por documento, con un
 * import ESTATICO del artefacto: nada de `readFileSync` (R23). `next.config.ts`
 * no declara ningun `outputFileTracingIncludes`, asi que un `.ttf` suelto leido
 * por ruta en tiempo de ejecucion depende del trazado automatico y podria no
 * llegar a la function; el fallo aparecerian SOLO en produccion, como un error
 * en la carga por API, que es el peor sitio posible para descubrirlo.
 */
export async function buildEtiquetasLotePdf(etiquetas: EtiquetaGuiaDTO[]): Promise<Uint8Array> {
  const format: [number, number] = [LIENZO_BASE_MM, LIENZO_BASE_MM];
  const doc = new jsPDF({ unit: "mm", format, compress: true });
  // Una sola vez por documento: `addFont` descodifica y parsea el TTF entero, y
  // ese coste se paga por PDF, no por pagina (design.md §11.2).
  registrarFuente(doc, fuenteEtiqueta);
  const layout = crearLayoutBase();
  for (let i = 0; i < etiquetas.length; i++) {
    if (i > 0) doc.addPage(format);
    const etiqueta = etiquetas[i];
    const qr = await qrDataUrl(buildPaqueteUrl(etiqueta.numGuia));
    const barcode = await barcodeDataUrl(etiqueta.barcodeValue);
    drawEtiqueta(doc, layout, etiqueta, { qr, barcode }, fuenteEtiqueta);
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
