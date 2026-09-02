import {
  celdaDeHoja,
  getHojaEtiqueta,
  type CeldaEtiqueta,
  type HojaEtiqueta,
} from "@/lib/config/etiquetas-hoja";

import {
  ANCHO_UTIL_BASE_MM,
  BARCODE_MM,
  CUERPOS_BASE,
  CUERPO_MINIMO_PT,
  LIENZO_BASE_MM,
  MAQUETA_BASE,
  MARGEN_MM,
  QR_MM,
} from "./etiquetas-maqueta";

// Feature 150 (T4) — Aritmetica del escalado de la etiqueta de guia.
//
// Feature 282 (T17) — MUDADO desde `app/(app)/ordenes/_components/` a `lib/pdf/`
// sin archivo-puente. Motivo: el generador server-side del lote usa el MISMO
// `crearLayout` y no puede importar de `app/`. Un puente re-exportador seria otro
// sitio donde volver a divergir, que es justo lo que aquella ficha vino a cerrar.
//
// ---------------------------------------------------------------------------
// Feature 350 (T7) — DOS ESCALAS DISTINTAS, Y ESA SEPARACION ES EL REDISEÑO.
//
// Lo que habia: un factor UNICO `s = min(ancho, alto) / 100` que multiplicaba a
// la vez las coordenadas y la tipografia, con el bloque cuadrado centrado. Como
// el ancho de columna crecia exactamente igual que el cuerpo, `splitTextToSize`
// partia en el MISMO numero de lineas en las cuatro hojas: las cuatro tenian la
// misma capacidad de texto y A4 tiraba 87 mm de papel. Aquel `offY` de 43,5 mm
// en A4 era, literalmente, la mitad del papel desperdiciado.
//
// Lo que hay:
//
//  | Que        | Como escala                     | Por que                                 |
//  |------------|---------------------------------|-----------------------------------------|
//  | Geometria  | con el AREA REAL de la celda    | el alto extra se vuelve LINEAS (R10)    |
//  | Tipografia | `k = anchoUtil / anchoUtilBase` | mantiene los caracteres por linea (R11) |
//  | Suelo (R6) | NO escala                       | la legibilidad es fisica: 7 pt son 7 pt |
//
// `x()` e `y()` ya no mapean «coordenadas del lienzo 0-100»: mapean **mm
// relativos al area util** de la celda a mm de pagina. No hay factor geometrico:
// un milimetro de la maqueta es un milimetro de papel en las cuatro hojas.
//
// Lo que el escalado por el lado menor protegia de verdad —no deformar el QR ni
// los modulos del CODE128, no salirse de la pagina— se conserva y se endurece: el
// QR sigue siendo cuadrado, el barcode conserva la relacion de aspecto de su
// raster (R12) y `V3` afirma sobre el PDF que nada sale de la celda (R4).

export { LIENZO_BASE_MM, MAQUETA_BASE };

/** Cuerpos tipograficos de la etiqueta YA escalados por `k`, en pt de pagina. */
export interface CuerposLayout {
  rotulo: number;
  guia: number;
  remision: number;
  destinatario: number;
  telefono: number;
  direccion: number;
  ubicacion: number;
  importe: number;
  detalle: number;
}

export interface EtiquetaLayout {
  /** Hoja del catalogo para la que se calculo el layout. */
  hoja: HojaEtiqueta;
  /** Rectangulo de papel de ESTA etiqueta, en mm de pagina (Q1: rejilla). */
  celda: CeldaEtiqueta;
  /** Margen entre el borde de la celda y el contenido, en mm (R9). */
  margen: number;
  /** Ancho util = celda.ancho - 2 x margen. */
  anchoUtil: number;
  /** Alto util = celda.alto - 2 x margen. */
  altoUtil: number;
  /**
   * Escala TIPOGRAFICA. Sale del ANCHO y no del lado menor: conservarla
   * proporcional al ancho mantiene constantes los caracteres por linea, y asi
   * TODO el alto adicional de la hoja es capacidad neta (R10/R11).
   */
  k: number;
  /** Suelo de legibilidad en pt de PAGINA. Absoluto: no se multiplica por `k` (R6). */
  cuerpoMinimoPt: number;
  /** Cuerpos base ya multiplicados por `k`. */
  cuerpos: CuerposLayout;
  /** Lado del QR, en mm. Nunca por debajo del de la celda base (R12). */
  qrMm: number;
  /** Alto del codigo de barras, en mm. Nunca por debajo del de la celda base (R12). */
  barcodeMm: number;
  /** Opciones del raster del codigo de barras, redondeadas hacia arriba (R12). */
  barcodeRaster: { width: number; height: number; fontSize: number };
  /** mm relativos al AREA UTIL -> mm de pagina, eje X. */
  x: (v: number) => number;
  /** mm relativos al AREA UTIL -> mm de pagina, eje Y. */
  y: (v: number) => number;
  /** Un cuerpo base de la maqueta llevado a esta hoja (`base * k`). */
  cuerpo: (base: number) => number;
}

