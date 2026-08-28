// Feature 318 (T2.2, design §2.1 y §2.5) — contrato del repositorio del HISTORICO de
// conversaciones. Solo queries (`docs/architecture.md`): la autorizacion por rol vive en
// `HistoricoConversacionesService`, no aqui. La interfaz NO expone `PrismaClient`.
//
// LA DIFERENCIA DELIBERADA CON EL CHAT DEL MENSAJERO, escrita para que nadie la lea como un
// descuido: `ChatConversacionRepository.findByOrdenParaMensajero` lleva el `mensajeroId` de la
// SESION en el `WHERE` —ahi es una restriccion de seguridad y no se toca (R26)—. Aqui el
// `mensajeroId` es PARTE DE LA CLAVE DEL HILO (R42): identifica cual de las conversaciones de
// esa orden se esta leyendo, no quien la lee. Por eso estos metodos NO reciben ningun scope de
// sesion: si lo recibieran, el histórico no podria cumplir R10 (ver hilos de otros).
//
// Ninguno de estos metodos escribe. R25 es explicito con `chat_conversacion.mensajero_leido_at`:
// abrir un hilo desde el histórico NO marca nada como leido.
import type {
  CursorHilo,
  CursorMensaje,
  FiltroHilosHistorico,
  HiloHistoricoDTO,
} from "@/lib/types/historico-conversaciones";
import type { ChatMensajeVista } from "@/lib/types/chat-whatsapp";

/** Entrada YA VALIDADA del listado: el borde zod corre antes, en la Server Action. */
export interface ListarHilosQuery {
  filtro: FiltroHilosHistorico;
  /** `null` = primera pagina. Nunca hay `OFFSET` (R13, A4). */
  cursor: CursorHilo | null;
  /** Numero de hilos pedidos. El repositorio pide `limite + 1` para saber si hay siguiente. */
  limite: number;
}

/** Pagina del listado. `siguiente` es `null` cuando no queda nada mas que recorrer. */
export interface ListarHilosPagina {
  items: HiloHistoricoDTO[];
  siguiente: CursorHilo | null;
}

/** Entrada YA VALIDADA de la pagina del hilo. Sin fechas a proposito (R17). */
export interface ListarMensajesQuery {
  ordenId: string;
  mensajeroId: string;
  /** `null` = pagina MAS RECIENTE (R21); se pagina hacia atras. */
  cursor: CursorMensaje | null;
  limite: number;
}

/**
 * Pagina del hilo. `mensajes` viene ya en orden cronologico ASCENDENTE y con las reacciones
 * ANCLADAS a su burbuja (R28): la consulta que las trae mira todas las conversaciones del
 * grupo y no solo la ventana de la pagina, porque una reaccion puede caer en otra pagina —o en
 * otra fila— que su objetivo (design §2.3).
 */
export interface ListarMensajesPagina {
  mensajes: ChatMensajeVista[];
  /** `null` = no hay mas mensajes hacia atras. */
  anterior: CursorMensaje | null;
}

export interface IHistoricoConversacionesRepository {
  /**
   * R10-R15, R33-R36, R42-R44: una pagina de hilos, agrupados por `(orden_id, mensajero_id)` y
   * ordenados por ultima actividad descendente con `(ordenId, mensajeroId)` como desempate
   * determinista. Excluye las ordenes borradas logicamente (R12) y NO devuelve ni un mensaje
   * (R41: `HiloHistoricoDTO` no tiene donde ponerlos).
   */
  listarHilos(query: ListarHilosQuery): Promise<ListarHilosPagina>;

  /**
   * R16-R21, R28, R40, R42: una pagina de mensajes del hilo `(orden, mensajero)`, fusionando
   * TODAS las filas de `chat_conversacion` del grupo en una sola secuencia por
   * `(ocurrido_at, id)`. Entrantes y salientes entrelazados; nunca se ordena por direccion.
   */
  listarMensajes(query: ListarMensajesQuery): Promise<ListarMensajesPagina>;

  /**
   * R43: la cabecera del hilo `(orden, mensajero)` — la MISMA proyeccion que una fila del
   * listado, para que la pantalla no tenga dos formas de decir lo mismo. `null` si el par no
   * existe o su orden esta borrada (R12), que es lo que el service traduce a `not_found`.
   */
  obtenerCabecera(ordenId: string, mensajeroId: string): Promise<HiloHistoricoDTO | null>;
}
