// Feature 90 (design §5, R22-R24) — handler DELGADO del job recurrente
// `liberar_reprogramadas` + su registro de recurrencia. NO reescribe la logica de
// liberacion: delega TODO en `LiberacionReprogramadaService.ejecutarLiberacion(...)`
// (feature 46), que ya es idempotente por dia CR (seguro ante re-claim por visibility
// timeout o reintento). El horario PRESERVA 00:00 America/Costa_Rica (= 06:00 UTC),
// decision del gate F1.4-1.
import type { ILiberacionReprogramadaService } from "@/lib/interfaces/services/ILiberacionReprogramadaService";
import { LiberacionReprogramadaService } from "@/lib/services/LiberacionReprogramadaService";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { startOfDayCR, fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import type { JobHandler, RecurrenciaSpec } from "@/lib/interfaces/services/IJobQueueService";

/** Prefijo del `dedupe_key` de la recurrencia diaria: `liberar_reprogramadas:<YYYY-MM-DD CR>`. */
export const DEDUPE_PREFIX = "liberar_reprogramadas";

// CR es UTC-6 fijo (sin horario de verano): 00:00 CR == 06:00 UTC.
const CR_MEDIANOCHE_HORA_UTC = 6;
const CR_OFFSET_MS = 6 * 60 * 60 * 1000;

/**
 * `dedupe_key` de la corrida cuya fecha CALENDARIO de CR corresponde a `instante`.
 * Idempotencia por dia (R25/R26): dos siembras/reencolados del mismo dia CR colisionan.
 */
export function dedupeKeyLiberar(instante: Date): string {
  return `${DEDUPE_PREFIX}:${fechaCalendarioCR(instante)}`;
}

/**
 * Proxima corrida = proximo 00:00 America/Costa_Rica ESTRICTAMENTE posterior a `now`
 * (gate F1.4-1: se preserva 00:00 CR, no se mueve a 01:00). 00:00 CR del dia D+1 es el
 * instante UTC `D+1 06:00`. Se deriva la fecha calendario CR de `now` y se avanza un dia.
 */
export function proximaCorridaLiberarCR(now: Date): Date {
  const crWall = new Date(now.getTime() - CR_OFFSET_MS);
  return new Date(
    Date.UTC(
      crWall.getUTCFullYear(),
      crWall.getUTCMonth(),
      crWall.getUTCDate() + 1,
      CR_MEDIANOCHE_HORA_UTC,
      0,
      0,
      0,
    ),
  );
}

/**
 * R23/R24: registro de recurrencia del tipo `liberar_reprogramadas`. La proxima ocurrencia
 * se agenda a las 00:00 CR del dia siguiente con `dedupe_key` de ESA fecha CR.
 */
export const recurrenciaLiberarReprogramadas: RecurrenciaSpec = {
  siguiente(now: Date) {
    const runAfter = proximaCorridaLiberarCR(now);
    return { runAfter, dedupeKey: dedupeKeyLiberar(runAfter) };
  },
};

/**
 * R22: handler delgado. Ejecuta la liberacion para "hoy" en CR (`startOfDayCR(now)`);
 * descarta el resultado (los conteos ya los observa la propia corrida via el service). El
 * `now` es inyectable para tests deterministas.
 */
export function crearLiberarReprogramadasHandler(
  service: ILiberacionReprogramadaService,
  now: () => Date = () => new Date(),
): JobHandler {
  return async () => {
    await service.ejecutarLiberacion(startOfDayCR(now()));
  };
}

/** Construye el `LiberacionReprogramadaService` real con sus repos (patron de la ruta 46). */
export function buildLiberarReprogramadasService(): ILiberacionReprogramadaService {
  const prisma = getPrismaClient();
  return new LiberacionReprogramadaService(
    new LiberacionReprogramadaRepository(prisma),
    new ZonaRepository(prisma),
    new OrdenRepository(prisma),
  );
}
