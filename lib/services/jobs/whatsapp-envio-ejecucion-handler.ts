// Ficha 474 (design §4.2, T8.1) — handler de `whatsapp_envio_ejecucion`: ejecuta UNA ejecucion de
// origen `evento` ya creada. Idempotente: un estado terminal no hace nada (§4.3 paso 1).
import { z } from "zod";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import type { IEjecucionEnvioService } from "@/lib/interfaces/services/IEjecucionEnvioService";
import { buildEnviosWhatsappDeps } from "@/lib/services/jobs/whatsapp-envio-deps";

const payloadSchema = z.object({ ejecucionId: z.string().min(1) });

export function crearWhatsappEnvioEjecucionHandler(
  buildEjecutor: () => Pick<IEjecucionEnvioService, "ejecutar"> = () => buildEnviosWhatsappDeps().ejecutor,
): JobHandler {
  return async (job: JobDTO) => {
    const p = payloadSchema.parse(job.payload);
    await buildEjecutor().ejecutar(p.ejecucionId);
  };
}
