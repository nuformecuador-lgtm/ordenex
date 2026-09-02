import type { jsPDF } from "jspdf";

import { formatMonto } from "@/lib/config/moneda";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

import {
  ajustarBloque,
  ErrorEtiquetaNoCabe,
  type DatoBloque,
  type MedirTexto,
} from "./etiquetas-ajuste";
import {
  caracterNoEscribibleEstandar,
  exigirCobertura,
  seguroEnFuenteEstandar,
  type FuenteEmbebida,
} from "./etiquetas-fuente-registro";
import type { EtiquetaLayout } from "./etiquetas-layout";
import {
  CUERPOS_BASE,
  CUERPO_MINIMO_DESTACADO_PT,
  CUERPO_MINIMO_PT,
  GAPS_ENTRE_BANDAS,
  GAP_ROTULO_VALOR,
  INTERLINEADO,
  PASO_AJUSTE_PT,
  PT_A_MM,
  separacionBajoGuiaMm,
} from "./etiquetas-maqueta";

// Feature 282 (T18) — EL DIBUJO DEL TEXTO DE LA ETIQUETA, UNA SOLA VEZ.
//
// Los dos generadores quedan reducidos a: rasterizar lo suyo (el cliente con
// `jsbarcode` sobre un canvas del DOM y el `<canvas>` de qrcode.react; el
// servidor con `qrcode` y `bwip-js`, que corren en Node sin DOM) y llamar aqui
// con los data URL ya listos.
//
// Lo que NO se comparte, y por que: el rasterizado. Las librerias son distintas
// POR RUNTIME, que es la razon documentada de que existan dos generadores
// (feature 136 §4). Unificarlo obligaria a arrastrar `jsbarcode` al servidor o
// `bwip-js` al navegador.
//
// ---------------------------------------------------------------------------
// Feature 350 (T10) — CINCO BANDAS, SIN COLUMNA DE ROTULOS Y SIN RECORTE.
//
// `drawCampos` ha desaparecido, y con el las dos causas del defecto:
//
//  1. La COLUMNA DE ROTULOS del bloque de destino. Su ancho lo fijaba el rotulo
//     mas largo («MONTO A COBRAR») y se descontaba en TODAS las lineas, tambien
//     en las de la direccion: ~24 % del ancho util regalado. Ahora el bloque de
//     destino se lee como un sobre postal —sin un solo rotulo— y el valor
//     dispone del ancho completo (D2/R16).
//  2. El RECORTE con puntos suspensivos. Ya no queda ninguna llamada a
//     `recortarConElipsis` en este camino: el cuerpo baja hasta el suelo de
//     legibilidad y, si con el suelo no cabe, se lanza `ErrorEtiquetaNoCabe`
//     ANTES de escribir un byte (R7). Un PDF que falta es mejor que uno que
//     miente sobre la direccion de un paquete.
//
// La jerarquia pasa a ser por TAMAÑO y no por orden de lista (D3): guia y QR
// arriba, destinatario y telefono grandes, el importe en un recuadro —es lo que
// el mensajero tiene que cobrar— y producto y tienda en el cuerpo menor.

/** Tipografia con la que se dibuja un texto concreto dentro de la etiqueta. */
export interface FuenteTexto {
  nombre: string;
  estilo: string;
}

/** La tipografia de todo lo que no lleve una propia. */
export const FUENTE_BASE: FuenteTexto = { nombre: "helvetica", estilo: "normal" };

/** La misma familia en negrita, para rotulos y para el numero de guia. */
const FUENTE_ROTULO: FuenteTexto = { nombre: "helvetica", estilo: "bold" };

/** Rotulos de la cabecera (feature 295 conserva el de la fecha y su sitio). */
export const ROTULO_GUIA = "GUÍA";
export const ROTULO_FECHA = "FECHA";
export const ROTULO_REMISION = "REMISIÓN";

/**
 * Rotulo del recuadro del importe. Comparte LINEA con el importe (§4.2): puesto
 * encima costaria ~3 mm del presupuesto vertical, que en la celda base es el
 * recurso escaso.
 */
export const ROTULO_COBRAR = "COBRAR";

/**
 * Rotulos del detalle. Van EN LINEA y sin columna alineada: el valor arranca
 * justo detras del rotulo y las lineas de continuacion usan el ancho completo.
 * Producto y tienda son los dos datos cuyo significado no se adivina sin rotulo
 * («Caja x2» podria ser cualquier cosa); un nombre, un telefono y una direccion
 * seguidos se leen solos.
 */
