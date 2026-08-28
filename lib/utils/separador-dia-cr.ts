// Feature 318 (R23, design §5.5) — la etiqueta del SEPARADOR DE DIA del hilo del histórico:
// «hoy», «ayer» o «jueves 28 de agosto». NUNCA lleva año, ni siquiera para un dia de otro año
// (decision humana P6).
//
// TRES cosas que aqui no son de estilo:
//
//   1. `es-CR` y `America/Costa_Rica`, no la zona del navegador. Es la convencion del repo
//      (`HiloNotasOrden.tsx`, `HistorialOrdenTimeline.tsx`, `RecolectadasHoyLista.tsx`,
//      `ranking-historico-labels.ts`, `TableroDiaCabecera.tsx`). Formatear en la zona del
//      dispositivo correria el separador un dia entero para quien mire desde otro huso.
//
//   2. «hoy»/«ayer» se deciden comparando FECHAS CALENDARIO DE CR, no restando 24 h a un
//      instante. `fechaCalendarioCR` (`lib/utils/fecha-cr.ts`) existe justamente porque
//      `toISOString().slice(0,10)` devuelve el dia SIGUIENTE despues de las 18:00 CR. Ahi vive
//      el off-by-one, y el test tiene un caso de frontera para el: a las 22:00 CR del 28, un
//      mensaje de las 21:00 CR del 28 es «hoy» — un calculo en UTC diria «ayer».
//
//   3. La cadena se ARMA desde `formatToParts`, no del `format()` completo. Medido en este
//      repo (Node 22 / ICU): `es-CR` emite «miércoles, 26 de agosto», CON COMA, y lo pedido es
//      «miércoles 26 de agosto». Armarla por partes deja fuera los literales del locale y, de
//      paso, hace IMPOSIBLE que se cuele un año: solo se concatenan `weekday`, `day` y `month`.
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

/**
 * Formateador del dia largo. SIN `year` a proposito (P6): lo que no se pide, no se puede
 * colar. `day: "numeric"` (no `2-digit`): «5 de agosto», no «05 de agosto».
 */
const FORMATO_DIA_LARGO = new Intl.DateTimeFormat("es-CR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Costa_Rica",
});

/** Milisegundos de un dia. CR es UTC-6 FIJO (sin horario de verano): restar 24 h es -1 dia. */
const UN_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Fuerza la minuscula inicial. `es-CR` ya emite el dia de la semana en minuscula, pero el ICU
 * de la plataforma no es un contrato: si una version futura (o un runtime distinto) devolviera
 * «Miércoles», el separador cambiaria de forma sin que nadie tocara este archivo. Esto lo fija.
 */
function enMinusculaInicial(texto: string): string {
  return texto.length === 0 ? texto : texto[0].toLowerCase() + texto.slice(1);
}

/** «jueves 28 de agosto», sin coma y sin año, en hora de pared de Costa Rica. */
function diaLargoCR(instante: Date): string {
  const partes = FORMATO_DIA_LARGO.formatToParts(instante);
  const parte = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((p) => p.type === tipo)?.value ?? "";
  return enMinusculaInicial(`${parte("weekday")} ${parte("day")} de ${parte("month")}`);
}

/** Fecha calendario de CR del dia ANTERIOR a `ahora`, como `YYYY-MM-DD`. */
function ayerCalendarioCR(ahora: Date): string {
  return fechaCalendarioCR(new Date(ahora.getTime() - UN_DIA_MS));
}

/**
 * Etiqueta del separador de dia para un mensaje ocurrido en `iso`, leido en el instante
 * `ahora` (R23).
 *
 * - «hoy» si el mensaje cae en la fecha calendario de CR en curso;
 * - «ayer» si cae en la inmediatamente anterior;
 * - «jueves 28 de agosto» en cualquier otro caso — **nunca** con año, tampoco si es de otro año.
 *
 * `ahora` es un parametro y no `new Date()` por dentro: un separador que depende del reloj del
 * proceso no se puede testear en la frontera, y la frontera es justo donde falla.
 */
export function separadorDia(iso: string, ahora: Date): string {
  const instante = new Date(iso);
  const dia = fechaCalendarioCR(instante);
  if (dia === fechaCalendarioCR(ahora)) return "hoy";
  if (dia === ayerCalendarioCR(ahora)) return "ayer";
  return diaLargoCR(instante);
}

/**
 * Clave de AGRUPACION del separador: la fecha calendario de CR (`YYYY-MM-DD`) del mensaje. Dos
 * mensajes con la misma clave comparten separador, y por eso el separador aparece UNA sola vez
 * por dia aunque el dia tenga tres mensajes (R23, T6.2). Se exporta desde aqui —y no se calcula
 * en la vista— para que la agrupacion y la etiqueta usen exactamente el mismo calendario.
 */
export function claveDiaCR(iso: string): string {
  return fechaCalendarioCR(new Date(iso));
}
