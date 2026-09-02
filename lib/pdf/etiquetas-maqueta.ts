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
//
// ---------------------------------------------------------------------------
// Feature 350 — LA ETIQUETA DEJA DE SER UN CUADRADO ESCALADO.
//
// Lo que habia: un lienzo de 100 x 100 con coordenadas absolutas (`guiaY: 16`,
// `qrTopBase() = 68`) que `crearLayout` multiplicaba entero por un factor unico
// `s = min(ancho, alto) / 100`. Consecuencia aritmetica, no opinion: **las
// cuatro hojas tenian la misma capacidad de texto**, porque el ancho de columna
// crecia exactamente igual que el cuerpo tipografico. Elegir A4 solo agrandaba
// la letra (la guia a 46,2 pt) y dejaba 87 mm de papel en blanco.
//
// Lo que hay: la celda es un **presupuesto de milimetros repartido entre cinco
// bandas** (R13). La geometria se reparte con el area REAL de la celda —el alto
// sobrante se vuelve LINEAS (R10)— y la tipografia escala con el ANCHO
// (`k = anchoUtil / anchoUtilBase`), de modo que los caracteres por linea se
// mantienen y todo el alto adicional es capacidad neta (R11). El suelo de
// legibilidad NO escala: 7 pt en A4 son 7 pt de tinta (R6).
//
// Las coordenadas absolutas del lienzo viejo (`cabeceraY`, `guiaY`, `remisionY`,
// `qrTopBase`, `textoYLimite`, `camposYInicio`) DESAPARECEN: ninguna posicion
// vertical se escribe a mano, todas se derivan del cuerpo tipografico que las
// gobierna. Lo que aquellas protegian de verdad —que el numero de guia no pise
// la linea siguiente— se conserva en `separacionBajoGuiaMm`, con su
// justificacion intacta.

/**
 * Lado del lienzo base en mm. Se conserva con este nombre porque es TAMBIEN el
 * formato de pagina del generador del lote (100 x 100 fijo, R20) y la unidad en
 * la que el catalogo declara sus hojas.
 */
export const LIENZO_BASE_MM = 100;

/** Lado de la CELDA base: el rectangulo de papel de una etiqueta de referencia. */
export const CELDA_BASE_MM = LIENZO_BASE_MM;

/** Un punto tipografico en milimetros. */
export const PT_A_MM = 25.4 / 72;

/** Margen entre el borde de la celda y el contenido, en mm de pagina (R9). */
export const MARGEN_MM = 6;

/** Ancho util de la celda base: 100 - 2 x 6. Es el denominador de `k` (§5.1). */
export const ANCHO_UTIL_BASE_MM = CELDA_BASE_MM - 2 * MARGEN_MM;

/**
 * SUELO DE LEGIBILIDAD, en puntos de PAGINA (R6). No se multiplica por ninguna
 * escala: la legibilidad es fisica, 7 pt en A4 son 7 pt de tinta.
 *
 * De donde sale el 7,0 y con que autoridad, porque el numero se pregunto (Q2) y
 * se firmo: el repo NO tiene ninguna fuente sobre legibilidad en papel; lo unico
 * medido es que hoy se imprimen y se leen rotulos a **8 pt** en la celda base.
 * Estas etiquetas salen por impresora TERMICA de 203 dpi, donde a 6 pt las
 * tildes y la «ñ» quedan al borde de lo que el cabezal resuelve —y el texto que
 * peor se leeria seria justo la direccion—. 7,0 es un paso corto desde la unica
 * evidencia que existe; 6,0 era un salto sin nada que lo sostenga.
 *
 * Que ningun texto baje de aqui es imposible POR CONSTRUCCION, no por
 * convencion: `ajustarBloque` devuelve `cabe: false` y el llamador lanza
 * `ErrorEtiquetaNoCabe` (R7). No hay rama que dibuje por debajo de este valor.
 */
export const CUERPO_MINIMO_PT = 7.0;

/**
 * Paso de la busqueda descendente del ajuste, en pt. Es tambien la MINIMA
 * diferencia de cuerpo que el motor sabe expresar, y por eso sirve para
 * garantizar el «estrictamente mayor» de R14 (ver `CUERPO_MINIMO_DESTACADO_PT`).
 */
export const PASO_AJUSTE_PT = 0.25;

/**
 * Suelo de los datos DESTACADOS del bloque de destino (destinatario y telefono).
 *
 * R14 exige que su cuerpo sea **estrictamente mayor** que el de producto y
 * tienda, y R6 prohibe que nada baje de `CUERPO_MINIMO_PT`. Las dos a la vez
 * obligan a que el destacado tenga un suelo propio: si el destinatario pudiera
 * bajar a 7,0 y el producto tambien, quedarian IGUALES y R14 se violaria
 * justo en el caso extremo, que es el que esta ficha viene a cerrar. Un paso del
 * ajuste por encima es la diferencia minima expresable.
 */
export const CUERPO_MINIMO_DESTACADO_PT = CUERPO_MINIMO_PT + PASO_AJUSTE_PT;

