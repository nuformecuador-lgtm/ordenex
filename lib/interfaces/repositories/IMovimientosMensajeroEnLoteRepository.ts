import type { MovimientoDeMensajeroRow } from "@/lib/interfaces/repositories/IEstadoCuentaRepository";

/** Una fila del libro del mensajero leida en lote: la de `movimientoDeMensajero` + su id. */
export interface MovimientoDeMensajeroEnLoteRow extends MovimientoDeMensajeroRow {
  id: string;
}

/**
 * Ficha 468 (design §4.1, R31/R55) — la lectura EN LOTE de filas del libro de UN mensajero por id, para
 * el detalle por guia de su estado de cuenta. Gemela de `IMovimientosTiendaEnLoteRepository`.
 *
 * Interfaz aparte de `IEstadoCuentaRepository` a proposito: aquella la implementan a mano varios dobles de
 * test que no tienen nada que ver con la descarga. La implementa el MISMO repositorio
 * (`EstadoCuentaRepository`), con la misma proyeccion que `movimientoDeMensajero`.
 */
export interface IMovimientosMensajeroEnLoteRepository {
  /**
   * VARIAS filas por id, acotadas a SU mensajero, en una consulta. El `mensajero_id` va en el `WHERE`:
   * un id de otro mensajero o inexistente simplemente no vuelve. El orden de salida no esta garantizado.
   */
  listarPorIdsDeMensajero(ids: readonly string[], mensajeroId: string): Promise<MovimientoDeMensajeroEnLoteRow[]>;
}
