// Configuracion de formato de moneda de la capa de presentacion. El backend NO
// emite simbolo ni moneda (feature 32/R5: `montoCobrar` es un `number|null`
// crudo); el formato/moneda se resuelve aqui por configuracion, sobreescribible
// por variable de entorno para no hardcodear el contexto (patron de
// lib/config/ordenes.ts, docs/architecture.md "Sin hardcode de contexto").
//
// Feature 201 (tanda A) — el formato de los importes vive AQUI y en un solo
// sitio. Antes habia siete copias byte a byte de un `money()` que se limitaba a
// anteponer un `₡` literal al STRING del servidor, y por eso los importes se
// pintaban sin separador de miles (`₡13331832.72`) y nadie podia cambiarlo en un
// solo lugar. El simbolo tambien sale de configuracion: estaba hardcodeado en
// las siete copias pese a que este archivo existe justamente para eso.
//
// Feature 230 — el dinero se pintaba REDONDEADO AL COLON. La cola de la escala 2
// no se copiaba: decidia el redondeo de la parte entera (half away from zero) y
// se descartaba, asi que `13331832.72` salia `₡13.331.833`.
//
// FICHA 359 — LA REGLA VIGENTE: la cola se pinta SOLO CUANDO EXISTE.
// `₡11.899` cuando el importe es redondo; `₡416,47` cuando tiene cola.
//
// Por que cambio, con lo medido en produccion el 2026-08-29: lo que se TOCA es
// siempre entero (971 montos a cobrar, 577 fletes y 27 totales de cierre, cero
// con cola), y la cola nace de UN concepto —la comision COD del 3,5%, 577 de 577
// filas— que se contagia a la wallet. Redondear la presentacion era barato
// mientras cada cifra se leyera sola, pero muchas pantallas enseñan A, B y C con
// C = A ± B calculado por el servidor sobre `Prisma.Decimal`: al redondear cada
// operando por su cuenta, la resta que el usuario VE deja de dar por hasta ±1
// colon. Se censaron 13 contradicciones de ese tipo, y la peor era un panel que
// encendia «no cuadran» y debajo pintaba «Diferencia ₡0».
//
// La regla nueva cierra esas identidades POR CONSTRUCCION y no pantalla por
// pantalla: la escala de PRESENTACION pasa a ser la misma escala 2 del dato, asi
// que formatear ya no pierde informacion y una suma de cadenas pintadas da lo
// mismo que la suma de los `Decimal` de origen. Es lo contrario de lo que hizo
// la feature 300, que arreglo UNA pantalla (`montoExacto`) y dejo las otras doce.
//
// Sigue siendo un cambio de PRESENTACION y solo de presentacion: la columna
// sigue siendo `DECIMAL(12,2)`, el importe sigue cruzando la frontera con escala
// 2 y las descargas XLSX/CSV siguen sin pasar por aqui.
//
// El formato opera sobre el STRING, digito a digito, y no es purismo: hay tres
// guardias vivas que prohiben convertir un monto a numero en este camino y este
// repo ya perdio un centimo por una conversion (feature 204).

function readNonEmpty(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw;
}

export interface MonedaConfig {
  /** Locale BCP 47 usado por `Intl.NumberFormat` (p. ej. "es-CR"). */
  locale: string;
  /** Codigo ISO 4217 de la moneda (p. ej. "CRC"). */
  currency: string;
  /** Simbolo que precede al importe (p. ej. "₡"). */
  simbolo: string;
  /** Separador de los grupos de tres de la parte entera (p. ej. "."). */
  separadorMiles: string;
  /**
   * El caracter que separa la parte entera de la cola (p. ej. ",").
   *
   * VUELVE A GOBERNAR LA SALIDA con la ficha 359: entre la 230 y la 359 no habia
   * cola que separar y este campo solo servia como punto unico de configuracion
   * para la guardia. Ahora hace las dos cosas: es el caracter que se emite
   * cuando el importe tiene cola, y sigue siendo el que la guardia lee de aqui
   * —`tests/unit/guards/dinero-centimos-cuando-existen.guardia.test.ts`— en vez
   * de escribir la coma a mano, que seria el hardcode de contexto que
   * `docs/architecture.md` prohibe.
   */
  separadorDecimal: string;
}

