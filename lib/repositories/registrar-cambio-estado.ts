import type {
  CambioEstadoEntrada,
  OrdenHistorialTxClient,
} from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";
import {
  emisorWebhookEstadoReal,
  type WebhookEmisor,
} from "@/lib/services/jobs/webhook-estado-encolado";
import {
  emisorNotificacionReal,
  type NotificacionEmisor,
  type NotificacionEmisorTx,
} from "@/lib/notificaciones/emitir";
import type { OrderStatusValue } from "@/lib/types/order-status";
import {
  assertTransicionValida,
  esOrderStatusValue,
  TransicionNoValidableError,
} from "@/lib/types/order-status-transiciones";

/**
 * Feature 99 (design §6.1): el `tx` del choke point se WIDEN de `OrdenHistorialTxClient` a la
 * interseccion con `JobTxClient` (`$queryRaw`/`$executeRaw`), porque tras el append hay que
 * resolver los owners suscritos (§5) y encolar el job de webhook DENTRO de la misma
 * transaccion (transactional-outbox). El `tx` REAL de los ~13 call-sites es el cliente de
 * `$transaction` de Prisma, que satisface ambas caras: se ensancha el TIPO, no la semantica.
 */
export type ChokePointTx = OrdenHistorialTxClient & JobTxClient & NotificacionEmisorTx;

/**
 * Feature 140 (design §4) — resolvedor del catalogo de estados para la guardia: devuelve el
 * mapa `id -> value` de `order_status`. Inyectable con default real, mismo patron que
 * `emitir: WebhookEmisor`, para que la firma publica de `appendCambioEstado` NO cambie para
 * los ~18 call-sites (Q6/R8).
 *
 * FALLO CERRADO (Q7): el tipo NO admite `null` ni `undefined`. Si el catalogo no se puede
 * leer, la implementacion LANZA (`TransicionNoValidableError`) y la `$transaction` del
 * call-site revierte. No existe "catalogo ausente => sigue adelante sin validar".
 */
export type CatalogoEstadosResolver = (
  tx: ChokePointTx,
) => Promise<ReadonlyMap<string, OrderStatusValue>>;

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
 * FALLO CERRADO (Q7): si el `tx` no expone `$queryRaw`, si la consulta no devuelve un array o
 * si el catalogo resulta vacio, LANZA `TransicionNoValidableError` — no devuelve un catalogo
 * parcial ni deja pasar la escritura. Un fallo transitorio de lectura tambien lanza (lo
 * propaga Prisma) y revierte la `$transaction` del call-site. La escritura de estado solo
 * ocurre si la guardia pudo demostrar que la transicion es legal.
 */
export const resolverCatalogoEstadosReal: CatalogoEstadosResolver = async (tx) => {
  if (catalogoCache !== null) return catalogoCache;
  if (typeof (tx as { $queryRaw?: unknown }).$queryRaw !== "function") {
    throw new TransicionNoValidableError("catalogo_no_disponible");
  }
  const filas = await tx.$queryRaw<OrderStatusRow[]>`
    SELECT os."id" AS id, os."value" AS value
    FROM "order_status" os`;
  if (!Array.isArray(filas)) throw new TransicionNoValidableError("catalogo_no_disponible");
  const porId = new Map<string, OrderStatusValue>();
  for (const fila of filas) {
    if (typeof fila?.id !== "string" || typeof fila?.value !== "string") continue;
    // Una fila con un `value` que este build no conoce (drift DB->codigo) NO entra al mapa:
    // no se puede clasificar. Cualquier transicion que la toque sera rechazada abajo con
    // `estatus_desconocido`, en vez de colarse sin validar.
    if (esOrderStatusValue(fila.value)) porId.set(fila.id, fila.value);
  }
  if (porId.size === 0) throw new TransicionNoValidableError("catalogo_no_disponible");
  catalogoCache = porId;
  return porId;
};

