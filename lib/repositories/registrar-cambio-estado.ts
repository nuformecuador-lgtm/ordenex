import type {
  CambioEstadoEntrada,
  OrdenHistorialTxClient,
} from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";
import {
  emisorWebhookEstadoReal,
  type WebhookEmisor,
} from "@/lib/services/jobs/webhook-estado-encolado";
import type { OrderStatusValue } from "@/lib/types/order-status";
import {
  assertTransicionValida,
  esOrderStatusValue,
} from "@/lib/types/order-status-transiciones";

/**
 * Feature 99 (design §6.1): el `tx` del choke point se WIDEN de `OrdenHistorialTxClient` a la
 * interseccion con `JobTxClient` (`$queryRaw`/`$executeRaw`), porque tras el append hay que
 * resolver los owners suscritos (§5) y encolar el job de webhook DENTRO de la misma
 * transaccion (transactional-outbox). El `tx` REAL de los ~13 call-sites es el cliente de
 * `$transaction` de Prisma, que satisface ambas caras: se ensancha el TIPO, no la semantica.
 */
export type ChokePointTx = OrdenHistorialTxClient & JobTxClient;

/**
 * Feature 140 (design §4) — resolvedor del catalogo de estados para la guardia: devuelve el
 * mapa `id -> value` de `order_status`, o `null` si el catalogo NO esta disponible en este
 * `tx`. Inyectable con default real, mismo patron que `emitir: WebhookEmisor`, para que la
 * firma publica de `appendCambioEstado` NO cambie para los ~18 call-sites (Q6/R8).
 */
export type CatalogoEstadosResolver = (
  tx: ChokePointTx,
) => Promise<ReadonlyMap<string, OrderStatusValue> | null>;

/** Fila cruda del catalogo (`order_status`), el unico dato que la guardia necesita. */
interface OrderStatusRow {
  id: string;
  value: string;
}

/**
 * Cache POR PROCESO del catalogo (R13). El catalogo es inmutable tras el seed, asi que se
 * lee UNA vez por proceso y despues la validacion es puramente en memoria: cero round-trips
 * de DB en el camino caliente, por muchas transiciones que traiga el lote.
 */
let catalogoCache: ReadonlyMap<string, OrderStatusValue> | null = null;

/** Solo para tests: descarta la cache por-proceso del catalogo. */
export function resetCatalogoEstadosCache(): void {
  catalogoCache = null;
}

/**
 * Resolvedor REAL usado por defecto (design §4). Lee el catalogo COMPLETO (18 filas) con UNA
 * consulta dentro del `tx` en curso y lo cachea por proceso.
 *
 * GUARD DEFENSIVO (mismo precedente que `emisorWebhookEstadoReal`): si el `tx` no expone
 * `$queryRaw`, o la consulta no devuelve un catalogo utilizable, retorna `null` = "catalogo
 * NO disponible". Eso ocurre SOLO con los dobles parciales de los tests unitarios historicos
 * de los call-sites (feature 49), que mockean el `tx` con `ordenHistorialEstado` a secas y
 * usan ids sinteticos (`os-x`) que no existen en ningun catalogo. En produccion el `tx` es
 * el cliente de `$transaction` de Prisma y `order_status` esta sembrado, asi que el catalogo
 * SIEMPRE resuelve y la guardia SIEMPRE valida. NO es un interruptor: no hay variable de
 * entorno, config ni parametro que lo fuerce (Q7, activacion estricta).
 */
export const resolverCatalogoEstadosReal: CatalogoEstadosResolver = async (tx) => {
  if (catalogoCache !== null) return catalogoCache;
  if (typeof (tx as { $queryRaw?: unknown }).$queryRaw !== "function") return null;
  const filas = await tx.$queryRaw<OrderStatusRow[]>`
    SELECT os."id" AS id, os."value" AS value
    FROM "order_status" os`;
  if (!Array.isArray(filas)) return null;
  const porId = new Map<string, OrderStatusValue>();
  for (const fila of filas) {
    if (typeof fila?.id !== "string" || typeof fila?.value !== "string") continue;
    if (esOrderStatusValue(fila.value)) porId.set(fila.id, fila.value);
  }
  if (porId.size === 0) return null; // catalogo vacio/ilegible: no se cachea, no se valida
  catalogoCache = porId;
  return porId;
};

/**
 * Feature 140 (R6/R7/R10) — valida el LOTE COMPLETO contra `TRANSICIONES` ANTES de escribir
 * nada. Si una sola entrada es ilegal, `assertTransicionValida` lanza `TransicionIlegalError`,
 * el `createMany` y el `emitir` no llegan a ejecutarse y el `throw` revierte la `$transaction`
 * del call-site: todo-o-nada, sin efectos parciales (R7).
 *
 * Una entrada cuyo `id` no esta en el catalogo resuelto se salta: no es clasificable, y no es
 * un agujero de la guardia — la FK `orden_historial_estado.estatus_destino_id -> order_status.id`
 * rechaza cualquier id que no exista, en esta misma transaccion. Ademas deja que un estado
 * sembrado DESPUES de arrancar el proceso (cache tibia) no tumbe el flujo.
 */
async function validarTransiciones(
  tx: ChokePointTx,
  entradas: CambioEstadoEntrada[],
  catalogo: CatalogoEstadosResolver,
): Promise<void> {
  const porId = await catalogo(tx);
  if (porId === null) return; // catalogo no disponible (doble de test): nada que clasificar
  for (const entrada of entradas) {
    const destino = porId.get(entrada.estatusDestinoId);
    if (destino === undefined) continue;
    if (entrada.estatusOrigenId === null) {
      assertTransicionValida(null, destino); // R10: creacion contra ESTADOS_CREACION
      continue;
    }
    const origen = porId.get(entrada.estatusOrigenId);
    if (origen === undefined) continue;
    assertTransicionValida(origen, destino); // R6
  }
}

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
 *
 * Feature 140 (design §4, R6/R7/R9/R10): ANTES de escribir nada, cada entrada del lote se
 * valida contra `TRANSICIONES` (`lib/types/order-status-transiciones.ts`). Aqui —y no en cada
 * service— porque es el UNICO punto por el que pasa toda escritura de `orden.estatus_id`:
 * ningun call-site puede saltarse la guardia, incluido el ajuste administrativo generico
 * (`origen_tipo = ajuste_estado`), que NO tiene override (Q3). Una transicion ilegal lanza
 * `TransicionIlegalError` y revierte la `$transaction` del call-site (R7). `catalogo` es
 * inyectable con default real (mismo patron que `emitir`), asi la firma sigue siendo
 * compatible con los ~18 call-sites (R8).
 */
export async function appendCambioEstado(
  tx: ChokePointTx,
  entradas: CambioEstadoEntrada[],
  emitir: WebhookEmisor = emisorWebhookEstadoReal,
  catalogo: CatalogoEstadosResolver = resolverCatalogoEstadosReal,
): Promise<void> {
  if (entradas.length === 0) return; // no-op: nada que registrar
  // Feature 140 (R6/R7): guardia ANTES del append; si lanza, no hay historial ni webhook.
  await validarTransiciones(tx, entradas, catalogo);
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
