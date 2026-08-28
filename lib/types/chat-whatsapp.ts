// Feature 109 — tipos del chat de WhatsApp que cruzan la frontera Server Action <-> UI.
import type { ChatMensajeDireccion, ChatMensajeEstado, ChatMensajeTipo } from "@prisma/client";
import type { ChatContactoNormalizado } from "@/lib/types/chat-contactos";
import type { ReaccionAgregada } from "@/lib/utils/chat-reacciones";

/**
 * Feature 311 (design §6, R19/R21) — metadatos del adjunto que la UI necesita para decidir COMO
 * pintarlo. NO lleva el media id de Meta A PROPOSITO: la burbuja construye la URL con
 * `/api/chat/media/${mensaje.id}`, que es el id INTERNO que ya tiene. El id de Meta no aparece
 * en ninguna URL, log de acceso ni historial del navegador (R21/R35).
 */
export interface ChatMediaVista {
  mime: string | null;
  /** `filename` del documento; `null` en imagen/audio/video/sticker. */
  nombre: string | null;
  /** Solo si Meta lo mando; normalmente `null` -> la UI no promete un tamaño que no conoce (P2). */
  tamanoBytes: number | null;
}

/** Feature 311 (R9/R32) — evidencia del cambio de numero del cliente, para la burbuja de sistema. */
export interface ChatSistemaVista {
  telefonoAnterior: string | null;
  telefonoNuevo: string | null;
}

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
  /**
   * Feature 311 (R1/R28/R29): presente SOLO en los tipos con adjunto (imagen, audio, video,
   * documento, sticker); `null` en el resto. Que no sea `null` es lo que le dice a la UI que
   * hay algo que pedirle al proxy.
   */
  media: ChatMediaVista | null;
  /** Feature 311 (R7/R31): contactos compartidos; `null` si el mensaje no es de contactos. */
  contactos: ChatContactoNormalizado[] | null;
  /** Feature 311 (R9/R32): numeros del cambio de numero; `null` si no es un mensaje de sistema. */
  sistema: ChatSistemaVista | null;
  /**
   * Feature 311 (R19/R20/R30): reacciones ANCLADAS a esta burbuja. Vacio = sin reacciones. Las
   * reacciones NO llegan nunca como burbuja propia: `listarHiloChat` las agrega aqui (D4).
   */
  reacciones: ReaccionAgregada[];
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
  | { status: "transitorio"; mensajeChatId: string } // R21: reintentable, encolado
  // La Graph API rechazo la peticion (4xx que no es 429): plantilla inexistente, idioma
  // equivocado, parametros que no cuadran, destinatario no permitido. NO se reintenta; el
  // saliente queda `failed` con su motivo. `detalle` lleva el mensaje de Meta, que es
  // accionable y por eso SI se expone a la UI.
  | { status: "permanente"; mensajeChatId: string; detalle: string };

/**
 * Feature 316 (design 5) -- resultado del envio de un ADJUNTO desde el chat. Misma forma que
 * `EnviarMensajeChatResult` mas los desenlaces propios de un adjunto.
 *
 * NO tiene `transitorio` A PROPOSITO (design 4.1): un saliente de adjunto nunca queda `queued`
 * porque el `media_id` caduca en Meta y no hay copia propia del binario para resubirlo. Que el
 * union lo OMITA es lo que impide que el `switch` de la UI prometa un reintento que no existe.
 *
 * Tampoco tiene `no_convertible` (R31), y tambien es deliberado: la normalizacion de la imagen
 * ocurre SOLO en el navegador, asi que ese desenlace no lo puede producir el servidor -al que
 * un HEIC, si llega, le llega como `tipo_no_permitido` (R9)-. Vive como estado del composer,
 * no como `status` de la accion; meterlo aqui seria prometer un caso imposible.
 */
