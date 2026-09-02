import { expect } from "vitest";
import type { jsPDF } from "jspdf";

import type { EtiquetaLayout } from "@/lib/pdf/etiquetas-layout";
import type { FuenteEmbebida } from "@/lib/pdf/etiquetas-fuente-registro";
import { MARCA_CORTE } from "@/lib/pdf/etiquetas-ajuste";
import {
  CUERPO_MINIMO_PT,
  GROSOR_RECUADRO_MM,
  GROSOR_REGLA_MM,
  INTERLINEADO,
  PT_A_MM,
  separacionBajoGuiaMm,
} from "@/lib/pdf/etiquetas-maqueta";
import {
  ROTULO_COBRAR,
  ROTULO_FECHA,
  ROTULO_GUIA,
  ROTULO_PARA,
  ROTULO_PRODUCTO,
  ROTULO_REMISION,
  ROTULO_TIENDA,
} from "@/lib/pdf/etiquetas-dibujo";

import type { CasoEtiqueta, EsperadoEtiqueta } from "../../fixtures/etiquetas-282";
import {
  fuentesDePagina,
  imagenesDePagina,
  rectangulosDePagina,
  textoLegible,
  textosDePagina,
  trazosDePagina,
  type FuentePdf,
} from "./pdf-inspector";

// Feature 350 (T12) — LAS SEIS ASERCIONES, EN UN SOLO SITIO.
//
// Viven aqui y no dentro de cada suite porque las tienen que correr LOS DOS
// generadores sobre el mismo corpus: si una de las seis viviera duplicada, la
// primera divergencia entre las dos copias seria invisible — que es exactamente
// el genero de fallo que la feature 282 documento y esta ficha hereda.
//
// | # | Asercion                                                        | Cubre        |
// |---|-----------------------------------------------------------------|--------------|
// | V1| RECONSTRUCCION exacta de cada dato contra el literal del fixture | R1, R2, R5   |
// | V2| Contencion horizontal medida con la fuente y el cuerpo del `Tf`  | R3, R16      |
// | V3| Contencion vertical, bandas disjuntas y ordenadas, nada en los codigos | R4, R13 |
// | V4| Suelo: ningun `Tf` por debajo de `CUERPO_MINIMO_PT`              | R6           |
// | V5| Jerarquia por tamaño + el importe dentro de su recuadro          | R14, R15     |
// | V6| Ningun texto con marca de recorte                                | R1           |
// | V7| La COLOCACION de los rotulos: apilados sobre su valor, o en linea | 353          |
// | V8| El DISEÑO aprobado, en milimetros: cabecera, QR, barcode, regla,  | 353          |
// |   | grosores y pesos                                                 |              |
//
// Feature 353 — V7 y V8 existen porque la 350 NO ATABA LA DISPOSICION con
// ninguna asercion: se aprobo un spec escrito, nadie comparo el PDF con el
// diseño y la maqueta derivo con la suite entera en verde. Corren aqui —y no en
// una suite suelta— por el mismo motivo que las seis primeras: los DOS
// generadores tienen que pasarlas sobre el mismo corpus.
//
// V1 es la que de verdad muerde. «No hay tres puntos» es una asercion debil:
// sobreviviria a un corte sin marca o a cambiar la marca. Comparar la
// concatenacion contra el valor ENTERO cierra las tres puertas a la vez.

/** Marca de puntos suspensivos de un solo caracter (U+2026). */
export const ELIPSIS_UNICODE = "…";

/** Un texto dibujado, ya en milimetros y con su ancho de tinta medido. */
export interface TextoMm {
  texto: string;
  /** Borde izquierdo de la tinta, en mm desde el borde izquierdo de la pagina. */
  xMm: number;
  /** LINEA BASE, en mm desde el borde SUPERIOR de la pagina. */
  yMm: number;
  /** Cuerpo con el que se dibujo, en pt. */
  pt: number;
  /** Ancho de tinta medido con la MISMA fuente y el MISMO cuerpo. */
  anchoMm: number;
  /** `/BaseFont` del recurso activo. */
  baseFont: string;
  /** `true` si se dibujo con la fuente embebida (`/Subtype /Type0`). */
  embebida: boolean;
}

