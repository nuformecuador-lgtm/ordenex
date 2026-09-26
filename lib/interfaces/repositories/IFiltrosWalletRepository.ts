import type { WalletMovimientoTipo } from "@/lib/types/wallet";

// Ficha 458-A (TA.3/TA.4, design §3.5) — las lecturas de los filtros de la wallet. SOLO queries:
// conteos (`_count`, nunca `_sum`) y nombres. La cuenta va SIEMPRE en el WHERE y la escribe el
// metodo, al principio del objeto, sin ningun spread encima que pueda pisarla (R12).

/** Filtros de la caja para contar conceptos. SIN `categoria`: el conteo no depende del elegido. */
export type FiltrosConteoCaja = { tipo?: WalletMovimientoTipo; desde?: Date; hasta?: Date };

/** Filtros de UNA tienda para contar conceptos. SIN `categoria`, por la misma razon. */
export type FiltrosConteoTienda = { cierreId?: string; desde?: Date; hasta?: Date };

/** Un concepto con su numero de filas. */
export type ConteoPorCategoria = { categoria: string; movimientos: number };

/** Un cierre con movimientos en el libro de una cuenta. `ultimaFecha` = ISO del movimiento mas reciente. */
export type CierreDeCuentaRow = {
  cierreId: string;
  solicitadoAt: string;
  mensajero: string;
  movimientos: number;
};

/**
 * Como acotar los cierres por el texto buscado. Lo resuelve el SERVICIO (es regla: un dia se busca
 * por su franja de Costa Rica, un texto por el nombre del mensajero); el repositorio solo lo aplica.
 */
export type BusquedaDeCierre =
  | { tipo: "dia"; desde: Date; hasta: Date }
  | { tipo: "mensajero"; texto: string };

export interface IFiltrosWalletRepository {
  contarConceptosCaja(filtros: FiltrosConteoCaja): Promise<ConteoPorCategoria[]>;
  contarConceptosTienda(tiendaId: string, filtros: FiltrosConteoTienda): Promise<ConteoPorCategoria[]>;
  /** Los cierres del libro de UNA tienda, mas recientes primero, como mucho `limite`. */
  cierresDeTienda(
    tiendaId: string,
    busqueda: BusquedaDeCierre | undefined,
    limite: number,
  ): Promise<CierreDeCuentaRow[]>;
  /** Los cierres del libro de UN mensajero, mas recientes primero, como mucho `limite`. */
  cierresDeMensajero(
    mensajeroId: string,
    busqueda: BusquedaDeCierre | undefined,
    limite: number,
  ): Promise<CierreDeCuentaRow[]>;
}