export function loadMonedaConfig(): MonedaConfig {
  return {
    locale: readNonEmpty("MONEDA_LOCALE", "es-CR"),
    currency: readNonEmpty("MONEDA_CURRENCY", "CRC"),
    simbolo: readNonEmpty("MONEDA_SIMBOLO", "₡"),
    separadorMiles: readNonEmpty("MONEDA_SEPARADOR_MILES", "."),
    separadorDecimal: readNonEmpty("MONEDA_SEPARADOR_DECIMAL", ","),
  };
}

export const monedaConfig: MonedaConfig = loadMonedaConfig();

/** Marcador cuando no hay monto a cobrar (R5: `montoCobrar` null). */
export const SIN_MONTO = "-";

/**
 * El OTRO marcador de "sin dato" que ya vive en pantalla: la raya larga con la
 * que las tarjetas de wallet, cierres, ranking y liquidacion pintan
 * un monto ausente.
 *
 * Son dos marcadores distintos a proposito y NO se unifican aqui: unificarlos
 * cambiaria lo que se ve en pantallas que la feature 201 no toca. Se exporta
 * para que quien migre esas pantallas (tandas B y C) pase EL SUYO por el segundo
 * parametro de `formatMontoString` en vez de escribir el caracter a mano.
 */
export const SIN_MONTO_RAYA = "—";

/**
 * La ESCALA DE PRESENTACION (ficha 359): la misma que la del dato y la de la
 * frontera. Que sean el mismo numero es lo que hace que formatear no pierda
 * informacion y que las identidades de pantalla cierren; si algun dia se bajara,
 * volverian los descuadres de ±1 que motivaron esta ficha.
 *
 * Se EXPORTA porque hay un consumidor que no formatea pero si necesita saberla:
 * `KpiValorAnimado` le pasa a countup.js cuantos decimales conserva el valor de
 * cada fotograma, y ese numero tiene que ser el mismo o el ultimo fotograma
 * llegaria cuadrado a menos escala de la que se pinta.
 */
export const ESCALA_PRESENTACION = 2;

const ESCALA = ESCALA_PRESENTACION;

/**
 * La forma de un importe decimal serializado por el servidor: signo opcional,
 * parte entera y —opcionalmente— cola. Es lo que emite
 * `Prisma.Decimal.toFixed(2)`, que es como el dinero cruza la frontera.
 */
const FORMA_DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * El sucesor de cada digito que NO es `'9'`. Una tabla y no una suma: sumar
 * obligaria a convertir el digito a numero, que es exactamente lo que este
 * modulo tiene prohibido.
 */
const DIGITO_SIGUIENTE: Readonly<Record<string, string>> = {
  "0": "1",
  "1": "2",
  "2": "3",
  "3": "4",
  "4": "5",
  "5": "6",
  "6": "7",
  "7": "8",
  "8": "9",
};

/**
 * Suma 1 a una cadena de digitos, con acarreo manual (feature 230).
 * `"999" -> "1000"`, `"9" -> "10"`, `"0" -> "1"`, `"99" -> "100"`.
 *
 * Es el acarreo de derecha a izquierda de toda la vida —la cola de nueves se
 * vuelve ceros y el primer digito distinto de `'9'` sube—, escrito con una
 * expresion regular en vez de con un bucle A PROPOSITO: asi no hay ni una sola
 * operacion aritmetica, ni siquiera sobre el indice del recorrido. `(\d*)` es
 * codicioso, asi que `([0-8])` cae sobre el ULTIMO digito que no es `'9'` y
 * `(9*)` se queda con la cola que hay que poner a cero.
 *
 * Si no hay ningun `[0-8]` es que el numero era todo nueves: la cola entera se
 * pone a cero y el acarreo sobrevive, asi que se antepone `'1'`. Ese es el unico
 * caso que CAMBIA EL NUMERO DE DIGITOS, y por eso quien llama tiene que mirar la
 * longitud del resultado para saber si el acarreo se le escapo hacia arriba.
 *
 * Los ceros a la izquierda se conservan (`"000123" -> "000124"`): es lo que ya
 * hacia el modulo con una entrada asi y esta feature no normaliza la rama de
 * entradas fuera de contrato.
 */
