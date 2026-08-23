import type { PrismaClient } from "@prisma/client";
import type {
  OrdenHistorialTransicionDTO,
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
 * Feature 167 (design §5.3, R24/R25/R28) — una recoleccion en tienda YA HECHA, leida del
 * HISTORIAL. `recolectadaAt` es el `created_at` de la fila de historial: el instante REAL de la
 * transicion, que es el unico dato que no miente sobre lo ya hecho (el historial es append-only
 * e inmutable, 49/R2). No lleva el estado ACTUAL de la orden a proposito: es irrelevante (R26).
 */
export interface RecoleccionHistorialRow {
  ordenId: string;
  numGuia: number | null;
  numRemision: string;
  tiendaNombre: string;
  recolectadaAt: Date;
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
   *
   * Feature 262 (B24/B25, design §14.5): devuelve el tipo ESTRECHO
   * `OrdenHistorialTransicionDTO[]` y NO la union `OrdenHistorialEntradaDTO[]`. Este metodo lee
   * `orden_historial_estado` y solo esa tabla: decirlo en la firma evita que alguien crea que ya
   * trae las correcciones del dia de reparto. La FUSION de las dos fuentes es del servicio (R41).
   */
  findHistorialByOrden(ordenId: string): Promise<OrdenHistorialTransicionDTO[]>;
  /**
   * Feature 215 (R1/R3/R5/R8/R29/R30/R31/R32) — cuenta los INTENTOS DE ENTREGA de `ordenId`.
   *
   * El criterio ya NO son destinos de transicion del historial: es el numero de CIERRES
   * APROBADOS DISTINTOS en los que la orden tuvo un resultado de gestion contable y vigente.
   *
   *   intento = nº de `cierre_id` DISTINTOS de las `gestion_orden` de la orden con
   *             resultado ∈ {rechazada, devuelta, reprogramada}  (lista de INCLUSION, R1/R2)
   *             AND anulada_at IS NULL                            (vigencia, R5)
   *             AND cierre_id IS NOT NULL AND cierre.estado = 'aprobado'   (D8/R3)
   *
   *   - El grano es la ORDEN dentro del cierre (R29): dos gestiones vigentes contables en el
   *     MISMO cierre aprobado suman **1**, no 2. Por eso es `DISTINCT cierre_id` y no un
   *     `COUNT(*)` de gestiones.
   *   - ACUMULA sobre todos los cierres aprobados de la orden (R30): N cierres -> N.
   *   - NO mira el estado ACTUAL de la orden (R31): cuenta el hecho ocurrido.
   *   - Es MONOTONO CRECIENTE (R32): un cierre aprobado no sale de `aprobado` y una gestion
   *     con `cierre_id` poblado ya no se puede anular. La anulacion impide que el numero SUBA;
   *     nunca lo hace bajar.
   *   - Vigencia = filtro de LECTURA (R5). No se modifica ningun registro para excluir una
   *     gestion anulada, y el historial sigue siendo append-only e inmutable (49/R2).
   *   - Sin gestiones contables -> `0` explicito, no ausencia ni error (R8).
   */
  contarIntentosVigentes(ordenId: string): Promise<number>;
  /**
   * Feature 215 (R4/R7/R8) — el gemelo EN LOTE de `contarIntentosVigentes`: los conteos de N
   * ordenes en UNA sola consulta, sea cual sea N (una consulta por fila es un incumplimiento de
   * R7, no una nota menor).
   *
   * MISMO predicado que la version individual (una sola definicion de "intento", R4/R6): lo
   * unico que cambia entre los dos `where` es `ordenId`.
   *   - Las ordenes SIN filas que cumplan el criterio NO aparecen en el Map: el llamador
   *     resuelve el default con `?? 0` (R8).
   *   - `ordenIds` vacio -> Map vacio SIN emitir consulta alguna (R7), patron
   *     `OrdenRepository.findMensajerosBloqueadosParaGestion`.
   */
  contarIntentosVigentesEnLote(ordenIds: string[]): Promise<Map<string, number>>;
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
  /**
   * Feature 167 (design §5.3, R24/R25/R26/R28/R29/R32) — las recolecciones en tienda que
   * `actorUsuarioId` actuo en la ventana `[desde, hasta)`, de la MAS RECIENTE a la mas antigua,
   * como mucho `limite` filas.
   *
   * LECTURA PURA: la ventana la calcula el service (R27, `lib/utils/fecha-cr.ts`); aqui solo se
   * aplica. `desde` INCLUSIVO, `hasta` EXCLUSIVO.
   *
   *   where: actorUsuarioId + origenTipo `recoleccion_tienda` + createdAt en rango
   *          + orden.deletedAt = null           (R29: las borradas no figuran)
   *   orderBy: createdAt desc                   (R28)
   *   take: limite
   *
   * NOTA DELIBERADA: **no** filtra por `estatus_destino_id`. La familia `recoleccion_tienda`
   * tiene una sola arista (#43) y el estado ACTUAL de la orden es IRRELEVANTE — eso es justo lo
   * que R26 exige: una orden ya recibida en la bodega central (138, `en_bodega_central`) tiene
   * que SEGUIR figurando como recolectada hoy.
   *
   * Resuelve sobre el indice `orden_historial_actor_origen_created_idx`
   * (actor_usuario_id, origen_tipo, created_at), R32.
   *
   * `limite <= 0` -> lista vacia SIN emitir consulta (patron
   * `contarIntentosVigentesEnLote` / `OrdenRepository.findMensajerosBloqueadosParaGestion`).
   */
  findRecoleccionesDeActor(
    actorUsuarioId: string,
    desde: Date,
    hasta: Date,
    limite: number,
  ): Promise<RecoleccionHistorialRow[]>;
}
