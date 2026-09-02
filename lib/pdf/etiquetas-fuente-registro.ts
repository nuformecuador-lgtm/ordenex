import type { jsPDF } from "jspdf";

// Feature 282 (T8/T20/T24) — Registro de la fuente embebida en un documento
// jsPDF y comprobacion de cobertura, COMPARTIDOS por los dos generadores de
// etiquetas (el de cliente y el server-side del lote).
//
// Vive en `lib/pdf/` y no junto a la maqueta de cliente porque el generador del
// lote corre en Node y no puede importar de `app/` (mismo motivo por el que
// `etiquetas-ajuste.ts` esta aqui).

/** El artefacto de fuente que se embebe en el PDF (y que la pantalla reutiliza). */
export interface FuenteEmbebida {
  /** Familia con la que se registra en jsPDF y en `document.fonts`. */
  nombre: string;
  /** Nombre del archivo dentro del sistema de archivos virtual de jsPDF. */
  archivoVfs: string;
  /** Estilo con el que se registra ("normal"). */
  estilo: string;
  /** Programa de fuente TrueType completo, en base64. */
  base64: string;
  /**
   * Code points que el subconjunto cubre, como rangos INCLUSIVOS `[desde, hasta]`
   * ordenados. Se genera desde el propio archivo (R29): una cobertura escrita a
   * mano puede mentir, y aqui una mentira no da un aviso —da una etiqueta con el
   * importe roto, que es el bug que esta ficha cierra.
   */
  cobertura: readonly (readonly [number, number])[];
}

/**
 * Registra la fuente en el documento. **Una vez por documento**: `addFont` hace
 * `atob` + parseo del TTF entero cada vez que se llama, y ese coste (`f`) se paga
 * por PDF, no por pagina (design.md §11.2).
 *
 * NO se pasa `"WinAnsiEncoding"` a proposito. Medido en la libreria
 * (`jspdf.node.js:27695-27713`): esa rama embebe `metadata.rawData`, es decir la
 * fuente COMPLETA, y reventaria el tope de 12 KB de `/FontFile2` por documento
 * (R15). El default de `addFont` es Identity-H, que embebe un subconjunto de los
 * glifos realmente usados y escribe el `/ToUnicode` con el que se verifica R9.
 */
export function registrarFuente(doc: jsPDF, fuente: FuenteEmbebida): void {
  doc.addFileToVFS(fuente.archivoVfs, fuente.base64);
  doc.addFont(fuente.archivoVfs, fuente.nombre, fuente.estilo);
}

/**
 * Feature 350 — ¿Puede la fuente ESTANDAR de jsPDF escribir este code point?
 *
 * MEDIDO en esta sesion (jsPDF 4.2.1, Helvetica, los 216 code points imprimibles
 * de cp1252 uno a uno, leyendo el resultado del PDF): sobreviven ASCII
 * `0x20-0x7E` y Latin-1 `0xA0-0xFF` —los acentos y la eñe incluidos— y jsPDF
 * **BORRA los 27 del bloque `0x80-0x9F`**:
 * `€ ‚ ƒ „ … † ‡ ˆ ‰ Š ‹ Œ Ž ‘ ’ “ ” • – — ˜ ™ š › œ ž Ÿ`.
 *
 * No los sustituye por nada ni avisa: `"a—b"` acaba escrito `"ab"` en el content
 * stream, y `getTextWidth` sigue devolviendo el ancho del caracter que no va a
 * imprimir. Es EL MISMO fallo mudo que la feature 282 encontro con el simbolo de
 * moneda —jsPDF borra de la cadena lo que la fuente no cubre— pero en la fuente
 * estandar, donde nadie lo estaba mirando.
 *
 * Importa de verdad y no es teorico: el apostrofo tipografico `’`, las comillas
 * `“ ”` y el guion largo `—` entran por copiar y pegar en un nombre de tienda o
 * en una direccion. La medida del alfabeto de produccion del 2026-08-25 dice que
 * hoy no hay ninguno, pero esa medida «es la foto de un dia y CADUCA»: por eso
 * esto se comprueba en tiempo de ejecucion y no se queda en un test.
 */
export function escribibleEnFuenteEstandar(cp: number): boolean {
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff);
}

/** Primer caracter que la fuente estandar NO puede escribir, o `null`. */
export function caracterNoEscribibleEstandar(texto: string): string | null {
  for (const caracter of texto) {
    const cp = caracter.codePointAt(0);
    if (cp === undefined) continue;
    if (!escribibleEnFuenteEstandar(cp)) return caracter;
  }
  return null;
}

/** ¿Puede dibujarse este texto entero con la fuente estandar, sin perder nada? */
export function seguroEnFuenteEstandar(texto: string): boolean {
  return caracterNoEscribibleEstandar(texto) === null;
}

/** ¿Cubre el subconjunto este code point? */
export function cubreCodePoint(fuente: FuenteEmbebida, cp: number): boolean {
  for (const [desde, hasta] of fuente.cobertura) {
    if (cp < desde) return false;
    if (cp <= hasta) return true;
  }
  return false;
}

/**
 * Primer caracter del texto que el subconjunto NO cubre, o `null` si los cubre
 * todos. Recorre por code point (no por unidad UTF-16) para no partir un par
 * suplente en dos mitades que nadie sabria interpretar.
 */
export function caracterNoCubierto(fuente: FuenteEmbebida, texto: string): string | null {
  for (const caracter of texto) {
    const cp = caracter.codePointAt(0);
    if (cp === undefined) continue;
    if (!cubreCodePoint(fuente, cp)) return caracter;
  }
  return null;
}

/** ¿Puede dibujarse este texto entero con la fuente embebida? */
export function cubreTexto(fuente: FuenteEmbebida, texto: string): boolean {
  return caracterNoCubierto(fuente, texto) === null;
}

/**
 * Exige que el texto quepa en el subconjunto, o LANZA (R28).
 *
 * No es una comprobacion defensiva de manual: es el nucleo de la decision Q5.
 * Con Identity-H, jsPDF **borra de la cadena** el caracter que la fuente no
 * cubre (`jspdf.node.js:27826`) y sigue adelante sin decir nada — que es
 * exactamente como el simbolo del colon lleva meses desapareciendo del papel sin
 * que ningun test ni ningun log se entere. Se comprueba el TEXTO COMPLETO del
 * campo y no solo el simbolo porque `formatMontoString` tiene una rama que pinta
 * verbatim lo que no tenga forma de decimal.
 *
 * Los dos canales de fallo ya existen y no se inventa ninguno: en el navegador,
 * el mensaje del modal y ninguna descarga; en la API de carga, el camino
 * best-effort (`etiquetasPdf: { error }`, HTTP 200, carga no revertida).
 */
export function exigirCobertura(
  fuente: FuenteEmbebida,
  texto: string,
  campo: string,
): void {
  const falta = caracterNoCubierto(fuente, texto);
  if (falta === null) return;
  const cp = falta.codePointAt(0) ?? 0;
  const hex = cp.toString(16).toUpperCase().padStart(4, "0");
  throw new Error(
    `El caracter «${falta}» (U+${hex}) del campo «${campo}» no esta en el subconjunto embebido de la fuente «${fuente.nombre}»; la etiqueta no se genera para no imprimirlo roto.`,
  );
}
