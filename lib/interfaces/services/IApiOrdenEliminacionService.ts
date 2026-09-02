import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiOrdenEliminacionDTO } from "@/lib/types/api-orden";

// FICHA 320 (decision del humano, 2026-08-28) — contrato del BORRADO de una orden propia desde
// el canal por API key.
//
// EL HUECO QUE CIERRA, medido el 2026-08-28: entre que la tienda carga una orden y que el paquete
// llega a la bodega central, el integrador NO tenia ninguna salida. Cancelar (feature 106) exige
// `en_bodega_central` o `en_ruta_bodega_central` y ademas identifica por `num_guia`, que con
// fulfillment todavia no existe; borrar era exclusivo del `maestro` por pantalla.
//
// ⚠️ SERVICIO PROPIO Y NO UN METODO DE `IEliminarOrdenService`, Y LA RAZON IMPORTA. Aquel es el
// camino de la APP: autoriza por ROL (`actor.rol !== "maestro"`) y NO acota por tienda, porque el
// maestro puede borrar CUALQUIER orden. Abrirle el canal API sin mas seria entregarle a una key
// la capacidad de borrar ordenes ajenas. Lo que las dos acciones comparten es el PREDICADO DE
// ESTADO (`esEstadoEliminable`, fuente unica de la ficha 319); lo que NO comparten es la
// AUTORIZACION, y por eso son dos servicios:
//   - app  : rol `maestro`, por lote, SIN frontera de tienda.
//   - API  : rol `apiKey`, UNA orden, con `tienda_id = ownerId` FORZADO en el `where` de las dos
//            sentencias (lectura y escritura), nunca en un `if` posterior.
//
// ⭑ FICHA 358 (2026-09-02) — ESE PARRAFO YA NO ES CIERTO Y SE CORRIGE AQUI EN VEZ DE BORRARLO,
// porque explica por que existen dos servicios. Lo que cambio: el humano abrio el borrado POR
// PANTALLA a la tienda, acotada a lo suyo, asi que la app tambien tiene frontera de tienda
// (`softDelete` recibe un `ownerId`) y la AUTORIZACION pasa a compartirse —los dos caminos
// preguntan a `resolverAlcanceBorradoOrden`, que es la unica copia de «el dueño es
// `actor.usuarioId`»—. Los dos servicios SIGUEN existiendo, pero ya no por la regla de dueño:
// por el GRANO (una orden contra un lote), por los estados de salida (404/409 uniformes contra
// un `conflict` con detalle por orden) y porque aqui el dueño es OBLIGATORIO.
//
// LO QUE ESTO REVIERTE, dicho aqui y no escondido. La feature «eliminar orden» firmo el
// 2026-08-27 que SOLO el `maestro` borra, con este motivo: borrar retira la orden de todos los
// listados —incluidos los de la tienda dueña— y con dos roles capaces de hacerlo el rastro deja
// de ser una sola persona. La ficha 320 lo revierte EN PARTE y a sabiendas (decision del humano
// del 2026-08-28): en los CUATRO estados eliminables el paquete esta quieto y la orden no esta en
// ningun cierre ni en la ruta de ningun mensajero, y la API key identifica al autor
// (`apiKeyId`). El rastro no se pierde: cambia de forma —de "un usuario maestro" a "esta
// credencial"—. Lo que NO se amplia es el predicado de estado: los cuatro de
// `ESTADOS_ELIMINABLES` y nada mas.

/**
 * Resultado de dominio del borrado por API (sin HTTP):
 *   - `ok`        -> borrada; `data` lleva la identidad y el estado que tenia.
 *   - `not_found` -> no existe, YA borrada, o es de OTRA tienda. Los tres casos colapsan a
 *                    proposito: distinguirlos filtraria la existencia de ordenes ajenas, que es
 *                    exactamente lo que el 404 uniforme del canal (106/R23, 177/R11) evita.
 *   - `conflict`  -> existe y es propia, pero su estado NO esta en `ESTADOS_ELIMINABLES`.
 */
export type ApiOrdenEliminacionResult =
  | { status: "ok"; data: ApiOrdenEliminacionDTO }
  | { status: "not_found" }
  | { status: "conflict" };

export interface IApiOrdenEliminacionService {
  /**
   * Borra (logicamente) la orden `ordenId` SI Y SOLO SI es del owner del actor, esta viva y su
   * estado admite borrado. `ordenId` llega YA resuelto por `IApiOrdenResolucionService` (guia o
   * remision), pero este service NO da por buena esa resolucion: vuelve a exigir el owner en sus
   * dos sentencias. Que la comprobacion sea redundante es el punto — la frontera multi-tenant no
   * puede depender de que el llamador haya hecho bien su parte.
   */
  eliminar(actor: Actor, ordenId: string): Promise<ApiOrdenEliminacionResult>;
}
