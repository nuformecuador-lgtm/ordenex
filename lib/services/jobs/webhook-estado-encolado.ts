// Feature 99 (design §6, R13/R14/R15/R27/D3/D5) — EMISION del job `webhook_estado` desde el
// choke point del historial (`appendCambioEstado`), con el patron TRANSACTIONAL OUTBOX: el
// job se inserta DENTRO de la transaccion del cambio de estado (4.º parametro `tx` de
// `IJobRepository.enqueue`). Si esa transaccion revierte, el job desaparece con ella (R11):
// no hay ventana con una transicion registrada sin su job, ni un job sin su transicion.
import { Prisma } from "@prisma/client";
import type {
  IJobRepository,
  JobTxClient,
} from "@/lib/interfaces/repositories/IJobRepository";
import type { CambioEstadoEntrada } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { esTransicionEmitible } from "@/lib/types/webhook-eventos";

/**
 * R27/D5 FIJADO = 5: limite de intentos del tipo `webhook_estado` (override por-fila en el
 * `enqueue`). Un callback de integrador que no responde se reintenta con backoff y, tras 5
 * intentos, va al dead-letter visible (`failed`, consultable — R31), sin reintentar
 * indefinidamente. Es NORMATIVO, no un default sugerido.
 */
export const MAX_INTENTOS_WEBHOOK = 5;

/** Prefijo del `dedupe_key` (patron `DEDUPE_PREFIX` de geocodificacion/liberar). */
export const DEDUPE_PREFIX = "webhook_estado";

/**
 * Clave de idempotencia del job de webhook (R14).
 *
 * ⚠️ EL COMPONENTE DE INSTANTE ES OBLIGATORIO, NO COSMETICO. Con
 * `webhook_estado:<ordenId>:<estatusDestinoId>` a secas, una orden que REINGRESA a un estado
 * por reintento (patron de la feature 47) chocaria con la fila `done` del evento anterior y
 * el `ON CONFLICT DO NOTHING` descartaria el segundo evento EN SILENCIO: el indice unico de
 * `dedupe_key` (migracion de la 90, :39) NO esta acotado por estado del job y las filas
 * `jobs` no se purgan. El instante desambigua las repeticiones del mismo estado de la misma
 * orden (mismo hallazgo que la 91 R13). Cada transicion es un EVENTO UNICO.
 */
export function dedupeKeyWebhookEstado(
  ordenId: string,
  estatusDestinoId: string,
  ocurridoAtISO: string,
): string {
  return `${DEDUPE_PREFIX}:${ordenId}:${estatusDestinoId}:${ocurridoAtISO}`;
}

/**
 * Cliente transaccional que el emisor necesita: `$queryRaw` (resolucion §5) + lo que
 * `IJobRepository.enqueue(..., tx)` consume. Coincide con `JobTxClient`.
 */
export type WebhookEmisorTx = JobTxClient;

/** Firma del emisor inyectable que `appendCambioEstado` invoca tras el append (design §6.1). */
export type WebhookEmisor = (
  tx: WebhookEmisorTx,
  entradas: CambioEstadoEntrada[],
) => Promise<void>;

/** Fila cruda de la resolucion §5 (owner con suscripcion activa Y rol apiKey). */
interface OrdenElegibleRow {
  orden_id: string;
}
/** Fila cruda del lookup de catalogo de estado. */
interface EstadoRow {
  id: string;
  value: string;
}

/**
 * R10/R12/R13/R15/R27 — emite un job `webhook_estado` por cada transicion EMITIBLE del lote,
 * dentro de la transaccion `tx`. Pasos (design §6):
 *  1. Resolver, en UNA consulta, que ordenes del lote tienen owner con suscripcion ACTIVA Y
 *     rol `apiKey` (§5, R12/D3). Si ninguna -> no-op (caso mayoritario: sin suscripciones el
 *     JOIN devuelve vacio de inmediato, sin tocar el catalogo).
 *  2. Para esas ordenes, resolver el `value` de su estatus destino y filtrar por la politica
 *     `EVENTOS_PUBLICOS` (R15). Si queda vacio -> no-op.
 *  3. Encolar `webhook_estado` con payload MINIMO (R13, sin secreto ni PII) y
 *     `MAX_INTENTOS_WEBHOOK` (R27), con `dedupeKey` por instante (R14) DENTRO de `tx` (R11).
 *
 * `now` inyectable para tests deterministas; el instante es unico por invocacion del emisor,
 * asi dos transiciones distintas (incluida la repeticion del mismo estado en dos llamadas)
 * producen claves distintas.
 */
