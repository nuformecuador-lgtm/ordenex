import type { AQuienCuentaTipo, AQuienFiltro } from "@/lib/types/libro-caja-a-quien";
import type { WalletMovimientoTipo } from "@/lib/types/wallet";

// Ficha 458-A (TA.3/TA.4, design §3.5) — las lecturas de los filtros de la wallet. SOLO queries:
// conteos (`_count`, nunca `_sum`) y nombres. La cuenta va SIEMPRE en el WHERE y la escribe el
// metodo, al principio del objeto, sin ningun spread encima que pueda pisarla (R12).

/** Filtros de la caja para contar conceptos. SIN `categoria`: el conteo no depende del elegido. */
export type FiltrosConteoCaja = {
  tipo?: WalletMovimientoTipo;
  desde?: Date;
  hasta?: Date;
  /** Ficha 458-E (R59): el mismo «A quién» del libro, resuelto con el mismo WHERE. */
  aQuien?: AQuienFiltro;
};

/** Ficha 458-E (R59) — el periodo y la direccion de las opciones del selector «A quién». */
export type FiltrosQuienesCaja = { tipo?: WalletMovimientoTipo; desde?: Date; hasta?: Date };

/** Una cuenta con filas en la caja: su nombre (`etiquetaDeCuenta`) y cuantas filas. */
export type CuentaConMovimientosRow = {
  tipo: AQuienCuentaTipo;
  cuentaId: string;
  nombre: string;
  movimientos: number;
};

/** Un nombre libre anotado con filas en la caja (agrupado sin mayusculas ni bordes). */
export type NombreConMovimientosRow = { nombre: string; movimientos: number };

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
  /**
   * Ficha 458-E (TE.2, R59) — TODAS las cuentas y nombres libres con filas en la caja bajo esos
   * filtros, agrupados en SQL con el MISMO cruce por origen que el filtro «A quién». La salida crece
   * con el numero de cuentas y de nombres distintos, no con el de movimientos; la busqueda, el orden
   * y el tope los pone el servicio.
   */
  quienesDelLibroCaja(
    filtros: FiltrosQuienesCaja,
  ): Promise<{ cuentas: CuentaConMovimientosRow[]; nombres: NombreConMovimientosRow[] }>;
}
