// FICHA 454 (design §12.1, T1.5) — handler DELGADO del job `webhook_evento` y su fabrica de
// dependencias reales. Espejo de `webhook-estado-handler.ts`.
//
// NO es recurrente: no se registra en `buildRecurrencias()`. Se encola por EVENTO (un hecho de orden
// con dueño suscrito), nunca por reloj.
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import { WebhookEventoOrdenService } from "@/lib/services/WebhookEventoOrdenService";
import { WebhookEventoReader } from "@/lib/repositories/WebhookEventoReader";
import { WebhookSuscripcionRepository } from "@/lib/repositories/WebhookSuscripcionRepository";
import { WebhookSender } from "@/lib/clients/webhook-sender";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadWebhookConfig, pausaConfigDe } from "@/lib/config/webhook";
import { notificarWebhookSuscripcionPausadaReal } from "@/lib/notificaciones/notificadores";

/** Adapta `WebhookEventoOrdenService.ejecutar` a la firma `JobHandler`. */
export function crearWebhookEventoHandler(service: WebhookEventoOrdenService): JobHandler {
  return async (job: JobDTO) => {
    await service.ejecutar(job);
  };
}

/**
 * Construye el service real. Como el de estado: la config NUNCA lanza si falta la clave de cifrado
 * (el descifrado falla job a job, recuperable) y el 7.º argumento es el aviso REAL de pausa (403) —
 * el default del constructor es el no-op y pasarlo aqui NO es opcional. El `undefined` del 6.º hueco
 * es el logger, escrito a proposito porque los argumentos son posicionales.
 */
export function buildWebhookEventoService(now: () => Date = () => new Date()): WebhookEventoOrdenService {
  const prisma = getPrismaClient();
  const config = loadWebhookConfig();
  return new WebhookEventoOrdenService(
    new WebhookEventoReader(prisma),
    new WebhookSuscripcionRepository(prisma, pausaConfigDe(config), now),
    new WebhookSender({ timeoutMs: config.WEBHOOK_TIMEOUT_MS, now }),
    config,
    now,
    undefined,
    notificarWebhookSuscripcionPausadaReal,
  );
}
