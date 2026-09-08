// ARCHIVO GENERADO — NO EDITAR A MANO.
//
//   pnpm exec tsx scripts/fuente-etiqueta-a-base64.ts
//
// Feature 282 (R29) / 383 (R1, R3) — Los code points que el subconjunto commiteado cubre, SOLOS.
//
// Estan aqui y no junto al programa de fuente porque son las dos unicas cosas del artefacto que
// tienen publicos distintos: el programa lo necesita quien DIBUJA el PDF; la cobertura la
// necesita ademas quien VALIDA lo que entra (`lib/utils/texto-imprimible-etiqueta.ts`), y ese
// camino no puede arrastrar 22592 caracteres de datos incrustados hasta el navegador.
//
// SIGUE SIENDO UNA SOLA COBERTURA: la escribe el mismo script, en la misma pasada y desde el
// mismo lector de TTF que comprueba el test de R29. `fuenteEtiqueta.cobertura` apunta a ESTA
// constante, asi que el generador de PDF y la validacion de entrada no pueden divergir.

/**
 * Code points cubiertos por el subconjunto, en rangos INCLUSIVOS y ordenados.
 * DERIVADO del propio archivo por el script (R29), nunca escrito a mano.
 */
export const COBERTURA: readonly (readonly [number, number])[] = [
  [0x0020, 0x007e],
  [0x00a0, 0x00ff],
  [0x0152, 0x0153],
  [0x0160, 0x0161],
  [0x0178, 0x0178],
  [0x017d, 0x017e],
  [0x0192, 0x0192],
  [0x02c6, 0x02c6],
  [0x02dc, 0x02dc],
  [0x2013, 0x2014],
  [0x2018, 0x201a],
  [0x201c, 0x201e],
  [0x2020, 0x2022],
  [0x2026, 0x2026],
  [0x2030, 0x2030],
  [0x2039, 0x203a],
  [0x20a1, 0x20a1],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
];

/** Total de code points cubiertos: 219. */
export default COBERTURA;
