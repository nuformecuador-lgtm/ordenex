// Feature 311 — fixture compartido para los tests que construyen un `ChatMensajeDTO` a mano.
//
// La feature añadio NUEVE columnas nullable a `chat_mensaje` (media, reaccion, contactos,
// cambio de numero). Ninguna aplica a un saliente de texto ni a un entrante de la 109/121, pero
// el DTO las declara y TypeScript strict las exige. Repetir nueve `null` en cada literal de cada
// test no prueba nada y hace ilegible el fixture: se centralizan aqui.
//
// Ojo: esto es el valor de "ninguno de los tipos nuevos". Los tests que SI ejercitan un tipo
// nuevo escriben sus campos explicitamente (para eso son el assert).
import type { ChatMensajeCamposMedia } from "@/lib/interfaces/repositories/IChatMensajeRepository";
import type { ChatMensajeVista } from "@/lib/types/chat-whatsapp";

export const SIN_CAMPOS_311: ChatMensajeCamposMedia = {
  mediaId: null,
  mediaMime: null,
  mediaNombre: null,
  mediaTamanoBytes: null,
  reaccionAWaMessageId: null,
  reaccionEmoji: null,
  contactos: null,
  sistemaTelefonoAnterior: null,
  sistemaTelefonoNuevo: null,
};

/**
 * Lo mismo para el contrato hacia la UI (`ChatMensajeVista`): una burbuja de texto o de
 * plantilla no tiene adjunto, ni contactos, ni cambio de numero, ni reacciones.
 */
export const VISTA_SIN_311 = {
  media: null,
  contactos: null,
  sistema: null,
  reacciones: [],
} satisfies Pick<ChatMensajeVista, "media" | "contactos" | "sistema" | "reacciones">;
