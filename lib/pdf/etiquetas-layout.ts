import { getHojaEtiqueta, type HojaEtiqueta } from "@/lib/config/etiquetas-hoja";

import { LIENZO_BASE_MM, MAQUETA_BASE } from "./etiquetas-maqueta";

// Feature 150 (T4) — Aritmetica del escalado de la etiqueta de guia.
//
// La maqueta (feature 32) esta expresada en mm sobre un LIENZO CUADRADO de
// 100 x 100 con margen 6, y vive en `etiquetas-maqueta.ts`. Este modulo la
// traduce a cualquier hoja del catalogo con un UNICO factor de escala (R14) y
// centrado en ambos ejes (R15).
//
// Feature 282 (T17) — MUDADO desde `app/(app)/ordenes/_components/` a `lib/pdf/`
// sin archivo-puente. Motivo: el generador server-side del lote pasa a usar el
// MISMO `crearLayout` (con `s = 1` y offsets 0, o sea el mismo resultado
// numerico que sus literales de antes) y no puede importar de `app/`. Un puente
// re-exportador seria otro sitio donde volver a divergir, que es justo lo que
// esta ficha viene a cerrar.

export { LIENZO_BASE_MM, MAQUETA_BASE };

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

/**
 * Layout del LIENZO BASE: 100 x 100 mm, `s = 1`, offsets 0.
 *
 * Existe para que el generador server-side del lote (feature 136) use la misma
 * maqueta compartida SIN importar el catalogo de tamaños de la feature 150. Esa
 * separacion no es cosmetica: el PDF consolidado que reciben los integradores
 * por API es 100 x 100 fijo y no tiene —ni debe ganar— un parametro de tamaño
 * (D3 de la 150, blindada en `etiquetas-pdf-lote.smoke.test.ts`). Con `s = 1` el
 * resultado numerico es identico al de los literales que aquel generador tenia
 * escritos a mano.
 */
export function crearLayoutBase(): EtiquetaLayout {
  return crearLayout(getHojaEtiqueta("100x100"));
}
