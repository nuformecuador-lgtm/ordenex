import type { HistorialOrigenRow } from "@/lib/utils/rechazo-sla-flag";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";

// Feature 237 (T6-bis, D6/R41) — CLASIFICACION «esta gestion la registro LA TIENDA», DERIVADA del
// historial INMUTABLE. Sin columna, sin tabla, sin migracion: quien actuo ya vive en
// `orden_historial_estado` (`actor_usuario_id` + `origen_tipo`), y una columna
// `gestionada_por_tienda` seria una SEGUNDA VERDAD que alguien tendria que mantener sincronizada
// —y que puede divergir sin que nada falle—. Molde literal: `lib/utils/rechazo-sla-flag.ts` (102).
//
// ⏳ 2026-08-20 (feature 240, T4.1) — ESTE ARCHIVO SE LLAMABA `gestion-tienda-ayuda-flag.ts` y
// declaraba UN valor (`ORIGEN_TIPO_GESTION_TIENDA_AYUDA`) con su predicado
// (`esGestionDesdeAyudaTienda`). Pasa a declarar una LISTA, porque la tienda ya registra gestiones
// por DOS caminos y el de la 240 no viene de la pantalla de ayuda. El nombre viejo describia UNO de
// los dos y habria empezado a mentir el dia que se ampliara la lista sin tocarlo.

/**
 * 💰 Las familias de historial que produce UNA GESTION REGISTRADA POR LA TIENDA. Fuente unica del
 * predicado, para no repartir strings magicos por los repositorios.
 *
 * LISTA DE INCLUSION, jamas de exclusion, y no es estilo: de este predicado cuelga el BLOQUEO DEL
 * DESHACER del mensajero (`CierreDiaService.deshacerGestion`). Con lista negra, una familia futura
 * de la tienda nacería DESHACIBLE por defecto y el mensajero podria revertir en silencio una
 * decision que ya se cobro. Con lista blanca, lo que una familia nueva hace por defecto es quedarse
 * fuera: la direccion segura del error.
 */
export const ORIGENES_GESTION_DE_LA_TIENDA = [
  // Feature 237: `GestionOrdenRepository.crearGestionDesdeAyuda` — la tienda resuelve desde la
  // pestaña de ayuda una orden que el mensajero se llevo y no supo cerrar
  // (`ayuda_tienda -> reprogramada | rechazada`).
  "gestion_tienda_ayuda",
  // 💰 Feature 240 (D6): `GestionOrdenRepository.rechazarDesdeDevuelta` — la tienda rechaza a mano
  // una devolucion ya anclada (`devuelta -> rechazada`). Entra por la MISMA razon y con mas motivo:
  // su gestion nace con el `mensajero_id` de ese mensajero (es lo que la mete en su cierre, R9) y
  // con `cierre_id NULL`, asi que PASA LAS OCHO GUARDIAS de `deshacerGestion` igual que la de la
  // 237. Sin esta entrada, el mensajero devolveria a `en_reparto` —REASIGNADA A EL— una orden cuyo
  // paquete esta fisicamente en la bodega, y borraria en silencio el `cobroRechazado` que la tienda
  // decidio. La 237 midio que deshacer se usa en 7 de 57 gestiones (12 %): no es una precaucion.
  "rechazo_tienda",
  // ⚠️ `reprogramacion_tienda` (feature 100) NO ENTRA, y la ausencia es una DECISION, no un olvido
  // (240/D6). Esa gestion sintetica TAMBIEN pasa las ocho guardias y HOY SE PUEDE DESHACER — es el
  // agujero hermano, y la auditoria de la pila lo habia dejado como «no se pudo determinar». Aqui
  // queda determinado. No se cierra desde esta ficha por dos razones: es dinero NEUTRO
  // (`reprogramada` no emite ningun concepto, a diferencia de `rechazada`) y cambiar la conducta de
  // la 100 sin pedirlo es alcance ajeno. Queda MEDIDO y PROPUESTO como ficha aparte, no en silencio.
] as const satisfies readonly OrdenHistorialOrigenTipo[];

/**
 * 💰 R41 (237) / R43 (240) — una gestion la registro LA TIENDA (`true`) SI Y SOLO SI tiene al menos
 * una fila de historial enlazada con una familia de `ORIGENES_GESTION_DE_LA_TIENDA`.
 *
 * ⚠️ QUE SIGNIFICA `false`, dicho aqui porque es donde se decide: significa **«no la registro la
 * tienda»**, no «no lo se». Y se puede afirmar con esa fuerza por una razon estructural, no por
 * optimismo: la fila de historial se escribe en la **MISMA transaccion** que la gestion, por el
 * choke point (`appendCambioEstado`), asi que una gestion de estas familias SIEMPRE tiene su fila.
 * No existe el estado «gestion de la tienda a la que le falta el historial».
 *
 * El unico hueco concebible son las gestiones LEGADAS anteriores al historial (feature 49), que no
 * tienen ninguna fila. Para ellas `false` tambien es CIERTO, no una suposicion: son anteriores al
 * estatus `ayuda_tienda` (feature 235, 2026-08-19) y a la arista manual (feature 240, 2026-08-20),
 * asi que ninguna pudo nacer por estas vias. Si algun dia esa premisa dejara de valer, este es el
 * sitio donde hay que volver a decidir — y entonces la respuesta honesta seria un tercer valor, no
 * un `false`.
 *
 * Funcion PURA: recibe las filas ya leidas (el repositorio acota el `where` por rendimiento).
 */
export function esGestionDeLaTienda(historialEstados: readonly HistorialOrigenRow[]): boolean {
  return historialEstados.some((h) =>
    (ORIGENES_GESTION_DE_LA_TIENDA as readonly string[]).includes(h.origenTipo),
  );
}