function sumarUno(digitos: string): string {
  const casa = /^(\d*)([0-8])(9*)$/.exec(digitos);
  if (casa === null) return `1${digitos.replace(/9/g, "0")}`;
  const [, cabeza, ultimoNoNueve, nueves] = casa;
  return `${cabeza}${DIGITO_SIGUIENTE[ultimoNoNueve]}${"0".repeat(nueves.length)}`;
}

/** Un importe partido en sus dos mitades YA cuadradas a la escala de presentacion. */
interface Partido {
  /** Parte entera, sin signo y sin agrupar. */
  enteros: string;
  /** La cola, SIEMPRE con `ESCALA` digitos (`"00"` cuando el importe es redondo). */
  cola: string;
}

/**
 * Cuadra el importe a la escala de presentacion (ficha 359: half away from zero,
 * el medio se ALEJA del cero) y devuelve las dos mitades por separado.
 *
 * Mira SOLO el primer digito que sobra —el tercero de la cola—: `>= '5'` sube, si
 * no baja, y el resto se ignora (`"10.4949"` da `"10"` y `"49"`; `"10.4951"` da
 * `"10"` y `"50"`). La comparacion es entre CARACTERES, que para un digito suelto
 * ordena igual que entre numeros y no obliga a convertir nada.
 *
 * El acarreo puede desbordar la cola hacia la parte entera (`"9.999"` da `"10"` y
 * `"00"`), y ese desbordamiento se detecta por LONGITUD: `sumarUno` sobre dos
 * digitos solo devuelve tres cuando la cola era `"99"`.
 *
 * El signo no llega hasta aqui: quien llama ya lo separo, asi que "alejarse del
 * cero" es siempre "subir" y el negativo hereda el mismo redondeo.
 */
function cuadrarAEscala(enteros: string, decimales: string | null): Partido {
  if (decimales === null || decimales === "") return { enteros, cola: "0".repeat(ESCALA) };

  const cola = `${decimales}${"0".repeat(ESCALA)}`.slice(0, ESCALA);
  const sobrante = decimales.slice(ESCALA);

  if (sobrante === "" || sobrante.charAt(0) < "5") return { enteros, cola };

  const subida = sumarUno(cola);
  if (subida.length === ESCALA) return { enteros, cola: subida };
  // La cola desbordo (`"99"` sube a `"100"`): se queda en ceros y el acarreo sube.
  return { enteros: sumarUno(enteros), cola: subida.slice(1) };
}

/** Una cadena de digitos que vale cero, con los ceros a la izquierda que traiga. */
function esCero(digitos: string): boolean {
  return /^0+$/.test(digitos);
}

/**
 * Agrupa de tres en tres DESDE LA DERECHA. El borde que importa es el del
 * principio: con 3 digitos exactos ("999") o con un multiplo de 3 ("1000" ->
 * "1.000") una agrupacion mal escrita cuela un separador delante del primer
 * grupo (".999"). Por eso se recorre desde el final y el `join` solo pone
 * separador ENTRE grupos.
 */
function agruparMiles(enteros: string): string {
  const grupos: string[] = [];
  for (let fin = enteros.length; fin > 0; fin -= 3) {
    grupos.unshift(enteros.slice(Math.max(0, fin - 3), fin));
  }
  return grupos.join(monedaConfig.separadorMiles);
}

