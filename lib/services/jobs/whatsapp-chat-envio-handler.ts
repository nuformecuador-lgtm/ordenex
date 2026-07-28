// Feature 109 (design §2.2/F3, D1/R21) — handler DELGADO del job `whatsapp_chat_envio` y su
// fabrica de dependencias reales. Espejo de `whatsapp-template-sync-handler.ts`.
//
// Reintenta el envio de un saliente `queued` cuyo envio en linea devolvio `transitorio`. NO
// es recurrente: no se registra en `buildRecurrencias()`. Un fallo se RELANZA (desde
// `reintentarEnvio`) para que `JobQueueService` aplique backoff y, agotados los intentos, el
// dead-letter. Las deps (config de WhatsApp) se cargan PEREZOSAMENTE: un env ausente falla
// ESTE job (recuperable job a job), no el drenado de los demas tipos.
import { z } from "zod";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import { ChatWhatsappService } from "@/lib/services/ChatWhatsappService";
import { ChatConversacionRepository } from "@/lib/repositories/ChatConversacionRepository";
import { ChatMensajeRepository } from "@/lib/repositories/ChatMensajeRepository";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
import { OrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";
import { WhatsappCloudClient } from "@/lib/clients/whatsapp-cloud";
import { loadWhatsappConfig } from "@/lib/config/whatsapp";
import { consoleLogger } from "@/lib/services/whatsapp/chat-logger";
import { getPrismaClient } from "@/lib/db/prisma-client";

const payloadSchema = z.object({
  mensajeChatId: z.string().min(1),
});

/** Construye el service real. `loadWhatsappConfig` lanza si falta un env (recuperable). */
export function buildWhatsappChatEnvioService(): ChatWhatsappService {
  const prisma = getPrismaClient();
  const config = loadWhatsappConfig();
  return new ChatWhatsappService({
    conversacionRepo: new ChatConversacionRepository(prisma),
    mensajeRepo: new ChatMensajeRepository(prisma),
    client: new WhatsappCloudClient({ config, logger: consoleLogger }),
    // Necesarios para reenviar un saliente `tipo=plantilla` COMO plantilla (misma cadena de
    // resolucion que `EnvioPlantillaWhatsappService`). Sin ellos el reintento de una plantilla
    // lanza en vez de degradarla a texto libre.
    plantillaRepo: new PlantillaMensajeRepository(prisma),
    ordenReader: new OrdenEnvioReader(prisma),
    idiomaPorDefecto: config.templateIdioma,
    logger: consoleLogger,
  });
}

/**
 * Handler del job. `buildService` inyectable para tests; en produccion construye el service
 * real en cada ejecucion (config perezosa). Payload invalido -> lanza (el job muere tras
 * backoff, no se traga en silencio).
 */
export function crearWhatsappChatEnvioHandler(
  buildService: () => ChatWhatsappService = buildWhatsappChatEnvioService,
): JobHandler {
  return async (job: JobDTO) => {
    const payload = payloadSchema.parse(job.payload);
    const service = buildService();
    await service.reintentarEnvio(payload.mensajeChatId);
  };
}
