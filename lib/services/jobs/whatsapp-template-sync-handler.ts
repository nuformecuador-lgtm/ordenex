// Integracion WhatsApp — handler DELGADO del job `whatsapp_template_sync` y su fabrica de
// dependencias reales. Espejo de `webhook-estado-handler.ts`.
//
// Reintenta contra Meta la operacion (crear/actualizar/eliminar) que fallo en linea. NO es
// recurrente: no se registra en `buildRecurrencias()`. Un fallo se RELANZA para que
// `JobQueueService` aplique el backoff y, agotados los intentos, el dead-letter.
//
// Las deps se construyen PEREZOSAMENTE dentro del handler: `loadWhatsappConfig` lanza si falta
// un env de WhatsApp, y ese fallo debe quedar acotado a ESTE job (recuperable, job a job), sin
// tumbar el drenado que comparte cron con los demas tipos.
import { z } from "zod";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import type { IPlantillaMensajeRepository } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { IWhatsappTemplatePort } from "@/lib/interfaces/services/IWhatsappTemplatePort";
import { aplicarUpsertTemplate } from "@/lib/services/whatsapp/plantilla-whatsapp-sync";
import { WhatsappTemplatePort } from "@/lib/services/whatsapp/WhatsappTemplatePort";
import { WhatsappPlantillasClient } from "@/lib/clients/whatsapp-cloud";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadWhatsappConfig } from "@/lib/config/whatsapp";

const payloadSchema = z.object({
  plantillaId: z.string().min(1),
  operacion: z.enum(["crear", "actualizar", "eliminar"]),
  nombre: z.string().optional(),
});

export interface WhatsappTemplateSyncDeps {
  port: IWhatsappTemplatePort;
  repo: IPlantillaMensajeRepository;
}

/** Construye las deps reales. `loadWhatsappConfig` lanza si falta un env (recuperable job a job). */
export function buildWhatsappTemplateSyncDeps(): WhatsappTemplateSyncDeps {
  const prisma = getPrismaClient();
  const config = loadWhatsappConfig();
  return {
    port: new WhatsappTemplatePort(new WhatsappPlantillasClient({ config }), config),
    repo: new PlantillaMensajeRepository(prisma),
  };
}

/**
 * Handler del job. `buildDeps` inyectable para tests; en produccion construye las deps reales
 * en cada ejecucion (config perezosa). Payload invalido -> lanza (el job muere tras backoff,
 * no se traga en silencio).
 */
export function crearWhatsappTemplateSyncHandler(
  buildDeps: () => WhatsappTemplateSyncDeps = buildWhatsappTemplateSyncDeps,
): JobHandler {
  return async (job: JobDTO) => {
    const payload = payloadSchema.parse(job.payload);
    const { port, repo } = buildDeps();

    if (payload.operacion === "eliminar") {
      // Sin nombre no hay nada que borrar en Meta (el job se da por hecho).
      if (payload.nombre === undefined) return;
      await port.eliminarTemplate(payload.nombre);
      return;
    }

    // crear/actualizar: la plantilla pudo borrarse mientras el job esperaba -> nada que hacer.
    const plantilla = await repo.findById(payload.plantillaId);
    if (plantilla === null) return;
    await aplicarUpsertTemplate(port, repo, plantilla);
  };
}
