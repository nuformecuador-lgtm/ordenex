import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiOrdenCancelacionDTO } from "@/lib/types/api-orden";

// Feature 106 (design §4) — contrato del service de CANCELACION del canal integrador. Resuelve
// el `estatusId` de `devuelta_origen` del catalogo y traduce la union del repo a resultado de
// dominio (sin HTTP). El owner es SIEMPRE `actor.usuarioId` (R4).

/**
 * Resultado de dominio de la cancelacion:
 *   - `ok`        -> transiciono a `devuelta_origen` (R19); `data` lleva estado anterior/nuevo.
 *   - `not_found` -> no existe / borrada / de otro owner (R23/R24).
 *   - `conflict`  -> estado actual no cancelable (incl. ya `devuelta_origen`) (R20).
 */
export type ApiOrdenCancelacionResult =
  | { status: "ok"; data: ApiOrdenCancelacionDTO }
  | { status: "not_found" }
  | { status: "conflict" };

export interface IApiOrdenCancelacionService {
  /**
   * R19-R26: cancela la orden `numGuia` del owner. Resuelve `devuelta_origen` -> `estatusId` y
   * delega en el repo (transaccion atomica con `appendCambioEstado` + `motivo`). Traduce la union
   * del repo al resultado de dominio.
   */
  cancelar(actor: Actor, numGuia: number): Promise<ApiOrdenCancelacionResult>;
}
