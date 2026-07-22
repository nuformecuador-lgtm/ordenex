import type {
  CambioEstadoEntrada,
  OrdenHistorialTxClient,
} from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";
import {
  emisorWebhookEstadoReal,
  type WebhookEmisor,
} from "@/lib/services/jobs/webhook-estado-encolado";

/**
 * Feature 99 (design §6.1): el `tx` del choke point se WIDEN de `OrdenHistorialTxClient` a la
 * interseccion con `JobTxClient` (`$queryRaw`/`$executeRaw`), porque tras el append hay que
 * resolver los owners suscritos (§5) y encolar el job de webhook DENTRO de la misma
 * transaccion (transactional-outbox). El `tx` REAL de los ~13 call-sites es el cliente de
 * `$transaction` de Prisma, que satisface ambas caras: se ensancha el TIPO, no la semantica.
 */
export type ChokePointTx = OrdenHistorialTxClient & JobTxClient;

/**
 * Feature 49 (design §3.1, R6/R7) — CHOKE POINT del append al historial de estados.
 *
 * Funcion PURA reutilizable por los repos que ESCRIBEN `orden.estatus_id`
 * (`OrdenRepository`, `GestionOrdenRepository`, `LiberacionReprogramadaRepository`)
 * sin instanciar `OrdenHistorialRepository`. Inserta el LOTE de transiciones
 * (`createMany`) en el `tx` de la transaccion EN CURSO, garantizando que el cambio de
 * estado y su rastro son atomicos: si una falla, ambas se revierten (R7).
 *
 * REGLA (design §3.3): toda escritura de `orden.estatus_id` DEBE invocar esta funcion en
 * su MISMA transaccion, y SOLO para las ordenes que EFECTIVAMENTE transicionaron (R8).
 * `OrdenHistorialRepository.registrarCambioEstado` delega aqui: hay UN solo punto de
 * append (el inventario cerrado de los 11 call-sites vive en design §2; el test de
 * cobertura T5.2 lo fija como conjunto conocido).
 *
 * Feature 99 (design §6, R10/R11/R16): tras el append, en la MISMA transaccion, se invoca el
 * `emitir` (emisor de webhooks). Al vivir en el UNICO choke point, TODA transicion registrada
 * por cualquier call-site es candidata a webhook, sin puntos de emision nuevos ni depender de
 * que cada call-site recuerde emitir. El emisor decide a quien emite (owner suscrito activo y
 * rol `apiKey`, evento publico); si nadie aplica, es no-op. `emitir` es inyectable con default
 * = emisor real para que los tests puedan espiarlo.
 */
export async function appendCambioEstado(
  tx: ChokePointTx,
  entradas: CambioEstadoEntrada[],
  emitir: WebhookEmisor = emisorWebhookEstadoReal,
): Promise<void> {
  if (entradas.length === 0) return; // no-op: nada que registrar
  await tx.ordenHistorialEstado.createMany({
    data: entradas.map((e) => ({
      ordenId: e.ordenId,
      estatusOrigenId: e.estatusOrigenId, // null = creacion (R1/R20)
      estatusDestinoId: e.estatusDestinoId,
      actorUsuarioId: e.actorUsuarioId, // null = sistema/cron (R21)
      origenTipo: e.origenTipo, // clasificacion (R23)
      motivo: e.motivo ?? null, // de la gestion (R22)
      gestionOrdenId: e.gestionOrdenId ?? null,
    })),
  });
  // Feature 99 (R10/R11): emision transactional-outbox EN LA MISMA tx. Si la tx revierte, el
  // job encolado se va con ella (R11).
  await emitir(tx, entradas);
}
