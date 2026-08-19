// UNICA fuente de color de serie del paquete (R16-R19).
//
// Modulo PURO y determinista: el color de una serie es funcion de su INDICE, no de una prop
// ni del tema leido en JavaScript. Los veinte tokens estan declarados en `app/globals.css` en
// `:root` Y en `.dark`, asi que cambiar de tema no ejecuta ni una linea de JS (R18, Q2).
//
// "Theme-aware" se agota aqui: cero hexadecimales, cero utilidades de la escala cruda de
// Tailwind (`emerald-*`, `red-*`), cero `matchMedia`.
//
// ─── 2026-08-18: VEINTE TOKENS Y LA PALETA CICLA ────────────────────────────────────────
//
// Antes eran CINCO y la paleta NO ciclaba: `tokenDeSerie` lanzaba fuera de `[0,5)` y
// `topes.ts` recortaba a cinco categorias. El motivo escrito era bueno —dos categorias con el
// mismo color se leen como la misma, y eso es un grafico que miente— pero el precio lo pagaba
// el dato: un desglose de ordenes por estado tiene hasta VEINTE buckets (`ORDER_STATUS_SEED`)
// y perdia quince, o los fundia en un cubo «otros» que no dice nada.
//
// Decision humana del 2026-08-18: veinte tokens y ciclado. Lo que eso compra y lo que cuesta,
// dicho entero:
//   - se pinta TODO el dato, sin recortes ni cubos;
//   - con mas de veinte categorias dos SI comparten color. Es el caso que antes se prevenia
//     lanzando. Sigue siendo una limitacion real, solo que ahora empieza en la categoria 21 y
//     no en la sexta — y ninguna metrica de este repo tiene veintiuna categorias (el catalogo
//     de estatus, que es el mas ancho, tiene exactamente veinte).
//
// Los cinco primeros tokens NO cambiaron de color: cualquier grafica ya publicada sigue
// pintandose igual. Los quince nuevos continuan la rueda de matiz y luego la repiten en
// version profunda (clara) o clara (oscura), para que dos porciones vecinas se distingan.

/**
 * Los tokens de serie, en orden. Son los que `app/globals.css` declara en los DOS temas: si
 * aqui hubiera uno que alli no existe, `var(--chart-N)` no resolveria y la porcion saldria
 * sin color — por eso `tests/unit/components/analytics-paleta.test.ts` los compara contra el
 * CSS en vez de darlos por buenos.
 */
export const TOKENS_SERIE = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
  "--chart-7",
  "--chart-8",
  "--chart-9",
  "--chart-10",
  "--chart-11",
  "--chart-12",
  "--chart-13",
  "--chart-14",
  "--chart-15",
  "--chart-16",
  "--chart-17",
  "--chart-18",
  "--chart-19",
  "--chart-20",
] as const;

export type TokenSerie = (typeof TOKENS_SERIE)[number];

/** Cuantos colores distintos sabe dar la paleta antes de repetir. */
export const COLORES_DISPONIBLES = TOKENS_SERIE.length;

/**
 * El indice no es una posicion valida: negativo, fraccionario o no numerico.
 *
 * ⚠ ESTO YA NO ES «hay demasiadas series». Un indice grande CICLA, que es el comportamiento
 * pedido. Lo que sigue lanzando es la entrada IMPOSIBLE —un `-1` o un `1.5` solo pueden venir
 * de un bug del llamador— porque devolver un color para eso enmascararia el fallo en vez de
 * enseñarlo.
 */
export class IndiceSerieInvalidoError extends Error {
  constructor(indice: number) {
    super(`El indice de serie ${indice} no es un entero no negativo`);
    this.name = "IndiceSerieInvalidoError";
  }
}

/**
 * Token de la serie que ocupa la posicion `indice` (R17, R19).
 *
 * CICLA con modulo: el indice 20 vuelve al primer token. Inyectiva dentro de cada vuelta
 * —dos indices distintos de `[0,20)` NUNCA dan el mismo token—, que es lo que necesita una
 * leyenda para no mentir mientras las categorias quepan en una vuelta.
 */
export function tokenDeSerie(indice: number): TokenSerie {
  if (!Number.isInteger(indice) || indice < 0) {
    throw new IndiceSerieInvalidoError(indice);
  }
  return TOKENS_SERIE[indice % COLORES_DISPONIBLES];
}

/**
 * El mismo color, ya listo para un atributo `fill`/`stroke` de SVG o para una propiedad CSS.
 * Es una referencia a la variable, no su valor: el navegador la resuelve segun el tema activo
 * sin que el componente lo sepa (R18).
 *
 * ⚠ LLEVA RESPALDO, Y SE GANO A GOLPES (2026-08-18). Al ampliar la paleta de cinco a veinte
 * tokens, el CSS compilado que servia el dev server siguio teniendo solo cinco —caché de
 * Turbopack— y las quince porciones restantes salieron NEGRAS en pantalla. Ese es el modo de
 * fallo de un `var()` sin respaldo: la propiedad no resuelve, el atributo `fill` se queda sin
 * valor y el SVG pinta negro.
 *
 * Negro no es «un color raro»: es indistinguible de una porcion de verdad, no se parece a un
 * error y nadie lo relaciona con un token que falta. Con respaldo, el peor caso pasa a ser un
 * color REPETIDO —feo, pero legible y evidentemente sospechoso— en vez de una mancha negra.
 *
 * NO enmascara el bug: `analytics-paleta.test.ts` comprueba que los veinte tokens existen en
 * `:root` y en `.dark` de `app/globals.css`, asi que un token que falte de verdad sale rojo en
 * el gate. El respaldo solo protege al usuario del estado intermedio.
 */
export function varDeSerie(indice: number): string {
  const token = tokenDeSerie(indice);
  // El respaldo es el PRIMER token, no un hexadecimal: el guardia del paquete prohibe colores
  // crudos aqui, y ademas un hex fijo no sabria de temas.
  return token === TOKENS_SERIE[0] ? `var(${token})` : `var(${token}, var(${TOKENS_SERIE[0]}))`;
}
