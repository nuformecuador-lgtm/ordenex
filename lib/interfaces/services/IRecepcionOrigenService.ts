import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Recepcion en la tienda de ORIGEN — contrato del servicio. Cierra el flujo de
// devolucion: la orden que viaja de vuelta (`devolviendo_a_tienda`, "En ruta a origen")
// la recibe FISICAMENTE su tienda, que escanea el QR de la etiqueta en `/ordenes`
// -> `devuelta_a_tienda` ("Recibido en tienda"). Logica de negocio pura (sin HTTP,
// sin Prisma); el borde (Server Action) la traduce al resultado tipado expuesto.

/**
 * Resultado de dominio de la recepcion en origen. Espejo de `RecibirServiceResult`
 * (feature 33) cambiando el alcance de ZONA por el de TIENDA. `unauthenticated` NO
 * vive aqui: lo agrega el borde.
 * - `ok`: transiciono a `devuelta_a_tienda`.
 * - `forbidden`: el actor no es adminTienda.
 * - `tienda_ajena`: la orden existe pero es de OTRA tienda (espejo de `zona_ajena`).
 * - `ya_recibida`: ya estaba en `devuelta_a_tienda` -> idempotente, sin escritura.
 * - `estado_invalido`: no esta en `devolviendo_a_tienda`; lleva el estado actual para
 *   que la UI pueda decirlo.
 * - `no_encontrada`: no existe orden viva con ese `num_guia` (o esta borrada).
 * - `validation_error`: el catalogo no tiene el estado destino (config).
 * - `conflict`: perdio una carrera (el estado cambio entre la lectura y el UPDATE).
 */
export type RecibirEnOrigenServiceResult =
  | { status: "ok"; ordenId: string; estado: "devuelta_a_tienda" }
  | { status: "forbidden" }
  | { status: "tienda_ajena" }
  | { status: "ya_recibida" }
  | { status: "estado_invalido"; estado: string }
  | { status: "no_encontrada" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict" };

export interface IRecepcionOrigenService {
  /**
   * Recibe en la tienda de origen la orden cuyo `num_guia` es el escaneado (el QR
   * codifica `/paquete/<numGuia>`). Transiciona a `devuelta_a_tienda` SOLO si sigue
   * en `devolviendo_a_tienda` y pertenece a la tienda del actor. Idempotente si ya
   * estaba recibida. El alcance por tienda se impone server-side.
   */
  recibirEnOrigen(
    numGuia: number,
    actor: Actor,
  ): Promise<RecibirEnOrigenServiceResult>;
}
