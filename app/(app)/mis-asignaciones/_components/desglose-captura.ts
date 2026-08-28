// Feature 213 (R3/R4/R5/R11/R12/R13, design §1.1) — logica PURA del editor de lineas de pago
// del panel del mensajero. Sin React y sin JSX a proposito: es lo que permite testear las reglas
// del desglose sin montar el componente ni usar `userEvent`.
//
// ⛔ Este modulo VIAJA AL BUNDLE DEL NAVEGADOR (lo importa `GestionarOrdenPanel.tsx`), asi que NO
// importa `@prisma/client` ni `lib/utils/lineas-pago.ts` —ese ultimo SI lo importa (`:1`) y es el
// serializador de las proyecciones del servidor, no el util del borde (R19). El util puro que si
// sirve, y cuyas reglas se reusan aqui sin duplicarlas, es `lib/utils/pagos-recaudo.ts` (212).
//
// Aritmetica (R11): toda suma y toda diferencia se hace en CENTIMOS ENTEROS con `aCentimos` /
// `sumaCuadra`. Cero suma de floats: `0.1 + 0.2` da `0.30000000000000004` y una entrega de 8.000
// partida en dos metodos dejaria de cuadrar por un centavo fantasma.

import { METODO_LABEL } from "@/app/(app)/cierres-admin/_components/cierre-labels";
import type { SelectOption } from "@/components/ui/select";
import type { MetodoPago } from "@/lib/types/metodo-pago";
import { METODO_PAGO_SEED } from "@/lib/types/metodo-pago";
import { aCentimos, sumaCuadra, type LineaPago } from "@/lib/utils/pagos-recaudo";

/** Una linea EN EDICION: los dos campos pueden estar a medias mientras se teclea. */
export interface LineaEnEdicion {
  /** Id estable para la `key` de React; NO viaja al servidor. */
  id: string;
  metodo: MetodoPago | "";
  /** El TEXTO crudo del input. `""` = vacio. Nunca un number: el usuario teclea. */
  monto: string;
}

/**
 * Textos de error de una linea, en un solo sitio para que la UI no los duplique y para que el dia
 * que haya i18n solo cambie este mapa (R13/R14; «metodo de pago requerido» es la misma frase que
 * usa la regla 3 del borde).
 */
export const ERRORES_LINEA = {
  montoRequerido: "Monto requerido",
  metodoRequerido: "Método de pago requerido",
} as const;

/** Contador de respaldo para entornos sin `crypto.randomUUID` (tests, contextos no seguros). */
let contadorLinea = 0;

function nuevoIdLinea(): string {
  const cripto = globalThis.crypto;
  if (typeof cripto?.randomUUID === "function") return cripto.randomUUID();
  contadorLinea += 1;
  return `linea-${contadorLinea}`;
}

/**
 * EXCEPCION EXPLICITA de R11 y UNICA conversion texto→numero admitida en todo el camino de la
 * captura: el campo de entrada devuelve un string y alguien tiene que interpretarlo. Queda acotada
 * aqui, con guard de `NaN`, para que la guardia de R11 (T13) pueda nombrarla como excepcion y no
 * como permiso general. Fuera de esta funcion no hay ni un `Number(` ni un `parseFloat(` sobre
 * montos: todo lo demas son centimos enteros.
 */
function montoDeTexto(texto: string): number {
  const limpio = texto.trim();
  if (limpio === "") return 0;
  const valor = Number(limpio);
  return Number.isFinite(valor) ? valor : 0;
}

/** Centimos enteros de una linea en edicion. */
function centimosDeLinea(linea: LineaEnEdicion): number {
  return aCentimos(montoDeTexto(linea.monto));
}

/**
 * UX de calle: la captura NO maneja decimales. El mensajero teclea con una mano y de pie, y un
 * punto de mas convierte 8.000 en 8. Por eso lo que se pre-carga se trunca a unidad entera y
 * lo que se teclea se filtra a digitos (`soloDigitos`).
 *
 * La aritmetica interna sigue en centimos (R11): el truncado es de ENTRADA, no de calculo, para
 * que este modulo siga cuadrando igual que `sumaCuadra` del borde si algun dia entran decimales
 * por otra via.
 *
 * FEATURE 300 — `Math.floor`, y NO el `Math.round` que habia. Con un total con centimos
 * (11.898,81) redondear proponia 11.899, que es MAS de lo que `topeDeLinea` admite: la funcion
 * que existe para acotar devolvia un valor por encima de su propio tope, y ese numero imposible
 * era justo el que el mensajero se encontraba pre-cargado. Truncando, lo que se ofrece es
 * siempre un importe que el editor acepta. Con un total ENTERO —las ordenes sanas, que son casi
 * todas— truncar y redondear dan lo mismo, asi que el cambio solo se nota donde esta el fallo.
 */
function textoDeMonto(monto: number): string {
  return String(Math.floor(monto));
}

