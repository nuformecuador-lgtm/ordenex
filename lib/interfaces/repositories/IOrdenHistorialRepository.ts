import type { PrismaClient } from "@prisma/client";
import type {
  OrdenHistorialEntradaDTO,
  OrdenHistorialOrigenTipo,
} from "@/lib/types/orden-historial";

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

export interface IOrdenHistorialRepository {
  /**
   * R6/R7: CHOKE POINT del historial. Inserta un LOTE de transiciones (createMany) en la
   * transaccion `tx` recibida, para que el cambio de `orden.estatus_id` y su rastro sean
   * atomicos (si una falla, ambas se revierten). El llamador (cada call-site de escritura
   * de estado) DEBE pasar SOLO las ordenes que EFECTIVAMENTE transicionaron (R8).
   */
  registrarCambioEstado(tx: OrdenHistorialTxClient, entradas: CambioEstadoEntrada[]): Promise<void>;
  /**
   * R26: linea de tiempo de UNA orden, ordenada cronologicamente (created_at asc), con los
   * `value` de estado origen/destino y el `nombre` del actor ya resueltos a DTO legible.
   * Usa el indice (orden_id, created_at) (R5).
   */
  findHistorialByOrden(ordenId: string): Promise<OrdenHistorialEntradaDTO[]>;
  /**
   * R24: cuenta las transiciones de `ordenId` cuyo destino es `estatusDestinoId`. Consulta
   * reutilizable para el derivador de intentos (destinos `devuelta`); usa el indice
   * (orden_id, estatus_destino_id).
   */
  contarPorDestino(ordenId: string, estatusDestinoId: string): Promise<number>;
  /**
   * R27: `true` si existe al menos una transicion de `ordenId` cuyo actor sea `usuarioId`
   * (la orden estuvo actuada por ese usuario). Sostiene la autorizacion del mensajero: ve
   * el historial de una orden que le fue/esta asignada, aunque hoy ya no la tenga asignada.
   */
  existeActuacionDe(ordenId: string, usuarioId: string): Promise<boolean>;
}
