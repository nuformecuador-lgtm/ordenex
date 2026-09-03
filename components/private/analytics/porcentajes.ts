// El PESO de cada porcion sobre el total del anillo. Modulo PURO: se invoca y se prueba sin
// renderizar nada, que es donde vive lo unico que aqui puede equivocarse — el redondeo.
//
// ─── TRES NUMEROS, NO UNO, Y CADA UNO TIENE UN OFICIO (ficha 364) ────────────────────────
//
// Una parte del reparto lleva tres cifras y confundirlas es EL defecto que este modulo ya ha
// tenido dos veces (la 290 y la 364):
//
//   · `exacta` — la razon `valor / total`, sin tocar. Es lo que se ESCRIBE.
//   · `cuota`  — la razon repartida por RESTO MAYOR. Suma exactamente 1. Es GEOMETRIA.
//   · `ancho`  — la cuota con las astillas de la 290. Suma exactamente 1. Es lo que se DIBUJA.
//
// ─── POR QUE EL DIBUJO NO PUEDE USAR `Math.round(valor / total * 100)` ───────────────────
//
// Porque esa cuenta NO SUMA 100. Con tres partes de 1/3 da 33 + 33 + 33 = 99; con 5, 3 y 2
// sobre 10 da los 50/30/20 del ejemplo, pero con 7, 7 y 1 sobre 15 da 47 + 47 + 7 = 101. En un
// grafico que reparte un TODO en partes, unas franjas que suman 99 o 101 no son un detalle
// tipografico: contradicen lo que el dibujo esta afirmando, y `flex` encoge en silencio todas
// las demas para hacer caber el sobrante.
//
// Se usa el metodo del RESTO MAYOR (el mismo de los repartos de escanos): se dan a cada parte
// sus puntos enteros y los puntos que sobran van a las partes con mayor resto, de mayor a
// menor. El resultado suma EXACTAMENTE `ESCALA` siempre que haya algo que repartir.
//
// ─── FICHA 364 — LO QUE SE ESCRIBE YA NO SALE DEL RESTO MAYOR, Y ES LA FICHA ENTERA ──────
//
// EL DEFECTO, reportado el 2026-09-02 sobre `/analitica`: la misma razon —259 entregadas de
// 877 ordenes— salia escrita DOS VECES y con DOS numeros. El KPI «Efectividad de entrega»
// decia 29,5 % (`formatearValor(259/877, "porcentaje")`, la razon exacta) y el segmento
// «Entregadas» de la barra «Detalle gestión» decia 30 %, porque escribia su CUOTA del resto
// mayor. Dos cifras del mismo hecho a un palmo de distancia en la misma pantalla.
//
// DECISION DEL HUMANO: «elijo el dato real, el del KPI, que se muestren los decimales».
//
// ⚠ SUBIR `ESCALA` NO ARREGLA ESTO, y conviene saberlo antes de intentarlo otra vez: lo que
// esta cabecera decia hasta hoy —«si algun dia hace falta un decimal, se cambia ESCALA y el
// metodo sigue valiendo igual»— es cierto para el DIBUJO y FALSO para el texto. El resto mayor
// desvia su cuota respecto de la razon exacta y sigue desviandola a cualquier escala; solo se
// hace mas pequeno el desvio. MEDIDO el 2026-09-02, comparando lo que escribiria la cuota
// contra lo que escribe el KPI para la misma razon, con `maximumFractionDigits: 1`:
//
//   | granularidad de la cuota | partes cuyo texto DIFIERE del KPI | desvio maximo |
//   |--------------------------|-----------------------------------|---------------|
//   | puntos enteros (ESCALA=100)  | 84,9 % – 93,7 %               | 0,81 pp       |
//   | un decimal   (ESCALA=1000)   |  7,9 % –  9,5 %               | 0,08 pp       |
//
// (1.192.554 partes de 200.000 repartos aleatorios de 6 partes, 529.720 partes de las 148.950
// composiciones exhaustivas de k=2..4 y T<=40, y 119.674 partes de 20.000 variantes del caso
// real de 877 ordenes.) Y EL CASO QUE EL HUMANO MIRO SIGUE DENTRO del 9 %: con ESCALA=1000 la
// barra escribiria 29,6 % donde el KPI escribe 29,5 %. Su problema no habria quedado resuelto.
//
// Por eso el arreglo esta en el ORIGEN y no en el formato: `textoDePeso` escribe `exacta`, que
// es LA MISMA cifra que el KPI formatea, asi que coinciden por construccion y no por suerte —
// no hay redondeo intermedio que pueda separarlas—. La `cuota` del resto mayor se queda con lo
// suyo, que es el ANCHO de la franja: ahi la suma exacta a 100 es geometria, no tipografia.
//
// EL PRECIO, dicho y medido (2026-09-02, mismos repartos): la suma de los TEXTOS puede no dar
// 100 exacto. Da 100,0 en el 45 % – 70 % de los repartos y en el resto dice 99,9 o 100,1; el
// desvio maximo observado es 0,2 pp en el caso real de 6 segmentos y 0,3 pp en 200.000
// aleatorios (el tope teorico con seis partes redondeadas a un decimal es 6 x 0,05 = 0,3 pp).
// Es un intercambio real y consciente: antes el texto sumaba 100 y mentia sobre el valor de
// cada parte; ahora cada parte dice la verdad y la columna puede desviarse un decimo. Lo que
// NO se negocia es la barra, que sigue midiendo 100 exacto — es la que afirma «esto es todo».

