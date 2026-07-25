// Feature 109 — tipos del chat de WhatsApp que cruzan la frontera Server Action <-> UI.
import type { ChatMensajeDireccion, ChatMensajeEstado, ChatMensajeTipo } from "@prisma/client";

/** Una burbuja del hilo tal como la consume la UI del mensajero (R22). */
export interface ChatMensajeVista {
  id: string;
  direccion: ChatMensajeDireccion;
  tipo: ChatMensajeTipo;
  cuerpo: string | null;
  /** Estado de entrega (solo salientes; `null` en entrantes). */
  estado: ChatMensajeEstado | null;
  /**
   * Feature 121 (R8): coordenadas de un mensaje de ubicacion; `null` en todo mensaje que no
   * sea de tipo `ubicacion`. La UI las usa para el minimapa de la burbuja de ubicacion.
   */
  latitud: number | null;
  longitud: number | null;
  /** Instante del evento en ISO 8601 (serializable a la UI). */
  ocurridoAt: string;
}

/** Resultado del envio de un texto libre desde el chat (R17-R21). */
export type EnviarMensajeChatResult =
  | { status: "ok"; mensajeChatId: string }
  | { status: "unauthenticated" }
  | { status: "forbidden" } // la orden no esta asignada a este mensajero (R17)
  | { status: "fuera_ventana" } // R19/D2: fuera de la ventana 24 h -> exige plantilla
  | { status: "no_configurado" } // WhatsApp aun sin credenciales de envio
  | { status: "transitorio"; mensajeChatId: string }; // R21: reintentable, encolado

/**
 * Resultado del envio de una PLANTILLA desde el chat. Sirve dentro Y fuera de la ventana de
 * 24 h, por eso NO tiene `fuera_ventana`. `not_found` = la plantilla no existe o no es enviable
 * (no vigente / sin `template_id`).
 */
export type EnviarPlantillaChatResult =
  | { status: "ok"; mensajeChatId: string }
  | { status: "unauthenticated" }
  | { status: "forbidden" } // la orden no esta asignada a este mensajero
  | { status: "not_found" } // plantilla inexistente o no enviable
  | { status: "no_configurado" } // WhatsApp aun sin credenciales de envio
  | { status: "transitorio"; mensajeChatId: string }; // R21: reintentable, encolado

/** Resultado del listado del hilo de una orden (R16/R22/R24). */
export type ListarHiloChatResult =
  | {
      status: "ok";
      /** True si el ultimo entrante ocurrio hace < 24 h (habilita texto libre, R23). */
      ventanaAbierta: boolean;
      /** Marca del ultimo entrante en ISO, o `null` si no hay ninguno. */
      ultimoEntranteAt: string | null;
      mensajes: ChatMensajeVista[];
    }
  | { status: "unauthenticated" }
  | { status: "forbidden" }; // la orden no esta asignada a este mensajero (R16)
