import { inflateSync } from "node:zlib";

// Feature 282 (T2/T10/T21) — Inspector minimo de PDF para los tests, SIN
// dependencias nuevas.
//
// Por que existe: los tests que hasta ahora afirmaban el contenido de la
// etiqueta buscaban un trozo ASCII dentro de los bytes del documento. Eso
// funcionaba mientras TODO el texto se dibujaba con una de las 14 fuentes
// estandar (WinAnsi, un byte por caracter). Con la fuente embebida en
// Identity-H el texto viaja en HEXADECIMAL, dos bytes por glifo, y un `grep`
// deja de encontrarlo. La respuesta NO es relajar la asercion sino endurecerla:
// aqui se decodifica el texto con el `/ToUnicode` que **el propio documento**
// declara, que afirma mas que el grep de antes (la cadena entera, simbolo
// incluido) y ademas es el mismo camino que sigue un lector de PDF real.
//
// Alcance deliberadamente estrecho: solo se entiende la forma que jsPDF emite
// (objetos indirectos sin xref-streams, `/Length` directo, streams sin filtrar o
// con `/FlateDecode`). No es un parser de PDF de proposito general y no
// pretende serlo.

/** Un objeto indirecto del documento. */
export interface ObjetoPdf {
  num: number;
  /** Diccionario en claro (latin1), sin el cuerpo del stream. */
  dict: string;
  /** Datos del stream YA descomprimidos, o `null` si el objeto no tiene stream. */
  stream: Uint8Array | null;
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

/**
 * Trocea el documento en objetos indirectos.
 *
 * El cuerpo del stream se recorta por el `/Length` DECLARADO y no buscando
 * `endstream`: los bytes binarios de una fuente o de un PNG pueden contener esa
 * secuencia por casualidad, y cortar ahi daria un archivo truncado que el lector
 * de TTF rechazaria con un error desconcertante.
 */
export function objetos(bytes: Uint8Array): Map<number, ObjetoPdf> {
  const s = latin1(bytes);
  const out = new Map<number, ObjetoPdf>();
  const re = /(?:^|[\r\n>\s])(\d+)\s+0\s+obj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const num = Number(m[1]);
    const inicioCuerpo = m.index + m[0].length;
    const finObj = s.indexOf("endobj", inicioCuerpo);
    if (finObj < 0) continue;
    const cuerpo = s.slice(inicioCuerpo, finObj);
    const posStream = cuerpo.indexOf("stream");
    if (posStream < 0) {
      out.set(num, { num, dict: cuerpo, stream: null });
      continue;
    }
    const dict = cuerpo.slice(0, posStream);
    const largo = /\/Length\s+(\d+)/.exec(dict);
    const trasStream = inicioCuerpo + posStream + "stream".length;
    // jsPDF escribe "stream\n"; el PDF admite ademas "stream\r\n".
    const salto = s.startsWith("\r\n", trasStream) ? 2 : 1;
    const ini = trasStream + salto;
    const fin = largo
      ? ini + Number(largo[1])
      : s.indexOf("endstream", ini);
    let datos = bytes.subarray(ini, fin);
    if (/\/Filter\s*\/FlateDecode/.test(dict)) {
      datos = new Uint8Array(inflateSync(Buffer.from(datos)));
    }
    out.set(num, { num, dict, stream: datos });
  }
  return out;
}

/** Objetos `/Type /Page`, en el orden en que aparecen en el archivo. */
export function paginas(objs: Map<number, ObjetoPdf>): ObjetoPdf[] {
  return [...objs.values()].filter((o) => /\/Type\s*\/Page(?![s])/.test(o.dict));
}

function referencia(dict: string, clave: string): number | null {
  const m = new RegExp(`${clave}\\s+(\\d+)\\s+0\\s+R`).exec(dict);
  return m ? Number(m[1]) : null;
}

/** Contenido (ya inflado) de la pagina `indice`, como texto latin1. */
export function contenidoDePagina(bytes: Uint8Array, indice = 0): string {
  const objs = objetos(bytes);
  const pagina = paginas(objs)[indice];
  if (!pagina) throw new Error(`pdf-inspector: no hay pagina ${indice}`);
  const ref = referencia(pagina.dict, "/Contents");
  if (ref === null) throw new Error("pdf-inspector: la pagina no declara /Contents");
  const contenido = objs.get(ref);
  if (!contenido?.stream) throw new Error("pdf-inspector: /Contents sin stream");
  return latin1(contenido.stream);
}

