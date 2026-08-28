// Feature 321 (T2.2, design §2.1 y §2.5) — contrato del servicio del HISTORICO de
// conversaciones. Logica de negocio pura: no conoce HTTP, ni Next, ni Prisma; se construye con
// un doble del repositorio.
//
// Las DOS operaciones comparten exactamente la misma secuencia:
//   1. `actor` ausente                                   -> `unauthenticated`
//   2. `actor.rol` ∈ ROLES_HISTORICO_CONVERSACIONES       -> si no, `forbidden` (R7/R10), y el
//      repositorio NO se llama (el test lo asserta con `not.toHaveBeenCalled()`)
//   3. delegar al repositorio y proyectar
//
// Ninguna de las dos ESCRIBE (R25). En particular no se toca
// `chat_conversacion.mensajero_leido_at`: leer el histórico no consume los no leidos del
// mensajero, que es de quien es ese contador.
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ListarHilosHistoricoInput,
  ListarHilosHistoricoResult,
  ListarMensajesHistoricoInput,
  ListarMensajesHistoricoResult,
} from "@/lib/types/historico-conversaciones";

export interface IHistoricoConversacionesService {
  /**
   * R10-R15, R33-R36, R41: la pagina de hilos de TODOS los mensajeros —el actor no acota por
   * mensajero asignado—, sin un solo mensaje en la respuesta.
   */
  listarHilos(
    input: ListarHilosHistoricoInput,
    actor: Actor | null,
  ): Promise<ListarHilosHistoricoResult>;

  /**
   * R16-R21, R28, R40, R42: la pagina de mensajes del hilo `(orden, mensajero)` mas su
   * cabecera. NO acepta filtro de fecha (R17): el hilo abierto se lee completo aunque el
   * listado estuviera filtrado por un solo dia; el borde zod rechaza esas claves.
   */
  listarMensajes(
    input: ListarMensajesHistoricoInput,
    actor: Actor | null,
  ): Promise<ListarMensajesHistoricoResult>;
}