/**
 * Puntos en que se cuantiza la GEOMETRIA. No tiene NADA que ver con lo que se escribe
 * (ficha 364): el texto sale de `exacta`, sin cuantizar.
 *
 * 1000 => franjas con resolucion de un decimo de punto, que es la misma precision con la que
 * se escribe el texto de al lado. Con los 100 de antes una franja rotulada «29,5 %» podia
 * dibujarse al 30 % de la barra: sobre 600 px son 3 px de desacuerdo entre lo que se lee y lo
 * que se ve. La suma exacta a `ESCALA` —y por tanto a 100 %— vale igual a cualquier escala.
 */
const ESCALA = 1000;

/**
 * ANCHO MINIMO de una parte que existe pero es diminuta, en fraccion de la barra.
 *
 * Medio PUNTO PORCENTUAL: sobre los 300-600 px que mide la barra en el panel son 1,5-3 px, o
 * sea una astilla que se VE. Sin esto, una categoria de valor 1 sobre 233 sale con ancho ~0 y
 * desaparece del dibujo mientras su cifra sigue en la leyenda — que es justo el defecto de
 * la 290: la barra decia que esa categoria no existe y la leyenda decia que vale 1.
 *
 * ⚠ ES UN VALOR ABSOLUTO Y NO SE DERIVA DE `ESCALA` (ficha 364). Antes era `0.5 / ESCALA`, y
 * con la escala en 1000 eso lo habria encogido a 0,05 % — 0,3 px, otra vez invisible, o sea la
 * 290 deshecha en silencio al tocar una constante que parecia no tener que ver. Lo que fija
 * este minimo es el PIXEL, no la granularidad del reparto.
 *
 * No se resuelve con un `min-width` en px porque los anchos son PORCENTUALES y suman 100:
 * un minimo en px empujaria el total por encima del contenedor y `flex` encogeria a todas
 * las demas, deformando en silencio el reparto entero. La astilla se DESCUENTA del segmento
 * mayor, asi que la suma sigue siendo exactamente 100 %.
 */
const ASTILLA = 0.005;

/**
 * El peso de UNA parte del reparto. TRES numeros con tres oficios (ver la cabecera): el que se
 * escribe, el que reparte y el que se dibuja. Desde la 290 no son el mismo, y desde la 364
 * tampoco lo son los dos primeros.
 */
