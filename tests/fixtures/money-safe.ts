/**
 * Feature 172 (Tanda D, R14) — utilidad de los barridos MONEY-SAFE de la liquidación.
 *
 * El requisito prohíbe convertir un monto a número u operar con él en el navegador, así que
 * los tests barren el CÓDIGO de cada archivo nuevo buscando `Number(`, `parseFloat(`,
 * `parseInt(` y `toFixed(`.
 *
 * El barrido NO puede hacerse sobre el texto crudo: los docstrings de este árbol nombran a
 * propósito lo que está prohibido («money-safe: sin parseFloat/Number»), y el barrido fallaría
 * por CITARLO. Se persigue la LLAMADA, no la palabra — por eso todas las expresiones exigen el
 * paréntesis y por eso se quitan antes los comentarios.
 *
 * Vive en `tests/fixtures/` porque lo usan los cuatro archivos de test de la tanda y una
 * quinta copia sería una quinta oportunidad de escribir mal la expresión regular. T H.2 hará
 * el barrido TRANSVERSAL sobre la feature entera; esto es el de cada archivo.
 *
 * **Feature 209:** el quitador de comentarios que vivía AQUÍ se mudó a
 * `tests/fixtures/sin-comentarios.ts`, que es ahora el único del repo y tiene test propio
 * (`tests/unit/guards/quitador-comentarios.guardia.test.ts`). Se re-exporta para no romper a
 * quien ya lo importaba de este módulo: la implementación es una sola.
 */

export { codigoSinComentarios, quitarComentarios } from "./sin-comentarios";

/** Las cuatro formas de perder un céntimo en el navegador. */
export const LLAMADAS_PROHIBIDAS_EN_DINERO: readonly RegExp[] = [
  /\bNumber\s*\(/,
  /\bparseFloat\s*\(/,
  /\bparseInt\s*\(/,
  /\.toFixed\s*\(/,
];
