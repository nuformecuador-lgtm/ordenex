import type { HistorialOrigenRow } from "@/lib/utils/rechazo-sla-flag";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";

// Feature 237 (T6-bis, D6/R41) — CLASIFICACION `desdeAyudaTienda`, DERIVADA del historial
// INMUTABLE. Sin columna, sin tabla, sin migracion: quien actuo ya vive en
// `orden_historial_estado` (`actor_usuario_id` + `origen_tipo`), y una columna
// `gestionada_por_tienda` seria una SEGUNDA VERDAD que alguien tendria que mantener sincronizada
// —y que puede divergir sin que nada falle—. Molde literal: `lib/utils/rechazo-sla-flag.ts` (102).

/**
 * `origen_tipo` que escribe `GestionOrdenRepository.crearGestionDesdeAyuda` en la transicion
 * `ayuda_tienda -> reprogramada | rechazada`, enlazando la gestion. Una gestion del MENSAJERO
 * escribe `origen_tipo = "gestion"`. Fuente unica del predicado, para no repartir el string
 * magico por los repositorios.
 */
export const ORIGEN_TIPO_GESTION_TIENDA_AYUDA =
  "gestion_tienda_ayuda" satisfies OrdenHistorialOrigenTipo;

/**
 * R41 — una gestion la registro LA TIENDA (`true`) SI Y SOLO SI tiene al menos una fila de
 * historial enlazada con `origen_tipo = gestion_tienda_ayuda`.
 *
 * ⚠️ QUE SIGNIFICA `false`, dicho aqui porque es donde se decide: significa **«no la registro la
 * tienda»**, no «no lo se». Y se puede afirmar con esa fuerza por una razon estructural, no por
 * optimismo: la fila de historial se escribe en la **MISMA transaccion** que la gestion, por el
 * choke point (`appendCambioEstado`), asi que una gestion de esta familia SIEMPRE tiene su fila.
 * No existe el estado «gestion de la tienda a la que le falta el historial».
 *
 * El unico hueco concebible son las gestiones LEGADAS anteriores al historial (feature 49), que no
 * tienen ninguna fila. Para ellas `false` tambien es CIERTO, no una suposicion: son anteriores al
 * estatus `ayuda_tienda` (feature 235, 2026-08-19), asi que ninguna pudo nacer por esta via. Si
 * algun dia esa premisa dejara de valer, este es el sitio donde hay que volver a decidir — y
 * entonces la respuesta honesta seria un tercer valor, no un `false`.
 *
 * Funcion PURA: recibe las filas ya leidas (el repositorio acota el `where` por rendimiento).
 */
export function esGestionDesdeAyudaTienda(
  historialEstados: readonly HistorialOrigenRow[],
): boolean {
  return historialEstados.some((h) => h.origenTipo === ORIGEN_TIPO_GESTION_TIENDA_AYUDA);
}
