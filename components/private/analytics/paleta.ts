// UNICA fuente de color de serie del paquete (R16-R19).
//
// Modulo PURO y determinista: el color de una serie es funcion de su INDICE, no
// de una prop ni del tema leido en JavaScript. Los cinco tokens estan declarados
// en `app/globals.css` en `:root` Y en `.dark`, asi que cambiar de tema no
// ejecuta ni una linea de JS en el componente (R18, Q2).
//
// "Theme-aware" se agota aqui: cero hexadecimales, cero utilidades de la escala
// cruda de Tailwind (`emerald-*`, `red-*`), cero `matchMedia`. Esta feature NO
// trae conmutador de tema (R40): eso es otra ficha.
//
// No cicla (Q3). Con mas de `MAX_SERIES` series, dos categorias compartirian
// color en la misma leyenda y se leerian como la misma serie — peor que mostrar
// menos series diciendolo. El desbordamiento lo gobierna `topes.ts`.

import { MAX_SERIES } from "./topes";

/**
 * Los tokens de serie, en orden. Su numero DEBE coincidir con `MAX_SERIES`
 * (R30): son los que `app/globals.css` declara en los dos temas.
 */
export const TOKENS_SERIE = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
] as const;

export type TokenSerie = (typeof TOKENS_SERIE)[number];

/** El indice cae fuera del techo declarado. Lo previene `aplicarTopeSeries`. */
export class IndiceSerieFueraDeRangoError extends Error {
  constructor(indice: number) {
    super(`El indice de serie ${indice} esta fuera del rango [0, ${MAX_SERIES})`);
    this.name = "IndiceSerieFueraDeRangoError";
  }
}

/**
 * Token de la serie que ocupa la posicion `indice` (R17, R19). Inyectiva en
 * `[0, MAX_SERIES)`: dos indices distintos NUNCA dan el mismo token.
 */
export function tokenDeSerie(indice: number): TokenSerie {
  if (!Number.isInteger(indice) || indice < 0 || indice >= MAX_SERIES) {
    throw new IndiceSerieFueraDeRangoError(indice);
  }
  return TOKENS_SERIE[indice];
}

/**
 * El mismo color, ya listo para un atributo `fill`/`stroke` de SVG o para una
 * propiedad CSS. Es una referencia a la variable, no su valor: el navegador la
 * resuelve segun el tema activo sin que el componente lo sepa (R18).
 */
export function varDeSerie(indice: number): string {
  return `var(${tokenDeSerie(indice)})`;
}