export interface PesoDeParte {
  /**
   * La razon EXACTA `valor / total` (`0,29533…` = 29,5 %), sin redondear.
   *
   * ES LO QUE SE ESCRIBE, y es lo unico de aqui que un KPI puede corroborar: el KPI formatea
   * esta misma razon (`calcularEfectividad` devuelve `entregadas / total`), asi que los dos
   * textos coinciden por construccion. Cualquier redondeo intermedio los separa — ficha 364.
   */
  readonly exacta: number;
  /**
   * La razon repartida por RESTO MAYOR (`0,5` = 50 %). El conjunto suma exactamente 1.
   *
   * ⚠ NO SE ESCRIBE NUNCA. Es la cuota que gobierna la GEOMETRIA, y difiere de `exacta` hasta
   * en medio punto de escala. Escribirla es el defecto de la ficha 364; para escribir esta
   * `textoDePeso`, que lee `exacta`.
   */
  readonly cuota: number;
  /**
   * Fraccion que ocupa la franja. Igual a `cuota` salvo en las partes que no llegan a la
   * `ASTILLA`; el conjunto sigue sumando exactamente 1 porque el mayor paga la diferencia.
   */
  readonly ancho: number;
}

/**
 * El reparto COMPLETO de una lista de valores, en el mismo orden que la entrada.
 *
 * CASOS QUE DEVUELVEN TODO CEROS, y los tres son la respuesta correcta:
 *   - lista vacia;
 *   - total 0 (nadie tiene peso sobre una nada; dividir daria `NaN`);
 *   - total negativo o valores negativos, que en un reparto no significan nada.
 *
 * Los `null` (dato ausente) cuentan como 0: no aportan al total y no reciben peso.
 */
