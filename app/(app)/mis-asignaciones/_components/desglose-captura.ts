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
 * punto de mas convierte 8.000 en 8. Por eso lo que se pre-carga se redondea a unidad entera y
 * lo que se teclea se filtra a digitos (`soloDigitos`).
 *
 * La aritmetica interna sigue en centimos (R11): el redondeo es de ENTRADA, no de calculo, para
 * que este modulo siga cuadrando igual que `sumaCuadra` del borde si algun dia entran decimales
 * por otra via.
 */
function textoDeMonto(monto: number): string {
  return String(Math.round(monto));
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
