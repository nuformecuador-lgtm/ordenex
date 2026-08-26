// Feature 282 (T17) — LA UNICA FUENTE DE VERDAD de la geometria de la etiqueta
// de guia (R21). La consumen los DOS generadores: el de cliente
// (`app/(app)/ordenes/_components/etiquetas-pdf.ts`, jsbarcode + canvas del DOM)
// y el server-side del lote (`lib/pdf/etiquetas-pdf-lote.ts`, qrcode + bwip-js).
//
// Por que se comparte en vez de duplicarse, con el hecho que lo decide: la
// cabecera del generador del servidor declaraba ser «espejo EXACTO» del de
// cliente, y **ya no lo era**. La feature 150 llevo el de cliente a constantes
// escaladas (`layout.fontRotulo`, `layout.fontGuia`…) mientras el del servidor
// conservaba `8`, `22` y `10` escritos a mano. Un espejo mantenido a mano
// diverge en cuanto alguien toca un lado, y esta ficha existe porque el MISMO
// defecto vivia por duplicado. El precedente del repo es el correcto:
// `etiquetas-ajuste.ts` se extrajo para «que las dos maquetas no vuelvan a
// divergir en este punto»; aqui se extiende al resto de la geometria.
//
// Vive en `lib/pdf/` porque el generador del lote corre en Node y no puede
// importar de `app/`.

/** Lado del lienzo base de la maqueta en mm (feature 32, decision F1.4 (c)). */
export const LIENZO_BASE_MM = 100;

/** Un punto tipografico en milimetros. */
export const PT_A_MM = 25.4 / 72;

const MARGIN = 6;

/**
 * Constantes de la maqueta base, en mm salvo las tipograficas (pt). Se exportan
 * porque los generadores dibujan en coordenadas del lienzo base y las mapean con
 * `layout.x()/y()`: asi la maqueta de la feature 32 se lee igual que antes.
 */
export const MAQUETA_BASE = {
  margin: MARGIN,
  fontRotulo: 8,
  fontValor: 9,
  fontRemision: 10,
  fontGuia: 22,
  lineHeight: 4,
  // Separacion ENTRE campos. Bajo de 1.5 a 1.0 al pasar la maqueta a rotulo y
  // valor en la misma linea (ver `drawCampos` en etiquetas-dibujo.ts): con 1.5
  // el cupo vertical se quedaba en 9 lineas para 7 campos y una direccion real
  // de tres lineas ya obligaba a recortar.
  fieldGap: 1.0,
  qrSize: 26,
  barcodeHeight: 16,
  gapQrBarcode: 4,
  /** Linea base de los rotulos de cabecera ("GUÍA" y "REMISIÓN"). */
  cabeceraY: MARGIN + 2,
  /** Linea base del NUMERO DE GUIA, el texto grande. No cambia (R27). */
  guiaY: MARGIN + 10,
  /** Linea base del numero de remision. */
  remisionY: MARGIN + 7,
  /** Cuanto baja el codigo de barras respecto del borde superior del QR. */
  barcodeOffsetY: 6,
} as const;

/** Aire entre la ultima linea de texto y el borde superior del QR, en mm base. */
export const GAP_TEXTO_CODIGOS = 2;

/** Separacion entre la columna del rotulo y la del valor, en mm base. */
export const GAP_ROTULO_VALOR = 2;

/**
 * Linea base de la PRIMERA fila del bloque de campos, DERIVADA del cuerpo del
 * numero de guia (R1, R2). Antes era la constante `18`, y ahi estaba el bug:
 * la guia se dibuja en `y = 16` con un cuerpo de 22 pt (7,76 mm), asi que la
 * fila «DESTINATARIO» arrancaba **2 mm** por debajo de una linea que necesita
 * casi ocho. El numero de guia pisaba la primera fila en TODAS las etiquetas.
 *
 * La regla es «un cuerpo entero (1 em) del numero de guia por debajo de su linea
 * base». Un em y no una fraccion medida porque las metricas de tinta
 * (ascendente, descendente, bbox) de las 14 fuentes estandar NO estan en el
 * repo —jsPDF solo expone `metadata.bbox` de fuentes embebidas—, asi que
 * cualquier fraccion seria un numero inventado. 1 em del cuerpo mayor cubre con
 * holgura el descendente del numero (que ademas, siendo digitos, es cero) mas el
 * ascendente de la primera fila, que se dibuja a 8-9 pt.
 *
 * Que se DERIVE es el requisito, no un detalle de estilo: si mañana alguien
 * cambia `fontGuia`, la primera fila baja sola. Y como `crearLayout` escala
 * coordenadas y tipografias con el MISMO factor `s`, la desigualdad
 * `camposYInicio - guiaY >= fontGuia * PT_A_MM` se conserva exactamente al
 * multiplicar los dos lados por `s`: vale para las cuatro hojas del catalogo por
 * construccion, no por haber probado cuatro casos.
 *
 * Coste, con la aritmetica delante: con 23,7611 el cupo de
 * `lineasDisponibles(yInicio, 66, 4, 1.0, 7)` baja de 11 a 10 lineas. Se cede esa
 * linea (decision firmada Q3) y NO se añade ningun termino de aire extra: el
 * umbral que costaria la segunda linea esta en 24,0 mm y quedan 0,24 mm.
 */
export function camposYInicio(fontGuia: number = MAQUETA_BASE.fontGuia): number {
  return MAQUETA_BASE.guiaY + fontGuia * PT_A_MM;
}

/**
 * Borde superior de la banda de codigos (QR + codigo de barras) en el lienzo
 * base. Es una `y` FIJA pegada al borde inferior: el texto fluye hacia abajo
 * desde la cabecera y `etiquetas-ajuste.ts` decide cuantas lineas caben antes de
 * llegar aqui. No se comprime (R27): ahi leen las pistolas de escaner.
 */
export function qrTopBase(): number {
  return LIENZO_BASE_MM - MAQUETA_BASE.margin - MAQUETA_BASE.qrSize;
}

/** Limite inferior del texto: el borde del QR menos el aire de seguridad. */
export function textoYLimite(): number {
  return qrTopBase() - GAP_TEXTO_CODIGOS;
}
