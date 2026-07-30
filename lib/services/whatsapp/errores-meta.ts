// Clasificacion de los codigos de error que Meta reporta en un status `failed` del webhook.
//
// POR QUE EXISTE: un `failed` de Meta NO es reintentable por defecto. La inmensa mayoria son
// DETERMINISTAS (el destinatario no esta en la lista de permitidos de la app en desarrollo,
// la plantilla no esta aprobada en ese idioma, el numero no tiene WhatsApp): reintentarlos
// gasta cuota de la Graph API, consume los intentos del job y termina en dead-letter sin
// haber cambiado nada. Solo un puñado de codigos describen una condicion PASAJERA.
//
// Mismo criterio que ya aplica `GeocodificacionService` con los desenlaces del geocoder:
// determinista -> se registra y se cierra; transitorio -> backoff y reintento.

/**
 * Codigos de Meta que describen una condicion PASAJERA y por tanto merecen reintento.
 *
 * ⚠️ LISTA BLANCA DELIBERADA, no una lista negra. Un codigo desconocido (o un `failed` sin
 * codigo) se trata como DETERMINISTA: es la opcion conservadora. Preferimos no reintentar un
 * fallo que quiza era recuperable, a martillear la Graph API con un fallo permanente que
 * ademas puede acabar penalizando la calidad del numero de negocio.
 *
 *   130429 — Rate limit hit: se supero el limite de mensajes por segundo de la cuenta.
 *   131000 — Something went wrong: error generico e interno de Meta, sin causa atribuible.
 *   131056 — Pair rate limit hit: demasiados mensajes a ESE destinatario en poco tiempo.
 *
 * Para ampliarla basta añadir el codigo aqui: no hay ninguna otra rama que dependa de el.
 */
export const CODIGOS_TRANSITORIOS: ReadonlySet<number> = new Set([130429, 131000, 131056]);

/**
 * ¿El fallo merece un reintento? `null`/`undefined` (Meta no mando codigo) -> `false`, por la
 * regla conservadora de arriba.
 */
export function esErrorTransitorio(codigo: number | null | undefined): boolean {
  return codigo !== null && codigo !== undefined && CODIGOS_TRANSITORIOS.has(codigo);
}
