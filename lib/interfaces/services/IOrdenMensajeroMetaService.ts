import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { MarcarLuegoInput, MarcarLuegoResult } from "@/lib/types/orden-mensajero-meta";

// Feature 115 — contrato del servicio de la meta privada del mensajero. Logica de negocio
// pura (sin HTTP ni Prisma): autoriza (rol `mensajero` + propiedad de la orden), fija el
// `usuario_id` con el actor y persiste `marcar_luego`. NO toca estatus/prioridad/ruta ni el
// historial de la orden (R15/R16). El borde (Server Action) traduce el resultado a tipado.
export interface IOrdenMensajeroMetaService {
  /**
   * R5/R6/R8/R11/R12/R13/R14/R15/R16: marca/desmarca una de las ordenes del actor como
   * "gestionar mas tarde". `forbidden` si el rol no es mensajero (R11) o la orden no es del
   * actor (R13); `not_found` si la orden no existe/esta borrada (R14). En `ok` refleja el
   * valor persistido para la pareja `(actor, orden)`.
   */
  marcarGestionarLuego(input: MarcarLuegoInput, actor: Actor): Promise<MarcarLuegoResult>;
}
