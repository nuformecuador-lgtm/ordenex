// Ficha 474 (design §1.6/§4.1/§5.3, T8.1, R25/R44) — handler RECURRENTE `whatsapp_envio_mantenimiento`,
// diario a las 03:30 CR (09:30 UTC). Dos tareas:
//   - R44: purga POR BASE los PDFs caducados (hasta 500 por corrida): borra los objetos del bucket y
//     marca `pdf_purgado_at`, para que el historial muestre «caducado»;
//   - R25: re-siembra la cadena de todo envio ENCENDIDO a hora fija que no tenga ningun job
//     programado pendiente.
// La primera fila la siembra la migracion `20261005120200_seed_whatsapp_envio_mantenimiento`; la
// `RecurrenciaSpec` de abajo re-encola la siguiente con la MISMA forma de `dedupe_key`.
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobHandler, RecurrenciaSpec } from "@/lib/interfaces/services/IJobQueueService";
import type { IWhatsappEnvioRepository } from "@/lib/interfaces/repositories/IWhatsappEnvioRepository";
import type { IWhatsappEjecucionRepository } from "@/lib/interfaces/repositories/IWhatsappEjecucionRepository";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { IAlmacenEnviosWhatsapp } from "@/lib/interfaces/external/IAlmacenEnviosWhatsapp";
import { encolarProximaOcurrencia } from "@/lib/whatsapp-envios/encolar";
import { LOTE_PURGA } from "@/lib/config/whatsapp-envios";
import { buildEnviosWhatsappDeps } from "@/lib/services/jobs/whatsapp-envio-deps";

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/** `whatsapp_envio_mantenimiento:<YYYY-MM-DD>` del dia de la corrida (09:30 UTC = 03:30 CR, mismo dia). */
export function dedupeKeyMantenimiento(runAfter: Date): string {
  return `whatsapp_envio_mantenimiento:${runAfter.toISOString().slice(0, 10)}`;
}

/** Proxima 09:30 UTC ESTRICTAMENTE posterior a `now`. */
export function proximaCorridaMantenimiento(now: Date): Date {
  const hoy = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9, 30, 0, 0));
  return hoy.getTime() > now.getTime() ? hoy : new Date(hoy.getTime() + UN_DIA_MS);
}

export const recurrenciaWhatsappEnvioMantenimiento: RecurrenciaSpec = {
  siguiente(now: Date) {
    const runAfter = proximaCorridaMantenimiento(now);
    return { runAfter, dedupeKey: dedupeKeyMantenimiento(runAfter) };
  },
};

export interface MantenimientoDeps {
  envios: Pick<IWhatsappEnvioRepository, "encendidosHoraFijaSinJobPendiente">;
  ejecuciones: Pick<IWhatsappEjecucionRepository, "seleccionarPurga" | "marcarPurgadas">;
  almacen: Pick<IAlmacenEnviosWhatsapp, "borrar">;
  cola: Pick<IJobRepository, "enqueue">;
  now: () => Date;
  logger?: { info(m: string): void };
}

export function crearWhatsappEnvioMantenimientoHandler(
  buildDeps: () => MantenimientoDeps = () => {
    const d = buildEnviosWhatsappDeps();
    return { envios: d.envios, ejecuciones: d.ejecuciones, almacen: d.almacen, cola: d.cola, now: () => new Date() };
  },
): JobHandler {
  return async (_job: JobDTO) => {
    const deps = buildDeps();
    const now = deps.now();

    // R25 primero: la re-siembra no puede quedar bloqueada por un fallo de Storage.
    const rotos = await deps.envios.encendidosHoraFijaSinJobPendiente();
    for (const e of rotos) await encolarProximaOcurrencia(deps.cola, e, now);

    // R44: purga por base. Un fallo de Storage LANZA (la cola lo registra y reintenta): una purga
    // muda dejaria crecer el bucket sin ninguna señal.
    const caducados = await deps.ejecuciones.seleccionarPurga(now, LOTE_PURGA);
    if (caducados.length > 0) {
      await deps.almacen.borrar(caducados.map((c) => c.pdfRuta));
      await deps.ejecuciones.marcarPurgadas(caducados.map((c) => c.id), now);
    }
    (deps.logger ?? { info: (m: string) => console.log(m) }).info(
      JSON.stringify({ op: "whatsapp_envio_mantenimiento", resembrados: rotos.length, purgados: caducados.length }),
    );
  };
}
