// Ficha 474 (design §4.2, T8.1, R19/R26/R27) — handler de `whatsapp_envio_evento`: UN aviso interno
// puenteado. Lee los envios encendidos con ese evento EN ESTE MOMENTO (R19: uno apagado entre el
// aviso y el drenado no envia) y crea UNA ejecucion por envio con `ON CONFLICT DO NOTHING` (R27).
// Solo si la inserto encola su ejecucion aparte: un envio con 50 destinatarios no retiene a los
// demas del lote del drenador.
import { z } from "zod";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import type { IWhatsappEnvioRepository } from "@/lib/interfaces/repositories/IWhatsappEnvioRepository";
import type { IWhatsappEjecucionRepository } from "@/lib/interfaces/repositories/IWhatsappEjecucionRepository";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import { dedupeKeyEjecucion, MAX_INTENTOS_EJECUCION } from "@/lib/whatsapp-envios/encolar";
import { buildEnviosWhatsappDeps } from "@/lib/services/jobs/whatsapp-envio-deps";

const payloadSchema = z.object({
  evento: z.string().min(1),
  referencia: z.string().min(1),
  notificacionId: z.string().min(1).nullable().default(null),
  datos: z.object({
    texto: z.string(),
    rolFila: z.enum(["maestro", "admin", "mensajero", "adminTienda", "adminSatelite", "apiKey"]),
    creadoAt: z.string(),
  }),
});

export interface EventoDeps {
  envios: Pick<IWhatsappEnvioRepository, "encendidosConEvento">;
  ejecuciones: Pick<IWhatsappEjecucionRepository, "insertarEvento">;
  cola: Pick<IJobRepository, "enqueue">;
}

export function crearWhatsappEnvioEventoHandler(
  buildDeps: () => EventoDeps = () => {
    const d = buildEnviosWhatsappDeps();
    return { envios: d.envios, ejecuciones: d.ejecuciones, cola: d.cola };
  },
): JobHandler {
  return async (job: JobDTO) => {
    const p = payloadSchema.parse(job.payload);
    const deps = buildDeps();
    for (const envioId of await deps.envios.encendidosConEvento(p.evento)) {
      const ej = await deps.ejecuciones.insertarEvento({
        envioId,
        eventoClave: p.evento,
        eventoReferencia: p.referencia,
        eventoDatos: p.datos,
        notificacionId: p.notificacionId,
      });
      if (!ej.creada) continue; // R27: ya existia para (envio, evento, entidad)
      await deps.cola.enqueue("whatsapp_envio_ejecucion", { ejecucionId: ej.id }, {
        dedupeKey: dedupeKeyEjecucion(ej.id),
        maxIntentos: MAX_INTENTOS_EJECUCION,
      });
    }
  };
}
