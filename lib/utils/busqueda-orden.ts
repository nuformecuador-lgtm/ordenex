/**
 * Feature 169 (design §3 y §3.1) — normalizacion COMPARTIDA del buscador de ordenes.
 *
 * ESTE ARCHIVO ES EL ESPEJO EN TypeScript DE LA EXPRESION SQL de la columna generada
 * `orden.busqueda_texto` (migracion `*_orden_busqueda_trgm`). El termino que teclea el
 * usuario se normaliza AQUI (Node); el valor indexado lo normaliza Postgres. Si las dos
 * normalizaciones no coinciden EXACTAMENTE, la busqueda "no encuentra" y nada peta: es el
 * fallo mas dificil de diagnosticar de esta feature (riesgo nº 3 del design).
 *
 * Por eso el plegado de acentos NO usa `unaccent` (que es STABLE, resuelve su diccionario
 * por `search_path` y pliega cosas que `String.normalize` no pliega) sino un `translate()`
 * con un mapa EXPLICITO de 48 caracteres, copiado literalmente en los dos lados. La paridad
 * deja de ser un acto de fe: la demuestra
 * `tests/integration/db/busqueda-normalizacion-paridad.test.ts` ejecutando ambas
 * normalizaciones sobre el mismo corpus.
 *
 * NO reutiliza `normalizeName` (lib/utils/normalize.ts) A PROPOSITO: aquel usa NFD +
 * descarte de marcas combinantes, que pliega MAS caracteres que el mapa SQL; reutilizarlo
 * reintroduciria justo la asimetria que este diseño viene a eliminar. `normalizeName` se
 * queda intacto y el buscador del mensajero (feature 114) sigue igual (R42).
 *
 * Modulo PURO: sin React, sin Prisma, sin acceso a datos.
 */

/**
 * Mapa de plegado de acentos. ESPEJO EXACTO del `translate()` de la columna generada:
 * los dos strings tienen que ser identicos, caracter a caracter, a los de `migration.sql`.
 *
 * Cubre las 24 letras acentuadas del español/portugues/frances de uso real en Costa Rica
 * (vocales con tilde/grave/dieresis/circunflejo/virgulilla, `ñ`, `ç`) en AMBAS cajas.
 * Un caracter fuera de la lista (`ø`, `ł`, `å`, cirilico) NO se pliega en ninguno de los
 * dos lados, asi que no hay asimetria: simplemente hay que teclearlo tal cual (deuda
 * conocida, design §3).
 */
export const ACENTOS_FROM = "áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ";
export const ACENTOS_TO = "aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC";

/** Traduccion caracter->caracter equivalente a `translate(texto, FROM, TO)` de Postgres. */
const PLEGADO: ReadonlyMap<string, string> = new Map(
  Array.from(ACENTOS_FROM, (caracter, i) => [caracter, ACENTOS_TO[i]] as const),
);

/**
 * Colapso de espacios: espeja `regexp_replace(x, '\s+', ' ', 'g')`. La clase se escribe
 * EXPLICITA (y no `\s` de JavaScript) porque el `\s` de JS incluye espacios Unicode
 * (NBSP, U+2028...) que el `\s` de Postgres no colapsa: usar `\s` a secas introduciria
 * asimetria justo en el punto que este modulo existe para cerrar.
 */
const ESPACIOS = /[ \t\n\r\f\v]+/g;

/**
 * Recorte de los extremos: espeja `btrim(x)` de Postgres, que recorta SOLO el caracter
 * espacio (no todo lo que `String.prototype.trim` considera espacio en blanco). Tras el
 * colapso de arriba, cualquier espacio ASCII de los extremos ya es un unico ' '.
 */
const EXTREMOS = /^ +| +$/g;

/** `translate(texto, ACENTOS_FROM, ACENTOS_TO)`. */
function plegarAcentos(texto: string): string {
  let plegado = "";
  for (const caracter of texto) plegado += PLEGADO.get(caracter) ?? caracter;
  return plegado;
}

/**
 * Normalizacion del TERMINO tecleado. Produce EXACTAMENTE lo mismo que la expresion de la
 * columna generada aplicada al mismo texto:
 *
 *   btrim(regexp_replace(lower(translate(texto, FROM, TO)), '\s+', ' ', 'g'))
 *
 * El orden importa: `translate` va ANTES de `lower` porque `lower()` depende de la
 * *collation* de la base (en una base `LC_CTYPE=C`, `lower('Á')` devuelve `'Á'`). Plegando
 * primero y bajando despues, a `lower()` solo se le pide que baje ASCII y el resultado es
 * correcto en cualquier locale; por eso el mapa lleva tambien las 24 mayusculas.
 */
export function normalizarTerminoBusqueda(termino: string): string {
  return plegarAcentos(termino)
    .toLowerCase()
    .replace(ESPACIOS, " ")
    .replace(EXTREMOS, "");
}

/**
 * Un termino compuesto SOLO por digitos y separadores habituales de telefono
 * (espacio, guion, punto, parentesis, `+`, `/`) -> su forma solo-digitos; `null` si el
 * termino contiene cualquier otra cosa o no tiene ni un digito.
 *
 * Para que sirve (R13): la columna generada indexa el telefono DOS veces, tal cual y en su
 * forma solo-digitos, asi que buscar `"88880000"` encuentra tanto `"88880000"` como
 * `"8888-0000"`. Lo que falta es el sentido contrario — teclear `"8888-0000"` cuando el
 * dato esta guardado sin guiones—, y se resuelve buscando TAMBIEN esta forma del termino.
 *
 * OJO (M1 del review): esta forma es un AÑADIDO, nunca un sustituto del termino tecleado.
 * La columna indexa el telefono en dos formas, pero la REMISION va tal cual: buscando solo
 * los digitos, `"2026-0912"` no encuentra `REM-2026-0912`, que existe. Quien llame a esto
 * tiene que buscar las dos formas (lo hace `OrdenService.escribirBusqueda`).
 *
 * `"1234"` (ya solo digitos) devuelve `"1234"`: es la entrada de la ruta rapida por
 * `num_guia` (design §5), que decide el llamador.
 */
export function soloDigitosSiPareceNumero(termino: string): string | null {
  const limpio = termino.trim();
  if (limpio.length === 0) return null;
  if (!/^[\d\s().+/-]+$/.test(limpio)) return null;
  const digitos = limpio.replace(/\D/g, "");
  return digitos.length > 0 ? digitos : null;
}
