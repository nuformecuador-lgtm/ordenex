// FICHA 454 (design §12.1, T1.5; R33) — ENCOLADO del job `webhook_evento`: la entrega de UN hecho
// de orden (`orden_evento`) a la suscripcion de webhook del dueño de la orden.
//
// Mismo patron TRANSACTIONAL OUTBOX que `webhook_estado` (`webhook-estado-encolado.ts`): el job se
// inserta DENTRO de la transaccion que escribe el hecho. Si esa transaccion revierte, el job
// desaparece con ella: no hay hecho sin su job ni job sin su hecho.
//
// Payload MINIMO `{ ordenEventoId }`: sin datos personales (R33). El handler arma el cuerpo al
// ENTREGAR leyendo el evento (`WebhookEventoOrdenService`).
import type {
  IJobRepository,
  JobTxClient,
} from "@/lib/interfaces/repositories/IJobRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { MAX_INTENTOS_WEBHOOK } from "@/lib/services/jobs/webhook-estado-encolado";

/** Prefijo del `dedupe_key` (patron `DEDUPE_PREFIX` de `webhook_estado`). */
export const DEDUPE_PREFIX_EVENTO = "webhook_evento";

/**
 * Clave de idempotencia: UN hecho, UN job. A diferencia de `webhook_estado` no hace falta el
 * instante: el id del evento ya es unico por construccion (una fila append-only por hecho). Es
 * ademas el `eventoId` publico del cuerpo, por donde el consumidor deduplica.
 */
export function dedupeKeyWebhookEvento(ordenEventoId: string): string {
  return `${DEDUPE_PREFIX_EVENTO}:${ordenEventoId}`;
}

/** Lo que el encolador necesita de la transaccion: `$queryRaw` (elegibilidad) + lo de `enqueue`. */
export type WebhookEventoTx = JobTxClient;

/**
 * Encola el job del evento `ordenEventoId` (de la orden `ordenId`) DENTRO de `tx`, solo si el dueño
 * de la orden tiene una suscripcion ACTIVA (misma consulta que `emitirWebhooksEstado`, paso 1: la
 * suscripcion YA ES la autorizacion, sin predicado de rol — ver la nota de la 302 alli). Sin
 * suscripcion, o con la orden borrada, no-op: el caso mayoritario no escribe nada.
 *
 * Devuelve `true` si encolo.
 */
export async function encolarWebhookEvento(
  tx: WebhookEventoTx,
  evento: { ordenEventoId: string; ordenId: string },
  repo: IJobRepository = new JobRepository(tx as unknown as ConstructorParameters<typeof JobRepository>[0]),
): Promise<boolean> {
  const elegibles = await tx.$queryRaw<{ orden_id: string }[]>`
    SELECT o."id" AS orden_id
      FROM "orden" o
      JOIN "webhook_suscripcion" w ON w."owner_usuario_id" = o."tienda_id" AND w."activa"
     WHERE o."id" = ${evento.ordenId} AND o."deleted_at" IS NULL`;
  if (!Array.isArray(elegibles) || elegibles.length === 0) return false;

  await repo.enqueue(
    "webhook_evento",
    { ordenEventoId: evento.ordenEventoId },
    {
      dedupeKey: dedupeKeyWebhookEvento(evento.ordenEventoId),
      maxIntentos: MAX_INTENTOS_WEBHOOK,
    },
    tx,
  );
  return true;
}
