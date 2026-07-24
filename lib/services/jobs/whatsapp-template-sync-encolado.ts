// Integracion WhatsApp — ENCOLADO del job `whatsapp_template_sync`. Lo usa el propagador
// (`PlantillaWhatsappPropagator`) cuando la operacion sincrona contra Meta falla: encola un
// reintento con `maxIntentos = MAX_INTENTOS_WHATSAPP_TEMPLATE` (5). Sin `dedupeKey`: cada
// fallo es un evento puntual (el handler es idempotente), no hay recurrencia que deduplicar.
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import { MAX_INTENTOS_WHATSAPP_TEMPLATE } from "@/lib/config/whatsapp";
import type {
  EncolarWhatsappTemplateSync,
  WhatsappTemplateSyncPayload,
} from "@/lib/services/whatsapp/plantilla-whatsapp-sync";

/** Fabrica el encolador real sobre `IJobRepository.enqueue`. */
export function crearEncolarWhatsappTemplateSync(
  jobRepo: IJobRepository,
): EncolarWhatsappTemplateSync {
  return async (payload: WhatsappTemplateSyncPayload, lastError?: string) => {
    const record: Record<string, unknown> = {
      plantillaId: payload.plantillaId,
      operacion: payload.operacion,
      ...(payload.nombre !== undefined ? { nombre: payload.nombre } : {}),
    };
    await jobRepo.enqueue("whatsapp_template_sync", record, {
      maxIntentos: MAX_INTENTOS_WHATSAPP_TEMPLATE,
      lastError, // motivo del fallo sincrono -> visible en `last_error` desde el encolado
    });
  };
}
