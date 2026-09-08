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
 * ¿Estos dos textos se PINTAN igual?
 *
 * Dos cadenas con el mismo NFD son «canonicamente equivalentes»: son la MISMA secuencia de
 * caracteres escrita de dos maneras (`"ñ"` frente a `"n"` + U+0303), y Unicode EXIGE a quien las
 * muestre que las muestre igual. O sea que la respuesta no es una heuristica sobre glifos ni un
 * parecido: es lo unico que se puede afirmar de verdad sobre dos textos sin abrir una fuente.
 *
 * No vale mirar solo el caracter culpable. El culpable que se reporta es el PRIMERO fuera de
 * cobertura, y en `"n" + U+0303 + " 𝕠rfirio"` es la marca combinante aunque el texto reparado SI
 * se vea distinto por culpa del `𝕠` de mas atras. La pregunta es sobre el texto entero.
 */
export function seVenIgual(a: string, b: string): boolean {
  return a.normalize("NFD") === b.normalize("NFD");
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
 *
 * ── EL CASO EN EL QUE «ESCRIBELO ASI» NO DICE NADA (revision del 2026-09-07, menor 1) ────────
 *
 * Con una `ñ` DESCOMPUESTA —`"n"` + U+0303, lo que produce macOS al copiar— el texto reparado es
 * `"Nuñez"`... que se pinta EXACTAMENTE igual que el `"Nuñez"` que la persona acaba de teclear.
 * El mensaje decia «Escribelo asi: «Nuñez»» enseñando lo mismo que ya estaba en pantalla: un
 * mensaje que no se puede obedecer, y ademas justo donde SI hay alguien mirando.
 *
 * Lo que cambia no son los pixeles, son los code points, asi que eso es lo que hay que decir. En
 * ese caso el mensaje NO repite el texto —repetirlo es el defecto— y da la unica instruccion que
 * funciona: volver a teclear esa letra. Copiar y pegar la trae otra vez descompuesta.
 *
 * La sugerencia de R18 sigue viajando entera cuando SI se distingue (`𝕠rfirio` -> `orfirio`), que
 * es el caso para el que se escribio. Y esto NO toca A2: se sigue rechazando y no se guarda nada.
 * Aceptar la composicion canonica sin preguntar seria otra decision —razonable, y el reviewer la
 * recomienda— pero es de la familia de las que estan esperando firma humana, no de las que se
 * cuelan en un arreglo de redaccion.
 */
export function mensajeCorreccionSugerencia(
  campo: string,
  caracter: string,
  codePoint: number,
  sugerencia: string,
  original: string,
): string {
  const diagnostico = `«${campo}» lleva un carácter que la etiqueta no puede imprimir: ${fraseCaracterNoImprimible(caracter, codePoint)}.`;
  if (seVenIgual(original, sugerencia)) {
    return `${diagnostico} Aquí no hay nada que se vea mal: esa letra está escrita en dos piezas —la letra por un lado y su acento por otro—, y así no se puede imprimir. Bórrala y vuelve a teclearla; copiar y pegar el mismo texto la trae otra vez partida.`;
  }
  return `${diagnostico} Escríbelo así: «${sugerencia}».`;
}