/** Un rectangulo o una imagen, normalizados a mm desde la esquina superior izquierda. */
export interface CajaMm {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Un segmento recto ya en mm desde la esquina superior izquierda de la pagina. */
export interface TrazoMm {
  x0: number;
  x1: number;
  /** `y` del segmento, en mm desde el borde SUPERIOR. Solo trazos horizontales. */
  yMm: number;
  /** Grosor, en mm. */
  grosorMm: number;
}

/** Un rectangulo dibujado, en mm, con el grosor con el que se trazó. */
export interface RecuadroMm extends CajaMm {
  grosorMm: number;
}

export interface EtiquetaLeida {
  textos: TextoMm[];
  recuadros: RecuadroMm[];
  imagenes: CajaMm[];
  /** Feature 353 — los segmentos HORIZONTALES (hoy, la regla bajo la cabecera). */
  reglas: TrazoMm[];
}

/** La familia y el estilo de jsPDF con los que se dibujo un texto. */
function tipografiaDe(
  fuentePdf: FuentePdf | undefined,
  embebida: FuenteEmbebida,
): { nombre: string; estilo: string } {
  const base = fuentePdf?.baseFont ?? "Helvetica";
  if (fuentePdf?.subtype === "Type0") {
    return { nombre: embebida.nombre, estilo: embebida.estilo };
  }
  if (/-Bold/i.test(base)) return { nombre: "helvetica", estilo: "bold" };
  if (/-Oblique|-Italic/i.test(base)) return { nombre: "helvetica", estilo: "italic" };
  return { nombre: "helvetica", estilo: "normal" };
}

/**
 * Lee una pagina del PDF y devuelve lo dibujado en milimetros.
 *
 * El ancho de cada texto se mide con `doc.getTextWidth` DESPUES de activar la
 * fuente y el cuerpo que el propio documento declara en su `Tf`: es la unica
 * forma de que «cabe en el ancho util» signifique tinta y no aritmetica. El
 * `doc` que se pasa se usa solo para medir; su estado tipografico queda
 * modificado, asi que no debe reutilizarse para dibujar despues.
 */
export function leerEtiqueta(
  doc: jsPDF,
  bytes: Uint8Array,
  indice: number,
  altoHojaMm: number,
  fuente: FuenteEmbebida,
): EtiquetaLeida {
  const fuentes = fuentesDePagina(bytes, indice);
  const textos = textosDePagina(bytes, indice).map((t): TextoMm => {
    const recurso = fuentes.get(t.fuenteRes);
    const tipo = tipografiaDe(recurso, fuente);
    doc.setFont(tipo.nombre, tipo.estilo);
    doc.setFontSize(t.tamano);
    const texto = textoLegible(t, recurso);
    return {
      texto,
      xMm: t.x * PT_A_MM,
      yMm: altoHojaMm - t.y * PT_A_MM,
      pt: t.tamano,
      anchoMm: doc.getTextWidth(texto),
      baseFont: recurso?.baseFont ?? "",
      embebida: recurso?.subtype === "Type0",
    };
  });

  const recuadros = rectangulosDePagina(bytes, indice).map((r): RecuadroMm => {
    const x0 = r.x * PT_A_MM;
    const yA = altoHojaMm - r.y * PT_A_MM;
    const yB = altoHojaMm - (r.y + r.h) * PT_A_MM;
    return {
      x0: Math.min(x0, x0 + r.w * PT_A_MM),
      x1: Math.max(x0, x0 + r.w * PT_A_MM),
      y0: Math.min(yA, yB),
      y1: Math.max(yA, yB),
      grosorMm: r.grosor * PT_A_MM,
    };
  });

  const imagenes = imagenesDePagina(bytes, indice).map((i): CajaMm => {
    const x0 = i.x * PT_A_MM;
    const yInferior = altoHojaMm - i.y * PT_A_MM;
    return {
      x0,
      x1: x0 + i.w * PT_A_MM,
      y0: yInferior - i.h * PT_A_MM,
      y1: yInferior,
    };
  });

  // Solo los HORIZONTALES: la unica linea que la maqueta dibuja es la regla de
  // la cabecera. Si un dia apareciera una vertical, este filtro la dejaria fuera
  // y el test que cuenta las reglas se daria cuenta.
  const reglas = trazosDePagina(bytes, indice)
    .filter((t) => Math.abs(t.y1 - t.y2) < 1e-6)
    .map((t): TrazoMm => ({
      x0: Math.min(t.x1, t.x2) * PT_A_MM,
      x1: Math.max(t.x1, t.x2) * PT_A_MM,
      yMm: altoHojaMm - t.y1 * PT_A_MM,
      grosorMm: t.grosor * PT_A_MM,
    }));

  return { textos, recuadros, imagenes, reglas };
}

/**
 * ¿Reconstruyen `lineas` el valor `esperado` EXACTAMENTE?
 *
 * Se consume el esperado linea a linea, admitiendo solo el espacio en blanco que
 * introduce el salto de linea (R2). No se normaliza «quitando todos los
 * espacios», que seria mas comodo y mucho mas debil: asi un caracter de menos,
 * uno de mas o uno sustituido rompen la reconstruccion, que es exactamente lo
 * que la mutacion M8 comprueba.
 */
export function reconstruye(lineas: readonly string[], esperado: string): boolean {
  let resto = esperado;
  for (const linea of lineas) {
    resto = resto.replace(/^\s+/, "");
    if (!resto.startsWith(linea)) return false;
    resto = resto.slice(linea.length);
  }
  return resto.trim() === "";
}

/**
 * Indices `[desde, hasta)` del tramo CONTIGUO de textos dibujados que reconstruye
 * `esperado`, o `null` si no existe ninguno.
 *
 * Contiguo porque el generador dibuja las lineas de un dato una detras de otra;
 * si algun dia dejaran de serlo, esto se pondria rojo y eso es lo correcto: seria
 * señal de que otro texto se ha colado en medio.
 */
export function tramoQueReconstruye(
  textos: readonly TextoMm[],
  esperado: string,
  disponibles?: readonly boolean[],
): [number, number] | null {
  for (let i = 0; i < textos.length; i++) {
    if (disponibles && !disponibles[i]) continue;
    let resto = esperado;
    let j = i;
    while (j < textos.length && (!disponibles || disponibles[j])) {
      const sinEspacio = resto.replace(/^\s+/, "");
      if (!sinEspacio.startsWith(textos[j].texto)) break;
      resto = sinEspacio.slice(textos[j].texto.length);
      j++;
      if (resto.trim() === "") return [i, j];
    }
  }
  return null;
}

const EPS = 1e-6;

function solapan(a: CajaMm, b: CajaMm): boolean {
  return a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.y0 < b.y1 - EPS && b.y0 < a.y1 - EPS;
}

/** Caja de tinta de un texto: 1 em por encima de la linea base y el descendente por debajo. */
export function cajaDeTexto(t: TextoMm): CajaMm {
  return {
    x0: t.xMm,
    x1: t.xMm + t.anchoMm,
    y0: t.yMm - t.pt * PT_A_MM,
    y1: t.yMm + t.pt * PT_A_MM * (INTERLINEADO - 1),
  };
}

export interface ResultadoVerificacion {
  /** Cuerpo efectivo de cada dato, en pt (el del primer tramo dibujado). */
  cuerpos: Record<keyof EsperadoEtiqueta, number>;
  /** Cuantas lineas ocupo cada dato. */
  lineas: Record<keyof EsperadoEtiqueta, number>;
  /**
   * Feature 353 — `true` si la etiqueta salio con los rotulos APILADOS sobre su
   * valor (la disposicion del diseño aprobado) y `false` si cayo a la de la 350,
   * con el rotulo en la linea de su valor y sin `PARA`.
   *
   * Se LEE DEL PDF, no se pregunta al codigo que lo decide: comparar contra la
   * funcion que produce el resultado esta siempre verde.
   */
  apilados: boolean;
  /** El primer texto de cada dato, ya en mm. Para las medidas del diseño. */
  primeros: Record<keyof EsperadoEtiqueta, TextoMm>;
  /** Los rotulos dibujados, por su texto. */
  rotulos: Map<string, TextoMm>;
  /** Lo leido del PDF, por si el llamador quiere medir mas. */
  leida: EtiquetaLeida;
}

/**
 * Corre V1-V6 sobre UNA etiqueta ya dibujada y devuelve lo medido.
 *
 * Falla con `expect` en cuanto algo no cuadra: nada de `if (!datos) return`, que
 * es la forma que tiene un test de reportarse verde sin haber comprobado nada.
 */
export function verificarEtiqueta(
  doc: jsPDF,
  bytes: Uint8Array,
  indice: number,
  layout: EtiquetaLayout,
  fuente: FuenteEmbebida,
  caso: CasoEtiqueta,
  contexto: string,
): ResultadoVerificacion {
  const leida = leerEtiqueta(doc, bytes, indice, layout.hoja.altoMm, fuente);
  const { textos } = leida;
  expect(textos.length, `${contexto}: no se leyo ningun texto del PDF`).toBeGreaterThan(10);

  // --- V1: reconstruccion exacta de los diez datos -------------------------
  const asignado = new Array<boolean>(textos.length).fill(false);
  const cuerpos = {} as Record<keyof EsperadoEtiqueta, number>;
  const lineas = {} as Record<keyof EsperadoEtiqueta, number>;
  const tramos = {} as Record<keyof EsperadoEtiqueta, [number, number]>;

  const claves = Object.keys(caso.esperado) as Array<keyof EsperadoEtiqueta>;
  for (const clave of claves) {
    const esperado = caso.esperado[clave];
    // Se busca solo entre textos AUN NO asignados: si no, dos datos con el mismo
    // valor se reconstruirian los dos con las mismas lineas y uno de ellos
    // podria faltar del papel sin que nadie lo viera.
    const disponibles = asignado.map((a) => !a);
    const tramo = tramoQueReconstruye(textos, esperado, disponibles);
    expect(
      tramo,
      `${contexto}: el dato «${clave}» NO se reconstruye desde el PDF. Esperado ${JSON.stringify(esperado)}; dibujado ${JSON.stringify(textos.map((t) => t.texto))}`,
    ).not.toBeNull();
    const [desde, hasta] = tramo!;
    for (let i = desde; i < hasta; i++) asignado[i] = true;
    tramos[clave] = [desde, hasta];
    cuerpos[clave] = textos[desde].pt;
    lineas[clave] = hasta - desde;
  }

  // Los rotulos son los unicos textos que pueden no pertenecer a ningun dato.
  // `PARA` va aparte: es el unico CONDICIONAL, porque solo se dibuja cuando los
  // rotulos caben apilados (feature 353). Los otros seis son obligatorios.
  const ROTULOS = [
    ROTULO_GUIA,
    ROTULO_FECHA,
    ROTULO_REMISION,
    ROTULO_COBRAR,
    ROTULO_PRODUCTO,
    ROTULO_TIENDA,
  ];
  const rotulos = new Map<string, TextoMm>();
  for (let i = 0; i < textos.length; i++) {
    if (asignado[i]) continue;
    expect(
      [...ROTULOS, ROTULO_PARA],
      `${contexto}: el texto ${JSON.stringify(textos[i].texto)} no es ni un dato ni un rotulo conocido`,
    ).toContain(textos[i].texto);
    rotulos.set(textos[i].texto, textos[i]);
  }
  for (const rotulo of ROTULOS) {
    expect(
      textos.map((t) => t.texto),
      `${contexto}: falta el rotulo «${rotulo}»`,
    ).toContain(rotulo);
  }

  // --- V7 (feature 353): la DISPOSICION de los rotulos, leida del PDF ------
  //
  // `PARA` presente <=> rotulos apilados. No se pregunta al codigo: se deduce de
  // la tinta y despues se comprueba que las OTRAS dos consecuencias de esa misma
  // decision cuadran. Si `PARA` estuviera y `CONTENIDO` compartiera linea con su
  // valor, la etiqueta seria un hibrido que nadie diseño y esto lo caza.
  const apilados = rotulos.has(ROTULO_PARA);
  const primeros = {} as Record<keyof EsperadoEtiqueta, TextoMm>;
  for (const clave of claves) primeros[clave] = textos[tramos[clave][0]];

  for (const [rotulo, dato] of [
    [ROTULO_PRODUCTO, primeros.producto],
    [ROTULO_TIENDA, primeros.tiendaNombre],
  ] as Array<[string, TextoMm]>) {
    const t = rotulos.get(rotulo)!;
    if (apilados) {
      expect(
        t.yMm,
        `${contexto}: «${rotulo}» (y=${t.yMm.toFixed(2)}) deberia ir ENCIMA de su valor (y=${dato.yMm.toFixed(2)}) y no en su linea`,
      ).toBeLessThan(dato.yMm - EPS);
      expect(
        Math.abs(t.xMm - dato.xMm),
        `${contexto}: apilado, «${rotulo}» y su valor arrancan en x distintas (${t.xMm.toFixed(2)} vs ${dato.xMm.toFixed(2)})`,
      ).toBeLessThan(1e-3);
    } else {
      expect(
        Math.abs(t.yMm - dato.yMm),
        `${contexto}: sin apilar, «${rotulo}» deberia compartir linea base con su valor`,
      ).toBeLessThan(1e-3);
      expect(
        t.xMm,
        `${contexto}: sin apilar, «${rotulo}» deberia ir DELANTE de su valor`,
      ).toBeLessThan(dato.xMm - EPS);
    }
  }
  if (apilados) {
    const para = rotulos.get(ROTULO_PARA)!;
    expect(
      para.yMm,
      `${contexto}: «${ROTULO_PARA}» no va encima del destinatario`,
    ).toBeLessThan(primeros.destinatario.yMm - EPS);
  }

  // --- V6: ninguna marca de recorte ---------------------------------------
  for (const t of textos) {
    expect(
      t.texto.includes(MARCA_CORTE),
      `${contexto}: el texto ${JSON.stringify(t.texto)} lleva la marca de recorte`,
    ).toBe(false);
    expect(
      t.texto.includes(ELIPSIS_UNICODE),
      `${contexto}: el texto ${JSON.stringify(t.texto)} lleva puntos suspensivos`,
    ).toBe(false);
  }

  // --- V4: el suelo de legibilidad ----------------------------------------
  for (const t of textos) {
    expect(
      t.pt,
      `${contexto}: ${JSON.stringify(t.texto)} se dibuja a ${t.pt} pt, por debajo del suelo`,
    ).toBeGreaterThanOrEqual(CUERPO_MINIMO_PT - EPS);
  }

  // --- V2/V3: contencion en la celda --------------------------------------
  const izquierda = layout.celda.x0 + layout.margen;
  const derecha = izquierda + layout.anchoUtil;
  const arriba = layout.celda.y0 + layout.margen;
  const abajo = arriba + layout.altoUtil;
  for (const t of textos) {
    const caja = cajaDeTexto(t);
    expect(
      caja.x0,
      `${contexto}: ${JSON.stringify(t.texto)} empieza en x=${caja.x0.toFixed(2)} mm, fuera del margen izquierdo`,
    ).toBeGreaterThanOrEqual(izquierda - 1e-3);
    expect(
      caja.x1,
      `${contexto}: ${JSON.stringify(t.texto)} acaba en x=${caja.x1.toFixed(2)} mm y el ancho util llega a ${derecha.toFixed(2)}`,
    ).toBeLessThanOrEqual(derecha + 1e-3);
    expect(
      caja.y0,
      `${contexto}: ${JSON.stringify(t.texto)} sube por encima del area util`,
    ).toBeGreaterThanOrEqual(arriba - 1e-3);
    expect(
      caja.y1,
      `${contexto}: ${JSON.stringify(t.texto)} baja por debajo del area util`,
    ).toBeLessThanOrEqual(abajo + 1e-3);
  }

  // --- V3: nada de texto dentro de la banda de codigos ---------------------
  expect(
    leida.imagenes.length,
    `${contexto}: se esperaban el QR y el codigo de barras como imagenes`,
  ).toBe(2);
  for (const imagen of leida.imagenes) {
    for (const t of textos) {
      expect(
        solapan(cajaDeTexto(t), imagen),
        `${contexto}: ${JSON.stringify(t.texto)} invade la banda reservada a los codigos`,
      ).toBe(false);
    }
  }

  // --- V3: las cinco bandas, disjuntas y en su orden -----------------------
  const extremos = (
    claves2: Array<keyof EsperadoEtiqueta>,
    rotulosDeLaBanda: string[] = [],
  ): CajaMm => {
    const cajas = claves2.flatMap((c) => {
      const [d, h] = tramos[c];
      return textos.slice(d, h).map(cajaDeTexto);
    });
    // Feature 353 — los rotulos ENTRAN en la caja de su banda. Sin esto, un
    // rotulo apilado podria caer dentro de la banda de arriba y la comprobacion
    // de bandas disjuntas no se enteraria: mediria solo los valores.
    for (const r of rotulosDeLaBanda) {
      const t = rotulos.get(r);
      if (t) cajas.push(cajaDeTexto(t));
    }
    return {
      x0: Math.min(...cajas.map((c) => c.x0)),
      x1: Math.max(...cajas.map((c) => c.x1)),
      y0: Math.min(...cajas.map((c) => c.y0)),
      y1: Math.max(...cajas.map((c) => c.y1)),
    };
  };
  const qr = leida.imagenes.find((i) => Math.abs(i.x1 - i.x0 - (i.y1 - i.y0)) < 0.01);
  expect(qr, `${contexto}: no se encontro una imagen CUADRADA (el QR)`).toBeDefined();
  const barcode = leida.imagenes.find((i) => i !== qr);
  expect(barcode, `${contexto}: no se encontro el codigo de barras`).toBeDefined();

  const cabecera = extremos(
    ["numGuia", "fechaCreacion", "numRemision"],
    [ROTULO_GUIA, ROTULO_FECHA, ROTULO_REMISION],
  );
  const destino = extremos(
    ["destinatario", "telefonoDest", "direccion", "ubicacion"],
    [ROTULO_PARA],
  );
  expect(leida.recuadros.length, `${contexto}: se esperaba UN recuadro (el del importe)`).toBe(1);
  const importe = leida.recuadros[0];
  const detalle = extremos(["producto", "tiendaNombre"], [ROTULO_PRODUCTO, ROTULO_TIENDA]);

  const bandas: Array<[string, CajaMm]> = [
    ["cabecera", { ...cabecera, y1: Math.max(cabecera.y1, qr!.y1), y0: Math.min(cabecera.y0, qr!.y0) }],
    ["destino", destino],
    ["importe", importe],
    ["detalle", detalle],
    ["codigos", barcode!],
  ];
  for (let i = 1; i < bandas.length; i++) {
    expect(
      bandas[i][1].y0,
      `${contexto}: la banda «${bandas[i][0]}» (y0=${bandas[i][1].y0.toFixed(2)}) se solapa con «${bandas[i - 1][0]}» (y1=${bandas[i - 1][1].y1.toFixed(2)})`,
    ).toBeGreaterThanOrEqual(bandas[i - 1][1].y1 - 1e-3);
  }

  // --- V3/R13: el ORDEN de los datos de arriba abajo ----------------------
  // Los tres de cabecera comparten banda y no se ordenan entre si; del destino
  // hacia abajo el orden es el requisito.
  const ordenExigido: Array<keyof EsperadoEtiqueta> = [
    "destinatario",
    "telefonoDest",
    "direccion",
    "ubicacion",
    "montoCobrar",
    "producto",
    "tiendaNombre",
  ];
  for (let i = 1; i < ordenExigido.length; i++) {
    const previo = textos[tramos[ordenExigido[i - 1]][0]];
    const actual = textos[tramos[ordenExigido[i]][0]];
    expect(
      actual.yMm,
      `${contexto}: «${ordenExigido[i]}» (y=${actual.yMm.toFixed(2)}) no va por debajo de «${ordenExigido[i - 1]}» (y=${previo.yMm.toFixed(2)})`,
    ).toBeGreaterThan(previo.yMm);
  }

  // --- V5: jerarquia por tamaño y el importe en su recuadro ----------------
  expect(
    cuerpos.destinatario,
    `${contexto}: destinatario ${cuerpos.destinatario} pt no supera a producto ${cuerpos.producto} pt`,
  ).toBeGreaterThan(cuerpos.producto);
  expect(cuerpos.destinatario).toBeGreaterThan(cuerpos.tiendaNombre);
  expect(
    cuerpos.telefonoDest,
    `${contexto}: telefono ${cuerpos.telefonoDest} pt no supera a producto ${cuerpos.producto} pt`,
  ).toBeGreaterThan(cuerpos.producto);
  expect(cuerpos.telefonoDest).toBeGreaterThan(cuerpos.tiendaNombre);

  expect(lineas.montoCobrar, `${contexto}: el importe se partio en varias lineas`).toBe(1);
  const [dMonto] = tramos.montoCobrar;
  const cajaMonto = cajaDeTexto(textos[dMonto]);
  expect(
    cajaMonto.x0 >= importe.x0 - 1e-3 &&
      cajaMonto.x1 <= importe.x1 + 1e-3 &&
      cajaMonto.y0 >= importe.y0 - 1e-3 &&
      cajaMonto.y1 <= importe.y1 + 1e-3,
    `${contexto}: el importe ${JSON.stringify(textos[dMonto].texto)} [${cajaMonto.x0.toFixed(2)}, ${cajaMonto.x1.toFixed(2)}] x [${cajaMonto.y0.toFixed(2)}, ${cajaMonto.y1.toFixed(2)}] no esta contenido en su recuadro [${importe.x0.toFixed(2)}, ${importe.x1.toFixed(2)}] x [${importe.y0.toFixed(2)}, ${importe.y1.toFixed(2)}]`,
  ).toBe(true);
  expect(
    textos[dMonto].embebida,
    `${contexto}: el importe no se dibujo con la fuente embebida`,
  ).toBe(true);

  // =========================================================================
  // V8 (feature 353) — LA DISPOSICION DEL DISEÑO APROBADO, medida sobre el PDF.
  //
  // Existe porque la 350 no ataba la disposicion con NINGUNA asercion: se aprobo
  // un spec escrito, nadie comparo el PDF con el diseño y la maqueta derivo sin
  // que un solo test se pusiera rojo. Todo lo de aqui abajo se comprueba en los
  // DOS generadores, en las CUATRO hojas y con el corpus entero.
  // =========================================================================
  const unEm = separacionBajoGuiaMm(layout.cuerpos.guia);
  const marca = rotulos.get(ROTULO_GUIA)!;

  // V8a — la cabecera: marca ARRIBA, numero en medio, `REM`/`FECHA` DEBAJO, con
  // al menos 1 em del cuerpo del numero de separacion a cada lado (la regla
  // derivada de la 282, que aqui se ejerce por partida doble).
  expect(
    primeros.numGuia.yMm - marca.yMm,
    `${contexto}: el rotulo «${ROTULO_GUIA}» no queda 1 em (${unEm.toFixed(2)} mm) por encima del numero de guia`,
  ).toBeGreaterThanOrEqual(unEm - 1e-3);
  for (const clave of ["numRemision", "fechaCreacion"] as const) {
    expect(
      primeros[clave].yMm - primeros.numGuia.yMm,
      `${contexto}: «${clave}» no queda 1 em (${unEm.toFixed(2)} mm) por DEBAJO del numero de guia; el diseño la pone en la fila de abajo`,
    ).toBeGreaterThanOrEqual(unEm - 1e-3);
  }
  expect(
    Math.abs(primeros.numRemision.yMm - primeros.fechaCreacion.yMm),
    `${contexto}: remision y fecha no comparten la fila META`,
  ).toBeLessThan(1e-3);
  expect(
    Math.abs(rotulos.get(ROTULO_REMISION)!.yMm - primeros.numRemision.yMm),
    `${contexto}: «${ROTULO_REMISION}» no comparte linea con su valor`,
  ).toBeLessThan(1e-3);
  expect(
    Math.abs(rotulos.get(ROTULO_FECHA)!.yMm - primeros.fechaCreacion.yMm),
    `${contexto}: «${ROTULO_FECHA}» no comparte linea con su valor`,
  ).toBeLessThan(1e-3);

  // V8b — el numero de guia MANDA: es el texto mas grande de la pagina y se
  // dibuja al cuerpo que declara la maqueta, sin encogerse.
  expect(
    cuerpos.numGuia,
    `${contexto}: el numero de guia se dibujo a ${cuerpos.numGuia} pt y la maqueta declara ${layout.cuerpos.guia}`,
  ).toBeCloseTo(layout.cuerpos.guia, 6);
  for (const t of textos) {
    if (t === primeros.numGuia) continue;
    expect(
      t.pt,
      `${contexto}: ${JSON.stringify(t.texto)} se dibuja a ${t.pt} pt y el numero de guia solo a ${cuerpos.numGuia}: el numero deja de ser el elemento dominante`,
    ).toBeLessThan(cuerpos.numGuia - 1e-9);
  }

  // V8c — el QR: CUADRADO, del lado que declara la maqueta y pegado a la esquina
  // SUPERIOR DERECHA del area util. Esta es la que caza «devolver el QR abajo».
  expect(qr!.x1 - qr!.x0, `${contexto}: el QR no mide el lado de la maqueta`).toBeCloseTo(
    layout.qrMm,
    6,
  );
  expect(qr!.y1 - qr!.y0).toBeCloseTo(layout.qrMm, 6);
  expect(qr!.y0, `${contexto}: el QR no arranca en el borde SUPERIOR del area util`).toBeCloseTo(
    arriba,
    3,
  );
  expect(qr!.x1, `${contexto}: el QR no acaba en el borde DERECHO del area util`).toBeCloseTo(
    derecha,
    3,
  );

  // V8d — el codigo de barras: SOLO el, a todo el ancho util y pegado abajo.
  expect(
    barcode!.x0,
    `${contexto}: el codigo de barras no arranca en el margen izquierdo`,
  ).toBeCloseTo(izquierda, 3);
  expect(barcode!.x1, `${contexto}: el codigo de barras no llega al margen derecho`).toBeCloseTo(
    derecha,
    3,
  );
  expect(barcode!.y1, `${contexto}: el codigo de barras no esta pegado al borde inferior`).toBeCloseTo(
    abajo,
    3,
  );
  expect(barcode!.y1 - barcode!.y0).toBeCloseTo(layout.barcodeMm, 6);

  // V8e — la REGLA HORIZONTAL bajo la cabecera: una sola, a todo el ancho util,
  // entre la cabecera y el destino, y con el grosor de la maqueta.
  expect(
    leida.reglas.length,
    `${contexto}: se esperaba UNA regla horizontal bajo la cabecera y hay ${leida.reglas.length}`,
  ).toBe(1);
  const regla = leida.reglas[0];
  expect(regla.x0, `${contexto}: la regla no arranca en el margen izquierdo`).toBeCloseTo(
    izquierda,
    3,
  );
  expect(regla.x1, `${contexto}: la regla no llega al margen derecho`).toBeCloseTo(derecha, 3);
  expect(regla.grosorMm, `${contexto}: la regla no tiene el grosor de la maqueta`).toBeCloseTo(
    GROSOR_REGLA_MM * Math.max(1, layout.k),
    6,
  );
  expect(
    regla.yMm,
    `${contexto}: la regla (y=${regla.yMm.toFixed(2)}) no va DEBAJO de la cabecera (y1=${bandas[0][1].y1.toFixed(2)})`,
  ).toBeGreaterThanOrEqual(bandas[0][1].y1 - 1e-3);
  expect(
    regla.yMm,
    `${contexto}: la regla (y=${regla.yMm.toFixed(2)}) no va ENCIMA del destino (y0=${destino.y0.toFixed(2)})`,
  ).toBeLessThanOrEqual(destino.y0 + 1e-3);

  // V8f — el recuadro del importe, de BORDE GRUESO.
  expect(
    importe.grosorMm,
    `${contexto}: el recuadro del importe no tiene el grosor de la maqueta`,
  ).toBeCloseTo(GROSOR_RECUADRO_MM * Math.max(1, layout.k), 6);

  // V8g — los PESOS del bloque de destino: nombre, telefono y ubicacion en
  // negrita; la direccion en redonda. Un texto que necesite la fuente embebida
  // no tiene version negrita y se acepta tal cual (esta declarado en el dibujo).
  const enNegrita = (t: TextoMm) => /-Bold/i.test(t.baseFont) || t.embebida;
  for (const clave of ["destinatario", "telefonoDest", "ubicacion"] as const) {
    expect(
      enNegrita(primeros[clave]),
      `${contexto}: «${clave}» deberia ir en negrita y su fuente es ${primeros[clave].baseFont}`,
    ).toBe(true);
  }
  expect(
    /-Bold/i.test(primeros.direccion.baseFont),
    `${contexto}: la direccion deberia ir en redonda, no en negrita`,
  ).toBe(false);

  return { cuerpos, lineas, apilados, primeros, rotulos, leida };
}
