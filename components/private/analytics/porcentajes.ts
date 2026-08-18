// El PESO de cada porcion sobre el total del anillo. Modulo PURO: se invoca y se prueba sin
// renderizar nada, que es donde vive lo unico que aqui puede equivocarse — el redondeo.
//
// ─── POR QUE NO ES `Math.round(valor / total * 100)` POR SEGMENTO ────────────────────────
//
// Porque esa cuenta NO SUMA 100. Con tres partes de 1/3 da 33 + 33 + 33 = 99; con 5, 3 y 2
// sobre 10 da los 50/30/20 del ejemplo, pero con 7, 7 y 1 sobre 15 da 47 + 47 + 7 = 101. En un
// grafico que reparte un TODO en partes, unos porcentajes que suman 99 o 101 no son un detalle
// tipografico: contradicen lo que el dibujo esta afirmando, y quien los sume se para a mirar
// por que no cuadran.
//
// Se usa el metodo del RESTO MAYOR (el mismo de los repartos de escanos): se dan a cada parte
// sus puntos enteros y los puntos que sobran van a las partes con mayor resto, de mayor a
// menor. El resultado suma EXACTAMENTE 100 siempre que haya algo que repartir, y cada
// porcentaje queda a menos de un punto de su valor exacto.
//
// GRANULARIDAD: puntos ENTEROS. Es lo que se pinta pegado a una cifra dentro de un anillo, y
// un «33,3 %» ahi es ruido. Si algun dia hace falta un decimal, se cambia `ESCALA` y el metodo
// sigue valiendo igual.

/** Puntos a repartir. 100 => porcentajes enteros. */
const ESCALA = 100;

/**
 * El peso de cada valor como FRACCION (`0,5` = 50 %), en el mismo orden que la entrada.
 *
 * Fraccion y no puntos porque asi lo espera `formatearValor(x, "porcentaje")`, que es el
 * formateador de la casa: multiplica por 100 y pone el simbolo en el locale configurado. Un
 * numero de puntos aqui obligaria a escribir el `%` a mano en el consumidor, que es justo el
 * literal que `formato.ts` existe para que nadie escriba.
 *
 * CASOS QUE DEVUELVEN TODO CEROS, y los tres son la respuesta correcta:
 *   - lista vacia;
 *   - total 0 (nadie tiene peso sobre una nada; dividir daria `NaN`);
 *   - total negativo o valores negativos, que en un reparto no significan nada.
 *
 * Los `null` (dato ausente) cuentan como 0: no aportan al total y no reciben peso.
 */
export function porcentajesDeReparto(valores: readonly (number | null)[]): number[] {
  const limpios = valores.map((v) => (typeof v === "number" && v > 0 ? v : 0));
  const total = limpios.reduce((suma, v) => suma + v, 0);
  if (total <= 0) return valores.map(() => 0);

  // Puntos enteros por parte, y el resto de cada una para el desempate.
  const exactos = limpios.map((v) => (v / total) * ESCALA);
  const puntos = exactos.map(Math.floor);
  const sobran = ESCALA - puntos.reduce((suma, p) => suma + p, 0);

  // Los que sobran van a los restos mayores. El desempate por INDICE (`a.i - b.i`) no es
  // cosmetico: sin el, dos partes con el mismo resto podrian ordenarse distinto entre
  // ejecuciones y el mismo dato pintaria dos repartos distintos.
  const porResto = exactos
    .map((exacto, i) => ({ i, resto: exacto - Math.floor(exacto) }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);

  for (let n = 0; n < sobran; n += 1) {
    const destino = porResto[n % porResto.length];
    if (destino) puntos[destino.i] = (puntos[destino.i] ?? 0) + 1;
  }

  return puntos.map((p) => p / ESCALA);
}

/**
 * La cifra con su peso pegado: `«20 (50 %)»`. Sin peso, la cifra sola.
 *
 * UNA sola funcion para los TRES sitios donde se escribe el mismo dato —la leyenda, el texto
 * sobre la porcion y la alternativa textual—: con tres composiciones sueltas acabarian
 * diciendolo distinto («20 (50 %)» aqui y «20 · 50%» alla) el dia que alguien retoque una, y en
 * la alternativa textual eso significa que el lector de pantalla lee otra cosa que la pantalla.
 */
export function cifraConPeso(cifra: string, peso?: string): string {
  return peso === undefined ? cifra : `${cifra} (${peso})`;
}
