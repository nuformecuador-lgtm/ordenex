import type { HojaEtiqueta } from "@/lib/config/etiquetas-hoja";

// Feature 150 (T4) — Aritmetica del escalado de la etiqueta de guia.
//
// La maqueta de `etiquetas-pdf.ts` (feature 32) esta expresada en mm sobre un
// LIENZO CUADRADO de 100 x 100 con margen 6. Este modulo traduce ese lienzo a
// cualquier hoja del catalogo con un UNICO factor de escala (R14) y centrado en
// ambos ejes (R15).
//
// Vive aqui (junto a su unico consumidor) y no en `lib/`, pero se separa de
// `etiquetas-pdf.ts` por una razon concreta: aquel modulo toca
// `document`/`canvas` y no es testeable en Node, mientras que toda esta
// aritmetica si lo es. Sin la separacion, R14-R17 no tendrian test barato y
// determinista.

/** Lado del lienzo base de la maqueta en mm (feature 32, decision F1.4 (c)). */
export const LIENZO_BASE_MM = 100;

/**
 * Constantes de la maqueta base, en mm salvo las tipograficas (pt). Se exportan
 * porque el generador dibuja en coordenadas del lienzo base y las mapea con
 * `layout.x()/y()`: asi la maqueta de la feature 32 se lee igual que antes.
 */
export const MAQUETA_BASE = {
  margin: 6,
  fontRotulo: 8,
  fontValor: 9,
  fontRemision: 10,
  fontGuia: 22,
  lineHeight: 4,
  fieldGap: 1.5,
  qrSize: 26,
  barcodeHeight: 16,
  gapQrBarcode: 4,
} as const;

export interface EtiquetaLayout {
  /** Hoja del catalogo para la que se calculo el layout. */
  hoja: HojaEtiqueta;
  /** Factor unico de escala, el mismo en X y en Y (R14). */
  s: number;
  /** Lado del bloque cuadrado dibujado, en mm (= 100 · s). */
  lado: number;
  /** Desplazamiento del bloque para centrarlo, en mm (R15). */
  offX: number;
  offY: number;
  /** Constantes de la maqueta ya escaladas por `s` (R16). */
  margin: number;
  contentWidth: number;
  fontRotulo: number;
  fontValor: number;
  fontRemision: number;
  fontGuia: number;
  lineHeight: number;
  fieldGap: number;
  qrSize: number;
  barcodeHeight: number;
  gapQrBarcode: number;
  /** Mapea una coordenada X del lienzo base (0-100) a la pagina, en mm. */
  x: (v: number) => number;
  /** Mapea una coordenada Y del lienzo base (0-100) a la pagina, en mm. */
  y: (v: number) => number;
  /** Escala una magnitud del lienzo base (sin desplazarla). */
  escala: (v: number) => number;
  /** Opciones del raster del codigo de barras, escaladas hacia arriba (R18). */
  barcodeRaster: { width: number; height: number; fontSize: number };
}

/**
 * Construye el layout escalado para una hoja del catalogo.
 *
 * El factor sale del LADO MENOR (`s = min(ancho, alto) / 100`) y se aplica igual
 * a los dos ejes: escalar cada eje por su propio factor deformaria el QR y los
 * modulos del CODE128 (dejarian de escanearse, feature 33) y escalar por el lado
 * mayor desbordaria la pagina (en A4, 297 mm de bloque sobre 210 de ancho),
 * violando R17. Las bandas sobrantes del lado mayor quedan en blanco, repartidas
 * por igual arriba y abajo (R15): margenes iguales para el corte manual en
 * A4/carta y absorcion simetrica del desalineado del medio termico en 4x6 in.
 *
 * Con `100x100` sale s = 1 y offX = offY = 0, es decir el dibujo por defecto es
 * exactamente el de la maqueta actual: el default no es una regresion visual.
 */
export function crearLayout(hoja: HojaEtiqueta): EtiquetaLayout {
  // `lado` sale directo del lado menor y NO de `100 * s`: el ida y vuelta por el
  // factor introduce error de coma flotante (101.6 -> 101.60000000000001) y
  // dejaria offsets de -1e-14, negativos, que violan R17 por ruido numerico.
  const lado = Math.min(hoja.anchoMm, hoja.altoMm);
  const s = lado / LIENZO_BASE_MM;
  // Se calculan los dos, no se asume que el lado menor sea siempre el ancho: el
  // catalogo podria crecer con una hoja apaisada.
  const offX = (hoja.anchoMm - lado) / 2;
  const offY = (hoja.altoMm - lado) / 2;

  return {
    hoja,
    s,
    lado,
    offX,
    offY,
    margin: MAQUETA_BASE.margin * s,
    contentWidth: (LIENZO_BASE_MM - MAQUETA_BASE.margin * 2) * s,
    fontRotulo: MAQUETA_BASE.fontRotulo * s,
    fontValor: MAQUETA_BASE.fontValor * s,
    fontRemision: MAQUETA_BASE.fontRemision * s,
    fontGuia: MAQUETA_BASE.fontGuia * s,
    lineHeight: MAQUETA_BASE.lineHeight * s,
    fieldGap: MAQUETA_BASE.fieldGap * s,
    qrSize: MAQUETA_BASE.qrSize * s,
    barcodeHeight: MAQUETA_BASE.barcodeHeight * s,
    gapQrBarcode: MAQUETA_BASE.gapQrBarcode * s,
    x: (v: number) => offX + s * v,
    y: (v: number) => offY + s * v,
    escala: (v: number) => s * v,
    // R18: si solo se escalaran los milimetros, en A4 la misma imagen se
    // estiraria 2.1x y las barras quedarian pixeladas (ilegibles para un lector
    // laser). Se redondea SIEMPRE hacia arriba para que la densidad efectiva
    // (px/mm) nunca baje respecto de 100x100.
    barcodeRaster: {
      width: Math.ceil(2 * s),
      height: Math.ceil(60 * s),
      fontSize: Math.round(18 * s),
    },
  };
}
