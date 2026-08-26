import type { jsPDF } from "jspdf";

import { formatMonto } from "@/lib/config/moneda";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

import {
  lineasDisponibles,
  recortarConElipsis,
  repartirLineas,
} from "./etiquetas-ajuste";
import {
  exigirCobertura,
  type FuenteEmbebida,
} from "./etiquetas-fuente-registro";
import type { EtiquetaLayout } from "./etiquetas-layout";
import {
  camposYInicio,
  GAP_ROTULO_VALOR,
  LIENZO_BASE_MM,
  MAQUETA_BASE,
  qrTopBase,
  textoYLimite,
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

/** Tipografia con la que se dibuja un texto concreto dentro de la etiqueta. */
export interface FuenteTexto {
  nombre: string;
  estilo: string;
}

/** La tipografia de todo lo que no lleve una propia (R12: no cambia nada mas). */
export const FUENTE_BASE: FuenteTexto = { nombre: "helvetica", estilo: "normal" };

export interface CampoEtiqueta {
  label: string;
  value: string;
  /**
   * Tipografia del VALOR. Solo la lleva «Monto a cobrar», que es el unico campo
   * que necesita el simbolo de moneda (design.md §3.2). Embeber la fuente para
   * todo el documento moveria el ancho de cada texto, y con el la columna de
   * rotulos, el corte de la direccion y el cupo vertical: un solape nuevo a
   * cambio de nada (alternativa A4, descartada).
   */
  fuente?: FuenteTexto;
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
 *
 * Disciplina de fuentes (feature 282): la tipografia de cada valor se activa
 * ANTES de `splitTextToSize`, de `getTextWidth` (el `medir` de la elipsis) y de
 * `doc.text`. Sin eso, el reparto de lineas se calcularia con las anchuras de
 * una fuente y el dibujo se haria con las de otra — el mismo genero de fallo
 * mudo que esta ficha viene a cerrar.
 */
export function drawCampos(
  doc: jsPDF,
  layout: EtiquetaLayout,
  campos: CampoEtiqueta[],
  yLimite: number,
): void {
  const { margin, lineHeight, fieldGap } = MAQUETA_BASE;
  const xRotulo = layout.x(margin);
  const yInicio = camposYInicio();

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

  const activarFuenteValor = (campo: CampoEtiqueta): void => {
    const fuente = campo.fuente ?? FUENTE_BASE;
    doc.setFont(fuente.nombre, fuente.estilo);
    doc.setFontSize(layout.fontValor);
  };

  const naturales = campos.map((c) => {
    activarFuenteValor(c);
    return doc.splitTextToSize(c.value, anchoValor) as string[];
  });
  const cupo = repartirLineas(
    naturales.map((l) => l.length),
    lineasDisponibles(yInicio, yLimite, lineHeight, fieldGap, campos.length),
  );

  let y = yInicio;
  campos.forEach((campo, i) => {
    activarFuenteValor(campo);
    const medir = (texto: string) => doc.getTextWidth(texto);
    const lineas = recortarConElipsis(naturales[i], cupo[i], anchoValor, medir);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(layout.fontRotulo);
    doc.text(campo.label.toUpperCase(), xRotulo, layout.y(y));

    activarFuenteValor(campo);
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
 * Los SIETE campos de la etiqueta, con sus rotulos y en su orden (R4). Ni se
 * añaden, ni se quitan, ni se reordenan, ni se renombran: esta ficha arregla lo
 * evidenciado, no rediseña la etiqueta (D2).
 *
 * El valor del monto es el unico que se dibuja con la fuente embebida, y antes
 * de devolverlo se EXIGE que el subconjunto lo cubra entero (R28). Si no lo
 * cubre se lanza aqui, antes de escribir un solo byte del PDF: mejor un fallo
 * visible por el canal que cada generador ya tiene que una etiqueta con el
 * importe mutilado.
 */
export function camposDeEtiqueta(
  etiqueta: EtiquetaGuiaDTO,
  fuente: FuenteEmbebida,
): CampoEtiqueta[] {
  const monto = formatMonto(etiqueta.montoCobrar);
  exigirCobertura(fuente, monto, "Monto a cobrar");
  return [
    { label: "Destinatario", value: etiqueta.destinatario },
    { label: "Teléfono", value: etiqueta.telefonoDest },
    { label: "Dirección", value: etiqueta.direccion ?? "—" },
    { label: "Ubicación", value: geografiaLegible(etiqueta) },
    { label: "Producto", value: etiqueta.producto },
    {
      label: "Monto a cobrar",
      value: monto,
      fuente: { nombre: fuente.nombre, estilo: fuente.estilo },
    },
    { label: "Tienda", value: etiqueta.tiendaNombre },
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
 * Dibuja una etiqueta completa (cabecera + campos + codigos) en la pagina activa.
 *
 * Es el cuerpo que ANTES estaba duplicado en los dos generadores. La `fuente`
 * es un parametro OBLIGATORIO por el mismo criterio que `hoja` en el generador
 * de cliente: con un default silencioso, un llamador que olvidase inyectarla
 * volveria a producir el bug del simbolo sin que nadie lo viera.
 */
export function drawEtiqueta(
  doc: jsPDF,
  layout: EtiquetaLayout,
  etiqueta: EtiquetaGuiaDTO,
  raster: RasterEtiqueta,
  fuente: FuenteEmbebida,
): void {
  // Coordenadas en el lienzo base de 100 mm; `layout.x/y` las lleva a la hoja.
  const { margin, qrSize } = MAQUETA_BASE;
  const derecha = LIENZO_BASE_MM - margin;

  // Cabecera: numero de guia (grande) + numero de remision (R4).
  doc.setFont("helvetica", "bold");
  doc.setFontSize(layout.fontRotulo);
  doc.text("GUÍA", layout.x(margin), layout.y(MAQUETA_BASE.cabeceraY));
  doc.setFontSize(layout.fontGuia);
  doc.text(String(etiqueta.numGuia), layout.x(margin), layout.y(MAQUETA_BASE.guiaY));

  doc.setFontSize(layout.fontRotulo);
  doc.text("REMISIÓN", layout.x(derecha), layout.y(MAQUETA_BASE.cabeceraY), {
    align: "right",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(layout.fontRemision);
  doc.text(etiqueta.numRemision, layout.x(derecha), layout.y(MAQUETA_BASE.remisionY), {
    align: "right",
  });

  // R20 (feature 150): los nueve datos de la etiqueta, en cualquier tamaño del
  // catalogo. El limite es el borde superior del QR.
  drawCampos(doc, layout, camposDeEtiqueta(etiqueta, fuente), textoYLimite());

  const qrY = qrTopBase();
  if (raster.qr) {
    doc.addImage(
      raster.qr,
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
    raster.barcode,
    "PNG",
    layout.x(barcodeX),
    layout.y(qrY + MAQUETA_BASE.barcodeOffsetY),
    layout.escala(barcodeWidth),
    layout.barcodeHeight,
  );
}
