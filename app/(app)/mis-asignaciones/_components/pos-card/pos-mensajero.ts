// POS card · el DATO «mensajero» de una orden, en UN solo sitio para las tres vistas.
//
// FICHA 296 — POR QUÉ EXISTE. La tienda veía en `/novedades` una orden pidiendo ayuda y no sabía a
// QUIÉN preguntarle: la card no nombraba a nadie. Las cards POS son COMPARTIDAS con el portal del
// mensajero, y allí el mensajero es quien mira —decirle su propio nombre no informa de nada—, así
// que el dato no puede vivir en `MiAsignacionDTO`, que es el contrato de ese portal. Llega como
// PROP opcional de la card (`PosOrderCardProps.mensajero`), que es como esta card ya trata todo lo
// que sólo tiene una de sus superficies (`estado`, `acciones`, `mostrarRuta`).
//
// Este módulo es la FUENTE ÚNICA del texto, igual que `intentos-entrega` lo es del suyo y
// `dia-reparto-textos` del aviso de reserva: el mismo literal copiado en tres cards paralelas
// diverge en cuanto una cambie, y uno solo no puede.

/**
 * Etiqueta del dato. Constante exportada y no literal repetido, para dejar la puerta abierta a
 * i18n (mismo criterio que `INTENTOS_LABEL`).
 */
export const MENSAJERO_LABEL = "Mensajero";

/**
 * Valor cuando la orden NO tiene mensajero asignado (`mensajeroNombre === null`).
 *
 * VA EN PALABRAS, y no como una raya ni como un hueco en blanco: esta pantalla ya resuelve así sus
 * otras dos ausencias —«Guía sin asignar» (R9) y «Sin causa registrada» (R7)—, y aquí la ausencia
 * es además una respuesta ÚTIL para quien mira (todavía no hay nadie a quien preguntarle), no un
 * dato que se quedó sin cargar.
 *
 * En MINÚSCULA a propósito: un nombre propio va capitalizado, así que el valor se lee de un vistazo
 * como una frase y no como el nombre de alguien que se llamara «Sin asignar».
 */
export const MENSAJERO_SIN_ASIGNAR = "sin asignar";

/**
 * El dato ya en palabras: etiqueta + valor en UNA sola cadena, para que se lea como una idea, se
 * traduzca como una unidad y no quede partido para un lector de pantalla (mismo criterio que
 * `IntentosDato`, feature 160/R18).
 *
 * `null` es el ÚNICO ausente que este texto conoce, y es el que declara el contrato
 * (`NovedadDTO.mensajeroNombre: string | null`). No se defiende de `""` a propósito: en este repo
 * un dato ausente viaja como `null` y NUNCA como cadena vacía, así que taparlo aquí escondería una
 * violación del contrato en vez de dejarla salir.
 */
export function textoMensajero(nombre: string | null): string {
  return `${MENSAJERO_LABEL}: ${nombre ?? MENSAJERO_SIN_ASIGNAR}`;
}
