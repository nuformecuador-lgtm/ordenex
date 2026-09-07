import { notacionCodePoint } from "@/lib/pdf/etiquetas-fuente-registro";

// FICHA 383 (T3) — EL FRAGMENTO QUE NOMBRA AL CARACTER CULPABLE, EN UN SOLO SITIO.
//
// La 382 escribio ese fragmento dentro de un componente de `app/`. Los rechazos de esta ficha se
// producen en el SERVIDOR —en la carga masiva y en la correccion de datos—, donde ese modulo no
// se puede importar. Sin extraerlo nacerian dos redacciones del mismo aviso, y la segunda se
// quedaria sin los dos detalles que costaron una ficha entera aprender.
//
// LOS DOS DETALLES, con su motivo (382, decision 3):
//
//  1. LOS AISLANTES BIDI. El conjunto «no cubierto» es todo lo que queda fuera de cp1252, y ahi
//     no solo hay glifos: un `U+202E` (RIGHT-TO-LEFT OVERRIDE) en el dato REORDENARIA el aviso
//     que lo denuncia, incluida la guia o el nombre del campo que van detras. `U+2068` y `U+2069`
//     acotan su efecto a si mismo. Van ESCAPADOS: un literal invisible en el codigo es un literal
//     que alguien borra sin darse cuenta.
//
//  2. LA NOTACION `U+XXXX`, que NO es decorativa y por eso no es opcional. Un caracter de ancho
//     cero (`U+200B`) se pinta como unas comillas vacias: sin el numero al lado, el aviso dice
//     «el caracter «» no se puede imprimir» y no hay forma de saber cual es.
//
// Q5 (decision del leader del 2026-09-07, NO firmada por el humano): los mensajes de esta ficha
// COMPARTEN esta frase de diagnostico con el de la 382 y difieren solo en el cierre. El de la 382
// termina con «ninguna etiqueta del lote se descarga mientras siga ahi», que aqui no aplica: la
// orden todavia no existe.

/** El caracter, encerrado en aislantes bidi para que no reordene el aviso que lo contiene. */
export function aislado(caracter: string): string {
  return `\u2068${caracter}\u2069`;
}

/** `«X» (U+1D560)` — el caracter aislado y su code point, que es como se busca en una tabla. */
export function fraseCaracterNoImprimible(caracter: string, codePoint: number): string {
  return `«${aislado(caracter)}» (${notacionCodePoint(codePoint)})`;
}

/**
 * Carga masiva, campo irreparable (R14). Nombra el CAMPO con la clave de la columna del archivo
 * —`destinatario`, `telefono`, `producto`, `direccion`, `num_remision`— porque lo que hay que
 * corregir es una celda, y NO manda reintentar: el caracter va a seguir fuera de la fuente el
 * segundo intento y el tercero.
 */
export function mensajeCargaCaracterNoImprimible(
  campo: string,
  caracter: string,
  codePoint: number,
): string {
  return `El campo «${campo}» lleva un carácter que la etiqueta no puede imprimir: ${fraseCaracterNoImprimible(caracter, codePoint)}. Reintentar no lo cambia: corrige esa celda y escríbela con letras y números normales.`;
}

/** Correccion de datos del cliente, texto irreparable (R17). Mismo diagnostico, otro cierre. */
export function mensajeCorreccionCaracterNoImprimible(
  campo: string,
  caracter: string,
  codePoint: number,
): string {
  return `«${campo}» lleva un carácter que la etiqueta no puede imprimir: ${fraseCaracterNoImprimible(caracter, codePoint)}. Reintentar no lo cambia: escríbelo con letras y números normales.`;
}

/**
 * Correccion de datos del cliente, texto REPARABLE (R18/A2).
 *
 * Aqui el sistema NO repara por su cuenta: devuelve el texto bueno para que la persona que esta
 * mirando esa orden lo pegue. Es el mismo criterio que este repo ya aplica al dinero en estas dos
 * mismas superficies —la carga ajusta y avisa (299), la correccion pregunta antes de escribir
 * (327/R11)—, y el motivo es el mismo: en la carga no hay nadie delante de 500 filas en el
 * instante en que se decide; aqui SI hay una persona mirando. Asi Ordenex nunca guarda un nombre
 * que el humano no haya tecleado.
 */
export function mensajeCorreccionSugerencia(
  campo: string,
  caracter: string,
  codePoint: number,
  sugerencia: string,
): string {
  return `«${campo}» lleva un carácter que la etiqueta no puede imprimir: ${fraseCaracterNoImprimible(caracter, codePoint)}. Escríbelo así: «${sugerencia}».`;
}
