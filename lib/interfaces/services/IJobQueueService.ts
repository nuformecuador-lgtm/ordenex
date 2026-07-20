// Feature 90 (design §4) — contrato del servicio drenador de la cola de jobs. Logica de
// negocio pura (sin HTTP ni Prisma directo): orquesta claim -> handler -> complete /
// backoff / dead-letter / recurrencia. El controller `procesar-jobs` la invoca.
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";

/** Ejecuta la logica de un tipo de job. Lanza si falla (el service traduce a fail/backoff). */
export type JobHandler = (job: JobDTO) => Promise<void>;

/**
 * Metadatos de recurrencia por tipo (solo `liberar_reprogramadas` en v1). Calcula el
 * reencolado de la PROXIMA ocurrencia a partir del momento de la corrida. La idempotencia
 * la garantiza el `dedupeKey` por dia CR + `ON CONFLICT DO NOTHING` del `enqueue` (R25).
 */
export interface RecurrenciaSpec {
  siguiente(now: Date): { runAfter: Date; dedupeKey: string };
}

/**
 * Conteos agregados de una corrida del drenador (R18, gate F1.4-5). SIN PII ni secretos:
 * `procesados` = reclamados; `ok` = completados; `fallidos` = handler lanzo (reintentado o
 * muerto); `reintentados` = re-agendados con backoff; `muertos` = dead-letter (`failed`).
 */
export interface DrenarResult {
  procesados: number;
  ok: number;
  fallidos: number;
  reintentados: number;
  muertos: number;
}

export interface IJobQueueService {
  /**
   * R14-R16/R23-R25: reclama hasta `limit` jobs vencidos y por cada uno ejecuta su handler.
   * Exito -> `complete` (+ re-agenda la proxima ocurrencia si es recurrente, R23). Fallo ->
   * si quedan intentos, backoff `min(cap, base*2^(intentos-1))` (R15); si se agotaron,
   * dead-letter (R16) Y re-agenda la proxima ocurrencia si es recurrente (R24). Devuelve
   * conteos agregados sin PII.
   */
  drenar(limit: number): Promise<DrenarResult>;
}