/**
 * Compone la cadena final a partir de las dos mitades ya cuadradas. Es el UNICO
 * sitio del modulo que decide si la cola se emite, y por eso lo comparten
 * `formatMontoString` y `formatMontoTope`: dos reglas de cuadre distintas, un
 * solo aspecto.
 *
 * La cola se emite SOLO CUANDO EXISTE (ficha 359), y "existe" es "no es toda
 * ceros". El signo se cae cuando lo que queda es un cero entero: "menos cero" no
 * es una cantidad que nadie quiera leer.
 */
function componer(partido: Partido, negativo: boolean): string {
  const { enteros, cola } = partido;
  const agrupado = agruparMiles(enteros);
  const sufijo = esCero(cola) ? "" : `${monedaConfig.separadorDecimal}${cola}`;
  const signo = negativo && !(esCero(enteros) && esCero(cola)) ? "-" : "";
  return `${signo}${monedaConfig.simbolo}${agrupado}${sufijo}`;
}

/** Las dos mitades de un importe con forma decimal, ya separado del signo. */
function partirSinSigno(sinSigno: string): { enteros: string; decimales: string | null } {
  const punto = sinSigno.indexOf(".");
  return {
    enteros: punto === -1 ? sinSigno : sinSigno.slice(0, punto),
    decimales: punto === -1 ? null : sinSigno.slice(punto + 1),
  };
}

/**
 * Formatea un importe que llega como STRING, sin convertirlo NUNCA a numero.
 *
 * `Number(`, `parseFloat(` y `parseInt(` estan prohibidos sobre el monto y no es
 * una precaucion teorica: un `DECIMAL(12,2)` de once digitos no cabe exacto en
 * un `number`, y el formato de este modulo tiene que ser exacto justo ahi
 * (`"99999999999.51"` se pinta `₡99.999.999.999,51`). Aqui se parte por el punto
 * y se trabaja digito a digito.
 *
 * QUE SE PINTA (ficha 359): la parte entera agrupada por miles y, DETRAS, la
 * cola de la escala 2 —pero solo cuando no es toda ceros—. `"11898.81"` da
 * `₡11.898,81`; `"11899.00"` y `"11899"` dan los dos `₡11.899`.
 *
 * Un importe con mas decimales que la escala se cuadra a ella (half away from
 * zero) antes de pintarse, y ahi el acarreo puede subir hasta la parte entera
 * (`"9.999"` da `₡10`), asi que primero se cuadra y despues se agrupa.
 *
 * Si lo que queda es cero, el signo SE CAE: un `"-0.00"` se pinta `₡0`, nunca con
 * el menos delante de un cero pelado. Un `"-0.49"`, en cambio, SI conserva el
 * signo —`-₡0,49`—, porque ya no se redondea a cero.
 *
 * Lo que NO tiene forma de importe decimal se pinta VERBATIM detras del simbolo,
 * como siempre. Esa rama no cuadra nada, asi que es la unica por la que puede
 * salir una cola de longitud distinta de la escala; esta escrita como excepcion
 * en la guardia para que no se descubra como un rojo inexplicable.
 *
 * @param value    importe serializado (`"13331832.72"`), o `null` si no lo hay.
 * @param sinMonto que pintar cuando no hay importe. Por defecto `SIN_MONTO`; las
 *                 pantallas que hoy muestran la raya larga pasan `SIN_MONTO_RAYA`.
 */
export function formatMontoString(value: string | null, sinMonto: string = SIN_MONTO): string {
  if (value === null) return sinMonto;
  const texto = value.trim();
  if (texto === "") return sinMonto;

  // Lo que no tiene forma de decimal se pinta tal cual detras del simbolo, que
  // es lo que hacian las siete copias de `money()`. Ni se agrupa a ciegas ni se
  // esconde tras el marcador de ausencia: un importe ilegible es un fallo que
  // hay que poder VER, y decir "no hay monto" cuando si lo hay seria mentir.
  if (!FORMA_DECIMAL.test(texto)) return `${monedaConfig.simbolo}${texto}`;

  const negativo = texto.startsWith("-");
  const { enteros, decimales } = partirSinSigno(negativo ? texto.slice(1) : texto);

  return componer(cuadrarAEscala(enteros, decimales), negativo);
}

