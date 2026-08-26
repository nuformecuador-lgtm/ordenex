// Feature 282 (T2) — Lector minimo de TrueType para los tests, SIN dependencias
// nuevas (Q4: no entra ningun parser de fuentes ni rasterizador al repo).
//
// Existe para responder a la unica pregunta que distingue "declarado" de
// "impreso": ¿el glifo con el que el PDF representa este caracter tiene
// CONTORNO, o es papel en blanco? Un mapa `/ToUnicode` que diga `20a1` y un
// glifo vacio producen exactamente el bug que esta ficha cierra, y ningun test
// que mire llamadas a funciones lo ve.
//
// Opera sobre BYTES: sirve igual para el `.ttf` commiteado en `assets/fuentes/`
// que para el stream `/FontFile2` extraido de un PDF generado, que es
// justamente el subconjunto que jsPDF vuelve a construir por documento.
//
// Lo que NO hace, a proposito: no rasteriza (no dibuja pixeles) y no interpreta
// glifos compuestos recursivamente. `contorno()` devuelve la LONGITUD del
// registro `glyf`, que es > 0 tanto para un glifo simple con puntos como para
// uno compuesto: las dos cosas dejan tinta. Un glifo sin registro (longitud 0)
// es, por definicion del formato, un blanco.

/** Un registro de la tabla de directorio del sfnt. */
export interface TablaTtf {
  offset: number;
  length: number;
}

function vista(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Directorio de tablas del sfnt: `tag -> { offset, length }`.
 *
 * Acepta `0x00010000` (TrueType) y `true` (TrueType de Apple). Rechaza `OTTO`
 * de forma explicita: una OpenType con contornos CFF no tiene `glyf`/`loca`, el
 * subsetter de jsPDF no la sabe reescribir y el `/FontFile2` que saldria seria
 * inutil (design.md §3.1). Mejor un error aqui que un PDF mudo.
 */
export function tablas(buf: Uint8Array): Map<string, TablaTtf> {
  const dv = vista(buf);
  const sfnt = dv.getUint32(0);
  if (sfnt === 0x4f54544f) {
    throw new Error("ttf-lector: la fuente es OpenType/CFF (OTTO); se necesita TrueType con glyf/loca");
  }
  if (sfnt !== 0x00010000 && sfnt !== 0x74727565) {
    throw new Error(`ttf-lector: sfntVersion desconocido 0x${sfnt.toString(16)}`);
  }
  const numTables = dv.getUint16(4);
  const out = new Map<string, TablaTtf>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(
      buf[rec],
      buf[rec + 1],
      buf[rec + 2],
      buf[rec + 3],
    );
    out.set(tag, { offset: dv.getUint32(rec + 8), length: dv.getUint32(rec + 12) });
  }
  return out;
}

function tabla(buf: Uint8Array, tag: string): TablaTtf {
  const t = tablas(buf).get(tag);
  if (!t) throw new Error(`ttf-lector: falta la tabla '${tag}'`);
  return t;
}

/** Subtabla de `cmap` elegida, con su formato. */
interface SubtablaCmap {
  offset: number;
  formato: number;
}

/**
 * Elige la mejor subtabla de `cmap`.
 *
 * Orden de preferencia: (3,10) UCS-4 -> (3,1) BMP -> (0,*) Unicode -> la
 * primera que haya. No se asume (3,1): un subsetter puede emitir formato 12 si
 * el subconjunto sale del BMP, y quedarse solo con (3,1) haria que el lector
 * dijera "no cubierto" sobre caracteres que si estan.
 */
function elegirCmap(buf: Uint8Array): SubtablaCmap {
  const cmap = tabla(buf, "cmap");
  const dv = vista(buf);
  const n = dv.getUint16(cmap.offset + 2);
  let mejor = -1;
  let mejorRango = -1;
  for (let i = 0; i < n; i++) {
    const rec = cmap.offset + 4 + i * 8;
    const plat = dv.getUint16(rec);
    const enc = dv.getUint16(rec + 2);
    const off = cmap.offset + dv.getUint32(rec + 4);
    let rango = 0;
    if (plat === 3 && enc === 10) rango = 4;
    else if (plat === 3 && enc === 1) rango = 3;
    else if (plat === 0) rango = 2;
    else rango = 1;
    if (rango > mejorRango) {
      mejorRango = rango;
      mejor = off;
    }
  }
  if (mejor < 0) throw new Error("ttf-lector: 'cmap' sin subtablas");
  return { offset: mejor, formato: dv.getUint16(mejor) };
}

/**
 * Indice de glifo del `codePoint`, o **0** si la fuente no lo cubre.
 *
 * El 0 no es un fallo del lector: en TrueType el glifo 0 es `.notdef` y es
 * exactamente lo que un consumidor pintaria (o descartaria) ante un caracter
 * ausente. Que este metodo devuelva 0 para U+4E2D es el control NEGATIVO del
 * lector: sin el, un lector que siempre dijera "si" pasaria todos los tests.
 */
