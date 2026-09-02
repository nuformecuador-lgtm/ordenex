// Ajuste vertical de los campos de la etiqueta de guia: aritmetica pura,
// compartida por los DOS generadores de PDF (el de cliente
// `app/(app)/ordenes/_components/etiquetas-pdf.ts` y el server-side del lote
// `lib/pdf/etiquetas-pdf-lote.ts`), que maquetan la misma etiqueta con libs de
// rasterizado distintas.
//
// El problema que resuelve: el bloque QR + codigo de barras se dibuja en una `y`
// FIJA (pegado al borde inferior), mientras el texto fluye hacia abajo desde la
// cabecera. Cuando el texto necesita mas alto del disponible, jspdf no recorta
// nada: sigue escribiendo y las ultimas lineas quedan DEBAJO del QR (ilegibles,
// y peor: tapan modulos del QR si la impresion es a un solo color). Aqui se
// decide, antes de dibujar, cuantas lineas puede gastar cada campo.
//
// Vive en `lib/` (y no junto a la maqueta de cliente) porque el generador del
// lote corre en Node y no puede importar de `app/`.
//
// ---------------------------------------------------------------------------
// Feature 350 (T8) — EL TEXTO YA NO SE RECORTA: EL CUERPO BAJA HASTA UN SUELO.
//
// Lo que hacia este modulo: repartir un cupo FIJO de lineas entre los campos y
// cortar la cola del que se pasara, marcandola con `...`. Eso resolvia el
// solape sobre el QR pero perdia datos, y el humano fue literal: «ningun dato
// de los que mostramos puede estar recortado ni terminado en tres puntos».
//
// Lo que hace ahora: `ajustarBloque` busca, de forma DESCENDENTE y en pasos de
// 0,25 pt, el mayor cuerpo con el que el bloque entero cabe en su banda. Ningun
// bloque pierde lineas en ningun paso —el numero de lineas lo dicta el texto y
// lo que se ajusta es el cuerpo—, y por eso la reconstruccion exacta de cada
// dato (R2) es cierta POR CONSTRUCCION y no por vigilancia. Si con el suelo
// declarado sigue sin caber, el llamador lanza `ErrorEtiquetaNoCabe` (R7): un
// PDF que falta es mejor que un PDF que miente.
//
// `MARCA_CORTE` y `recortarConElipsis` se CONSERVAN en el archivo y dejan de
// usarse en el camino de la etiqueta. Borrarlos arrastraria sus tests, y en este
// repo eso ya costo una regresion en produccion; ademas la verificacion de la
// 350 los usa como control negativo (ningun texto del PDF contiene la marca).

import { INTERLINEADO, PASO_AJUSTE_PT, PT_A_MM } from "./etiquetas-maqueta";

/** Marca de corte. ASCII a proposito: "…" cambia la codificacion del literal a UTF-16 en jspdf. */
export const MARCA_CORTE = "...";

/**
 * Reparte `maxTotal` lineas entre los campos, partiendo de las que cada uno
 * necesita (`naturales`) y recortando SIEMPRE al campo mas alto.
 *
 * Recortar al mas alto —y no en orden de aparicion— es lo que evita el peor
 * resultado: con un recorte secuencial, una direccion de cuatro lineas se
 * quedaria entera y los campos del final (producto, monto, tienda) desaparecerian.
 * Ningun campo baja de 1 linea: los nueve datos de la etiqueta siguen presentes.
 */
export function repartirLineas(naturales: number[], maxTotal: number): number[] {
  const asignadas = naturales.map((n) => Math.max(1, n));
  // Si no cabe ni una linea por campo, se devuelve el minimo: el llamador
  // dimensiona la banda de texto para que esto no ocurra, pero mas vale una
  // etiqueta apretada que un bucle infinito.
  if (maxTotal < asignadas.length) return asignadas.map(() => 1);

  let total = asignadas.reduce((a, b) => a + b, 0);
  while (total > maxTotal) {
    // `>=` a proposito: si varios campos empatan en alto, se recorta el ULTIMO.
    // El orden de la etiqueta va de mas a menos importante (destinatario primero,
    // tienda al final), asi que empatar a favor del primero es lo correcto.
    let masAlto = 0;
    for (let i = 1; i < asignadas.length; i++) {
      if (asignadas[i] >= asignadas[masAlto]) masAlto = i;
    }
    asignadas[masAlto] -= 1;
    total -= 1;
  }
  return asignadas;
}

/**
 * Recorta `lineas` a `permitidas` y marca el corte con `MARCA_CORTE` en la
 * ultima linea visible, comiendo caracteres hasta que la marca CABE en
 * `anchoMax` (medido con `medir`, normalmente `doc.getTextWidth`). Sin ese
 * bucle, pegar los puntos desbordaria el ancho de la columna y el texto se
 * saldria por la derecha justo en el caso que estamos arreglando.
 */