export const ROTULO_PRODUCTO = "Producto:";
export const ROTULO_TIENDA = "Tienda:";

/** Marcador cuando la orden no trae direccion. */
export const SIN_DIRECCION = "—";

/** Une la geografia disponible; omite el distrito si es null (R4 de la 32). */
export function geografiaLegible(etiqueta: EtiquetaGuiaDTO): string {
  return [
    etiqueta.zonaNombre,
    etiqueta.provinciaNombre,
    etiqueta.cantonNombre,
    etiqueta.distritoNombre,
  ]
    .filter((parte): parte is string => Boolean(parte))
    .join(" / ");
}

/**
 * Los textos que se dibujan con la FUENTE EMBEBIDA, en el orden en que se
 * dibujan. Hoy es uno solo: el valor del importe, que es el unico que necesita
 * el simbolo de moneda.
 *
 * Existe como funcion exportada —y no como un `exigirCobertura` suelto dentro
 * del dibujo— para que la verificacion pueda cruzar DOS conjuntos: los textos
 * que el PDF marca como `/Subtype /Type0` y los que pasaron por
 * `exigirCobertura`. Si mañana alguien dibuja un texto nuevo con la fuente
 * embebida y olvida la comprobacion, los dos conjuntos dejan de coincidir y sale
 * rojo (R21). Sin este punto unico ese olvido seria invisible: jsPDF BORRA de la
 * cadena el caracter que la fuente no cubre y sigue adelante sin decir nada.
 */
export function textosConFuenteEmbebida(etiqueta: EtiquetaGuiaDTO): string[] {
  const monto = formatMonto(etiqueta.montoCobrar);
  const otros = datosDeEtiqueta(etiqueta)
    .filter((d) => d.id !== "montoCobrar" && !seguroEnFuenteEstandar(d.valor))
    .map((d) => d.valor);
  return [monto, ...otros];
}

/** Identificador de cada dato imprimible de la etiqueta (R17). */
export type DatoEtiquetaId =
  | "numGuia"
  | "fechaCreacion"
  | "numRemision"
  | "destinatario"
  | "telefonoDest"
  | "direccion"
  | "ubicacion"
  | "montoCobrar"
  | "producto"
  | "tiendaNombre";

export interface DatoEtiqueta {
  id: DatoEtiquetaId;
  valor: string;
}

/**
 * Los datos que la etiqueta imprime, en el ORDEN de arriba abajo del papel
 * (R13/R17). Ninguno desaparece por efecto del rediseño; lo que cambia respecto
 * de la 282 es su orden y sus rotulos, que es justo lo que esta ficha revisa.
 *
 * ⚠️ Esta funcion NO puede usarse como valor esperado de la verificacion de
 * reconstruccion (V1): comparar un texto contra la funcion que lo genera esta
 * siempre verde. El valor esperado sale del literal del fixture; esto sirve para
 * el ORDEN y para el cruce pantalla/papel.
 */
export function datosDeEtiqueta(etiqueta: EtiquetaGuiaDTO): DatoEtiqueta[] {
  return [
    { id: "numGuia", valor: String(etiqueta.numGuia) },
    { id: "fechaCreacion", valor: etiqueta.fechaCreacion },
    { id: "numRemision", valor: etiqueta.numRemision },
    { id: "destinatario", valor: etiqueta.destinatario },
    { id: "telefonoDest", valor: etiqueta.telefonoDest },
    { id: "direccion", valor: etiqueta.direccion ?? SIN_DIRECCION },
    { id: "ubicacion", valor: geografiaLegible(etiqueta) },
    { id: "montoCobrar", valor: formatMonto(etiqueta.montoCobrar) },
    { id: "producto", valor: etiqueta.producto },
    { id: "tiendaNombre", valor: etiqueta.tiendaNombre },
  ];
}

/** Los dos codigos, ya rasterizados por quien sepa hacerlo en su runtime. */
export interface RasterEtiqueta {
  /** Data URL PNG del QR; `null` si el cliente aun no tiene el canvas. */
  qr: string | null;
  /** Data URL PNG del codigo de barras (CODE128). */
  barcode: string;
}