export async function emitirWebhooksEstado(
  tx: WebhookEmisorTx,
  entradas: CambioEstadoEntrada[],
  repo: IJobRepository,
  now: () => Date = () => new Date(),
): Promise<void> {
  if (entradas.length === 0) return;

  const ordenIds = Array.from(new Set(entradas.map((e) => e.ordenId)));

  // Paso 1 (§5, R12/D3): ordenes cuyo owner tiene suscripcion ACTIVA y es rol `apiKey`. El
  // JOIN a `rol.value = 'apiKey'` es el guard explicito de D3.
  const elegibles = await tx.$queryRaw<OrdenElegibleRow[]>`
    SELECT o."id" AS orden_id
    FROM "orden" o
    JOIN "webhook_suscripcion" w ON w."owner_usuario_id" = o."tienda_id" AND w."activa"
    JOIN "usuario" u ON u."id" = o."tienda_id"
    JOIN "rol" r ON r."id" = u."rol_id" AND r."value" = 'apiKey'
    WHERE o."id" IN (${Prisma.join(ordenIds)}) AND o."deleted_at" IS NULL`;
  // Defensivo: si el resultado no es un array (mocks de tests de call-sites que no
  // interpretan esta consulta), se trata como "sin elegibles" -> no-op.
  if (!Array.isArray(elegibles) || elegibles.length === 0) return;

  const elegiblesSet = new Set(elegibles.map((r) => r.orden_id));
  const candidatas = entradas.filter((e) => elegiblesSet.has(e.ordenId));
  if (candidatas.length === 0) return;

  // Paso 2 (R15): resolver el `value` del estatus destino y filtrar por la POLITICA
  // (`esTransicionEmitible`, `lib/types/webhook-eventos.ts`), que desde la feature 235 mira DOS
  // cosas: el estado destino (EVENTOS_PUBLICOS, R15) y la FAMILIA de origen
  // (ORIGENES_SIN_EVENTO_PUBLICO, 235/P4). La decision NO se escribe aqui: este modulo pregunta.
  const destinoIds = Array.from(new Set(candidatas.map((e) => e.estatusDestinoId)));
  const estados = await tx.$queryRaw<EstadoRow[]>`
    SELECT os."id" AS id, os."value" AS value
    FROM "order_status" os
    WHERE os."id" IN (${Prisma.join(destinoIds)})`;
  const valuePorId = new Map(estados.map((r) => [r.id, r.value]));

  // Paso 3 (R10/R13/R14/R27): encolar dentro de `tx`.
  const ocurridoAtISO = now().toISOString();
  for (const entrada of candidatas) {
    const estado = valuePorId.get(entrada.estatusDestinoId);
    // La familia entra en la decision (mecanismo de la 235/P4). Hoy NINGUNA familia esta
    // exceptuada —la lista quedo vacia con la decision humana del 2026-08-21, que revirtio P4—,
    // asi que el ciclo de ayuda emite ENTERO: la ida (`-> ayuda_tienda`, ya evento publico) y la
    // vuelta (el rescate `ayuda_tienda -> en_reparto`). El segundo argumento se sigue pasando
    // porque la exencion por FAMILIA es el unico modo de silenciar algo sin cargarse los
    // reingresos legitimos a un mismo estado; la decision no se re-deriva aqui, se pregunta.
    if (estado === undefined || !esTransicionEmitible(estado, entrada.origenTipo)) continue;

    await repo.enqueue(
      "webhook_estado",
      {
        // R13: payload MINIMO, sin secreto ni PII (nombre/telefono). El handler resuelve al
        // ENTREGAR los campos legibles del cuerpo (num_guia, num_remision, estado en texto).
        ordenId: entrada.ordenId,
        estatusDestinoId: entrada.estatusDestinoId,
        ocurridoAt: ocurridoAtISO,
      },
      {
        dedupeKey: dedupeKeyWebhookEstado(entrada.ordenId, entrada.estatusDestinoId, ocurridoAtISO),
        maxIntentos: MAX_INTENTOS_WEBHOOK, // R27/D5
      },
      tx, // R11: dentro de la transaccion del cambio de estado (outbox)
    );
  }
}

/**
 * Emisor REAL usado por defecto en `appendCambioEstado` (design §6.1). Construye un
 * `JobRepository` sobre `tx`: como `enqueue` recibe `tx` explicito, el cliente del
 * constructor NO se usa para la insercion (patron del propio `JobRepository`, que castea su
 * prisma a `JobTxClient`). Los tests del choke point inyectan un espia en su lugar.
 *
 * GUARD DEFENSIVO: los tests unitarios historicos de los call-sites (feature 49) mockean
 * `tx` con SOLO `ordenHistorialEstado` (sin `$queryRaw`). En ese caso NO hay outbox real que
 * emitir y se retorna sin tocar la cola, para no romper esas suites. En produccion los ~13
 * call-sites pasan el `tx` COMPLETO de Prisma (`$transaction`), que si expone `$queryRaw`, y
 * la emision corre normalmente. Los tests de emision (R10-R16) usan un `tx` real o un espia.
 */
export const emisorWebhookEstadoReal: WebhookEmisor = async (tx, entradas) => {
  if (typeof (tx as { $queryRaw?: unknown }).$queryRaw !== "function") return;
  const repo = new JobRepository(tx as unknown as ConstructorParameters<typeof JobRepository>[0]);
  await emitirWebhooksEstado(tx, entradas, repo);
};
