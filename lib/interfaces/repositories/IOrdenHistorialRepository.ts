import type { PrismaClient } from "@prisma/client";
import type {
  OrdenHistorialEntradaDTO,
  OrdenHistorialOrigenTipo,
} from "@/lib/types/orden-historial";
import type { JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";
import type { NotificacionTxClient } from "@/lib/interfaces/repositories/INotificacionRepository";

// Feature 49 (design §3.1/§4.2) — contrato del repositorio del HISTORIAL de estados de la
// orden. Solo queries Prisma; sin logica de negocio (la autorizacion vive en el service,
// R27). Es el CHOKE POINT del append: toda escritura de `orden.estatus_id` DEBE registrar
// su transicion aqui, en la MISMA transaccion (R6/R7).

// Cliente de transaccion aceptado por `registrarCambioEstado`: cualquier cosa que exponga
// `ordenHistorialEstado` (el `tx` de un `$transaction`, o el PrismaClient completo). Igual
// patron que `WalletTxClient`.
export type OrdenHistorialTxClient = Pick<PrismaClient, "ordenHistorialEstado">;

// Una transicion a registrar. `estatusOrigenId` NULL = creacion (R1/R20); `actorUsuarioId`
// NULL = sistema/cron (R21); `motivo` de la gestion (R22); `gestionOrdenId` enlaza la
// gestion que causo la transicion (familia gestion). Los dos ultimos opcionales.
export interface CambioEstadoEntrada {
  ordenId: string;
  estatusOrigenId: string | null;
  estatusDestinoId: string;
  actorUsuarioId: string | null;
  origenTipo: OrdenHistorialOrigenTipo;
  motivo?: string | null;
  gestionOrdenId?: string | null;
}

// Feature 49 (design §2/§3.2) — contexto MINIMO que un call-site de escritura de estado
// necesita para poblar el append del historial: quien la origino (`actorUsuarioId` NULL =
// sistema/cron, R21) y de que FAMILIA de transicion proviene (`origenTipo`, R23). El
// estado de ORIGEN por-orden lo lee el propio repo dentro de su tx (R20), el DESTINO ya se
// pasa a cada metodo, y el `motivo`/`gestionOrdenId` (familia gestion) los resuelve el repo.
// Se thread-ea a los metodos cuyo actor NO es ya un parametro (los del maestro/adminTienda/
// adminSatelite). Los metodos cuyo actor ya viaja (recogerLote/crearGestion = mensajero) o
// es constante (liberarOrden = cron NULL) lo derivan sin este contexto.
export interface HistorialContexto {
  actorUsuarioId: string | null;
  origenTipo: OrdenHistorialOrigenTipo;
}

// Feature 149 (design §3.3) — una orden del lote a revertir, con el `estatus_id` ACTUAL que el
// service ya leyo (`findByIdsForTransicion`). El repo NO vuelve a leer el estado: recibe el par
// y busca la fila de historial que produjo ese estado.
export interface OrigenReversionItem {
  ordenId: string;
  estatusActualId: string;
}

/**
 * Feature 160 (design §1.1/§3.2, R1/R6) — ids de catalogo que materializan el criterio de
 * "intento de entrega". El repositorio NO conoce los `value` del catalogo (eso vive en
 * `OrdenHistorialService`, unico dueño de la traduccion value -> id): recibe los ids ya
 * resueltos.
 *
 *   intento = VIGENTE  AND  ( destino = devueltaId
 *                             OR (destino = reprogramadaId AND origen ∈ ORIGEN_TIPOS_REPROGRAMADA_INTENTO) )
 *
 * `reprogramadaId: null` = el catalogo no tiene `reprogramada` (seed parcial): se cuenta
 * SOLO la rama A y la lectura no falla (R6).
 */
export interface CriterioIntento {
  devueltaId: string;
  reprogramadaId: string | null;
}

export interface IOrdenHistorialRepository {
  /**
   * R6/R7: CHOKE POINT del historial. Inserta un LOTE de transiciones (createMany) en la
   * transaccion `tx` recibida, para que el cambio de `orden.estatus_id` y su rastro sean
   * atomicos (si una falla, ambas se revierten). El llamador (cada call-site de escritura
   * de estado) DEBE pasar SOLO las ordenes que EFECTIVAMENTE transicionaron (R8).
   */
  // Feature 99 (design §6.1): el `tx` se ensancha con `JobTxClient` para poder emitir el
  // webhook en la misma transaccion (transactional-outbox); el `tx` real de Prisma ya lo
  // satisface.
  // Feature 146 (design §4.1): se ensancha una vez mas con las tablas de notificacion + `orden`,
  // porque el choke point emite el aviso del rechazo DENTRO de la misma transaccion (F1.4-3).
  // Mismo movimiento que hizo la 99: se ensancha el TIPO, no la semantica.
  registrarCambioEstado(
    tx: OrdenHistorialTxClient & JobTxClient & NotificacionTxClient & Pick<PrismaClient, "orden">,
    entradas: CambioEstadoEntrada[],
  ): Promise<void>;
  /**
   * R26: linea de tiempo de UNA orden, ordenada cronologicamente (created_at asc), con los
   * `value` de estado origen/destino y el `nombre` del actor ya resueltos a DTO legible.
   * Usa el indice (orden_id, created_at) (R5).
   */
  findHistorialByOrden(ordenId: string): Promise<OrdenHistorialEntradaDTO[]>;
  /**
   * R24 (49) + feature 67/R24-R26 + feature 160/R1: cuenta los INTENTOS DE ENTREGA VIGENTES de
   * `ordenId` segun el `criterio` (design 160 §1.1). Usa el indice
   * (orden_id, estatus_destino_id); `origen_tipo` y `gestion.anulada_at` quedan como filtros
   * residuales sobre el puñado de filas ya recuperadas, y el join a `gestion_orden` es por PK.
   *
   * "Vigente" EXCLUYE las transiciones causadas por una gestion ANULADA (67/R24) y las
   * HUERFANAS (67/R26), pero SIGUE contando las que nunca vinieron de una gestion (67/R25).
   * Es un filtro de LECTURA: el historial NO se modifica jamas (49/R2, 67/R23).
   *
   * Sustituye a `contarPorDestinoVigentes` (features 49/67), que contaba "por destino" suelto.
   * El RENOMBRE es deliberado (160, design §3.3): el metodo ya no cuenta un destino, cuenta
   * intentos segun un criterio COMPUESTO. Conservar el nombre viejo invitaria a un call-site
   * futuro a pasarle un destino a secas y obtener un numero que NO es el que gobierna el
   * escalado a `rechazada` -> `cobroRechazado` (56, dinero real).
   */
  contarIntentosVigentes(ordenId: string, criterio: CriterioIntento): Promise<number>;
  /**
   * Feature 160/R12/R13/R14 — el gemelo EN LOTE de `contarIntentosVigentes`: los conteos de N
   * ordenes en UNA sola consulta al historial, sea cual sea N (una consulta por fila es un
   * incumplimiento de R12, no una nota menor).
   *
   * MISMO predicado que la version individual (una sola definicion de "intento vigente", R4).
   *   - Las ordenes SIN filas que cumplan el criterio NO aparecen en el Map: el llamador
   *     resuelve el default con `?? 0` (R14).
   *   - `ordenIds` vacio -> Map vacio SIN emitir consulta alguna (R13), patron
   *     `OrdenRepository.findMensajerosBloqueados`.
   */
  contarIntentosVigentesEnLote(
    ordenIds: string[],
    criterio: CriterioIntento,
  ): Promise<Map<string, number>>;
  /**
   * R27: `true` si existe al menos una transicion de `ordenId` cuyo actor sea `usuarioId`
   * (la orden estuvo actuada por ese usuario). Sostiene la autorizacion del mensajero: ve
   * el historial de una orden que le fue/esta asignada, aunque hoy ya no la tenga asignada.
   */
  existeActuacionDe(ordenId: string, usuarioId: string): Promise<boolean>;
  /**
   * Feature 149 (design §3.3, R11) — LECTURA PURA que alimenta la derivacion del destino de
   * una reversion. Por cada item devuelve el `value` del estado de ORIGEN de la fila de
   * historial MAS RECIENTE de esa orden cuyo `estatus_destino_id` es su `estatusActualId`:
   * literalmente "de donde salio la transicion que se esta deshaciendo".
   *
   * UNA sola consulta para todo el lote (sin N+1): `DISTINCT ON (orden_id)` con
   * `ORDER BY orden_id, created_at DESC, id DESC` (el desempate por `id` solo existe para que
   * la consulta sea determinista, Q3) sobre el indice `(orden_id, estatus_destino_id)`.
   *
   * Semantica del resultado (el service la interpreta, R13 — aqui NO hay logica de negocio):
   *   - clave ausente  => la orden no tiene ninguna fila con ese destino;
   *   - valor `null`   => la fila existe pero su `estatus_origen_id` es NULL (fila de creacion);
   *   - valor `string` => el `value` del estado de origen.
   * Los tres casos que no producen un `value` normalizable terminan en rechazo (fallo CERRADO).
   * Mapa vacio si `items` esta vacio.
   */
  findOrigenesReversion(
    items: readonly OrigenReversionItem[],
  ): Promise<Map<string, string | null>>;
}
