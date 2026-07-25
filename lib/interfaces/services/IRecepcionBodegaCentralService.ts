import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 138 — Recepcion en la BODEGA CENTRAL, contrato del servicio. Cierra el dead-end
// de la carga por API: la orden cargada por el canal integrador queda en
// `en_ruta_bodega_central` ("En ruta a bodega central") sin transicion de salida; alguien en
// la bodega central confirma fisicamente su llegada escaneando el QR de la etiqueta en
// `/ordenes` -> `en_bodega_central`. Espejo de `IRecepcionOrigenService` cambiando el alcance
// de TIENDA por el GLOBAL de maestro/admin (`esAccesoTotal`), SIN acotar por zona ni por
// tienda (R11). Logica de negocio pura (sin HTTP, sin Prisma); el borde (Server Action) la
// traduce al resultado tipado expuesto.

/**
 * Resultado de dominio de la recepcion en bodega central (STATE-AWARE, feature 138 + 139). Espejo de
 * `RecibirEnOrigenServiceResult` SIN `tienda_ajena` (ni `zona_ajena`/`sin_zona`): la bodega central es
 * global, no hay alcance por tienda/zona que reportar (R11). `unauthenticated` NO vive aqui: lo agrega
 * el borde (R5).
 * - `ok`: transiciono al destino resuelto por el estado de origen: `en_bodega_central` (desde
 *   `en_ruta_bodega_central`, caso 138) o `por_devolver_a_tienda` (desde `devolviendo_a_bodega_central`,
 *   caso 139/R17).
 * - `forbidden`: el actor no es maestro ni admin (R4/R17).
 * - `ya_recibida`: ya estaba en un destino (en_bodega_central / por_devolver_a_tienda) -> idempotente,
 *   sin escritura (R7).
 * - `estado_invalido`: no esta en un origen valido de la recepcion central; lleva el estado actual
 *   para que la UI pueda nombrarlo (R8).
 * - `no_encontrada`: no existe orden viva con ese `num_guia` (o esta borrada) (R6).
 * - `validation_error`: el catalogo no tiene el estado destino (config; seed pendiente).
 * - `conflict`: perdio una carrera (el estado cambio entre la lectura y el UPDATE) (R9).
 */
export type RecibirEnBodegaCentralServiceResult =
  | { status: "ok"; ordenId: string; estado: "en_bodega_central" | "por_devolver_a_tienda" }
  | { status: "forbidden" }
  | { status: "estado_invalido"; estado: string }
  | { status: "ya_recibida" }
  | { status: "no_encontrada" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict" };

export interface IRecepcionBodegaCentralService {
  /**
   * Recibe en la bodega central la orden cuyo `num_guia` es el escaneado (el QR codifica
   * `/paquete/<numGuia>`). STATE-AWARE (feature 138 + 139): resuelve el par ORIGEN->DESTINO por el
   * estado de origen: `en_ruta_bodega_central -> en_bodega_central` (138) o
   * `devolviendo_a_bodega_central -> por_devolver_a_tienda` (139/R17). Idempotente si ya estaba en un
   * destino. Elegible CUALQUIER orden en un origen valido para maestro/admin, sin acotar por zona ni
   * por tienda (R11). El rol y la guardia de estado se imponen server-side.
   */
  recibirEnBodegaCentral(
    numGuia: number,
    actor: Actor,
  ): Promise<RecibirEnBodegaCentralServiceResult>;
}