/**
 * FEATURE 300 — los CENTIMOS del total que este editor NO puede capturar (0..99).
 *
 * Todo lo que se puede teclear aqui es un entero de la unidad monetaria (`soloDigitos`), asi que
 * cualquier suma alcanzable es entera. Si el total a cobrar arrastra una cola de centimos, esa
 * cola no es «lo que aun falta por teclear»: es un importe que el teclado que se ofrece no puede
 * escribir, y por tanto un cuadre que no existe. Se devuelve el NUMERO —y no solo un booleano—
 * porque el aviso tiene que poder decirlo con su cifra delante, en vez de afirmar que no falta
 * nada mientras bloquea la entrega.
 *
 * Siempre positivo: un total negativo no es un caso de esta pantalla, pero devolver aqui un
 * resto negativo convertiria el aviso en otro numero raro y no hay motivo para arriesgarlo.
 */
export function centimosNoCapturables(totalACobrar: number): number {
  const sueltos = aCentimos(totalACobrar) % 100;
  return sueltos < 0 ? -sueltos : sueltos;
}

/**
 * FEATURE 300 — `true` si el cuadre EXACTO es INALCANZABLE desde este editor.
 *
 * NO afloja la regla de negocio: `capturaCuadra` sigue exigiendo la igualdad exacta y este
 * predicado no la toca ni la sustituye. Lo unico que separa es «te falta teclear» de «esto no se
 * puede teclear», que son dos situaciones distintas y hasta hoy se contaban con la misma frase —
 * la que dejaba al mensajero buscando un numero que no existe.
 */
export function cuadreInalcanzable(totalACobrar: number): boolean {
  return centimosNoCapturables(totalACobrar) !== 0;
}

/**
 * Filtra a digitos lo que se teclea en el input de monto: sin punto, sin coma, sin signo. Devuelve
 * `""` para el campo vacio (que es un estado legitimo mientras se edita) y come los ceros a la
 * izquierda para que no quede «08000» en pantalla.
 */
export function soloDigitos(texto: string): string {
  const digitos = texto.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digitos;
}

/**
 * Pedido humano (2026-08-14): TOPE de lo que cabe en la linea `indice`, que es lo que falta para
 * el total contando SOLO las OTRAS lineas. Con un total de 1.000 y una primera linea de 700, la
 * segunda no admite mas de 300.
 *
 * Se excluye la propia linea a proposito —mismo criterio que `opcionesPara` (R5)— porque el tope
 * es lo que esa linea PUEDE llegar a valer, no lo que ya vale: incluirse a si misma congelaria el
 * campo en cuanto la suma cuadrase y no se podria ni corregir a la baja.
 *
 * Nunca negativo: si las otras lineas ya cubren el total, el tope es 0.
 */
export function topeDeLinea(
  lineas: readonly LineaEnEdicion[],
  indice: number,
  totalACobrar: number,
): number {
  const otras = lineas.reduce(
    (acc, l, i) => (i === indice ? acc : acc + centimosDeLinea(l)),
    0,
  );
  const margen = aCentimos(totalACobrar) - otras;
  return margen > 0 ? margen / 100 : 0;
}

/**
 * Lo que QUEDA en el input tras teclear: digitos (`soloDigitos`) y, como mucho, `topeDeLinea`.
 *
 * Acota en vez de rechazar la tecla. Teclear 2.000 donde caben 300 deja 300, no deja el campo
 * como estaba: el mensajero ve el numero que el sistema acepta en lugar de pelearse con un campo
 * que no reacciona. El `""` sobrevive intacto —es un estado legitimo mientras se edita (R13)—.
 *
 * Consecuencia deliberada: por esta via la suma YA NO PUEDE pasarse del total, asi que el
 * descuadre que queda alcanzable desde la UI es solo el de MENOS. La regla del exceso sigue viva
 * en `capturaCuadra`/`pendiente`, que es donde protege lo que llega por otros caminos.
 */
export function acotarMonto(
  texto: string,
  lineas: readonly LineaEnEdicion[],
  indice: number,
  totalACobrar: number,
): string {
  const digitos = soloDigitos(texto);
  if (digitos === "") return "";
  const tope = topeDeLinea(lineas, indice, totalACobrar);
  return aCentimos(montoDeTexto(digitos)) > aCentimos(tope) ? textoDeMonto(tope) : digitos;
}

/** `true` si la linea no tiene NI metodo NI monto: la unica que se descarta ([Q2] de la 212). */
function estaVacia(linea: LineaEnEdicion): boolean {
  return linea.metodo === "" && linea.monto.trim() === "";
}

/** Una linea nueva, sin metodo y con el monto PENDIENTE pre-cargado (R4, [Q4]). */
export function lineaNueva(montoPendiente: number): LineaEnEdicion {
  return { id: nuevoIdLinea(), metodo: "", monto: textoDeMonto(montoPendiente) };
}

/**
 * R2 [Q4]: el editor arranca con EXACTAMENTE UNA linea, sin metodo y con el monto a cobrar ya
 * puesto, para que un cobro de un solo metodo siga costando un solo gesto.
 */
