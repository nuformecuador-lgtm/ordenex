// FICHA 410 (design §7, T3.8) — handler DELGADO del job `push_web` y su fabrica de dependencias
// reales. Espejo de `webhook-estado-handler.ts`.
//
// Este tipo de job NO es recurrente: no se registra en `buildRecurrencias()`. Se encola por EVENTO
// —la creacion de un aviso elegible, desde el decorador del repositorio de notificaciones—, nunca
// por reloj. Re-agendarlo mandaria un push por minuto a la misma persona.
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import type { IPushWebService } from "@/lib/interfaces/services/IPushWebService";
import { PushWebService } from "@/lib/services/PushWebService";
import { PushNotificacionReader } from "@/lib/repositories/PushNotificacionReader";
import { PushSuscripcionRepository } from "@/lib/repositories/PushSuscripcionRepository";
import { AvisoAgregadoRepository } from "@/lib/repositories/AvisoAgregadoRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { VigenciaAvisoAgregadoService } from "@/lib/services/VigenciaAvisoAgregadoService";
import { WebPushSender } from "@/lib/push/web-push-sender";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { avisosDiariosConfig } from "@/lib/config/avisos-diarios";
import { loadPushConfig, piezasVapidAusentes, pushConfigurado } from "@/lib/config/push";

/** Adapta `PushWebService.ejecutar` a la firma `JobHandler`. */
export function crearPushWebHandler(service: IPushWebService): JobHandler {
  return async (job: JobDTO) => {
    await service.ejecutar(job);
  };
}

/**
 * Construye el service real con sus repositorios, su emisor y el resolutor de la cifra viva.
 *
 * ⚠️ NO LANZA SI FALTAN LAS CLAVES VAPID (R30). `pushConfigurado()` decide si se instancia el
 * emisor real o si el service recibe `null`; con `null` el trabajo TERMINA dejando constancia del
 * NOMBRE de la variable ausente. Un `loadPushConfig()` a secas aqui reventaria la construccion del
 * registro de handlers y se llevaria por delante el drenado de los otros nueve tipos, que comparten
 * este cron. Es la leccion de la ficha 400 y el mismo patron que `buildWebhookEstadoService`.
 *
 * ⚠️ EL RESOLUTOR DE LA CIFRA VIVA ES OBLIGATORIO Y VA AQUI. Sin el, los dos avisos AGREGADOS
 * saldrian sin numero («La mas antigua lleva 3 dias...») en vez de con el titulo que el diseno
 * aprobo («5 novedades esperan tu decision»), y ademas dejarian de apagarse solos cuando la cifra
 * llega a cero. El constructor lo exige: no hay default no-op que lo esconda.
 */
export function buildPushWebService(now: () => Date = () => new Date()): IPushWebService {
  const prisma = getPrismaClient();
  return new PushWebService({
    lector: new PushNotificacionReader(prisma),
    canal: new PushSuscripcionRepository(prisma),
    sender: pushConfigurado() ? new WebPushSender(loadPushConfig()) : null,
    vigencia: new VigenciaAvisoAgregadoService(
      new AvisoAgregadoRepository(prisma, new OrdenRepository(prisma)),
      // R53 de la 409: el MISMO umbral que aplica el cron de avisos diarios. Si el push contara
      // con otro, el numero del telefono y el de la pantalla dirian cosas distintas.
      avisosDiariosConfig.DIAS_REPRESAMIENTO,
      now,
    ),
    now,
    piezasAusentes: piezasVapidAusentes,
  });
}