export function recortarConElipsis(
  lineas: string[],
  permitidas: number,
  anchoMax: number,
  medir: (texto: string) => number,
): string[] {
  const tope = Math.max(1, permitidas);
  if (lineas.length <= tope) return lineas;

  const cortadas = lineas.slice(0, tope);
  const ultima = cortadas.length - 1;
  let texto = cortadas[ultima].trimEnd();
  while (texto.length > 0 && medir(texto + MARCA_CORTE) > anchoMax) {
    texto = texto.slice(0, -1).trimEnd();
  }
  cortadas[ultima] = texto + MARCA_CORTE;
  return cortadas;
}

/**
 * Cuantas lineas de texto caben entre `yInicio` y `yLimite` (unidades del lienzo
 * base) sabiendo que hay `numCampos - 1` separaciones `fieldGap` entre campos.
 *
 * La geometria exacta: con `n` lineas repartidas en `numCampos` campos, la ultima
 * LINEA BASE cae en `yInicio + (n - 1) * lineHeight + (numCampos - 1) * fieldGap`
 * (la `y` de jspdf es la linea base, no el borde inferior). Se despeja `n` de que
 * eso no pase de `yLimite`; el descendente de esa ultima linea lo absorbe el aire
 * que el llamador deja entre `yLimite` y el borde del QR.
 */
export function lineasDisponibles(
  yInicio: number,
  yLimite: number,
  lineHeight: number,
  fieldGap: number,
  numCampos: number,
): number {
  const alto = yLimite - yInicio - (numCampos - 1) * fieldGap;
  return Math.max(numCampos, Math.floor(alto / lineHeight) + 1);
}

// ===========================================================================
// Feature 350 — El ajuste por CUERPO. Nada de lo de arriba se usa ya en el
// camino de la etiqueta; nada de lo de abajo recorta un solo caracter.
// ===========================================================================

/**
 * Mide el ancho de tinta de `texto` a `pt`, en mm de pagina.
 *
 * Se inyecta —y no se importa jsPDF— por dos razones: este modulo tiene que
 * seguir siendo aritmetica pura (lo comparten dos runtimes distintos) y la
 * tipografia con la que se mide tiene que ser la MISMA con la que se dibuja. El
 * llamador activa la fuente antes de pasar la funcion; esa disciplina viene de
 * la feature 282 y es la que evita calcular el reparto con las anchuras de una
 * fuente y dibujar con las de otra.
 */
export type MedirTexto = (texto: string, pt: number) => number;

/** Tolerancia de coma flotante al comparar milimetros. */
const EPS = 1e-9;

/**
 * El mayor prefijo de `texto` que cabe en `anchoMm`, en numero de caracteres.
 * Nunca devuelve 0: si ni un solo caracter cupiera, devolver 0 colgaria el
 * bucle que la usa. Ese caso —una celda mas estrecha que un glifo— lo detecta
 * `ajustarBloque` comparando el ancho de cada linea, y acaba en R7.
 */
function mayorPrefijoQueCabe(
  texto: string,
  anchoMm: number,
  pt: number,
  medir: MedirTexto,
): number {
  let corte = texto.length;
  while (corte > 1 && medir(texto.slice(0, corte), pt) > anchoMm + EPS) corte--;
  return corte;
}

/**
 * Parte `texto` en las lineas con las que se va a DIBUJAR, sin perder ni
 * añadir un solo caracter (R2) y sin que ninguna linea exceda su ancho util (R3).
 *
 * Envoltura codiciosa por palabras y, si una palabra no cabe entera, PARTIDO POR
 * CARACTER con continuacion en la linea siguiente. Lo segundo es lo que exige
 * R3 y lo que hace que el caso adversarial (una direccion con una «palabra» de
 * 60 caracteres sin un espacio) no se salga del bloque.
 *
 * ⚠️ Medido en esta ficha (T1) con jsPDF 4.2.1 y Helvetica: `splitTextToSize`
 * **si** parte por su cuenta las palabras mas anchas que el cupo (una palabra de
 * 60 «A» en 88 mm sale en dos lineas de 41 y 19, sin desbordar). O sea que aqui
 * NO se esta compensando un defecto de la libreria. Se envuelve a mano de todas
 * formas por tres motivos: este modulo tiene que ser puro (no puede llamar a un
 * metodo de `jsPDF`), la garantia de R3 pasa a ser NUESTRA y no heredada de la
 * version de una dependencia, y el ancho se mide con la MISMA funcion con la que
 * despues se comprueba la contencion sobre el PDF.
 *
 * `sangriaPrimeraMm` es el hueco que ocupa un rotulo en linea (p. ej. «Producto:
 * ») delante de la PRIMERA linea; las siguientes disponen del ancho completo.
 */