/**
 * El mayor cuerpo entre `cuerpoMaxPt` y `cuerpoMinPt` (en pasos de
 * `PASO_AJUSTE_PT`) con el que `anchoTotal(pt)` cabe en `anchoMm`, o `null` si
 * ni con el minimo cabe.
 *
 * Es el equivalente horizontal de `ajustarBloque` y se usa donde el texto NO
 * puede partirse en varias lineas: las dos filas de la cabecera y el importe
 * (R15 exige que el importe vaya en UNA sola linea).
 */
function mayorCuerpoQueCabe(
  anchoTotal: (pt: number) => number,
  anchoMm: number,
  cuerpoMaxPt: number,
  cuerpoMinPt: number,
): number | null {
  const pasos = Math.max(0, Math.floor((cuerpoMaxPt - cuerpoMinPt) / PASO_AJUSTE_PT + 1e-9));
  for (let i = 0; i <= pasos; i++) {
    const pt = cuerpoMaxPt - i * PASO_AJUSTE_PT;
    if (anchoTotal(pt) <= anchoMm + 1e-9) return pt;
  }
  return null;
}

/**
 * Dibuja una etiqueta completa en la pagina activa: cinco bandas verticales, en
 * el orden que fija R13 (cabecera, destino, importe, detalle, codigos).
 *
 * La `fuente` es un parametro OBLIGATORIO por el mismo criterio que `hoja` en el
 * generador de cliente: con un default silencioso, un llamador que olvidase
 * inyectarla volveria a producir el bug del simbolo sin que nadie lo viera.
 *
 * Disciplina de fuentes (feature 282, intacta): la tipografia de cada texto se
 * activa ANTES de medirlo y ANTES de dibujarlo, nunca despues. Sin eso, el
 * reparto de lineas se calcularia con las anchuras de una fuente y el dibujo se
 * haria con las de otra — el mismo genero de fallo mudo que la 282 cerro.
 */