/** Una llamada a `doc.text()` tal como quedo escrita en el content stream. */
export interface TextoDibujado {
  /** Nombre del recurso de fuente activo, p. ej. `F15`. */
  fuenteRes: string;
  /** Cuerpo tipografico en puntos. */
  tamano: number;
  /** Coordenadas del `Td`, en puntos y con el origen del PDF (abajo-izquierda). */
  x: number;
  y: number;
  /** Operando tal cual: `(...)` literal o `<...>` hexadecimal. */
  crudo: string;
  hex: boolean;
}

/**
 * Todas las cadenas dibujadas en la pagina, con la fuente y el cuerpo activos.
 *
 * jsPDF emite un bloque `BT /F<n> <pt> Tf ... x y Td (texto) Tj ET` por llamada a
 * `text()`, con coordenadas ABSOLUTAS en el `Td` (no acumula matriz de texto
 * entre lineas: el generador dibuja linea a linea a proposito).
 */
export function textosDePagina(bytes: Uint8Array, indice = 0): TextoDibujado[] {
  const stream = contenidoDePagina(bytes, indice);
  const out: TextoDibujado[] = [];
  let fuenteRes = "";
  let tamano = 0;
  let x = 0;
  let y = 0;
  const re =
    /\/(F\d+)\s+([\d.]+)\s+Tf|(-?[\d.]+)\s+(-?[\d.]+)\s+Td|\(((?:\\[\s\S]|[^()\\])*)\)\s*Tj|<([0-9a-fA-F]*)>\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream)) !== null) {
    if (m[1] !== undefined) {
      fuenteRes = m[1];
      tamano = Number(m[2]);
    } else if (m[3] !== undefined) {
      x = Number(m[3]);
      y = Number(m[4]);
    } else if (m[5] !== undefined) {
      out.push({ fuenteRes, tamano, x, y, crudo: m[5], hex: false });
    } else if (m[6] !== undefined) {
      out.push({ fuenteRes, tamano, x, y, crudo: m[6], hex: true });
    }
  }
  return out;
}

/** Un recurso de fuente del `/Resources` de la pagina. */
export interface FuentePdf {
  res: string;
  subtype: string;
  baseFont: string;
  /** `Identity-H` para la fuente embebida; `WinAnsiEncoding` para las estandar. */
  encoding: string | null;
  /** `cid -> texto`, tal como lo declara el `/ToUnicode` del propio documento. */
  toUnicode: Map<number, string> | null;
  /** Programa de fuente embebido (`/FontFile2`), ya descomprimido. */
  fontFile2: Uint8Array | null;
  /** Valor de `/CIDToGIDMap` del descendiente, si lo hay. */
  cidToGidMap: string | null;
}

/**
 * Interpreta un CMap `/ToUnicode` (entradas `beginbfchar <cid> <unicode>`).
 *
 * Es LA pieza que hace honesta la verificacion de R9: el texto no se compara con
 * lo que el generador quiso escribir, sino con lo que el documento dice que
 * significa cada glifo. Si la fuente no tuviera el glifo, jsPDF habria borrado el
 * caracter de la cadena y aqui faltaria.
 */
export function leerToUnicode(cmap: string): Map<number, string> {
  const out = new Map<number, string>();
  const bloques = cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? [];
  for (const bloque of bloques) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(bloque)) !== null) {
      const cid = parseInt(m[1], 16);
      let texto = "";
      for (let i = 0; i + 3 < m[2].length + 1; i += 4) {
        texto += String.fromCharCode(parseInt(m[2].slice(i, i + 4), 16));
      }
      out.set(cid, texto);
    }
  }
  return out;
}