export function partirEnLineas(
  texto: string,
  anchoMm: number,
  pt: number,
  medir: MedirTexto,
  sangriaPrimeraMm = 0,
): string[] {
  const palabras = texto.split(/\s+/).filter((p) => p.length > 0);
  const lineas: string[] = [];
  let actual = "";
  // Solo la PRIMERA linea paga la sangria del rotulo; las de continuacion
  // arrancan en el margen y disponen del ancho util completo.
  const disponible = () => (lineas.length === 0 ? anchoMm - sangriaPrimeraMm : anchoMm);

  for (const palabra of palabras) {
    const tentativa = actual === "" ? palabra : `${actual} ${palabra}`;
    if (medir(tentativa, pt) <= disponible() + EPS) {
      actual = tentativa;
      continue;
    }
    if (actual !== "") {
      lineas.push(actual);
      actual = "";
    }
    if (medir(palabra, pt) <= disponible() + EPS) {
      actual = palabra;
      continue;
    }
    // R3: la palabra no cabe entera ni en una linea vacia. Se parte y se
    // continua en la siguiente; NUNCA se deja desbordar el bloque.
    let resto = palabra;
    while (resto.length > 0 && medir(resto, pt) > disponible() + EPS) {
      const corte = mayorPrefijoQueCabe(resto, disponible(), pt, medir);
      lineas.push(resto.slice(0, corte));
      resto = resto.slice(corte);
    }
    actual = resto;
  }
  if (actual !== "") lineas.push(actual);
  return lineas.length > 0 ? lineas : [""];
}

/** Un dato dentro de un bloque que se ajusta como una unidad. */
export interface DatoBloque {
  texto: string;
  /** Cuerpo relativo al del bloque. `1` = el cuerpo del bloque. */
  factorCuerpo: number;
  /**
   * Suelo propio de ESTE dato, en pt de pagina. Nunca por debajo del suelo de
   * legibilidad (R6); los datos DESTACADOS llevan uno mayor para que R14 se
   * cumpla tambien en el caso extremo (ver `CUERPO_MINIMO_DESTACADO_PT`).
   */
  cuerpoMinimoPt: number;
  /** Hueco del rotulo en linea delante de la primera linea, en mm. */
  sangriaPrimeraMm?: (pt: number) => number;
  /**
   * Medidor PROPIO de este dato, si su tipografia no es la del bloque.
   *
   * Existe porque un valor con un caracter que la fuente estandar no sabe
   * escribir se dibuja entero con la fuente embebida (ver
   * `seguroEnFuenteEstandar`), y medirlo con las anchuras de OTRA fuente es
   * justo el fallo mudo que la disciplina de la 282 prohibe: se repartirian las
   * lineas con unas metricas y se dibujarian con otras.
   */
  medir?: MedirTexto;
}

export interface AjusteBloque {
  /** Cuerpo del BLOQUE elegido, en pt. Siempre >= `cuerpoMinPt`. */
  cuerpoPt: number;
  /** Cuerpo EFECTIVO de cada dato, en pt. Siempre >= su `cuerpoMinimoPt`. */
  cuerpos: number[];
  /** Las lineas de cada dato, tal como se van a dibujar. Nunca recortadas. */
  lineas: string[][];
  /** Alto que ocupa el bloque, en mm. */
  altoMm: number;
  /** `false` => ni con el suelo cabe: el llamador aplica R7, NUNCA recorta. */
  cabe: boolean;
  /**
   * Por que NO cabe, cuando `cabe` es `false`. Se distingue el alto del ancho
   * porque son dos problemas distintos para quien lee el error: por alto sobra
   * texto, por ancho hay UNA palabra que no entra en la linea ni con el cuerpo
   * minimo. Decir «necesita 18,9 mm y hay 26,7» cuando el problema es de ancho
   * manda a mirar donde no es.
   */
  motivo: "alto" | "ancho" | null;
}

/** Cuerpo efectivo de un dato para un cuerpo de bloque dado (clamp por su suelo). */
function cuerpoEfectivo(dato: DatoBloque, cuerpoBloquePt: number): number {
  return Math.max(dato.cuerpoMinimoPt, cuerpoBloquePt * dato.factorCuerpo);
}