export function drawEtiqueta(
  doc: jsPDF,
  layout: EtiquetaLayout,
  etiqueta: EtiquetaGuiaDTO,
  raster: RasterEtiqueta,
  fuente: FuenteEmbebida,
): void {
  const { anchoUtil, altoUtil, cuerpos } = layout;
  const hojaId = layout.hoja.id;
  // El tipo se anota EXPLICITAMENTE en la variable, no solo en la lambda: es el
  // requisito de TypeScript para que una llamada que devuelve `never` estreche
  // el tipo de lo que hay despues (aqui, los cuerpos que pueden ser `null`).
  const noCabe: (dato: string, detalle: string) => never = (dato, detalle) => {
    throw new ErrorEtiquetaNoCabe(etiqueta.numGuia, hojaId, dato, detalle);
  };

  // Medidores. Cada uno activa SU tipografia antes de medir (feature 282).
  const medirCon =
    (nombre: string, estilo: string): MedirTexto =>
    (texto, pt) => {
      doc.setFont(nombre, estilo);
      doc.setFontSize(pt);
      return doc.getTextWidth(texto);
    };
  const medirBold = medirCon(FUENTE_ROTULO.nombre, FUENTE_ROTULO.estilo);
  const medirImporte = medirCon(fuente.nombre, fuente.estilo);

  /**
   * La tipografia con la que se dibuja un VALOR, decidida SOLO a partir de sus
   * caracteres (R2).
   *
   * jsPDF borra en silencio los 27 caracteres del bloque `0x80-0x9F` de cp1252
   * —`’`, `“ ”`, `—`, `…`— cuando dibuja con la fuente estandar (medido en la
   * ficha 350). Un nombre de tienda con un apostrofo tipografico saldria del
   * papel con un hueco y nadie se enteraria, que es exactamente lo que R2
   * prohibe. Cuando el texto lleva uno de esos caracteres se dibuja ENTERO con
   * la fuente embebida, que si los cubre (su subconjunto es cp1252 completo), y
   * se exige la cobertura antes de escribir un byte (R21).
   *
   * Es funcion PURA del texto, y eso es lo que la hace segura: el mismo texto
   * decide la misma fuente al MEDIR y al DIBUJAR, asi que el reparto de lineas y
   * el dibujo nunca usan metricas distintas.
   */
  const fuenteDeValor = (texto: string): FuenteTexto => {
    if (seguroEnFuenteEstandar(texto)) return FUENTE_BASE;
    exigirCobertura(fuente, texto, "texto de la etiqueta");
    return { nombre: fuente.nombre, estilo: fuente.estilo };
  };

  /** Medidor atado a una tipografia concreta. */
  const medirEn = (tipo: FuenteTexto): MedirTexto => medirCon(tipo.nombre, tipo.estilo);

  const escribir = (
    texto: string,
    xMm: number,
    yMm: number,
    pt: number,
    tipo: FuenteTexto,
  ): void => {
    doc.setFont(tipo.nombre, tipo.estilo);
    doc.setFontSize(pt);
    doc.text(texto, layout.x(xMm), layout.y(yMm));
  };

  /**
   * Los rotulos y el numero de guia van en NEGRITA, y del artefacto embebido no
   * hay version negrita: si alguno dejara de ser escribible con la estandar, no
   * habria a donde caer. Se falla de forma visible en vez de imprimirlo con un
   * hueco.
   */
  const exigirRotuloEscribible = (texto: string, campo: string): void => {
    const falta = caracterNoEscribibleEstandar(texto);
    if (falta === null) return;
    const cp = (falta.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");
    noCabe(
      campo,
      `el caracter «${falta}» (U+${cp}) no se puede escribir con la fuente estandar y no hay negrita embebida`,
    );
  };

  // -------------------------------------------------------------------------
  // R21/R22 — El importe, ANTES de escribir un solo byte.
  //
  // Se exige que el subconjunto embebido cubra el texto COMPLETO del importe (no
  // solo el simbolo: `formatMontoString` tiene una rama que pinta verbatim lo
  // que no tenga forma de decimal). Y se toma tal cual lo produce el formateador
  // money-safe: no se convierte a numero, no se re-parsea, no se reconstruye.
  // Ninguna decision de maquetacion altera sus caracteres.
  // -------------------------------------------------------------------------
  const monto = formatMonto(etiqueta.montoCobrar);
  exigirCobertura(fuente, monto, "Monto a cobrar");
  const tipoMonto: FuenteTexto = { nombre: fuente.nombre, estilo: fuente.estilo };

  // La tipografia de CADA valor, decidida una sola vez y usada tanto al medir
  // como al dibujar. `fuenteDeValor` lanza aqui —antes del primer byte— si un
  // texto no lo puede escribir ninguna de las dos fuentes.
  const tipoFecha = fuenteDeValor(etiqueta.fechaCreacion);
  const tipoRemision = fuenteDeValor(etiqueta.numRemision);
  const medirFecha = medirEn(tipoFecha);
  const medirRemision = medirEn(tipoRemision);

  // =========================================================================
  // BANDA 1 — CABECERA: guia + fecha + remision a la izquierda, QR a la derecha.
  // =========================================================================
  const anchoTextoCabecera = anchoUtil - layout.qrMm - GAPS_ENTRE_BANDAS[0];
  if (anchoTextoCabecera <= 0) {
    noCabe(
      "cabecera",
      `el QR de ${layout.qrMm.toFixed(1)} mm no deja ancho para el numero de guia`,
    );
  }
  const gapRotulo = GAP_ROTULO_VALOR * layout.k;
  for (const rotulo of [
    ROTULO_GUIA,
    ROTULO_FECHA,
    ROTULO_REMISION,
    ROTULO_COBRAR,
    ROTULO_PRODUCTO,
    ROTULO_TIENDA,
  ]) {
    exigirRotuloEscribible(rotulo, `rotulo «${rotulo}»`);
  }

  // Fila de rotulos: GUÍA a la izquierda, REMISIÓN a la derecha y el par
  // FECHA + fecha centrado entre los dos. Es la fila que la feature 295 creo, y
  // se conserva entera; lo unico que cambia es que ahora vive en la columna de
  // texto de la cabecera, porque el QR ocupa la derecha (D3).
  const anchoFilaRotulos = (pt: number): number =>
    medirBold(ROTULO_GUIA, pt) +
    medirBold(ROTULO_FECHA, pt) +
    gapRotulo +
    medirFecha(etiqueta.fechaCreacion, pt) +
    medirBold(ROTULO_REMISION, pt) +
    2 * gapRotulo;
  const cuerpoRotulo = mayorCuerpoQueCabe(
    anchoFilaRotulos,
    anchoTextoCabecera,
    cuerpos.rotulo,
    CUERPO_MINIMO_PT,
  );
  if (cuerpoRotulo === null) {
    noCabe(
      "fila de rotulos de cabecera",
      `necesita ${anchoFilaRotulos(CUERPO_MINIMO_PT).toFixed(1)} mm y hay ${anchoTextoCabecera.toFixed(1)} mm`,
    );
  }

  // El numero de guia NO se encoge jamas (282/R27): es el dato que el operador
  // busca de un vistazo. Quien cede ancho es el numero de remision.
  const cuerpoGuia = cuerpos.guia;
  const textoGuia = String(etiqueta.numGuia);
  exigirRotuloEscribible(textoGuia, "numero de guia");
  const anchoGuia = medirBold(textoGuia, cuerpoGuia);
  if (anchoGuia > anchoTextoCabecera + 1e-9) {
    noCabe(
      "numero de guia",
      `${anchoGuia.toFixed(1)} mm a ${cuerpoGuia.toFixed(1)} pt en ${anchoTextoCabecera.toFixed(1)} mm, y la guia no se encoge`,
    );
  }
  const cuerpoRemision = mayorCuerpoQueCabe(
    (pt) => anchoGuia + gapRotulo + medirRemision(etiqueta.numRemision, pt),
    anchoTextoCabecera,
    cuerpos.remision,
    CUERPO_MINIMO_PT,
  );
  if (cuerpoRemision === null) {
    noCabe(
      "numero de remision",
      `no cabe junto al numero de guia en ${anchoTextoCabecera.toFixed(1)} mm`,
    );
  }

  const yRotulos = cuerpoRotulo * PT_A_MM;
  const yGuia = yRotulos + separacionBajoGuiaMm(cuerpoGuia);
  const altoCabecera = Math.max(layout.qrMm, yGuia);

  // =========================================================================
  // BANDA 3 — IMPORTE: recuadro, UNA sola linea, y el texto contenido en el.
  // =========================================================================
  const padRecuadro = (pt: number) => pt * PT_A_MM * (INTERLINEADO - 1);
  const anchoImporteTotal = (pt: number): number =>
    medirBold(ROTULO_COBRAR, pt) + gapRotulo + medirImporte(monto, pt) + 2 * padRecuadro(pt);
  const cuerpoImporte = mayorCuerpoQueCabe(
    anchoImporteTotal,
    anchoUtil,
    cuerpos.importe,
    CUERPO_MINIMO_PT,
  );
  if (cuerpoImporte === null) {
    noCabe(
      "importe a cobrar",
      `«${monto}» no cabe en una sola linea de ${anchoUtil.toFixed(1)} mm, y R15 prohibe partirlo`,
    );
  }
  const altoImporte = cuerpoImporte * PT_A_MM * INTERLINEADO;

  // =========================================================================
  // BANDAS 2 y 4 — El presupuesto vertical que queda, y su orden de sacrificio.
  // =========================================================================
  const gapsTotal = GAPS_ENTRE_BANDAS.reduce((a, b) => a + b, 0);
  const disponible = altoUtil - altoCabecera - altoImporte - layout.barcodeMm - gapsTotal;

  const factor = (base: number) => base / CUERPOS_BASE.destinatario;
  // Cada dato lleva SU tipografia y SU medidor: un valor con un caracter que la
  // fuente estandar no sabe escribir se dibuja entero con la embebida, y medirlo
  // con las anchuras de la otra seria el fallo mudo que la 282 cerro.
  const tipoDestino = [
    etiqueta.destinatario,
    etiqueta.telefonoDest,
    etiqueta.direccion ?? SIN_DIRECCION,
    geografiaLegible(etiqueta),
  ].map(fuenteDeValor);
  const tipoDetalle = [etiqueta.producto, etiqueta.tiendaNombre].map(fuenteDeValor);

  const datosDestino: DatoBloque[] = [
    {
      texto: etiqueta.destinatario,
      factorCuerpo: 1,
      cuerpoMinimoPt: CUERPO_MINIMO_DESTACADO_PT,
      medir: medirEn(tipoDestino[0]),
    },
    {
      texto: etiqueta.telefonoDest,
      factorCuerpo: factor(CUERPOS_BASE.telefono),
      cuerpoMinimoPt: CUERPO_MINIMO_DESTACADO_PT,
      medir: medirEn(tipoDestino[1]),
    },
    {
      texto: etiqueta.direccion ?? SIN_DIRECCION,
      factorCuerpo: factor(CUERPOS_BASE.direccion),
      cuerpoMinimoPt: CUERPO_MINIMO_PT,
      medir: medirEn(tipoDestino[2]),
    },
    {
      texto: geografiaLegible(etiqueta),
      factorCuerpo: factor(CUERPOS_BASE.ubicacion),
      cuerpoMinimoPt: CUERPO_MINIMO_PT,
      medir: medirEn(tipoDestino[3]),
    },
  ];
  const datosDetalle: DatoBloque[] = [
    {
      texto: etiqueta.producto,
      factorCuerpo: 1,
      cuerpoMinimoPt: CUERPO_MINIMO_PT,
      medir: medirEn(tipoDetalle[0]),
      sangriaPrimeraMm: (pt) => medirBold(ROTULO_PRODUCTO, pt) + gapRotulo,
    },
    {
      texto: etiqueta.tiendaNombre,
      factorCuerpo: 1,
      cuerpoMinimoPt: CUERPO_MINIMO_PT,
      medir: medirEn(tipoDetalle[1]),
      sangriaPrimeraMm: (pt) => medirBold(ROTULO_TIENDA, pt) + gapRotulo,
    },
  ];

  // Orden de sacrificio (§5.4): PRIMERO baja el detalle —producto y tienda son
  // lo menos critico de D3— y solo despues el destino. Para saber cuanto sitio
  // le queda al destino, se calcula el detalle en su suelo.
  const detalleEnElSuelo = ajustarBloque(
    datosDetalle,
    anchoUtil,
    Number.POSITIVE_INFINITY,
    CUERPO_MINIMO_PT,
    CUERPO_MINIMO_PT,
    medirEn(FUENTE_BASE),
  );
  const destino = ajustarBloque(
    datosDestino,
    anchoUtil,
    disponible - detalleEnElSuelo.altoMm,
    cuerpos.destinatario,
    CUERPO_MINIMO_DESTACADO_PT,
    medirEn(FUENTE_BASE),
  );
  if (!destino.cabe) {
    noCabe(
      "bloque de destino (destinatario, telefono, direccion y ubicacion)",
      destino.motivo === "ancho"
        ? `una palabra no entra en los ${anchoUtil.toFixed(1)} mm de ancho util ni con el cuerpo minimo`
        : `necesita ${destino.altoMm.toFixed(1)} mm de alto con el cuerpo minimo y hay ${(disponible - detalleEnElSuelo.altoMm).toFixed(1)} mm`,
    );
  }

  // R14 POR CONSTRUCCION: el detalle nunca alcanza el cuerpo del telefono, que a
  // su vez nunca supera el del destinatario. Un paso del ajuste es la minima
  // diferencia expresable, y basta para el «estrictamente mayor» del requisito.
  const cuerpoTelefono = destino.cuerpos[1];
  const topeDetalle = Math.min(cuerpos.detalle, cuerpoTelefono - PASO_AJUSTE_PT);
  const detalle = ajustarBloque(
    datosDetalle,
    anchoUtil,
    disponible - destino.altoMm,
    topeDetalle,
    CUERPO_MINIMO_PT,
    medirEn(FUENTE_BASE),
  );
  if (!detalle.cabe) {
    noCabe(
      "bloque de producto y tienda",
      detalle.motivo === "ancho"
        ? `una palabra no entra en los ${anchoUtil.toFixed(1)} mm de ancho util ni con el cuerpo minimo`
        : `necesita ${detalle.altoMm.toFixed(1)} mm de alto con el cuerpo minimo y hay ${(disponible - destino.altoMm).toFixed(1)} mm`,
    );
  }

  // Anclaje: la banda de codigos va pegada al borde inferior del area util y el
  // resto se apila hacia arriba desde ahi. Asi la franja de papel sin usar es
  // EXACTAMENTE el margen por los cuatro lados (R9) y el sobrante —que en A4 son
  // mas de 140 mm— queda DENTRO, en la banda de destino, que es la flexible.
  const yCodigos = altoUtil - layout.barcodeMm;
  const yDetalle = yCodigos - GAPS_ENTRE_BANDAS[3] - detalle.altoMm;
  const yImporte = yDetalle - GAPS_ENTRE_BANDAS[2] - altoImporte;
  const yDestino = altoCabecera + GAPS_ENTRE_BANDAS[0];

  /**
   * Dibuja un bloque ya ajustado, linea a linea con el interlineado de la
   * maqueta. Linea a linea y no con `doc.text(array)` porque el avance
   * automatico de jsPDF usa el leading de la fuente y se desincronizaria del
   * interlineado con el que aqui se calculo el alto.
   */
  const dibujarBloque = (
    lineasPorDato: string[][],
    cuerposPorDato: number[],
    tiposPorDato: FuenteTexto[],
    yBanda: number,
    rotulos?: string[],
  ): void => {
    let y = yBanda;
    for (let i = 0; i < lineasPorDato.length; i++) {
      const pt = cuerposPorDato[i];
      const rotulo = rotulos?.[i];
      const sangria = rotulo ? medirBold(rotulo, pt) + gapRotulo : 0;
      for (let j = 0; j < lineasPorDato[i].length; j++) {
        const yBase = y + pt * PT_A_MM;
        if (j === 0 && rotulo) escribir(rotulo, 0, yBase, pt, FUENTE_ROTULO);
        escribir(lineasPorDato[i][j], j === 0 ? sangria : 0, yBase, pt, tiposPorDato[i]);
        y += pt * PT_A_MM * INTERLINEADO;
      }
    }
  };

  // =========================================================================
  // A dibujar. De aqui abajo no se decide nada: solo se pinta lo ya resuelto.
  // =========================================================================

  // --- Banda 1: cabecera ---------------------------------------------------
  const anchoRotuloFecha = medirBold(ROTULO_FECHA, cuerpoRotulo);
  const anchoFecha = medirFecha(etiqueta.fechaCreacion, cuerpoRotulo);
  const anchoRotuloRemision = medirBold(ROTULO_REMISION, cuerpoRotulo);

  escribir(ROTULO_GUIA, 0, yRotulos, cuerpoRotulo, FUENTE_ROTULO);
  const xPar = (anchoTextoCabecera - (anchoRotuloFecha + gapRotulo + anchoFecha)) / 2;
  escribir(ROTULO_FECHA, xPar, yRotulos, cuerpoRotulo, FUENTE_ROTULO);
  escribir(
    etiqueta.fechaCreacion,
    xPar + anchoRotuloFecha + gapRotulo,
    yRotulos,
    cuerpoRotulo,
    tipoFecha,
  );
  escribir(
    ROTULO_REMISION,
    anchoTextoCabecera - anchoRotuloRemision,
    yRotulos,
    cuerpoRotulo,
    FUENTE_ROTULO,
  );

  escribir(textoGuia, 0, yGuia, cuerpoGuia, FUENTE_ROTULO);
  escribir(
    etiqueta.numRemision,
    anchoTextoCabecera - medirRemision(etiqueta.numRemision, cuerpoRemision),
    yGuia,
    cuerpoRemision,
    tipoRemision,
  );

  if (raster.qr) {
    doc.addImage(
      raster.qr,
      "PNG",
      layout.x(anchoUtil - layout.qrMm),
      layout.y(0),
      layout.qrMm,
      layout.qrMm,
    );
  }

  // --- Banda 2: destino, SIN columna de rotulos (D2/R16) -------------------
  dibujarBloque(destino.lineas, destino.cuerpos, tipoDestino, yDestino);

  // --- Banda 3: importe, en su recuadro y en UNA linea (R15) ---------------
  doc.setLineWidth(0.3 * Math.max(1, layout.k));
  doc.rect(layout.x(0), layout.y(yImporte), anchoUtil, altoImporte, "S");
  const pad = padRecuadro(cuerpoImporte);
  const yBaseImporte = yImporte + cuerpoImporte * PT_A_MM;
  escribir(ROTULO_COBRAR, pad, yBaseImporte, cuerpoImporte, FUENTE_ROTULO);
  escribir(
    monto,
    anchoUtil - pad - medirImporte(monto, cuerpoImporte),
    yBaseImporte,
    cuerpoImporte,
    tipoMonto,
  );

  // --- Banda 4: detalle, con el rotulo EN LINEA ----------------------------
  dibujarBloque(detalle.lineas, detalle.cuerpos, tipoDetalle, yDetalle, [
    ROTULO_PRODUCTO,
    ROTULO_TIENDA,
  ]);

  // --- Banda 5: codigo de barras, a TODO el ancho util ---------------------
  // Al subir el QR a la cabecera, el barcode pasa de `88 - 26 - 4 = 58 mm` a los
  // 88 mm completos: mas modulos por milimetro para la pistola, gratis.
  doc.addImage(
    raster.barcode,
    "PNG",
    layout.x(0),
    layout.y(yCodigos),
    anchoUtil,
    layout.barcodeMm,
  );
}
