// Feature 109 (design §2.2/F3, D1/R21) — ENCOLADO del job `whatsapp_chat_envio`. Lo usa el
// `ChatWhatsappService` cuando el envio saliente en linea devuelve `transitorio`: encola un
// reintento del saliente ya persistido como `queued`, identificado por su id de chat.
//
// `dedupeKey = whatsapp_chat_envio:<mensajeChatId>`: el reintento de un mismo saliente es
// idempotente (ON CONFLICT DO NOTHING); un segundo `transitorio` del mismo mensaje no
// duplica el job.
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";

/** Payload del job: el id del mensaje de chat `queued` a reintentar. */
export interface WhatsappChatEnvioPayload {
  mensajeChatId: string;
}

/** Fabrica el encolador real sobre `IJobRepository.enqueue`. */
export function crearEncolarReintentoChatEnvio(
  jobRepo: IJobRepository,
): (mensajeChatId: string) => Promise<void> {
  return async (mensajeChatId: string) => {
    await jobRepo.enqueue(
      "whatsapp_chat_envio",
      { mensajeChatId } satisfies WhatsappChatEnvioPayload,
      { dedupeKey: `whatsapp_chat_envio:${mensajeChatId}` },
    );
  };
}
