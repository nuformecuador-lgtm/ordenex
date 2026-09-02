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
  GROSOR_RECUADRO_MM,
  GROSOR_REGLA_MM,
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

/**
 * Rotulo de MARCA de la cabecera (feature 353). Es el «rotulo diminuto» que el
 * diseño aprobado pone encima del numero de guia. Conserva el nombre
 * `ROTULO_GUIA` —lo importan la verificacion y el generador de cliente— porque
 * sigue siendo el rotulo QUE ANUNCIA EL NUMERO; lo que cambia es su texto.
 *
 * El `·` es U+00B7, dentro de Latin-1: la fuente estandar lo escribe (medido en
 * `escribibleEnFuenteEstandar`), asi que no arrastra la fuente embebida.
 */
export const ROTULO_GUIA = "ORDENEX · GUÍA";

/**
 * Rotulos de la fila META, la que el diseño pone DEBAJO del numero de guia
 * (feature 353). La feature 295 metio la fecha en la etiqueta y esta ficha no se
 * la lleva: la mueve de la fila de encima del numero a la de debajo, que es donde
 * el diseño aprobado la coloca, junto a la remision y en cuerpo pequeño.
 *
 * `REMISIÓN` pasa a `REM` por el diseño. No es un ahorro de ancho disfrazado:
 * el rotulo largo y el corto caben los dos; el diseño escribe `REM <n>`.
 */
export const ROTULO_FECHA = "FECHA";
export const ROTULO_REMISION = "REM";

/**
 * Rotulo del recuadro del importe. Comparte LINEA con el importe (§4.2): puesto
 * encima costaria ~3 mm del presupuesto vertical, que en la celda base es el
 * recurso escaso.
 */
export const ROTULO_COBRAR = "COBRAR";

/**
 * Rotulo del bloque de destino (feature 353). El diseño aprobado abre el bloque
 * con `PARA` en versalitas pequeñas y despues los cuatro datos SIN rotulo, que es
 * la D2 de la 350 intacta: no se reintroduce ninguna columna de rotulos, se pone
 * UNA linea que dice de quien es el bloque, como en un sobre postal.
 */
export const ROTULO_PARA = "PARA";

/**
 * Rotulos del detalle (feature 353). Cambian de texto y de SITIO: el diseño
 * aprobado los pone ENCIMA de su valor, en rotulo diminuto, y el valor debajo en
 * el cuerpo mas pequeño. Antes iban en linea, delante del valor.
 *
 * Producto y tienda siguen siendo los dos datos cuyo significado no se adivina
 * sin rotulo («Caja x2» podria ser cualquier cosa); un nombre, un telefono y una
 * direccion seguidos se leen solos.
 *
 * ⚠️ COSTE MEDIDO, y es lo unico del diseño que NO sale gratis: apilar el rotulo
 * sobre su valor gasta una linea de mas por dato. Con `PARA`, son TRES lineas de
 * rotulo nuevas. En la celda de 100 x 100 el peor caso medido de produccion
 * (direccion de 286 caracteres) cabia con 0,25 mm de holgura, asi que esas tres
 * lineas no caben ahi. Los numeros y la decision estan en `progress/impl_353.md`.
 */