export function lineasIniciales(montoACobrar: number): LineaEnEdicion[] {
  return [lineaNueva(montoACobrar)];
}

/**
 * R5 [D2]: devuelve SIEMPRE las tres opciones del catalogo, marcando `disabled` las ya usadas en
 * OTRA linea. Se deshabilita en vez de ocultar: el mensajero ve que el metodo existe y que ya lo
 * uso, en lugar de que desaparezca de la lista sin explicacion. La regla 2 del `superRefine` del
 * borde (212) sigue detras como red; esto es prevencion, no sustitucion.
 */
export function opcionesPara(lineas: readonly LineaEnEdicion[], indice: number): SelectOption[] {
  return METODO_PAGO_SEED.map((metodo) => ({
    value: metodo,
    label: METODO_LABEL[metodo],
    disabled: lineas.some((linea, i) => i !== indice && linea.metodo === metodo),
  }));
}

/** R3: no puede haber mas lineas que metodos en el catalogo. */
export function puedeAnadirLinea(lineas: readonly LineaEnEdicion[]): boolean {
  return lineas.length < METODO_PAGO_SEED.length;
}

/**
 * Pedido humano (2026-08-14): no queda NADA que repartir, porque lo capturado ya iguala —o
 * supera— el total. La linea nueva nace de `pendiente`, que se acota a 0 (R4), asi que aqui
 * solo podria nacer una linea de monto 0: una que no cobra nada y que, al enviarse, se para
 * sola en `erroresDeLinea` con «Monto requerido». Ofrecerla es ofrecer un callejon sin salida.
 *
 * Es un `>=` deliberado, no un `>`: con la captura PASADA de rosca el problema no se arregla
 * anadiendo otra linea, se arregla corrigiendo las que ya hay. Se lee del mismo `pendiente`
 * que pre-carga el monto, para que el boton y lo que el boton haria no puedan divergir.
 *
 * DESHABILITA, no oculta —a diferencia del tope de catalogo (R3), que si esconde el control—:
 * el mensajero tiene que poder ver que partir el cobro sigue siendo posible en cuanto baje el
 * monto de una linea, no que la opcion desaparecio sin explicacion.
 */
export function sinPendiente(
  lineas: readonly LineaEnEdicion[],
  totalACobrar: number,
): boolean {
  return pendiente(lineas, totalACobrar) === 0;
}

/**
 * R4: diferencia entre el total a cobrar y lo ya capturado, en centimos enteros. Nunca negativa:
 * si la suma ya cuadra —o se pasa— lo pendiente es `0`, porque una linea nueva con monto negativo
 * seria una resta disfrazada de cobro.
 */
export function pendiente(lineas: readonly LineaEnEdicion[], totalACobrar: number): number {
  const capturado = lineas.reduce((acc, linea) => acc + centimosDeLinea(linea), 0);
  const diferencia = aCentimos(totalACobrar) - capturado;
  return diferencia > 0 ? diferencia / 100 : 0;
}

/** Suma capturada (R8), en la misma aritmetica de centimos que el resto. */
export function totalCapturado(lineas: readonly LineaEnEdicion[]): number {
  return lineas.reduce((acc, linea) => acc + centimosDeLinea(linea), 0) / 100;
}

/** R9: la suma de las lineas iguala EXACTAMENTE el total. Misma regla que el borde: `sumaCuadra`. */
export function capturaCuadra(lineas: readonly LineaEnEdicion[], totalACobrar: number): boolean {
  return sumaCuadra(
    lineas.map((linea) => ({ monto: montoDeTexto(linea.monto) })),
    totalACobrar,
  );
}

/**
 * R12 [Q2 de la 212]: descarta del envio SOLO la linea COMPLETAMENTE vacia.
 *
 * Una linea a medias NO se descarta: sale tal cual para que la vean las DOS barreras —
 * `erroresDeLinea` antes de pulsar y el `gestionarSchema` del borde al enviar—. Descartarla en
 * silencio cambiaria el reparto del dinero sin decirselo a nadie, y este camino alimenta la `E`
 * del `min(P, E)` del pago al mensajero (44).
 */
export function lineasParaEnviar(lineas: readonly LineaEnEdicion[]): LineaPago[] {
  return lineas
    .filter((linea) => !estaVacia(linea))
    .map((linea) => ({ metodo: linea.metodo as MetodoPago, monto: montoDeTexto(linea.monto) }));
}

/**
 * R13 [Q6], lectura ESTRICTA: un error POR LINEA, en la posicion de la linea que lo provoca.
 * Metodo sin monto estrictamente positivo → error; monto sin metodo → error; linea totalmente
 * vacia → sin error (esa si se descarta).
 */
export function erroresDeLinea(lineas: readonly LineaEnEdicion[]): (string | undefined)[] {
  return lineas.map((linea) => {
    if (estaVacia(linea)) return undefined;
    if (linea.metodo === "") return ERRORES_LINEA.metodoRequerido;
    return centimosDeLinea(linea) > 0 ? undefined : ERRORES_LINEA.montoRequerido;
  });
}