export function glifoDe(buf: Uint8Array, codePoint: number): number {
  const { offset, formato } = elegirCmap(buf);
  const dv = vista(buf);

  if (formato === 4) {
    if (codePoint > 0xffff) return 0;
    const segX2 = dv.getUint16(offset + 6);
    const endBase = offset + 14;
    const startBase = endBase + segX2 + 2;
    const deltaBase = startBase + segX2;
    const rangeBase = deltaBase + segX2;
    for (let i = 0; i < segX2 / 2; i++) {
      const end = dv.getUint16(endBase + i * 2);
      if (codePoint > end) continue;
      const start = dv.getUint16(startBase + i * 2);
      if (codePoint < start) return 0;
      const delta = dv.getInt16(deltaBase + i * 2);
      const rangeOffset = dv.getUint16(rangeBase + i * 2);
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
      const dir = rangeBase + i * 2 + rangeOffset + (codePoint - start) * 2;
      if (dir + 1 >= buf.byteLength) return 0;
      const gid = dv.getUint16(dir);
      return gid === 0 ? 0 : (gid + delta) & 0xffff;
    }
    return 0;
  }

  if (formato === 12) {
    const nGroups = dv.getUint32(offset + 12);
    for (let i = 0; i < nGroups; i++) {
      const g = offset + 16 + i * 12;
      const ini = dv.getUint32(g);
      const fin = dv.getUint32(g + 4);
      if (codePoint < ini) return 0;
      if (codePoint > fin) continue;
      return dv.getUint32(g + 8) + (codePoint - ini);
    }
    return 0;
  }

  if (formato === 6) {
    const first = dv.getUint16(offset + 6);
    const count = dv.getUint16(offset + 8);
    if (codePoint < first || codePoint >= first + count) return 0;
    return dv.getUint16(offset + 10 + (codePoint - first) * 2);
  }

  if (formato === 0) {
    if (codePoint > 0xff) return 0;
    return buf[offset + 6 + codePoint];
  }

  throw new Error(`ttf-lector: formato de cmap ${formato} no soportado`);
}

/** Numero de glifos declarado en `maxp`. */
export function numGlifos(buf: Uint8Array): number {
  return vista(buf).getUint16(tabla(buf, "maxp").offset + 4);
}

/**
 * Longitud en bytes del registro `glyf` del glifo `gid`. **0 = contorno vacio**
 * (papel en blanco), > 0 = hay descripcion de contorno.
 *
 * `loca` es un array de N+1 desplazamientos; `head.indexToLocFormat` dice si van
 * en formato corto (uint16, en unidades de 2 bytes) o largo (uint32). Que la
 * diferencia entre dos consecutivos sea 0 es el modo NORMAL de codificar un
 * glifo sin tinta —el espacio, sin ir mas lejos—, y por eso este numero es la
 * unica manera barata de distinguir "declarado" de "impreso".
 */
export function contorno(buf: Uint8Array, gid: number): number {
  const dv = vista(buf);
  const head = tabla(buf, "head");
  const formatoLoca = dv.getInt16(head.offset + 50);
  const loca = tabla(buf, "loca");
  const n = numGlifos(buf);
  if (gid < 0 || gid >= n) {
    throw new Error(`ttf-lector: gid ${gid} fuera de rango (numGlyphs=${n})`);
  }
  const leer = (i: number): number =>
    formatoLoca === 0
      ? dv.getUint16(loca.offset + i * 2) * 2
      : dv.getUint32(loca.offset + i * 4);
  return leer(gid + 1) - leer(gid);
}

/**
 * ¿Este glifo deja TINTA en el papel?
 *
 * `contorno()` mide la longitud del registro `glyf`, que es el eslabon que fija
 * `design.md` §4 y el que se usa sobre el `/FontFile2` del PDF. Pero esa medida
 * tiene un limite que conviene conocer y no tapar: un glifo COMPUESTO —que solo
 * referencia a otros— ocupa 16 bytes o mas aunque lo que referencie este vacio.
 * El espacio duro (U+00A0) de Liberation Sans es exactamente eso: un compuesto
 * que apunta al espacio, 16 bytes de registro y cero tinta.
 *
 * Esta funcion resuelve los compuestos y responde a la pregunta de verdad. Se
 * usa donde la pregunta es «¿se ve?» (la cobertura del artefacto); `contorno()`
 * se usa donde la pregunta es «¿hay descripcion de glifo?» (el `/FontFile2`,
 * donde jsPDF deja a cero justamente los glifos que no embebe).
 */
