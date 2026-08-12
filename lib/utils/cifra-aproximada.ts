// Aproximacion a la baja de las cifras PUBLICAS de la landing (feature 198).
//
// Por que aproximar y no pintar el numero exacto: son cifras de marca en la portada, no un
// tablero. Un «+120 ordenes efectivas» comunica escala; un «123» invita a volver mañana a ver
// si subio a 124, y encima expone el ritmo real de operacion de la empresa a cualquiera que
// pase —la accion que los sirve es publica y sin sesion—. Redondear a la baja tambien hace que
// el numero NUNCA prometa de mas: siempre hay al menos lo que dice.

/** Una cifra lista para pintar: el numero al que anima el contador y su prefijo. */
export interface CifraAproximada {
  /** El valor ya aproximado. Es lo que se le pasa al contador animado. */
  valor: number;
  /** `"+"` cuando se recorto algo, `""` cuando el numero es exacto. */
  prefijo: string;
}

/** Umbral por debajo del cual NO se aproxima. Ver el porque en `aproximarADecenas`. */
const MINIMO_APROXIMABLE = 10;

/**
 * Baja `n` al multiplo de 10 anterior y le pone `+`: 128 → «+120», 123 → «+120», 1450 → «+1450»
 * (decision humana del 2026-08-11; se descarto bajar a la potencia de 10 anterior, que habria
 * dado «+100» y «+1000»).
 *
 * DEBAJO DE 10 NO SE APROXIMA, y ese caso no es teorico: con 7 distritos cubiertos el
 * redondeo daria 0 y la landing anunciaria «+0 con cobertura», que es peor que no poner nada.
 * Por debajo del umbral se pinta el numero exacto y SIN `+`, porque «+7» seria falso: no hay
 * nada de mas que ese 7 este escondiendo.
 *
 * Un multiplo exacto tampoco miente: 120 → «+120», que sigue siendo cierto (hay 120 o mas).
 *
 * Tolerante a basura por la misma razon que el resto de esta feature: alimenta una pagina
 * publica que NO puede caerse por un contador. Un valor no finito o negativo colapsa a 0.
 */
export function aproximarADecenas(n: number): CifraAproximada {
  if (!Number.isFinite(n) || n <= 0) return { valor: 0, prefijo: "" };
  if (n < MINIMO_APROXIMABLE) return { valor: Math.floor(n), prefijo: "" };

  return { valor: Math.floor(n / 10) * 10, prefijo: "+" };
}
