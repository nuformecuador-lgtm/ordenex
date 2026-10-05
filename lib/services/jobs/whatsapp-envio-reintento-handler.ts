// Ficha 474 (design §4.3, T8.1, R36/R37) — handler de `whatsapp_envio_reintento`: reintenta UNA
// entrega con fallo transitorio de Meta. Reclama igual que el envio original (R37: una entrega
// `en_curso` no se reenvia); un nuevo transitorio la devuelve a `pendiente` y LANZA (backoff de la
// cola); agotados los 5 intentos queda `fallida` con el ultimo motivo y no lanza.
import { z } from "zod";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import type { IEjecucionEnvioService } from "@/lib/interfaces/services/IEjecucionEnvioService";
import { buildEnviosWhatsappDeps } from "@/lib/services/jobs/whatsapp-envio-deps";

const payloadSchema = z.object({ entregaId: z.string().min(1) });

export function crearWhatsappEnvioReintentoHandler(
  buildEjecutor: () => Pick<IEjecucionEnvioService, "reintentar"> = () => buildEnviosWhatsappDeps().ejecutor,
): JobHandler {
  return async (job: JobDTO) => {
    const p = payloadSchema.parse(job.payload);
    await buildEjecutor().reintentar(p.entregaId, { intentos: job.intentos, maxIntentos: job.maxIntentos });
  };
}
