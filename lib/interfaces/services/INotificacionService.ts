import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CargaTerminadaInput,
  ListarNotificacionesServiceResult,
  MarcarNotificacionServiceResult,
  MarcarTodasServiceResult,
  NotificarCargaServiceResult,
} from "@/lib/types/notificacion";

// Feature 146 (design §2/§3) — contrato del servicio de notificaciones. Devuelve resultados
// de DOMINIO (sin HTTP): el borde (Server Action) los traduce al contrato tipado que consume
// la campana.

export interface INotificacionService {
  /** R28/R29/R30: listado visible del actor, en ventana, ordenado, con `read` y `noLeidas`. */
  listar(actor: Actor): Promise<ListarNotificacionesServiceResult>;

  /** R31/R35/R37: registra la lectura del actor si la notificacion le es visible. */
  marcarLeida(id: string, actor: Actor): Promise<MarcarNotificacionServiceResult>;

  /** R32: marca todas las visibles y no descartadas del actor; el contador queda en cero. */
  marcarTodasLeidas(actor: Actor): Promise<MarcarTodasServiceResult>;

  /** R33/R35/R37: descarta POR USUARIO, sin borrar la fila ni afectar a otros destinatarios. */
  descartar(id: string, actor: Actor): Promise<MarcarNotificacionServiceResult>;

  /**
   * R22/R39: aviso de "carga masiva terminada" por la via UI. El destinatario es SIEMPRE el
   * actor —el cliente no puede designarlo— y la idempotencia va por `loteId` (design §3.6).
   */
  notificarCargaTerminada(
    input: CargaTerminadaInput,
    actor: Actor,
  ): Promise<NotificarCargaServiceResult>;
}