/** Resuelve un `id` de estatus a su `value`, o LANZA: no hay "no se pudo, sigue adelante". */
function valueDe(
  porId: ReadonlyMap<string, OrderStatusValue>,
  estatusId: string,
  lado: "origen" | "destino",
): OrderStatusValue {
  const value = porId.get(estatusId);
  if (value === undefined) throw new TransicionNoValidableError("estatus_desconocido", lado);
  return value;
}

/**
 * Feature 140 (R6/R7/R10) — valida el LOTE COMPLETO contra `TRANSICIONES` ANTES de escribir
 * nada. Si una sola entrada es ilegal, `assertTransicionValida` lanza `TransicionIlegalError`,
 * el `createMany` y el `emitir` no llegan a ejecutarse y el `throw` revierte la `$transaction`
 * del call-site: todo-o-nada, sin efectos parciales (R7).
 *
 * FALLO CERRADO (Q7, decision del gate): NO existe ninguna ruta por la que una entrada llegue
 * al `createMany` sin haber pasado por `assertTransicionValida`. Si el catalogo no esta
 * disponible, o si un `id` de la entrada no resuelve a un `value` CONOCIDO por este build
 * (drift DB->codigo: la tabla gano un value que `ORDER_STATUS_SEED` aun no lista), la guardia
 * no puede DEMOSTRAR la legalidad -> rechaza con `TransicionNoValidableError`. "No sé" se
 * trata como "no", que es lo que distingue una guardia de un adorno.
 */
async function validarTransiciones(
  tx: ChokePointTx,
  entradas: CambioEstadoEntrada[],
  catalogo: CatalogoEstadosResolver,
): Promise<ReadonlyMap<string, OrderStatusValue>> {
  const porId = await catalogo(tx);
  for (const entrada of entradas) {
    const destino = valueDe(porId, entrada.estatusDestinoId, "destino");
    const origen =
      entrada.estatusOrigenId === null
        ? null // creacion (R10): se valida contra ESTADOS_CREACION
        : valueDe(porId, entrada.estatusOrigenId, "origen");
    assertTransicionValida(origen, destino); // R6/R10
  }
  // Feature 146: se devuelve el catalogo YA resuelto para que el emisor de notificaciones
  // clasifique el destino del lote sin una segunda consulta.
  return porId;
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
 *
 * La guardia es de FALLO CERRADO (Q7): si no puede resolver el catalogo, o si un `id` de la
 * entrada no corresponde a un `value` conocido por este build, lanza `TransicionNoValidableError`
 * en vez de dejar pasar la escritura sin validar.
 */
export async function appendCambioEstado(
  tx: ChokePointTx,
  entradas: CambioEstadoEntrada[],
  emitir: WebhookEmisor = emisorWebhookEstadoReal,
  catalogo: CatalogoEstadosResolver = resolverCatalogoEstadosReal,
  emitirNotificaciones: NotificacionEmisor = emisorNotificacionReal,
): Promise<void> {
  if (entradas.length === 0) return; // no-op: nada que registrar
  // Feature 140 (R6/R7): guardia ANTES del append; si lanza, no hay historial ni webhook.
  const valuePorEstatusId = await validarTransiciones(tx, entradas, catalogo);
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
  // Feature 146 (design §4.1, R18-R21): emision de las notificaciones de "orden rechazada por
  // el destinatario" EN LA MISMA tx (F1.4-3). Aqui —y no en `GestionOrdenRepository`— porque
  // este es el UNICO punto por el que pasa toda escritura de `orden.estatus_id`: ningun camino
  // nuevo hacia `rechazada` puede perder el aviso por olvido (alternativa A5 descartada).
  //
  // TRANSACCIONAL, no best-effort: dentro de una transaccion de Postgres un error de sentencia
  // aborta la transaccion entera, asi que el try/catch "dentro del tx" no existe. Consecuencias
  // ACEPTADAS y cerradas en F1.4-3: si la tx revierte no queda notificacion (R20) y si la
  // emision falla no se persiste el cambio de estado (R21).
  await emitirNotificaciones(tx, entradas, valuePorEstatusId);
}
