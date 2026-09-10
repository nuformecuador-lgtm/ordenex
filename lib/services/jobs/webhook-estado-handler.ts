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
import { loadWebhookConfig, pausaConfigDe } from "@/lib/config/webhook";
import { notificarWebhookSuscripcionPausadaReal } from "@/lib/notificaciones/notificadores";

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
 *
 * ⚠️ FICHA 403 — EL 7º ARGUMENTO ES EL AVISO, Y NO ES DECORATIVO. El default del constructor de
 * `WebhookEstadoService` es el NO-OP, asi que si esta llamada dejara de pasar
 * `notificarWebhookSuscripcionPausadaReal`, el aviso no se emitiria JAMAS en produccion con la
 * suite entera en verde. Es exactamente lo que le paso a `corte-diario/route.ts` (feature 271):
 * pasaba CINCO argumentos y el notificador era el septimo. Hay una guardia que afirma sobre esta
 * LINEA, no solo sobre el import, en `notificacion-notificadores-reales.test.ts`.
 *
 * El `undefined` del 6º hueco es el LOGGER, que sigue cayendo a su default. Va escrito y no
 * omitido porque los argumentos son posicionales: es el hueco por el que aquel fallo se coló.
 */
export function buildWebhookEstadoService(now: () => Date = () => new Date()): WebhookEstadoService {
  const prisma = getPrismaClient();
  const config = loadWebhookConfig();
  return new WebhookEstadoService(
    new WebhookOrdenReader(prisma),
    // FICHA 403: el repositorio recibe el MISMO umbral y el MISMO reloj que el service, para que
    // lo que decide el espaciado y lo que lee la pantalla no puedan salir de sitios distintos.
    new WebhookSuscripcionRepository(prisma, pausaConfigDe(config), now),
    new WebhookSender({ timeoutMs: config.WEBHOOK_TIMEOUT_MS, now }),
    config,
    now,
    undefined,
    notificarWebhookSuscripcionPausadaReal,
  );
}