/** Recursos de fuente declarados por la pagina `indice`, indexados por `/F<n>`. */
export function fuentesDePagina(bytes: Uint8Array, indice = 0): Map<string, FuentePdf> {
  const objs = objetos(bytes);
  const pagina = paginas(objs)[indice];
  if (!pagina) throw new Error(`pdf-inspector: no hay pagina ${indice}`);
  const refRecursos = referencia(pagina.dict, "/Resources");
  const dictRecursos =
    refRecursos !== null ? (objs.get(refRecursos)?.dict ?? "") : pagina.dict;
  const bloqueFuentes = /\/Font\s*<<([\s\S]*?)>>/.exec(dictRecursos);
  const out = new Map<string, FuentePdf>();
  if (!bloqueFuentes) return out;

  const re = /\/(F\d+)\s+(\d+)\s+0\s+R/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bloqueFuentes[1])) !== null) {
    const res = m[1];
    const obj = objs.get(Number(m[2]));
    if (!obj) continue;
    const subtype = /\/Subtype\s*\/(\w+)/.exec(obj.dict)?.[1] ?? "";
    const baseFont = /\/BaseFont\s*\/([\w+-]+)/.exec(obj.dict)?.[1] ?? "";
    const encoding = /\/Encoding\s*\/([\w-]+)/.exec(obj.dict)?.[1] ?? null;

    let toUnicode: Map<number, string> | null = null;
    const refTU = referencia(obj.dict, "/ToUnicode");
    if (refTU !== null) {
      const s = objs.get(refTU)?.stream;
      if (s) toUnicode = leerToUnicode(latin1(s));
    }

    let fontFile2: Uint8Array | null = null;
    let cidToGidMap: string | null = null;
    const refDesc = /\/DescendantFonts\s*\[\s*(\d+)\s+0\s+R/.exec(obj.dict);
    if (refDesc) {
      const descendiente = objs.get(Number(refDesc[1]));
      if (descendiente) {
        cidToGidMap = /\/CIDToGIDMap\s*\/(\w+)/.exec(descendiente.dict)?.[1] ?? null;
        const refFd = referencia(descendiente.dict, "/FontDescriptor");
        if (refFd !== null) {
          const fd = objs.get(refFd);
          const refFf = fd ? referencia(fd.dict, "/FontFile2") : null;
          if (refFf !== null) fontFile2 = objs.get(refFf)?.stream ?? null;
        }
      }
    }

    out.set(res, { res, subtype, baseFont, encoding, toUnicode, fontFile2, cidToGidMap });
  }
  return out;
}

/** CIDs de una cadena hexadecimal (2 bytes por glifo, Identity-H). */
export function cidsDe(texto: TextoDibujado): number[] {
  if (!texto.hex) throw new Error("pdf-inspector: la cadena no es hexadecimal");
  const out: number[] = [];
  for (let i = 0; i + 3 < texto.crudo.length + 1; i += 4) {
    out.push(parseInt(texto.crudo.slice(i, i + 4), 16));
  }
  return out;
}

/** Deshace el escapado de una cadena literal de PDF (`\(`, `\)`, `\\`, `\ddd`). */
function desescapar(s: string): string {
  return s.replace(/\\(\d{1,3}|[\s\S])/g, (_, g: string) =>
    /^\d+$/.test(g) ? String.fromCharCode(parseInt(g, 8)) : g,
  );
}

/**
 * Texto legible de una cadena dibujada.
 *
 * - Identity-H (fuente embebida): cada CID se traduce con el `/ToUnicode` que el
 *   documento declara. Un CID sin entrada es un `?`: si eso aparece, el PDF esta
 *   diciendo que no sabe que caracter imprimio, y el test debe verlo.
 * - Fuentes estandar: jsPDF escribe WinAnsi (1 byte) salvo que la cadena tenga
 *   algun caracter fuera de ese juego, en cuyo caso emite UTF-16BE con BOM.
 */
export function textoLegible(texto: TextoDibujado, fuente?: FuentePdf): string {
  if (texto.hex) {
    const mapa = fuente?.toUnicode;
    if (!mapa) throw new Error("pdf-inspector: cadena hex sin /ToUnicode en su fuente");
    return cidsDe(texto)
      .map((cid) => mapa.get(cid) ?? "?")
      .join("");
  }
  const crudo = desescapar(texto.crudo);
  if (crudo.startsWith("þÿ")) {
    let s = "";
    for (let i = 2; i + 1 < crudo.length; i += 2) {
      s += String.fromCharCode((crudo.charCodeAt(i) << 8) | crudo.charCodeAt(i + 1));
    }
    return s;
  }
  return crudo;
}
