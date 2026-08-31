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
// Feature 230 — el dinero se pinta SIN CENTIMOS. La parte decimal ya no se
// copia: se usa para REDONDEAR la parte entera (half away from zero) y se
// descarta. `₡13.331.833`, no `₡13.331.832` con su cola. Es un cambio de
// PRESENTACION y solo de presentacion: la columna sigue siendo `DECIMAL(12,2)`,
// el importe sigue cruzando la frontera con escala 2 y las descargas XLSX/CSV
// conservan la cola que la contabilidad necesita. Ver `specs/230-*`.
//
// El redondeo opera sobre el STRING, digito a digito, y no es purismo: hay tres
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
   * El caracter que separaria la parte entera de la decimal (p. ej. ",").
   *
   * ⚠️ Desde la feature 230 NO GOBIERNA LA SALIDA: no hay parte decimal que
   * separar, asi que este campo no se emite nunca y cambiarlo no altera ni un
   * byte de lo que se pinta. Se conserva —decision Q1(b), firmada— porque le
   * queda un oficio distinto y vivo: es EL CARACTER QUE LA GUARDIA VIGILA.
   * `tests/unit/guards/dinero-sin-centimos.guardia.test.ts` lo lee de aqui en
   * vez de escribir la coma a mano, que seria el hardcode de contexto que
   * `docs/architecture.md` prohibe. Retirarlo dejaria a la guardia sin punto
   * unico de configuracion para lo que persigue.
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
 * La forma de un importe decimal serializado por el servidor: signo opcional,
 * parte entera y —opcionalmente— parte decimal. Es lo que emite
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
 * Suma 1 a una parte entera representada como STRING, con acarreo manual
 * (feature 230). `"999" -> "1000"`, `"9" -> "10"`, `"0" -> "1"`,
 * `"999999" -> "1000000"`.
 *
 * Es el acarreo de derecha a izquierda de toda la vida —la cola de nueves se
 * vuelve ceros y el primer digito distinto de `'9'` sube—, escrito con una
 * expresion regular en vez de con un bucle A PROPOSITO: asi no hay ni una sola
 * operacion aritmetica, ni siquiera sobre el indice del recorrido. `(\d*)` es
 * codicioso, asi que `([0-8])` cae sobre el ULTIMO digito que no es `'9'` y
 * `(9*)` se queda con la cola que hay que poner a cero.
 *
 * Si no hay ningun `[0-8]` es que el numero era todo nueves: la cola entera se
 * pone a cero y el acarreo sobrevive, asi que se antepone `'1'`. Ese es el caso
 * que CAMBIA EL NUMERO DE DIGITOS y por el que el redondeo tiene que ir ANTES
 * de agrupar los miles y nunca despues (`999.50` se pinta `₡1.000`).
 *
 * Los ceros a la izquierda se conservan (`"000123" -> "000124"`): es lo que ya
 * hacia el modulo con una entrada asi y esta feature no normaliza la rama de
 * entradas fuera de contrato.
 */
function sumarUno(enteros: string): string {
  const casa = /^(\d*)([0-8])(9*)$/.exec(enteros);
  if (casa === null) return `1${enteros.replace(/9/g, "0")}`;
  const [, cabeza, ultimoNoNueve, nueves] = casa;
  return `${cabeza}${DIGITO_SIGUIENTE[ultimoNoNueve]}${"0".repeat(nueves.length)}`;
}

/**
 * Devuelve la parte entera YA redondeada (feature 230, D1: half away from zero,
 * el medio se ALEJA del cero).
 *
 * Mira SOLO el primer digito decimal: `>= '5'` sube, si no baja, y el resto se
 * ignora (`"10.4999" -> "10"`, `"10.5001" -> "11"`). La comparacion es entre
 * CARACTERES, que para un digito suelto ordena igual que entre numeros y no
 * obliga a convertir nada.
 *
 * El signo no llega hasta aqui: quien llama ya lo separo, asi que "alejarse del
 * cero" es siempre "subir" y el negativo hereda el mismo redondeo.
 */
function redondearEnteros(enteros: string, decimales: string | null): string {
  if (decimales === null || decimales === "") return enteros;
  return decimales.charAt(0) >= "5" ? sumarUno(enteros) : enteros;
}

/** Una parte entera que vale cero, con los ceros a la izquierda que traiga. */
function esCero(enteros: string): boolean {
  return /^0+$/.test(enteros);
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
 * Formatea un importe que llega como STRING, sin convertirlo NUNCA a numero.
 *
 * `Number(`, `parseFloat(` y `parseInt(` estan prohibidos sobre el monto y no es
 * una precaucion teorica: un `DECIMAL(12,2)` de once digitos no cabe exacto en
 * un `number`, y el redondeo de esta feature tiene que ser exacto justo ahi
 * (`"99999999999.51"` se pinta `₡100.000.000.000`). Aqui se parte por el punto y
 * se trabaja digito a digito.
 *
 * QUE SE PINTA (feature 230): la parte entera agrupada por miles, sin cola
 * decimal. La parte decimal que mande el servidor no se copia: decide el
 * redondeo de la entera y se descarta. El orden importa —primero se redondea y
 * despues se agrupa—, porque el acarreo puede añadir un digito y cambiar la
 * agrupacion entera.
 *
 * Si el redondeo da cero, el signo SE CAE: un `"-0.49"` se pinta `₡0`, nunca con
 * el menos delante de un cero pelado.
 *
 * Lo que NO tiene forma de importe decimal se pinta VERBATIM detras del simbolo,
 * como siempre. Esa rama no redondea nada, asi que es la unica por la que puede
 * salir un caracter separador seguido de digitos; esta escrita como excepcion en
 * la guardia de la feature 230 para que no se descubra como un rojo inexplicable.
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
  const sinSigno = negativo ? texto.slice(1) : texto;

  const punto = sinSigno.indexOf(".");
  const enteros = punto === -1 ? sinSigno : sinSigno.slice(0, punto);
  const decimales = punto === -1 ? null : sinSigno.slice(punto + 1);

  const redondeado = redondearEnteros(enteros, decimales);
  const agrupado = agruparMiles(redondeado);

  // El signo va DELANTE del simbolo ("-₡4.501"), y desaparece si lo que queda
  // es un cero: "menos cero" no es una cantidad que nadie quiera leer.
  const signo = negativo && !esCero(redondeado) ? "-" : "";
  return `${signo}${monedaConfig.simbolo}${agrupado}`;
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
 * ⚠️ El `toFixed(2)` se conserva DESPUES de la feature 230, y con los ojos
 * abiertos (`design.md` §7/A3): la escala 2 es la del CONTRATO de la frontera, y
 * bajarla aqui delegaria el redondeo en el motor de JS —binario— justo en la
 * operacion que esta feature quiere determinista. La consecuencia declarada es
 * un doble redondeo para entradas que YA estan fuera de ese contrato: un
 * `1234.4951` serializa a `"1234.50"` y sube, cuando el redondeo directo habria
 * bajado. Solo pasa con mas de dos decimales por el camino numerico y esta
 * fijado con un test para que sea una decision y no una sorpresa.
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
  return formatMontoString(monto.toFixed(2));
}
