import type { WalletTxClient } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";

/**
 * FICHA 458-B (D7, R64/R68) — el PUERTO ESTRECHO por el que la anulacion de un cobro por rechazo
 * escribe en la caja: los dos REVERSOS de cargo (flete e IVA por separado). Tipo, categoria y
 * origen son literales de la implementacion; el servicio solo aporta la gestion, los montos (de las
 * lineas originales), quien y cuando. Molde: `ICajaCobroTiendaFeedService` (461).
 */
export type CajaRechazoTiendaCobroTxClient = WalletTxClient;

export interface ReversosDeCobroRechazo {
  /** La gestion del cobro: el `origen_id` de sus lineas originales y de sus reversos. */
  gestionId: string;
  /** Monto de la linea `ingreso_flete_devolucion` que se anula (STRING escala 2), o `null` si no hay. */
  montoFlete: string | null;
  /** Monto de la linea `ingreso_iva_flete_devolucion` que se anula, o `null` si no hay (IVA en 0). */
  montoIva: string | null;
  descripcion: string | null;
  registradoPor: string;
  /** R64: el MISMO instante en los dos libros. */
  fechaMovimiento: Date;
}

export interface ICajaRechazoTiendaCobroFeedService {
  /**
   * Escribe `egreso_reverso_flete_devolucion` (y `egreso_reverso_iva_flete_devolucion` si hay IVA),
   * origen `gestion_orden`/gestion. Idempotente por `(origen_tipo, origen_id, categoria)`. Devuelve
   * cuantas filas inserto.
   */
  emitirReversosDeAnulacion(tx: CajaRechazoTiendaCobroTxClient, r: ReversosDeCobroRechazo): Promise<number>;
}
