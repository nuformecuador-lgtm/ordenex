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
  /** Separador entre la parte entera y la decimal (p. ej. ","). */
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
 * que las tarjetas de wallet, cierres, mis-pagos, ranking y liquidacion pintan
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
 * una precaucion teorica: `Number("1500.50")` ya no vuelve a ser `"1500.50"`,
 * `"0.10"` se convierte en `0.1` —y se pintaria "₡0,1"— y un `DECIMAL(12,2)` de
 * once digitos no cabe exacto en un `number`. Aqui se parte por el punto, se
 * agrupa la parte ENTERA y los decimales se copian VERBATIM: si el servidor
 * manda dos, se pintan dos; si no manda ninguno, no se inventa ningun ",00".
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

  const agrupado = agruparMiles(enteros);
  const cuerpo =
    decimales === null ? agrupado : `${agrupado}${monedaConfig.separadorDecimal}${decimales}`;

  // El signo va DELANTE del simbolo: "-₡4.500,00".
  return `${negativo ? "-" : ""}${monedaConfig.simbolo}${cuerpo}`;
}

/**
 * El `money()` de las pantallas de dinero (wallet, cierres, mis-pagos, ranking,
 * liquidacion), UNA sola vez.
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
 * Pasa por la MISMA agrupacion que `formatMontoString` para que los dos caminos
 * produzcan el mismo aspecto; `Intl` con locale "es-CR" da espacio fino como
 * separador de miles y aqui se quiere el punto (feature 201).
 *
 * Este es el unico sitio del formato donde un monto llega como `number`, y llega
 * asi POR CONTRATO (feature 32/R5). Convertirlo a STRING con `toFixed(2)` —la
 * serializacion de escala 2, la misma que emite el servidor— es entrar al camino
 * money-safe, no salirse de el. `toFixed(2)` es ademas lo que hace que un importe
 * entero se pinte "₡320,00" y no "₡320": aqui la escala 2 SI esta en el contrato,
 * al reves que en `formatMontoString`, donde los decimales se copian verbatim.
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