/**
 * Construye el layout de la celda `indiceCelda` de una hoja del catalogo.
 *
 * Con `100x100` (rejilla 1 x 1) sale `k = 1`, la celda es la hoja entera y el
 * area util es la misma de siempre: el default no es una regresion de escala —el
 * mismo criterio con el que la feature 150 justifico su `s = 1`—.
 *
 * `indiceCelda` existe por la **Q1** (cuatro etiquetas por hoja), que sigue
 * abierta: con la rejilla de hoy siempre vale 0 y `celdaDeHoja` devuelve la hoja
 * entera, asi que ni el ajuste ni el dibujo se enteran de que el concepto existe.
 */
export function crearLayout(hoja: HojaEtiqueta, indiceCelda = 0): EtiquetaLayout {
  const celda = celdaDeHoja(hoja, indiceCelda);
  const anchoUtil = celda.ancho - 2 * MARGEN_MM;
  const altoUtil = celda.alto - 2 * MARGEN_MM;
  const k = anchoUtil / ANCHO_UTIL_BASE_MM;

  // `max(1, k)` y no `k` a secas: con la rejilla de Q1 una celda de 99 mm daria
  // k = 0,99 y el QR encogeria por debajo de los 26 mm con los que hoy se
  // imprime, que es exactamente lo que R12 prohibe. Los codigos crecen con la
  // hoja pero NUNCA menguan.
  const kCodigos = Math.max(1, k);

  const cuerpo = (base: number) => base * k;

  return {
    hoja,
    celda,
    margen: MARGEN_MM,
    anchoUtil,
    altoUtil,
    k,
    cuerpoMinimoPt: CUERPO_MINIMO_PT,
    cuerpos: {
      rotulo: cuerpo(CUERPOS_BASE.rotulo),
      guia: cuerpo(CUERPOS_BASE.guia),
      remision: cuerpo(CUERPOS_BASE.remision),
      destinatario: cuerpo(CUERPOS_BASE.destinatario),
      telefono: cuerpo(CUERPOS_BASE.telefono),
      direccion: cuerpo(CUERPOS_BASE.direccion),
      ubicacion: cuerpo(CUERPOS_BASE.ubicacion),
      importe: cuerpo(CUERPOS_BASE.importe),
      detalle: cuerpo(CUERPOS_BASE.detalle),
    },
    qrMm: QR_MM * kCodigos,
    barcodeMm: BARCODE_MM * kCodigos,
    x: (v: number) => celda.x0 + MARGEN_MM + v,
    y: (v: number) => celda.y0 + MARGEN_MM + v,
    cuerpo,
    // R12: si solo se escalaran los milimetros, en A4 la misma imagen se
    // estiraria 2,25x y las barras quedarian pixeladas (ilegibles para un lector
    // laser). Se redondea SIEMPRE hacia arriba para que la densidad efectiva
    // (px/mm) nunca baje respecto de la celda base.
    barcodeRaster: {
      width: Math.ceil(2 * kCodigos),
      height: Math.ceil(60 * kCodigos),
      fontSize: Math.round(18 * kCodigos),
    },
  };
}

/**
 * Layout de la CELDA BASE: 100 x 100 mm, `k = 1`, celda en el origen.
 *
 * Existe para que el generador server-side del lote (feature 136) use la misma
 * maqueta compartida SIN importar el catalogo de tamaños de la feature 150. Esa
 * separacion no es cosmetica: el PDF consolidado que reciben los integradores por
 * API es 100 x 100 fijo y no tiene —ni debe ganar— un parametro de tamaño (D3 de
 * la 150, blindada en `etiquetas-pdf-lote.smoke.test.ts`, R20).
 */
export function crearLayoutBase(): EtiquetaLayout {
  return crearLayout(getHojaEtiqueta("100x100"));
}
