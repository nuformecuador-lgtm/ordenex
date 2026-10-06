// Ficha 474 (design §4.1, T8.1, R19-R24) — handler de `whatsapp_envio_programado`: UNA ocurrencia
// a hora fija de un envio. La programacion es una CADENA por envio: cada job encola el siguiente.
//
// El ORDEN importa (design §4.1):
//   1. lee el envio (incluidos borrados): borrado, apagado o ya no `hora_fija` -> nada (R19/R21);
//   2. encola la SIGUIENTE ocurrencia ANTES de ejecutar (desde max(now, instante de este job)): un
//      fallo terminal de esta no rompe la cadena;
//   3. (fecha, hora) del payload ya no coincide con la programacion vigente -> job obsoleto, nada;
//   4. arranca mas tarde que instante + ventana -> ejecucion `omitida` con el retraso (R24);
//   5. INSERT idempotente de la ejecucion (R23) y la ejecuta. Dos jobs del mismo dia acaban en la
//      MISMA fila.
import { z } from "zod";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler } from "@/lib/interfaces/services/IJobQueueService";
import type { IWhatsappEnvioRepository } from "@/lib/interfaces/repositories/IWhatsappEnvioRepository";
import type { IWhatsappEjecucionRepository } from "@/lib/interfaces/repositories/IWhatsappEjecucionRepository";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { IEjecucionEnvioService } from "@/lib/interfaces/services/IEjecucionEnvioService";
import { encolarProximaOcurrencia } from "@/lib/whatsapp-envios/encolar";
import { diaIsoDe, instanteDe } from "@/lib/whatsapp-envios/proxima-ocurrencia";
import { ventanaMinutos } from "@/lib/config/whatsapp-envios";
import { buildEnviosWhatsappDeps } from "@/lib/services/jobs/whatsapp-envio-deps";

const payloadSchema = z.object({
  envioId: z.string().min(1),
  fechaCr: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
});

export interface ProgramadoDeps {
  envios: Pick<IWhatsappEnvioRepository, "obtener">;
  ejecuciones: Pick<IWhatsappEjecucionRepository, "insertarProgramada">;
  cola: Pick<IJobRepository, "enqueue">;
  ejecutor: Pick<IEjecucionEnvioService, "ejecutar">;
  now: () => Date;
  ventanaMin?: () => number;
}

export function crearWhatsappEnvioProgramadoHandler(
  buildDeps: () => ProgramadoDeps = () => {
    const d = buildEnviosWhatsappDeps();
    return { envios: d.envios, ejecuciones: d.ejecuciones, cola: d.cola, ejecutor: d.ejecutor, now: () => new Date() };
  },
): JobHandler {
  return async (job: JobDTO) => {
    const p = payloadSchema.parse(job.payload);
    const deps = buildDeps();
    const envio = await deps.envios.obtener(p.envioId, { incluirBorrados: true });
    // 1. R19/R21.
    if (envio === null || envio.deletedAt !== null || !envio.encendido || envio.disparo !== "hora_fija" || envio.hora === null) {
      return;
    }
    const now = deps.now();
    const instante = instanteDe(p.fechaCr, p.hora);
    // 2. La cadena sigue aunque esta ocurrencia falle.
    const desde = new Date(Math.max(now.getTime(), instante.getTime()));
    await encolarProximaOcurrencia(deps.cola, { id: envio.id, diasSemana: envio.diasSemana, hora: envio.hora }, desde);
    // 3. Obsoleto (R20): la ocurrencia valida tiene su propio job.
    if (p.hora !== envio.hora || !envio.diasSemana.includes(diaIsoDe(p.fechaCr))) return;
    // 4. R24.
    const ventana = (deps.ventanaMin ?? ventanaMinutos)();
    const retrasoMin = Math.floor((now.getTime() - instante.getTime()) / 60_000);
    if (now.getTime() > instante.getTime() + ventana * 60_000) {
      await deps.ejecuciones.insertarProgramada({
        envioId: envio.id,
        fechaCr: p.fechaCr,
        instanteProgramado: instante,
        estado: "omitida",
        motivo: `La cola arrancó ${retrasoMin} min tarde (tolerancia ${ventana} min).`,
      });
      return;
    }
    // 5. R23.
    const ej = await deps.ejecuciones.insertarProgramada({ envioId: envio.id, fechaCr: p.fechaCr, instanteProgramado: instante });
    await deps.ejecutor.ejecutar(ej.id);
  };
}