export type EnviarMediaChatResult =
  | { status: "ok"; mensajeChatId: string }
  | { status: "unauthenticated" } // R26: sin sesion, sin subir ni llamar a Meta
  | { status: "forbidden" } // R27: la orden no esta asignada a este mensajero
  | { status: "fuera_ventana" } // R3: fuera de la ventana de 24 h, sin subir nada
  | { status: "no_configurado" } // WhatsApp aun sin credenciales de envio
  | { status: "tipo_no_permitido" } // R9/R11
  // R10/R11: el limite viaja para que el aviso diga CUAL era, en vez de "demasiado grande".
  | { status: "demasiado_grande"; limiteBytes: number }
  | { status: "caption_largo"; maximo: number } // R12
  | { status: "fallo_subida" } // R19: nada enviado, nada persistido; el adjunto sigue elegido
  // R20: se subio pero el envio fallo. El saliente YA quedo `failed` con su motivo y su
  // media id; no hay reintento automatico.
  | { status: "permanente"; mensajeChatId: string; detalle: string };

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
  | { status: "transitorio"; mensajeChatId: string } // R21: reintentable, encolado
  // La Graph API rechazo la peticion (4xx que no es 429): plantilla inexistente, idioma
  // equivocado, parametros que no cuadran, destinatario no permitido. NO se reintenta; el
  // saliente queda `failed` con su motivo. `detalle` lleva el mensaje de Meta, que es
  // accionable y por eso SI se expone a la UI.
  | { status: "permanente"; mensajeChatId: string; detalle: string };

/** Resultado del listado del hilo de una orden (R16/R22/R24). */
export type ListarHiloChatResult =
  | {
      status: "ok";
      /** True si el ultimo entrante ocurrio hace < 24 h (habilita texto libre, R23). */
      ventanaAbierta: boolean;
      /** Marca del ultimo entrante en ISO, o `null` si no hay ninguno. */
      ultimoEntranteAt: string | null;
      /**
       * Ya salio un mensaje HOY (dia calendario de Costa Rica) y el cliente aun no ha
       * respondido hoy -> no se ofrece otra plantilla hasta que conteste.
       *
       * EL "HOY" ES EL PUNTO, y es lo que arregla el bug del chat mudo. Antes esto se
       * derivaba en el componente sobre el hilo ENTERO (`!hayEntrante && haySaliente`), y
       * como el hilo es por `(orden_id, telefono_e164)` y sobrevive a las reasignaciones
       * (`ChatConversacionRepository.upsertParaOrden` solo reescribe `mensajero_id`), un
       * saliente de AYER —una plantilla, o la bienvenida automatica del job
       * `whatsapp_bienvenida`— bloqueaba el chat PARA SIEMPRE: al mensajero que recibia el
       * paquete reasignado al dia siguiente no le dejaba ni mandar plantilla ni escribir.
       * Cada dia arranca como gestion nueva.
       */
      plantillaBloqueada: boolean;
      /**
       * El cliente respondio HOY: solo entonces se acepta texto libre. Es mas estricto que
       * `ventanaAbierta` A PROPOSITO (decision humana): un entrante de ayer a las 23:00 deja
       * la ventana de Meta abierta, pero no reabre la conversacion del dia. El dia empieza
       * siempre por una plantilla, y el texto libre se gana con la respuesta del cliente.
       */
      textoLibreHabilitado: boolean;
      mensajes: ChatMensajeVista[];
    }
  | { status: "unauthenticated" }
  | { status: "forbidden" }; // la orden no esta asignada a este mensajero (R16)

/** Entrantes sin leer de UNA conversacion, tal como los consume el chat del mensajero. */
export interface ChatNoLeidosVista {
  ordenId: string;
  noLeidos: number;
}

/**
 * Resultado del resumen de no leidos del mensajero: una entrada por orden CON entrantes
 * pendientes (las que no aparecen tienen cero). Alimenta el distintivo numerico del boton
 * flotante del chat y el de cada fila de la lista de conversaciones.
 */
export type ResumenNoLeidosChatResult =
  | { status: "ok"; conversaciones: ChatNoLeidosVista[] }
  | { status: "unauthenticated" };

/** Resultado de sellar un hilo como leido. `forbidden` = la orden no es de este mensajero. */
export type MarcarChatLeidoResult =
  | { status: "ok" }
  | { status: "unauthenticated" }
  | { status: "forbidden" };