/**
 * Interlineado como MULTIPLO del cuerpo. No es un numero nuevo: es exactamente
 * la densidad que hoy se imprime —4 mm a 9 pt— despejada,
 * `4 / (9 * 25,4/72) = 1,26`. Se conserva la densidad ya validada en papel en
 * vez de estrenar una.
 *
 * El 0,26 sobrante por encima del cuerpo es ademas la reserva del descendente de
 * la ultima linea de cada bloque: Helvetica desciende ~0,21 em.
 */
export const INTERLINEADO = 1.26;

/**
 * Cuerpos BASE de cada elemento, en pt de la celda base (`k = 1`). Los del
 * destino y el detalle son el PUNTO DE PARTIDA del ajuste (§4.3): bajan cuando
 * hace falta y suben cuando sobra sitio. Los de la cabecera son fijos.
 *
 * De donde sale cada uno:
 *  - `rotulo` 8: no se toca (282/R24). Es el cuerpo de TODOS los rotulos
 *    diminutos de la etiqueta: «ORDENEX · GUÍA», «PARA», «CONTENIDO», «TIENDA».
 *  - `guia` **30**: feature 353. Ver la nota de abajo.
 *  - `remision` 10: no se toca (feature 295). Gobierna la fila «REM … FECHA …».
 *  - `destinatario` 13 y `telefono` 12: D3, jerarquia por TAMAÑO.
 *  - `direccion` 10: gana ancho por D2 (se va la columna de rotulos).
 *  - `ubicacion` 9: igual que antes.
 *  - `importe` 16: es lo que el mensajero tiene que cobrar (D3).
 *  - `detalle` 8: el «cuerpo menor» de D3 para producto y tienda.
 *
 * FEATURE 353 — EL NUMERO DE GUIA PASA DE 22 A 30 pt, y no es una preferencia:
 * es la medida del diseño aprobado. Sobre el lienzo de 100 mm el numero mide
 * ~10,6 mm de alto de caja, y `10,6 / (25,4/72) = 30,0` pt. A 22 pt su caja mide
 * 7,76 mm —el 73 % de lo aprobado— y deja de ser el elemento dominante de la
 * etiqueta, que es literalmente lo que el humano reclamo.
 *
 * NO CUESTA NI UN MILIMETRO de capacidad, y esa es la razon por la que se puede
 * hacer sin reabrir nada de la 350: el alto de la cabecera lo manda el QR
 * (`max(QR_MM, pila de texto)`) y la pila con 30 pt mas la fila «REM … FECHA …»
 * mide ~24,9 mm, por debajo de los 26 del QR. Medido en `progress/impl_353.md`.
 */
export const CUERPOS_BASE = {
  rotulo: 8,
  guia: 30,
  remision: 10,
  destinatario: 13,
  telefono: 12,
  direccion: 10,
  ubicacion: 9,
  importe: 16,
  detalle: 8,
} as const;

/**
 * Feature 353 — GROSORES DE TRAZO de la celda base, en mm.
 *
 * Los dos salen del diseño aprobado y viven aqui —y no como literales dentro del
 * dibujo— por el mismo motivo que el resto de la maqueta: son geometria
 * compartida por los DOS generadores y la guardia
 * `etiquetas-maqueta-unica.guardia.test.ts` prohibe que cualquiera de ellos
 * declare un valor que el otro tambien declara.
 *
 * `GROSOR_RECUADRO_MM` era 0,3 antes de la 353 y el diseño pide «borde grueso»
 * para el recuadro del importe: es el unico elemento enmarcado de la etiqueta y a
 * 0,3 mm el marco se leia como una linea de tabla, no como un recuadro.
 */
export const GROSOR_RECUADRO_MM = 0.6;

/**
 * Grosor de la REGLA HORIZONTAL que separa la cabecera del resto (feature 353).
 *
 * Se dibuja centrada en la separacion que ya existia entre las bandas de
 * cabecera y destino (`GAPS_ENTRE_BANDAS[0]` = 2 mm), asi que NO consume ni un
 * milimetro del presupuesto vertical: con 0,4 mm de grosor ocupa
 * [0,8 ; 1,2] mm dentro de ese hueco y deja 0,8 mm de aire a cada lado.
 */
export const GROSOR_REGLA_MM = 0.4;

/** Lado del QR en la celda base, en mm. NO se comprime: ahi leen las pistolas (R12). */
export const QR_MM = 26;

/** Alto del codigo de barras en la celda base, en mm. Tampoco se comprime (R12). */
export const BARCODE_MM = 16;

/**
 * Aire entre el texto y la banda de codigos, en mm. Constante HEREDADA de la
 * feature 282 con su valor intacto: es la separacion que ya se imprime hoy entre
 * la ultima linea de texto y el borde del QR.
 */
export const GAP_TEXTO_CODIGOS = 2;