/**
 * El MISMO aspecto que `formatMontoString`, pero cuadrando HACIA EL CERO en vez
 * de al vecino mas cercano. Es el formateador de una COTA, y su unica diferencia
 * es que nunca puede quedar por encima del importe que recibe.
 *
 * Existe porque un maximo cuadrado al alza deja de ser un maximo: el mensaje
 * pasaria a anunciar como valido justo lo que el validador rechaza. Con la ficha
 * 359 el sintoma concreto que lo destapo desaparece —a escala 2 el formateo ya
 * es exacto para todo lo que emite el servidor—, pero la garantia no sobra: lo
 * que llegue con mas decimales de los que se pintan sigue teniendo que quedarse
 * POR DEBAJO, y quien lea la llamada tiene que ver que ahi hay una cota.
 *
 * Ficha 359 — lo que cambia respecto de la version de la 230 (que vivia en
 * `cierre-detalle-shared.tsx` como `moneyTope` y cortaba por el punto) es SOLO
 * donde corta: antes el corte era en la escala 0 porque esa era la escala que se
 * pintaba; ahora es en la escala 2 por la misma razon. La regla —«nunca al
 * alza»— es la misma, y expresarla contra la escala vigente es lo que evita que
 * un tope sea el unico dinero de la app que esconde una cola que existe. Efecto
 * medido en el unico tope real del repo: `"9999999999.99"` pasa de anunciarse
 * `₡9.999.999.999` —99 centimos POR DEBAJO de lo que el validador acepta, y en
 * contradiccion con el «(10 digitos y 2 decimales)» de su propia frase— a
 * `₡9.999.999.999,99`, que es exactamente el limite.
 *
 * ⚠️ Es para una cota POSITIVA, que es lo que son los topes de columna de este
 * repo. Con un tope negativo cuadrar hacia el cero seria cuadrar AL ALZA, o sea
 * el lado inseguro.
 *
 * Money-safe: corta el STRING, sin `Number(`/`parseFloat(`/`.toFixed(`.
 */
export function formatMontoTope(max: string | null, sinMonto: string = SIN_MONTO): string {
  if (max === null) return sinMonto;
  const texto = max.trim();
  if (texto === "") return sinMonto;
  if (!FORMA_DECIMAL.test(texto)) return `${monedaConfig.simbolo}${texto}`;

  const negativo = texto.startsWith("-");
  const { enteros, decimales } = partirSinSigno(negativo ? texto.slice(1) : texto);

  // Cuadrar hacia el cero es quedarse con los `ESCALA` primeros digitos de la
  // cola y tirar el resto: sin mirar el sobrante, no hay acarreo posible.
  const cola = `${decimales ?? ""}${"0".repeat(ESCALA)}`.slice(0, ESCALA);
  return componer({ enteros, cola }, negativo);
}

/**
 * El `money()` de las pantallas de dinero (wallet, cierres, ranking, liquidacion),
 * UNA sola vez.
 *
 * Era la misma funcion copiada byte a byte en siete archivos de etiquetas, y por
 * eso este modulo la absorbe en vez de que cada uno delegue por su cuenta: los
 * archivos de labels la RE-EXPORTAN (`export { money } from "@/lib/config/moneda"`)
 * y ninguno de sus ~37 consumidores cambia un import. Es el mismo patron con el
 * que `montoValido` se mudo a `components/shared/monto-cliente`: una mudanza, no
 * un cambio de comportamiento.
 *
 * Se llama `money` —y no `formatMoney`— porque ese es el nombre que ya tiene en
 * las siete copias y en cada uno de sus consumidores; renombrarlo aqui obligaria
 * a un alias en cada re-export y convertiria la mudanza en una refactorizacion.
 *
 * Lo unico que NO comparte con `formatMontoString` es el marcador de ausencia:
 * estas pantallas pintan la raya larga (`SIN_MONTO_RAYA`), no el guion corto.
 * Ese detalle es el que hay que preservar; dejarlo caer al default cambiaria en
 * silencio como se ve "sin dato" en pantallas que la feature 201 no toca.
 */
