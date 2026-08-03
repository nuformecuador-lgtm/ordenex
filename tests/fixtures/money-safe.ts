import { readFileSync } from "node:fs";
import path from "node:path";

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
 */

const RAIZ = path.resolve(__dirname, "../..");

/**
 * Quita los comentarios de bloque y de línea de un fuente TypeScript. No pretende ser un
 * parser: le basta con no confundir un `//` de una URL (`https://…`) con un comentario.
 */
export function quitarComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/gm, "$1 ");
}

/** Código (ya sin comentarios) de un archivo del repo, por su ruta relativa a la raíz. */
export function codigoSinComentarios(rutaRelativa: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, rutaRelativa), "utf8"));
}

/** Las cuatro formas de perder un céntimo en el navegador. */
export const LLAMADAS_PROHIBIDAS_EN_DINERO: readonly RegExp[] = [
  /\bNumber\s*\(/,
  /\bparseFloat\s*\(/,
  /\bparseInt\s*\(/,
  /\.toFixed\s*\(/,
];