/**
 * Separacion entre bandas de TEXTO, en mm. Es el `fieldGap` de la maqueta
 * anterior con su valor intacto (1,0): la separacion que hoy ya se imprime entre
 * dos campos consecutivos.
 *
 * Se REUSAN las dos constantes que ya existian en vez de estrenar una separacion
 * uniforme, y no es cosmetica: los `4 x 2 mm` que estimaba `design.md` §5.5
 * costaban 8 mm del presupuesto vertical y el peor caso medido no cabia por
 * 5,56 mm. Derivarlas de lo ya impreso devuelve 3 mm sin inventar ningun numero
 * y sin tocar el margen (que es tolerancia al desalineado del medio termico).
 * La medida completa esta en `progress/impl_350.md`.
 */
export const GAP_CAMPOS_MM = 1.0;

/** Separacion entre un rotulo y su valor cuando comparten linea, en mm. */
export const GAP_ROTULO_VALOR = 2;

/**
 * Las CINCO bandas verticales de la etiqueta, de arriba abajo (R13). El orden es
 * el requisito, no un detalle de forma: `V3` afirma sobre el PDF que sus
 * intervalos son disjuntos y estan en esta secuencia.
 */
export const BANDAS = ["cabecera", "destino", "importe", "detalle", "codigos"] as const;
export type BandaId = (typeof BANDAS)[number];

/**
 * Separacion entre cada par de bandas consecutivas, en mm: cuatro valores para
 * cinco bandas. Contra la banda de codigos se usa `GAP_TEXTO_CODIGOS` (el aire
 * que protege la lectura del QR y del barcode); entre bandas de texto,
 * `GAP_CAMPOS_MM`.
 */
export const GAPS_ENTRE_BANDAS: readonly number[] = [
  GAP_TEXTO_CODIGOS, // cabecera (el QR) -> destino
  GAP_CAMPOS_MM, // destino -> importe
  GAP_CAMPOS_MM, // importe -> detalle
  GAP_TEXTO_CODIGOS, // detalle -> codigos
];

/** Suma de las cuatro separaciones entre bandas, en mm. */
export const GAP_BANDAS_TOTAL_MM = GAPS_ENTRE_BANDAS.reduce((a, b) => a + b, 0);

/**
 * Constantes de la maqueta base, agrupadas. Se exporta como objeto —y no solo
 * sueltas— porque es lo que la guardia `etiquetas-maqueta-unica.guardia.test.ts`
 * usa como control positivo: los generadores tienen PROHIBIDO declarar estos
 * nombres por su cuenta, y la prohibicion seria vacia si aqui no estuvieran.
 */
export const MAQUETA_BASE = {
  margen: MARGEN_MM,
  anchoUtil: ANCHO_UTIL_BASE_MM,
  interlineado: INTERLINEADO,
  cuerpoMinimoPt: CUERPO_MINIMO_PT,
  cuerpoMinimoDestacadoPt: CUERPO_MINIMO_DESTACADO_PT,
  pasoAjustePt: PASO_AJUSTE_PT,
  qrSize: QR_MM,
  barcodeHeight: BARCODE_MM,
  grosorRecuadro: GROSOR_RECUADRO_MM,
  grosorRegla: GROSOR_REGLA_MM,
  gapCampos: GAP_CAMPOS_MM,
  gapTextoCodigos: GAP_TEXTO_CODIGOS,
  gapRotuloValor: GAP_ROTULO_VALOR,
  fontRotulo: CUERPOS_BASE.rotulo,
  fontGuia: CUERPOS_BASE.guia,
  fontRemision: CUERPOS_BASE.remision,
  cuerpos: CUERPOS_BASE,
} as const;

/**
 * Cuanto baja la linea base de lo que venga DEBAJO del numero de guia, en mm,
 * derivado del cuerpo de ese numero (feature 282, R1/R2).
 *
 * La regla es «un cuerpo entero (1 em) del numero de guia por debajo de su linea
 * base». Un em y no una fraccion medida porque las metricas de tinta
 * (ascendente, descendente, bbox) de las 14 fuentes estandar NO estan en el repo
 * —jsPDF solo expone `metadata.bbox` de fuentes embebidas—, asi que cualquier
 * fraccion seria un numero inventado. 1 em del cuerpo mayor cubre con holgura el
 * descendente del numero (que ademas, siendo digitos, es cero) mas el ascendente
 * de la fila de abajo.
 *
 * Que se DERIVE es el requisito, no un detalle de estilo: si mañana alguien
 * cambia `CUERPOS_BASE.guia`, la fila de abajo baja sola. Y como el cuerpo de la
 * guia escala con `k` igual que esta separacion, la desigualdad se conserva en
 * las cuatro hojas por construccion, no por haber probado cuatro casos.
 *
 * Feature 350: la constante `18` de antes —el defecto original, 2 mm para un
 * cuerpo que necesita 7,76— ya no existe en ningun sitio. La cabecera se compone
 * llamando a esta funcion.
 */
export function separacionBajoGuiaMm(cuerpoGuiaPt: number): number {
  return cuerpoGuiaPt * PT_A_MM;
}

/**
 * Alto de una linea de texto de cuerpo `pt`, en mm, con el interlineado de la
 * maqueta. Un bloque de `n` lineas mide `n` veces esto.
 */
export function altoLineaMm(pt: number): number {
  return pt * PT_A_MM * INTERLINEADO;
}
