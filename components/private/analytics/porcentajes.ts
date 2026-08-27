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

/** El peso mas pequeno que este reparto sabe ESCRIBIR: un punto entero. */
const UN_PUNTO = 1 / ESCALA;

/**
 * ANCHO MINIMO de una parte que existe pero no llega a un punto, en fraccion de la barra.
 *
 * Medio punto: sobre los 300-600 px que mide la barra en el panel son 1,5-3 px, o sea una
 * astilla que se VE. Sin esto, una categoria de valor 1 sobre 233 sale con ancho 0 y
 * desaparece del dibujo mientras su cifra sigue en la leyenda — que es justo el defecto de
 * la 290: la barra decia que esa categoria no existe y la leyenda decia que vale 1.
 *
 * No se resuelve con un `min-width` en px porque los anchos son PORCENTUALES y suman 100:
 * un minimo en px empujaria el total por encima del contenedor y `flex` encogeria a todas
 * las demas, deformando en silencio el reparto entero. La astilla se DESCUENTA del segmento
 * mayor, asi que la suma sigue siendo exactamente 100 %.
 */
const ASTILLA = 0.5 / ESCALA;

/**
 * El peso de UNA parte del reparto: lo que se escribe y lo que se dibuja, que desde la 290
 * ya no son el mismo numero.
 */
export interface PesoDeParte {
  /** Fraccion repartida por RESTO MAYOR (`0,5` = 50 %). El conjunto suma exactamente 1. */
  readonly fraccion: number;
  /**
   * Fraccion que ocupa la franja. Igual a `fraccion` salvo en las partes que no llegan a la
   * `ASTILLA`; el conjunto sigue sumando exactamente 1 porque el mayor paga la diferencia.
   */
  readonly ancho: number;
  /**
   * La parte EXISTE (valor > 0) y su peso EXACTO no llega a un punto. Quien lo escribe dice
   * «<1 %» y no «0 %»: un cero de verdad y una parte demasiado pequena para el redondeo son
   * hechos distintos, y escribir «0 %» junto a una cifra de 1 niega el dato que hay al lado.
   *
   * Se mide sobre el peso exacto y no sobre los puntos asignados; el porque, en la funcion.
   */
  readonly bajoUnPunto: boolean;
}

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
  return pesosDeReparto(valores).map((peso) => peso.fraccion);
}

/**
 * El reparto COMPLETO: la fraccion que se escribe, el ancho que se dibuja y si la parte es
 * demasiado pequena para su propio redondeo.
 *
 * Es la misma cuenta de `porcentajesDeReparto` —que ahora se limita a quedarse con la
 * fraccion— y existe porque el ancho de la franja y el porcentaje escrito DEJARON de ser el
 * mismo numero: una parte de valor 1 sobre 233 se escribe «<1 %» y se dibuja como astilla,
 * pero seguiria valiendo 0 puntos si se preguntara solo por su porcentaje (feature 290).
 */
export function pesosDeReparto(valores: readonly (number | null)[]): PesoDeParte[] {
  const limpios = valores.map((v) => (typeof v === "number" && v > 0 ? v : 0));
  const total = limpios.reduce((suma, v) => suma + v, 0);
  if (total <= 0) return valores.map(() => ({ fraccion: 0, ancho: 0, bajoUnPunto: false }));

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

  const fracciones = puntos.map((p) => p / ESCALA);
  const anchos = conAstillas(fracciones, limpios);

  return fracciones.map((fraccion, i) => ({
    fraccion,
    ancho: anchos[i] ?? 0,
    // ⚠ SE MIRA EL PESO EXACTO, NO LOS PUNTOS QUE LE TOCARON. Con 1 y 1 sobre 233 las dos
    // partes valen 0,429 % y las dos deben rotularse igual; pero solo hay UN punto sobrante
    // y el desempate del resto mayor se lo da a la de menor indice, asi que por puntos una
    // saldria «1 %» y la otra «0 %» — dos etiquetas distintas para el MISMO dato, que es la
    // mitad del defecto de la 290. El peso exacto no depende del desempate.
    bajoUnPunto: (limpios[i] ?? 0) > 0 && (exactos[i] ?? 0) < 1,
  }));
}

/**
 * El ancho de cada franja: la fraccion repartida, salvo que la parte EXISTA y no llegue a la
 * `ASTILLA`. Lo que se les da se le COBRA al segmento mayor, asi que la suma sigue siendo 1.
 *
 * Al mayor y no a prorrateo entre todos: es el unico al que un descuento de medio punto no le
 * cambia nada de lo que se lee (99,14 % sigue escribiendose «99 %»), y repartir el descuento
 * obligaria a tocar franjas que hoy estan bien. Sale de su ancho, NUNCA de su `fraccion`: el
 * porcentaje escrito sigue siendo el del resto mayor.
 *
 * El tope `cedible` es la red por si algun dia llegan tantas partes minusculas que el mayor no
 * pueda pagarlas: las astillas se encogen a partes iguales antes que dejar que la suma se pase
 * de 100 % o que el mayor se quede sin franja.
 */
function conAstillas(fracciones: readonly number[], limpios: readonly number[]): number[] {
  const anchos = [...fracciones];
  const pequenas = anchos.flatMap((ancho, i) =>
    (limpios[i] ?? 0) > 0 && ancho < ASTILLA ? [i] : [],
  );
  if (pequenas.length === 0) return anchos;

  const mayor = anchos.reduce((mejor, ancho, i) => (ancho > (anchos[mejor] ?? 0) ? i : mejor), 0);
  const cedible = Math.max(0, (anchos[mayor] ?? 0) - ASTILLA);
  const astilla = Math.min(ASTILLA, cedible / pequenas.length);

  let descontado = 0;
  for (const i of pequenas) {
    const nuevo = Math.max(anchos[i] ?? 0, astilla);
    descontado += nuevo - (anchos[i] ?? 0);
    anchos[i] = nuevo;
  }
  anchos[mayor] = (anchos[mayor] ?? 0) - descontado;

  return anchos;
}

/**
 * El peso de una parte, ESCRITO: `«50 %»`, y `«<1 %»` cuando existe pero no llega al punto.
 *
 * UNA sola funcion —como `cifraConPeso`— porque el mismo texto lo dicen la leyenda, el texto
 * pegado a la porcion y la alternativa textual. Con el «<» escrito en cada sitio, el dia que
 * uno cambie el lector de pantalla oira otra cosa que la pantalla, que es exactamente el
 * fallo que `cifraConPeso` ya evita para la cifra.
 *
 * El numero lo pone `formatear` —`formatearValor(x, "porcentaje")`, el formateador de la
 * casa— tambien en el caso pequeno: aqui no se escribe ni un `%` ni un separador, solo el
 * signo de «menor que». Por eso recibe la funcion en vez de importarla: el modulo sigue
 * siendo aritmetica pura, sin locale ni configuracion dentro.
 */
export function textoDePeso(peso: PesoDeParte, formatear: (fraccion: number) => string): string {
  return peso.bajoUnPunto ? `<${formatear(UN_PUNTO)}` : formatear(peso.fraccion);
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
