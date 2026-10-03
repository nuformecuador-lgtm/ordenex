import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";

/**
 * Ficha 464 (design §4, R34/R37) — la lectura EN LOTE de filas del ledger de UNA tienda por id.
 *
 * Interfaz aparte de `IWalletTiendaMovimientoRepository` a proposito: aquella la implementan a mano
 * una docena de dobles de test que no tienen nada que ver con la descarga, y ampliarla los obligaria
 * a todos a declarar un metodo que no usan. La implementa el MISMO repositorio
 * (`WalletTiendaMovimientoRepository`), con el mismo `toDTO` que `obtenerPorIdDeTienda`.
 */
export interface IMovimientosTiendaEnLoteRepository {
  /**
   * VARIAS filas del ledger por id, acotadas a SU tienda, en una consulta. Mismo contrato que
   * `obtenerPorIdDeTienda`: el `tienda_id` va en el `WHERE`, y un id de otra tienda o inexistente
   * simplemente no vuelve. El orden de salida no esta garantizado (quien llama lo indexa por id).
   */
  listarPorIdsDeTienda(ids: readonly string[], tiendaId: string): Promise<WalletTiendaMovimientoDTO[]>;
}