function componer(
  datos: readonly DatoBloque[],
  anchoMm: number,
  cuerpoBloquePt: number,
  medir: MedirTexto,
): { cuerpos: number[]; lineas: string[][]; altoMm: number; entraDeAncho: boolean } {
  const cuerpos: number[] = [];
  const lineas: string[][] = [];
  let altoMm = 0;
  let entraDeAncho = true;
  for (const dato of datos) {
    const pt = cuerpoEfectivo(dato, cuerpoBloquePt);
    const medirDato = dato.medir ?? medir;
    const sangria = dato.sangriaPrimeraMm ? dato.sangriaPrimeraMm(pt) : 0;
    const partido = partirEnLineas(dato.texto, anchoMm, pt, medirDato, sangria);
    cuerpos.push(pt);
    lineas.push(partido);
    altoMm += partido.length * pt * PT_A_MM * INTERLINEADO;
    // R3 medido, no supuesto: si alguna linea excediera su ancho util (una celda
    // mas estrecha que un glifo), el bloque NO cabe por ancho y hay que bajar el
    // cuerpo o acabar en R7. Sin esta comprobacion, `partirEnLineas` podria
    // devolver una linea de un caracter que aun asi se sale.
    for (let i = 0; i < partido.length; i++) {
      const util = i === 0 ? anchoMm - sangria : anchoMm;
      if (medirDato(partido[i], pt) > util + EPS) entraDeAncho = false;
    }
  }
  return { cuerpos, lineas, altoMm, entraDeAncho };
}

/**
 * El mayor cuerpo con el que TODO el bloque cabe en `altoMm` sin recortar nada.
 *
 * Busqueda DESCENDENTE en pasos de `PASO_AJUSTE_PT` desde `cuerpoMaxPt` hasta
 * `cuerpoMinPt`, y lineal a proposito: el corte de palabras no es monotono de
 * forma garantizada —bajar el cuerpo puede, en un caso patologico, reordenar el
 * reparto de palabras y añadir una linea—, y una busqueda binaria sobre una
 * funcion no monotona devuelve un resultado plausible y equivocado, que es el
 * peor tipo de resultado. Son <= 56 iteraciones por bloque y el coste esta
 * medido en `progress/impl_350.md`.
 *
 * Si ni con `cuerpoMinPt` cabe, se devuelve el resultado a ese cuerpo con
 * `cabe: false` y **con todas sus lineas**: aqui no se recorta jamas. Decidir
 * que hacer con eso es del llamador (R7).
 */
export function ajustarBloque(
  datos: readonly DatoBloque[],
  anchoMm: number,
  altoMm: number,
  cuerpoMaxPt: number,
  cuerpoMinPt: number,
  medir: MedirTexto,
): AjusteBloque {
  const minimo = Math.min(cuerpoMinPt, cuerpoMaxPt);
  const pasos = Math.max(0, Math.floor((cuerpoMaxPt - minimo) / PASO_AJUSTE_PT + EPS));
  for (let i = 0; i <= pasos; i++) {
    const cuerpoPt = cuerpoMaxPt - i * PASO_AJUSTE_PT;
    const r = componer(datos, anchoMm, cuerpoPt, medir);
    if (r.entraDeAncho && r.altoMm <= altoMm + EPS) {
      return {
        cuerpoPt,
        cuerpos: r.cuerpos,
        lineas: r.lineas,
        altoMm: r.altoMm,
        cabe: true,
        motivo: null,
      };
    }
  }
  const r = componer(datos, anchoMm, minimo, medir);
  return {
    cuerpoPt: minimo,
    cuerpos: r.cuerpos,
    lineas: r.lineas,
    altoMm: r.altoMm,
    cabe: false,
    motivo: r.entraDeAncho ? "alto" : "ancho",
  };
}

/**
 * La etiqueta no cabe en su celda ni con el cuerpo minimo de legibilidad (R7).
 *
 * NOMBRA LA GUIA en el mensaje a proposito: una direccion de 286 caracteres es
 * un problema de DATOS, no de maqueta, y el operador solo puede arreglarlo si
 * sabe de que orden se trata. Un «no se pudo generar el PDF» a secas le deja sin
 * nada que hacer.
 *
 * Se lanza ANTES de escribir un solo byte, igual que `exigirCobertura`: el
 * repo ya decidio que un fallo visible es preferible a una etiqueta con un dato
 * mutilado, y esta ficha lo extiende del importe a todo lo demas.
 */
export class ErrorEtiquetaNoCabe extends Error {
  constructor(
    readonly numGuia: number | string,
    readonly hojaId: string,
    readonly dato: string,
    readonly detalle: string,
  ) {
    super(
      `La etiqueta de la guia ${numGuia} no cabe en la hoja «${hojaId}» ni con el cuerpo minimo de legibilidad: ${dato} (${detalle}). No se emite: antes que una etiqueta con un dato recortado, ninguna.`,
    );
    this.name = "ErrorEtiquetaNoCabe";
  }
}
