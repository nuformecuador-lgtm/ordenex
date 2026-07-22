// Feature 99 (design §7/§8) — handler DELGADO del job `webhook_estado` y su fabrica de
// dependencias reales. Espejo de `geocodificacion-handler.ts`.
//
// Este tipo de job NO es recurrente: no se registra en `buildRecurrencias()`. Se encola por
// EVENTO (cambio de estado de una orden con owner suscrito), no por reloj.
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import { WebhookEstadoService } from "@/lib/services/WebhookEstadoService";
import { WebhookOrdenReader } from "@/lib/repositories/WebhookOrdenReader";
import { WebhookSuscripcionRepository } from "@/lib/repositories/WebhookSuscripcionRepository";
import { WebhookSender } from "@/lib/clients/webhook-sender";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadWebhookConfig } from "@/lib/config/webhook";

/** Adapta `WebhookEstadoService.ejecutar` a la firma `JobHandler`. */
export function crearWebhookEstadoHandler(service: WebhookEstadoService): JobHandler {
  return async (job: JobDTO) => {
    await service.ejecutar(job);
  };
}

/**
 * Construye el service real con sus repos, el cliente HTTP y la config (patron
 * `buildGeocodificacionService`).
 *
 * La config se carga aqui y NUNCA lanza si falta la clave de cifrado (design §2/R28). Sin
 * clave, el descifrado del secreto lanza `WebhookSecretKeyError` recuperable job a job (R32),
 * asi que un despliegue sin `WEBHOOK_SECRET_ENC_KEY` NO tumba el drenado de la cola, que
 * comparte cron con `liberar_reprogramadas` / `geocodificacion` / `optimizacion_ruta`.
 */
export function buildWebhookEstadoService(now: () => Date = () => new Date()): WebhookEstadoService {
  const prisma = getPrismaClient();
  const config = loadWebhookConfig();
  return new WebhookEstadoService(
    new WebhookOrdenReader(prisma),
    new WebhookSuscripcionRepository(prisma),
    new WebhookSender({ timeoutMs: config.WEBHOOK_TIMEOUT_MS }),
    config,
    now,
  );
}
