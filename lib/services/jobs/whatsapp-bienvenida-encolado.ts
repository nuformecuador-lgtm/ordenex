// MENSAJE DE BIENVENIDA — ENCOLADO del job `whatsapp_bienvenida`, colgado del choke point de
// transiciones de estado (`appendCambioEstado`). Cuando el mensajero recoge un paquete y la orden
// pasa de `por_recoger` a `en_reparto`, si el negocio tiene una plantilla marcada como
// bienvenida, se encola su envio al cliente.
//
// POR QUE AQUI Y NO EN `MisAsignacionesService.recogerAsignaciones`, que es donde parecia.
// Porque el service NO SABE que ordenes transicionaron de verdad: `recogerLote` devuelve solo un
// conteo (`GestionOrdenRepository.ts:606`, `return rows.length`) y el service responde
// `recogidas: ordenIds` — los ids PEDIDOS (`MisAsignacionesService.ts:483`). Una orden que pierda
// la carrera del `WHERE` (doble pulsacion, reserva para otro dia, reasignacion) se reporta igual
// como recogida. Colgar de ahi mandaria WhatsApps a clientes cuyo paquete NO salio. El choke
// point, en cambio, recibe exactamente las entradas del `RETURNING "id"`.
//
// Y ademas es TRANSACTIONAL OUTBOX: el `enqueue` va con el `tx` de la recogida, asi que si la
// transaccion revierte, el job se va con ella. Mismo patron que `webhook-estado-encolado.ts`
// (feature 99) y `lib/notificaciones/emitir.ts` (feature 146), que cuelgan del mismo sitio.
import { JobRepository } from "@/lib/repositories/JobRepository";
import type { IJobRepository, JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";
import type { CambioEstadoEntrada } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { OrderStatusValue } from "@/lib/types/order-status";

/**
 * TRES INTENTOS, y el numero esta elegido, no heredado del default (que son 5).
 *
 * Los fallos de META no se cuentan aqui: `ChatWhatsappService.enviarPlantilla` ya se ocupa de
 * ellos por su cuenta —un `transitorio` persiste el saliente `queued` y encola su propio
 * `whatsapp_chat_envio` con sus 5 reintentos; un `permanente` persiste el saliente `failed` con
 * el error de Meta, visible EN EL HILO DEL CHAT—, y el handler resuelve sin lanzar en los dos
 * casos. Este job nunca muere por culpa de Meta.
 *
 * Lo que SI lo mata son dos clases de fallo muy distintas, y tres intentos es el punto donde las
 * dos quedan bien servidas:
 *
 * - TRANSITORIO DE INFRAESTRUCTURA, antes de llegar a Meta: un hipo de la base, un env a medio
 *   desplegar. Se arregla solo, y con el backoff de `JobQueueService`
 *   (`min(1h, 60s * 2^(intentos-1))`) los reintentos caen al minuto y a los dos minutos. Con un
 *   solo intento se habria perdido la bienvenida de esas ordenes para siempre.
 * - CONFIGURACION: la plantilla marcada no esta aprobada por Meta, la orden ya no es del
 *   mensajero que la recogio. No se arregla sola. Aqui los reintentos no sirven de nada, y por
 *   eso NO se usan los 5 del default: agotar tres tarda ~3 minutos en vez de ~15, y el motivo
 *   esta en `jobs.last_error` mucho antes.
 *
 * Es un compromiso explicito: se aceptan ~3 minutos de reintentos inutiles en el caso de
 * configuracion a cambio de no perder la bienvenida en el caso transitorio. `JobQueueService` no
 * distingue un error reintentable de uno determinista, asi que no se pueden tener las dos cosas
 * a la vez; si algun dia hace falta, el arreglo correcto es dar a `JobHandler` una forma de decir
 * "no reintentes", no mover este numero.
 */
export const MAX_INTENTOS_BIENVENIDA = 3;

/** Prefijo del `dedupe_key` (patron `DEDUPE_PREFIX` de webhook-estado/geocodificacion). */
export const DEDUPE_PREFIX = "whatsapp_bienvenida";

/** Familia de transicion que produce SOLO la recogida (`GestionOrdenRepository.recogerLote`). */
const ORIGEN_RECOLECCION = "recoleccion";

/** Estado destino de una recogida. */
const DESTINO_RECOGIDA: OrderStatusValue = "en_reparto";

/**
 * Clave de idempotencia del job.
 *
 * ⚠️ EL COMPONENTE DE INSTANTE ES OBLIGATORIO, NO COSMETICO — y aqui mas que en ningun otro
 * tipo. Con `whatsapp_bienvenida:<ordenId>` a secas, una orden REPROGRAMADA que vuelve a
 * `por_recoger` y se recoge otra vez chocaria contra la fila `done` de la primera bienvenida y
 * el `ON CONFLICT DO NOTHING` descartaria el segundo envio EN SILENCIO ABSOLUTO: sin excepcion,
 * sin log y sin fila. El indice unico `jobs_dedupe_key_key` (migracion de la 90, :39) NO esta
 * acotado por estado del job y las filas de `jobs` no se purgan nunca.
 *
 * Seria el modo de fallo mas caro posible: la feature funcionaria en la primera recogida y
 * dejaria de funcionar justo en el caso que la decision humana pidio cubrir («se reenvia cada vez
 * que se recoge»). Mismo hallazgo que `webhook-estado-encolado.ts:26-36` y que la 91 (R13).
 *
 * NO lleva `estatusDestinoId`, a diferencia de `webhook_estado`: aqui el destino es CONSTANTE
 * (`en_reparto`), asi que anadirlo seria ruido que no desambigua nada.
 */
export function dedupeKeyBienvenida(ordenId: string, ocurridoAtISO: string): string {
  return `${DEDUPE_PREFIX}:${ordenId}:${ocurridoAtISO}`;
}

/**
 * Payload MINIMO y sin PII, criterio de `webhook_estado`: ni telefono, ni destinatario, ni
 * direccion, ni cuerpo renderizado. El handler resuelve todo eso al ejecutar.
 *
 * Tampoco lleva `plantillaId`: QUIEN es la bienvenida es CONFIGURACION, no parte del evento, y
 * se relee al enviar. Asi, si el maestro corrige la marca en los ~60 s entre la recogida y el
 * drenado, sale la plantilla correcta; y no existe el estado raro de un job apuntando a una
 * plantilla borrada entre medias. La trazabilidad de que plantilla se uso no se pierde: el
 * `chat_mensaje` resultante guarda su `plantilla_id`.
 */
export interface WhatsappBienvenidaPayload {
  ordenId: string;
  /** El mensajero que recogio. Es el scope obligatorio de `OrdenEnvioReader.findParaEnvio`. */
  mensajeroId: string;
  /** Instante de la recogida en ISO; el mismo que desambigua la `dedupeKey`. */
  ocurridoAt: string;
}

/** Cliente transaccional que el emisor necesita: lo que `enqueue(..., tx)` consume. */
export type BienvenidaEmisorTx = JobTxClient;

/** Firma del emisor inyectable en `appendCambioEstado` (patron `WebhookEmisor`). */
export type BienvenidaEmisor = (
  tx: BienvenidaEmisorTx,
  entradas: CambioEstadoEntrada[],
  valuePorEstatusId: ReadonlyMap<string, OrderStatusValue>,
) => Promise<void>;

/** Fila cruda de la comprobacion de existencia de bienvenida. */
interface BienvenidaRow {
  id: string;
}

/**
 * Encola una bienvenida por cada orden RECOGIDA del lote, si el negocio tiene una configurada.
 *
 * El orden de las guardas importa y es deliberado: primero se filtra el lote EN MEMORIA y, si no
 * hay ninguna recogida, se retorna sin tocar la base. Como este emisor cuelga del choke point,
 * corre en TODA transicion del sistema —entregas, devoluciones, corte diario, carga masiva— y el
 * caso mayoritario tiene que costar cero consultas. Mismo criterio que `emisorNotificacionReal`
 * (`lib/notificaciones/emitir.ts:226`).
 */
export async function emitirBienvenidaRecogida(
  tx: BienvenidaEmisorTx,
  entradas: CambioEstadoEntrada[],
  valuePorEstatusId: ReadonlyMap<string, OrderStatusValue>,
  repo: IJobRepository,
  now: () => Date = () => new Date(),
): Promise<void> {
  const recogidas = entradas.filter(
    (e) =>
      e.origenTipo === ORIGEN_RECOLECCION &&
      e.actorUsuarioId !== null &&
      valuePorEstatusId.get(e.estatusDestinoId) === DESTINO_RECOGIDA,
  );
  if (recogidas.length === 0) return; // caso mayoritario: ni una consulta

  // Solo hace falta saber SI existe una bienvenida configurada. La fila completa —y el juicio
  // sobre si es enviable— los resuelve el handler; aqui la pregunta es binaria: ¿encolo o no?
  //
  // `welcome_message = true AND deleted_at IS NULL` sin mas filtros: una plantilla marcada pero
  // no aprobada por Meta TIENE que encolar, para que su fallo deje rastro en vez de evaporarse.
  const filas = await tx.$queryRaw<BienvenidaRow[]>`
    SELECT p."id"
    FROM "plantilla_mensaje" p
    WHERE p."welcome_message" = true AND p."deleted_at" IS NULL
    LIMIT 1
  `;
  // Nadie marco una bienvenida: silencio total, ni un job. No es un fallo, es que el negocio no
  // la configuro.
  if (!Array.isArray(filas) || filas.length === 0) return;

  const ocurridoAt = now().toISOString();
  for (const entrada of recogidas) {
    await repo.enqueue(
      DEDUPE_PREFIX,
      {
        ordenId: entrada.ordenId,
        mensajeroId: entrada.actorUsuarioId as string,
        ocurridoAt,
      } satisfies WhatsappBienvenidaPayload,
      {
        dedupeKey: dedupeKeyBienvenida(entrada.ordenId, ocurridoAt),
        maxIntentos: MAX_INTENTOS_BIENVENIDA,
      },
      tx,
    );
  }
}

/**
 * Emisor REAL usado por defecto en `appendCambioEstado`.
 *
 * GUARD DEFENSIVO (patron `emisorWebhookEstadoReal` / `emisorNotificacionReal`): los ~18
 * call-sites historicos del choke point tienen tests unitarios que mockean `tx` con SOLO
 * `ordenHistorialEstado`. Si el `tx` no expone `$queryRaw` no hay outbox real que emitir y se
 * retorna sin tocar nada, para no romper esas suites. En produccion el `tx` es el de
 * `$transaction`, completo.
 */
export const emisorBienvenidaReal: BienvenidaEmisor = async (
  tx,
  entradas,
  valuePorEstatusId,
) => {
  if (typeof (tx as { $queryRaw?: unknown }).$queryRaw !== "function") return;
  const repo = new JobRepository(tx as unknown as ConstructorParameters<typeof JobRepository>[0]);
  await emitirBienvenidaRecogida(tx, entradas, valuePorEstatusId, repo);
};