export function pesosDeReparto(valores: readonly (number | null)[]): PesoDeParte[] {
  const limpios = valores.map((v) => (typeof v === "number" && v > 0 ? v : 0));
  const total = limpios.reduce((suma, v) => suma + v, 0);
  if (total <= 0) return valores.map(() => ({ exacta: 0, cuota: 0, ancho: 0 }));

  // La razon EXACTA de cada parte: lo que se escribe, y lo que escribe el KPI (ficha 364).
  const exactas = limpios.map((v) => v / total);

  // Y la GEOMETRIA, por resto mayor: puntos enteros de escala por parte, y el resto de cada
  // una para el desempate.
  const escalados = exactas.map((exacta) => exacta * ESCALA);
  const puntos = escalados.map(Math.floor);
  const sobran = ESCALA - puntos.reduce((suma, p) => suma + p, 0);

  // Los que sobran van a los restos mayores. El desempate por INDICE (`a.i - b.i`) no es
  // cosmetico: sin el, dos partes con el mismo resto podrian ordenarse distinto entre
  // ejecuciones y el mismo dato pintaria dos repartos distintos.
  const porResto = escalados
    .map((escalado, i) => ({ i, resto: escalado - Math.floor(escalado) }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);

  for (let n = 0; n < sobran; n += 1) {
    const destino = porResto[n % porResto.length];
    if (destino) puntos[destino.i] = (puntos[destino.i] ?? 0) + 1;
  }

  const cuotas = puntos.map((p) => p / ESCALA);
  const anchos = conAstillas(cuotas, limpios);

  return cuotas.map((cuota, i) => ({
    exacta: exactas[i] ?? 0,
    cuota,
    ancho: anchos[i] ?? 0,
  }));
}

/**
 * El ancho de cada franja: la cuota repartida, salvo que la parte EXISTA y no llegue a la
 * `ASTILLA`. Lo que se les da se le COBRA al segmento mayor, asi que la suma sigue siendo 1.
 *
 * Al mayor y no a prorrateo entre todos: es el unico al que un descuento de medio punto no le
 * cambia nada de lo que se ve, y repartir el descuento obligaria a tocar franjas que hoy estan
 * bien. Sale de su ancho, NUNCA de su `cuota` ni de su `exacta`: el numero escrito no se entera
 * de esto.
 *
 * El tope `cedible` es la red por si algun dia llegan tantas partes minusculas que el mayor no
 * pueda pagarlas: las astillas se encogen a partes iguales antes que dejar que la suma se pase
 * de 100 % o que el mayor se quede sin franja.
 */
function conAstillas(cuotas: readonly number[], limpios: readonly number[]): number[] {
  const anchos = [...cuotas];
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
 * El PASO mas fino que este formateador sabe escribir, en fraccion: `0,001` (= 0,1 %) para el
 * formateador de la casa, que redondea a un decimal.
 *
 * ⚠ SE LE PREGUNTA AL FORMATEADOR EN VEZ DE SUPONERLO, y ese es el punto (ficha 364). El valor
 * anterior —«un punto entero»— era una suposicion sobre la precision del formateador escrita
 * en OTRO archivo, y una suposicion asi es exactamente lo que produjo el defecto de esta
 * ficha: dos modulos con dos ideas distintas de cuantos decimales se escriben. Preguntando, el
 * dia que `formato.ts` cambie sus decimales este modulo lo sigue sin que nadie se acuerde.
 *
 * El tope de 8 es la red: sin el, un formateador degenerado que escriba siempre lo mismo
 * dejaria el bucle sin salida.
 */
function pasoEscribible(formatear: (fraccion: number) => string): number {
  const cero = formatear(0);
  for (let n = 1; n <= 8; n += 1) {
    if (formatear(10 ** -n) === cero) return 10 ** -(n - 1);
  }
  return 10 ** -8;
}

/**
 * El peso de una parte, ESCRITO: `«29,5 %»`, y `«<0,1 %»` cuando existe pero es tan pequena
 * que el formateador escribiria un cero.
 *
 * ⚠ ESCRIBE LA RAZON EXACTA (ficha 364), no la cuota del resto mayor: es la unica forma de que
 * este numero y el del KPI que mide la misma razon digan lo mismo. Lo que sigue sumando
 * exactamente 100 es la BARRA, que es donde la suma significa algo — ver la cabecera, con la
 * medida de cuanto puede desviarse la suma de los textos (0,1 pp casi siempre, 0,3 pp de tope).
 *
 * EL CASO PEQUENO, que la 290 dejo escrito y aqui se conserva: una parte que EXISTE y no llega
 * a lo que el formateador sabe escribir saldria como «0 %» pegada a su propia cifra, negando
 * el dato que tiene al lado. Se escribe «<0,1 %», y un cero de verdad sigue diciendo «0 %»:
 * son dos hechos distintos. La condicion no es un umbral escrito a mano sino la pregunta
 * directa —«¿escribirias esto igual que escribes el cero?»—, asi que no puede desincronizarse
 * de la precision real del formateador.
 *
 * UNA sola funcion —como `cifraConPeso`— porque el mismo texto lo dicen la leyenda, el texto
 * pegado a la porcion y la alternativa textual. Con el «<» escrito en cada sitio, el dia que
 * uno cambie el lector de pantalla oira otra cosa que la pantalla.
 *
 * El numero lo pone `formatear` —`formatearValor(x, "porcentaje")`, el formateador de la
 * casa— tambien en el caso pequeno: aqui no se escribe ni un `%` ni un separador, solo el
 * signo de «menor que». Por eso recibe la funcion en vez de importarla: el modulo sigue
 * siendo aritmetica pura, sin locale ni configuracion dentro.
 */
export function textoDePeso(peso: PesoDeParte, formatear: (fraccion: number) => string): string {
  const escrito = formatear(peso.exacta);
  if (peso.exacta <= 0 || escrito !== formatear(0)) return escrito;
  return `<${formatear(pasoEscribible(formatear))}`;
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