export const ROTULO_PRODUCTO = "CONTENIDO";
export const ROTULO_TIENDA = "TIENDA";

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
   *
   * Feature 353 — `negrita` pide el PESO que el diseño aprobado da al nombre, al
   * telefono y a la ubicacion. Se atiende SOLO cuando el texto es escribible con
   * la fuente estandar: del artefacto embebido no hay version negrita (lo dice
   * `exigirRotuloEscribible` mas abajo), asi que un texto que la necesite se
   * dibuja en su unico estilo. La regla de precedencia es explicita y no un
   * accidente: perder el peso es una diferencia visible que alguien puede ver y
   * corregir; perder un caracter es el fallo mudo que la 282 cerro.
   */
  const fuenteDeValor = (texto: string, negrita = false): FuenteTexto => {
    if (seguroEnFuenteEstandar(texto)) return negrita ? FUENTE_ROTULO : FUENTE_BASE;
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
  // BANDA 1 — CABECERA (feature 353, el diseño aprobado)
  //
  //   ORDENEX · GUÍA                        +-----------+
  //   19887906                              |    QR     |
  //   REM 2201            FECHA 2026-08-25  +-----------+
  //   ----------------------------------------------------  (regla horizontal)
  //
  // Tres filas en la columna de texto y el QR CUADRADO a la derecha, alineado
  // ARRIBA. Lo que cambia respecto de la 350: el rotulo de la cabecera pasa a
  // ser la marca, el numero manda por tamaño (30 pt, `CUERPOS_BASE.guia`) y la
  // fila de remision y fecha baja DEBAJO del numero en vez de ir encima.
  //
  // Por que se puede: el alto de esta banda lo fija el QR —`max(qrMm, pila)`— y
  // la pila de tres filas mide ~24,9 mm contra los 26 del QR. Las tres filas
  // caben en el hueco que el QR ya reservaba, asi que la fidelidad al diseño en
  // la cabecera NO cuesta ni un milimetro de capacidad de texto.
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
    ROTULO_PARA,
    ROTULO_PRODUCTO,
    ROTULO_TIENDA,
  ]) {
    exigirRotuloEscribible(rotulo, `rotulo «${rotulo}»`);
  }

  // Fila 1 — el rotulo de marca, solo, a la izquierda. Es tambien el cuerpo de
  // TODOS los rotulos diminutos de la etiqueta (`PARA`, `CONTENIDO`, `TIENDA`):
  // se resuelve una vez aqui para que los cuatro compartan tamaño, que es lo que
  // el diseño muestra.
  const cuerpoRotulo = mayorCuerpoQueCabe(
    (pt) => medirBold(ROTULO_GUIA, pt),
    anchoTextoCabecera,
    cuerpos.rotulo,
    CUERPO_MINIMO_PT,
  );
  if (cuerpoRotulo === null) {
    noCabe(
      "rotulo de cabecera",
      `«${ROTULO_GUIA}» necesita ${medirBold(ROTULO_GUIA, CUERPO_MINIMO_PT).toFixed(1)} mm y hay ${anchoTextoCabecera.toFixed(1)} mm`,
    );
  }

  // Fila 2 — el numero de guia. NO se encoge jamas (282/R27): es el dato que el
  // operador busca de un vistazo y, desde la 353, el elemento dominante de la
  // etiqueta por mandato del diseño.
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

  // Fila 3 — `REM <n>` a la izquierda y `FECHA <f>` a la derecha de la columna.
  // Los dos pares comparten cuerpo; quien cede es el cuerpo, no el contenido.
  const anchoFilaMeta = (pt: number): number =>
    medirBold(ROTULO_REMISION, pt) +
    gapRotulo +
    medirRemision(etiqueta.numRemision, pt) +
    gapRotulo +
    medirBold(ROTULO_FECHA, pt) +
    gapRotulo +
    medirFecha(etiqueta.fechaCreacion, pt);
  const cuerpoMeta = mayorCuerpoQueCabe(
    anchoFilaMeta,
    anchoTextoCabecera,
    cuerpos.remision,
    CUERPO_MINIMO_PT,
  );
  if (cuerpoMeta === null) {
    noCabe(
      "fila de remision y fecha",
      `necesita ${anchoFilaMeta(CUERPO_MINIMO_PT).toFixed(1)} mm y hay ${anchoTextoCabecera.toFixed(1)} mm`,
    );
  }

  // Las tres lineas base. La separacion bajo el numero es la REGLA DERIVADA de
  // la 282 (1 em del cuerpo de la guia), aplicada dos veces: una para separar el
  // numero del rotulo que tiene encima y otra para la fila que tiene debajo. Si
  // mañana cambia `CUERPOS_BASE.guia`, las dos se mueven solas.
  const yRotulos = cuerpoRotulo * PT_A_MM;
  const yGuia = yRotulos + separacionBajoGuiaMm(cuerpoGuia);
  const yMeta = yGuia + separacionBajoGuiaMm(cuerpoGuia);
  const altoPilaCabecera = yMeta + cuerpoMeta * PT_A_MM * (INTERLINEADO - 1);
  const altoCabecera = Math.max(layout.qrMm, altoPilaCabecera);

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
  const altoLineaRotulo = cuerpoRotulo * PT_A_MM * INTERLINEADO;
  const gapsTotal = GAPS_ENTRE_BANDAS.reduce((a, b) => a + b, 0);
  const presupuesto = altoUtil - altoCabecera - altoImporte - layout.barcodeMm - gapsTotal;

  const factor = (base: number) => base / CUERPOS_BASE.destinatario;
  // Cada dato lleva SU tipografia y SU medidor: un valor con un caracter que la
  // fuente estandar no sabe escribir se dibuja entero con la embebida, y medirlo
  // con las anchuras de la otra seria el fallo mudo que la 282 cerro.
  //
  // Feature 353 — el diseño pide NEGRITA en el nombre, el telefono y la
  // ubicacion. `fuenteDeValor` decide por el texto: si la estandar lo escribe,
  // negrita de verdad; si hace falta la embebida (que no tiene version negrita),
  // se dibuja en su unico estilo. Perder el peso de un texto es una degradacion
  // visible y reversible; perder un caracter no lo es.
  const tipoDestino = [
    fuenteDeValor(etiqueta.destinatario, true),
    fuenteDeValor(etiqueta.telefonoDest, true),
    fuenteDeValor(etiqueta.direccion ?? SIN_DIRECCION),
    fuenteDeValor(geografiaLegible(etiqueta), true),
  ];
  const tipoDetalle = [etiqueta.producto, etiqueta.tiendaNombre].map((t) => fuenteDeValor(t));

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
  // Feature 353 — el detalle se compone de DOS formas y la eleccion se toma
  // abajo, medida. Apilado (el diseño): el rotulo estrena su propia linea y el
  // valor dispone del ancho util COMPLETO. En linea (la disposicion de la 350):
  // el rotulo ocupa una sangria en la primera linea del valor y no gasta ninguna
  // linea propia.
  const detalleDe = (apilado: boolean): DatoBloque[] => [
    {
      texto: etiqueta.producto,
      factorCuerpo: 1,
      cuerpoMinimoPt: CUERPO_MINIMO_PT,
      medir: medirEn(tipoDetalle[0]),
      sangriaPrimeraMm: apilado
        ? undefined
        : (pt: number) => medirBold(ROTULO_PRODUCTO, pt) + gapRotulo,
    },
    {
      texto: etiqueta.tiendaNombre,
      factorCuerpo: 1,
      cuerpoMinimoPt: CUERPO_MINIMO_PT,
      medir: medirEn(tipoDetalle[1]),
      sangriaPrimeraMm: apilado
        ? undefined
        : (pt: number) => medirBold(ROTULO_TIENDA, pt) + gapRotulo,
    },
  ];

  // -------------------------------------------------------------------------
  // LA DECISION DE LA FICHA 353, tomada con numeros y no con gusto.
  //
  // El diseño aprobado apila cada rotulo diminuto sobre su valor: `PARA` abre el
  // bloque de destino y `CONTENIDO` / `TIENDA` abren los suyos. Son TRES lineas
  // de rotulo que la disposicion de la 350 no gastaba, y en la celda de
  // 100 x 100 **no siempre caben**: MEDIDO en esta ficha, cuestan 9,1 mm netos
  // (10,7 de lineas menos 1,6 que devuelve quitar la sangria en linea) y el peor
  // caso de produccion —direccion de 286 caracteres— entraba con 0,25 mm de
  // holgura. Con los rotulos apilados, ese peor caso NO se emitiria.
  //
  // Elegir «diseño» a secas romperia lo que la 350 pago caro (nada recortado, y
  // el peor caso real impreso entero); elegir «capacidad» a secas devolveria la
  // etiqueta que el humano acaba de rechazar. Se hace lo que ya hacia esta
  // maqueta con el CUERPO tipografico: una DEGRADACION EN ORDEN DECLARADO. La
  // etiqueta se compone apilada —el diseño— siempre que quepa; cuando el texto
  // no deja sitio, y solo entonces, los rotulos vuelven a la linea de su valor y
  // `PARA` se omite, que es exactamente la disposicion de la 350. Nunca se
  // recorta un dato y nunca se deja de emitir por un rotulo.
  //
  // La comprobacion se hace contra los dos bloques EN SU SUELO de legibilidad,
  // que es el minimo que van a necesitar pase lo que pase: si ni asi caben con
  // los rotulos apilados, apilarlos solo serviria para disparar R7.
  // -------------------------------------------------------------------------
  const sueloDe = (datos: readonly DatoBloque[], cuerpoPt: number): number =>
    ajustarBloque(
      datos,
      anchoUtil,
      Number.POSITIVE_INFINITY,
      cuerpoPt,
      cuerpoPt,
      medirEn(FUENTE_BASE),
    ).altoMm;
  const rotulosApilados =
    presupuesto - 3 * altoLineaRotulo >=
    sueloDe(datosDestino, CUERPO_MINIMO_DESTACADO_PT) +
      sueloDe(detalleDe(true), CUERPO_MINIMO_PT) -
      1e-9;
  const datosDetalle = detalleDe(rotulosApilados);
  const lineasDeRotulo = rotulosApilados ? 3 : 0;
  const disponible = presupuesto - lineasDeRotulo * altoLineaRotulo;

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
  const altoRotulosDetalle = rotulosApilados ? 2 * altoLineaRotulo : 0;
  const yDetalle = yCodigos - GAPS_ENTRE_BANDAS[3] - (detalle.altoMm + altoRotulosDetalle);
  const yImporte = yDetalle - GAPS_ENTRE_BANDAS[2] - altoImporte;
  const yDestino = altoCabecera + GAPS_ENTRE_BANDAS[0];

  /**
   * Dibuja un bloque ya ajustado, linea a linea con el interlineado de la
   * maqueta. Linea a linea y no con `doc.text(array)` porque el avance
   * automatico de jsPDF usa el leading de la fuente y se desincronizaria del
   * interlineado con el que aqui se calculo el alto.
   *
   * Feature 353 — `rotulos` tiene DOS colocaciones y la elige `rotulosApilados`:
   * apilado (el diseño) el rotulo estrena su propia linea encima del valor, en
   * el cuerpo de los rotulos diminutos; en linea (la disposicion de la 350) el
   * rotulo ocupa la sangria de la primera linea del valor. La sangria que se
   * dibuja es LA MISMA que `sangriaPrimeraMm` uso al repartir las lineas: se
   * calcula con la misma llamada, no con una copia.
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
      if (rotulo && rotulosApilados) {
        escribir(rotulo, 0, y + cuerpoRotulo * PT_A_MM, cuerpoRotulo, FUENTE_ROTULO);
        y += altoLineaRotulo;
      }
      const sangria = rotulo && !rotulosApilados ? medirBold(rotulo, pt) + gapRotulo : 0;
      for (let j = 0; j < lineasPorDato[i].length; j++) {
        const yBase = y + pt * PT_A_MM;
        if (j === 0 && sangria > 0) escribir(rotulo!, 0, yBase, pt, FUENTE_ROTULO);
        escribir(lineasPorDato[i][j], j === 0 ? sangria : 0, yBase, pt, tiposPorDato[i]);
        y += pt * PT_A_MM * INTERLINEADO;
      }
    }
  };

  // =========================================================================
  // A dibujar. De aqui abajo no se decide nada: solo se pinta lo ya resuelto.
  // =========================================================================

  // --- Banda 1: cabecera ---------------------------------------------------
  escribir(ROTULO_GUIA, 0, yRotulos, cuerpoRotulo, FUENTE_ROTULO);
  escribir(textoGuia, 0, yGuia, cuerpoGuia, FUENTE_ROTULO);

  // La fila meta: `REM <n>` pegado al margen izquierdo y `FECHA <f>` pegado al
  // borde derecho de la columna de texto. El aire sobrante queda EN MEDIO, que
  // es lo que hace legible la fila (y lo que el diseño muestra).
  escribir(ROTULO_REMISION, 0, yMeta, cuerpoMeta, FUENTE_ROTULO);
  escribir(
    etiqueta.numRemision,
    medirBold(ROTULO_REMISION, cuerpoMeta) + gapRotulo,
    yMeta,
    cuerpoMeta,
    tipoRemision,
  );
  const anchoValorFecha = medirFecha(etiqueta.fechaCreacion, cuerpoMeta);
  const xRotuloFecha =
    anchoTextoCabecera - anchoValorFecha - gapRotulo - medirBold(ROTULO_FECHA, cuerpoMeta);
  escribir(ROTULO_FECHA, xRotuloFecha, yMeta, cuerpoMeta, FUENTE_ROTULO);
  escribir(
    etiqueta.fechaCreacion,
    anchoTextoCabecera - anchoValorFecha,
    yMeta,
    cuerpoMeta,
    tipoFecha,
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

  // --- La regla horizontal bajo la cabecera (feature 353) -------------------
  // Va CENTRADA en la separacion que ya existia entre cabecera y destino, asi
  // que no consume presupuesto vertical: solo ocupa aire que ya estaba vacio.
  const yRegla = altoCabecera + GAPS_ENTRE_BANDAS[0] / 2;
  doc.setLineWidth(GROSOR_REGLA_MM * Math.max(1, layout.k));
  doc.line(layout.x(0), layout.y(yRegla), layout.x(anchoUtil), layout.y(yRegla));

  // --- Banda 2: destino, con el rotulo PARA y SIN columna (D2/R16) ----------
  // `PARA` es UNA linea que dice de quien es el bloque, no una columna: los
  // cuatro datos siguen disponiendo del ancho util completo (R16 intacto).
  if (rotulosApilados) {
    escribir(ROTULO_PARA, 0, yDestino + cuerpoRotulo * PT_A_MM, cuerpoRotulo, FUENTE_ROTULO);
  }
  dibujarBloque(
    destino.lineas,
    destino.cuerpos,
    tipoDestino,
    yDestino + (rotulosApilados ? altoLineaRotulo : 0),
  );

  // --- Banda 3: importe, en su recuadro y en UNA linea (R15) ---------------
  doc.setLineWidth(GROSOR_RECUADRO_MM * Math.max(1, layout.k));
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

  // --- Banda 4: detalle, con el rotulo ENCIMA de su valor ------------------
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