export function money(value: string | null): string {
  return formatMontoString(value, SIN_MONTO_RAYA);
}

/**
 * El `money()` de una COTA: mismo marcador de ausencia, cuadre hacia el cero.
 * Ver `formatMontoTope` para el porque. Se exporta con este nombre para que las
 * pantallas de dinero —que ya importan `money`— no tengan que elegir tambien un
 * marcador al pintar un tope.
 */
export function moneyTope(max: string | null): string {
  return formatMontoTope(max, SIN_MONTO_RAYA);
}

/**
 * Formatea un monto a cobrar con la moneda configurada (R5, sin hardcodear
 * simbolo ni moneda en el codigo). Sin importe -> `sinMonto` (por defecto
 * `SIN_MONTO`).
 *
 * Pasa por el MISMO camino que `formatMontoString` para que los dos produzcan el
 * mismo aspecto; `Intl` con locale "es-CR" da espacio fino como separador de
 * miles y aqui se quiere el punto (feature 201).
 *
 * Este es el unico sitio del formato donde un monto llega como `number`, y llega
 * asi POR CONTRATO (feature 32/R5). Convertirlo a STRING con `toFixed(2)` —la
 * serializacion de escala 2, la misma que emite el servidor— es entrar al camino
 * money-safe, no salirse de el.
 *
 * ⚠️ El `toFixed(2)` fija la escala del CONTRATO de la frontera, que desde la
 * ficha 359 es tambien la escala que se pinta. Para una entrada dentro de ese
 * contrato el paso es exacto; para una que ya viene fuera de el —mas de dos
 * decimales por el camino numerico— el redondeo lo hace el motor de JS, en
 * binario, y puede diferir del que haria este modulo sobre el string. Un
 * `1234.4951` serializa a `"1234.50"` y se pinta `₡1.234,50`. Esta fijado con un
 * test para que sea una decision y no una sorpresa.
 *
 * @param monto    importe, o `null` si no lo hay.
 * @param sinMonto que pintar cuando no hay importe. Por defecto `SIN_MONTO` (el
 *                 guion corto de R5); las pantallas del mensajero y del satelite
 *                 pintan la raya larga y pasan `SIN_MONTO_RAYA` (tanda D). El
 *                 marcador se ELIGE en la llamada por la misma razon que en
 *                 `formatMontoString`: son dos marcadores distintos que ya estan
 *                 en pantalla y unificarlos cambiaria lo que ve el usuario.
 */
export function formatMonto(monto: number | null, sinMonto: string = SIN_MONTO): string {
  if (monto == null) return sinMonto;
  return formatMontoString(monto.toFixed(ESCALA));
}

/**
 * FEATURE 300, ficha 359 — ALIAS del formateador base, conservado por su nombre.
 *
 * La 300 lo escribio aparte porque el formateador de entonces cuadraba al colon
 * y el resumen del cobro necesitaba la cola EXACTA: la entrega pintaba «A cobrar
 * ₡11.899», «Capturado ₡11.899», «Diferencia ₡0» y debajo un error de descuadre,
 * porque la comparacion miraba el valor exacto. Era una excepcion declarada y
 * acotada a UNA pantalla, y precisamente por acotada dejo vivas las otras doce
 * contradicciones que censo la ficha 359.
 *
 * Desde la 359 el formateador base YA hace eso para toda la app, asi que el
 * sexto formateador dejo de tener cuerpo propio: seria una segunda
 * implementacion de la misma regla, o sea la forma exacta en que estas cosas
 * divergen. Se conserva el NOMBRE —y solo el nombre— porque es el que leen sus
 * consumidores y sus tests, y porque en el sitio de llamada sigue diciendo algo
 * cierto: «aqui la cola no se puede esconder».
 *
 * Entra en el censo de la guardia como un camino publico mas, que es lo que
 * garantiza que siga siendo byte a byte el mismo que los otros.
 */
export function montoExacto(monto: number): string {
  return formatMonto(monto, SIN_MONTO_RAYA);
}
