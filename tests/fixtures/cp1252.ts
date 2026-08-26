// Feature 282 — El juego de caracteres que la fuente embebida DEBE cubrir (R11).
//
// Es una FIXTURE, no un derivado del artefacto, y esa es toda la gracia: R11 dice
// «la fuente embebida DEBE tener glifo para todo caracter imprimible que la
// fuente estandar cubre HOY». Si esta lista se leyera del propio subconjunto,
// el test de cobertura compararia el archivo consigo mismo y estaria verde
// pasara lo que pasara —el fallo de «asercion contra su propia fuente»—. La
// lista viene de la especificacion de cp1252 (WinAnsi), que es el juego con el
// que jsPDF dibuja las 14 fuentes estandar y por tanto lo que hoy se imprime.
//
// Contenido: los 224 code points que cp1252 define entre 0x20 y 0xFF. Los cinco
// bytes SIN definir (0x81, 0x8D, 0x8F, 0x90, 0x9D) quedan fuera, y el 0x7F (DEL)
// tambien: no son caracteres imprimibles.

/** Los 27 code points de la zona 0x80-0x9F, que en cp1252 NO son Latin-1. */
const ZONA_ALTA_CP1252: readonly number[] = [
  0x20ac, // 0x80 €
  0x201a, // 0x82 ‚
  0x0192, // 0x83 ƒ
  0x201e, // 0x84 „
  0x2026, // 0x85 …
  0x2020, // 0x86 †
  0x2021, // 0x87 ‡
  0x02c6, // 0x88 ˆ
  0x2030, // 0x89 ‰
  0x0160, // 0x8A Š
  0x2039, // 0x8B ‹
  0x0152, // 0x8C Œ
  0x017d, // 0x8E Ž
  0x2018, // 0x91 '
  0x2019, // 0x92 '
  0x201c, // 0x93 "
  0x201d, // 0x94 "
  0x2022, // 0x95 •
  0x2013, // 0x96 –
  0x2014, // 0x97 —
  0x02dc, // 0x98 ˜
  0x2122, // 0x99 ™
  0x0161, // 0x9A š
  0x203a, // 0x9B ›
  0x0153, // 0x9C œ
  0x017e, // 0x9E ž
  0x0178, // 0x9F Ÿ
];

function rango(desde: number, hasta: number): number[] {
  const out: number[] = [];
  for (let c = desde; c <= hasta; c++) out.push(c);
  return out;
}

/** Todos los code points imprimibles de cp1252, ordenados. */
export const CP1252_IMPRIMIBLES: readonly number[] = [
  ...rango(0x20, 0x7e),
  ...ZONA_ALTA_CP1252,
  ...rango(0xa0, 0xff),
].sort((a, b) => a - b);

/**
 * Los code points de cp1252 que, POR DISEÑO DE LA TIPOGRAFIA, no dejan tinta:
 * el espacio y el espacio duro. Se declaran aqui, con nombre, para que el test
 * de cobertura pueda exigir contorno no vacio a TODOS LOS DEMAS y ponerse rojo
 * si un tercero se vacia (que es exactamente el fallo de R10 llevado al
 * artefacto).
 *
 * Los dos estan MEDIDOS, no supuestos: el espacio es un glifo con registro
 * `glyf` vacio y el espacio duro es un COMPUESTO que lo referencia (16 bytes de
 * registro, cero tinta). El guion suave (0x00AD) NO esta aqui: en Liberation
 * Sans remite al glifo del guion y SI deja tinta.
 */
export const CP1252_SIN_TINTA: readonly number[] = [0x0020, 0x00a0];

/** Nombre legible de un code point para los mensajes de error de los tests. */
export function nombreCodePoint(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")} «${String.fromCodePoint(cp)}»`;
}
