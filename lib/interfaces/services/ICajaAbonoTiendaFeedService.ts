import type { PrismaClient } from "@prisma/client";

/**
 * FICHA 457 (design §6.1) — el PUERTO de la caja del pago de una tienda a Ordenex. Molde exacto de
 * `ICajaPagoPorCuentaFeedService`: el servicio que lo recibe no puede EXPRESAR una escritura en la
 * caja que no sea la entrada del pago o su reverso. El tipo, la categoria y el origen los fija la
 * implementacion, no quien la llama (R22: ninguna categoria propia ni de capital es alcanzable).
 */
export type CajaAbonoTiendaTxClient = Pick<PrismaClient, "walletMovimiento">;

export interface MovimientoDeCajaDeAbono {
  abonoId: string;
  monto: string; // STRING escala 2
  descripcion: string;
  registradoPor: string;
  /** R20/R32: el MISMO instante que el asiento del libro de la tienda. */
  fechaMovimiento: Date;
}

export interface ICajaAbonoTiendaFeedService {
  /** R17/R19: la ENTRADA de dinero de la tienda (`ingreso_abono_tienda`, terceros, efectivo). */
  emitirIngresoDeAbono(tx: CajaAbonoTiendaTxClient, movimiento: MovimientoDeCajaDeAbono): Promise<number>;
  /** R31/R39: la SALIDA que devuelve el dinero al anular (`egreso_reverso_abono_tienda`). */
  emitirReversoDeAbono(tx: CajaAbonoTiendaTxClient, movimiento: MovimientoDeCajaDeAbono): Promise<number>;
}