export function tieneTinta(buf: Uint8Array, gid: number, profundidad = 0): boolean {
  if (profundidad > 5) return false; // los compuestos anidados no llegan a tanto
  const largo = contorno(buf, gid);
  if (largo <= 0) return false;

  const dv = vista(buf);
  const head = tabla(buf, "head");
  const formatoLoca = dv.getInt16(head.offset + 50);
  const loca = tabla(buf, "loca");
  const glyf = tabla(buf, "glyf");
  const inicio =
    glyf.offset +
    (formatoLoca === 0
      ? dv.getUint16(loca.offset + gid * 2) * 2
      : dv.getUint32(loca.offset + gid * 4));

  const numContornos = dv.getInt16(inicio);
  if (numContornos === 0) return false;
  if (numContornos > 0) {
    // Glifo simple: `endPtsOfContours` cierra en el indice del ultimo punto.
    const ultimoPunto = dv.getUint16(inicio + 10 + (numContornos - 1) * 2);
    return ultimoPunto + 1 > 0;
  }

  // Glifo compuesto: se recorren los componentes hasta encontrar uno con tinta.
  const ARGS_SON_PALABRAS = 0x0001;
  const HAY_ESCALA = 0x0008;
  const MAS_COMPONENTES = 0x0020;
  const HAY_ESCALA_XY = 0x0040;
  const HAY_MATRIZ_2X2 = 0x0080;
  let p = inicio + 10;
  for (;;) {
    const flags = dv.getUint16(p);
    const componente = dv.getUint16(p + 2);
    p += 4 + (flags & ARGS_SON_PALABRAS ? 4 : 2);
    if (flags & HAY_ESCALA) p += 2;
    else if (flags & HAY_ESCALA_XY) p += 4;
    else if (flags & HAY_MATRIZ_2X2) p += 8;
    if (tieneTinta(buf, componente, profundidad + 1)) return true;
    if (!(flags & MAS_COMPONENTES)) return false;
  }
}

/**
 * Todos los code points que la `cmap` de la fuente mapea a un glifo != 0.
 *
 * Es la fuente de la que se DERIVA `COBERTURA` en `lib/pdf/etiquetas-fuente.ts`
 * (R29): una cobertura escrita a mano puede mentir, y una que miente es peor que
 * no tenerla porque `cubreTexto` la usa para decidir si se dibuja o se falla.
 */
export function codePointsCubiertos(buf: Uint8Array): number[] {
  const { offset, formato } = elegirCmap(buf);
  const dv = vista(buf);
  const out: number[] = [];

  if (formato === 4) {
    const segX2 = dv.getUint16(offset + 6);
    const endBase = offset + 14;
    const startBase = endBase + segX2 + 2;
    for (let i = 0; i < segX2 / 2; i++) {
      const end = dv.getUint16(endBase + i * 2);
      const start = dv.getUint16(startBase + i * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end && c <= 0xffff; c++) {
        if (glifoDe(buf, c) !== 0) out.push(c);
      }
    }
    return out;
  }

  if (formato === 12) {
    const nGroups = dv.getUint32(offset + 12);
    for (let i = 0; i < nGroups; i++) {
      const g = offset + 16 + i * 12;
      const ini = dv.getUint32(g);
      const fin = dv.getUint32(g + 4);
      for (let c = ini; c <= fin; c++) {
        if (glifoDe(buf, c) !== 0) out.push(c);
      }
    }
    return out;
  }

  if (formato === 6) {
    const first = dv.getUint16(offset + 6);
    const count = dv.getUint16(offset + 8);
    for (let c = first; c < first + count; c++) {
      if (glifoDe(buf, c) !== 0) out.push(c);
    }
    return out;
  }

  if (formato === 0) {
    for (let c = 0; c <= 0xff; c++) {
      if (glifoDe(buf, c) !== 0) out.push(c);
    }
    return out;
  }

  throw new Error(`ttf-lector: formato de cmap ${formato} no soportado`);
}

/**
 * Nombre de familia (`name` ID 1) en la primera codificacion legible. Se usa
 * para el cruce de R32: la familia registrada en pantalla debe ser la misma con
 * la que el PDF dibuja el monto.
 */
export function nombreFamilia(buf: Uint8Array): string {
  const dv = vista(buf);
  const name = tabla(buf, "name");
  const count = dv.getUint16(name.offset + 2);
  const stringOffset = dv.getUint16(name.offset + 4);
  for (let i = 0; i < count; i++) {
    const rec = name.offset + 6 + i * 12;
    const plat = dv.getUint16(rec);
    const nameId = dv.getUint16(rec + 6);
    if (nameId !== 1) continue;
    const len = dv.getUint16(rec + 8);
    const off = name.offset + stringOffset + dv.getUint16(rec + 10);
    const bytes = buf.subarray(off, off + len);
    // Plataforma 3 (Windows) y 0 (Unicode) escriben UTF-16BE; la 1 (Mac), 1 byte.
    if (plat === 1) return Buffer.from(bytes).toString("latin1");
    let s = "";
    for (let k = 0; k + 1 < bytes.length; k += 2) {
      s += String.fromCharCode((bytes[k] << 8) | bytes[k + 1]);
    }
    return s;
  }
  throw new Error("ttf-lector: la fuente no declara nombre de familia (name ID 1)");
}
