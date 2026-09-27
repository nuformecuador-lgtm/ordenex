import type { PrismaClient } from "@prisma/client";

/**
 * FICHA 459 (design §6.3) — el PUERTO de la caja del pago por cuenta de una tienda. Molde exacto
 * de `ICajaPagoTiendaFeedService`: el servicio que lo recibe no puede EXPRESAR una escritura en la
 * caja que no sea la salida del pago por cuenta o su reverso. El tipo, la categoria y el origen
 * los fija la implementacion, no quien la llama.
 */
export type CajaPagoPorCuentaTxClient = Pick<PrismaClient, "walletMovimiento">;

export interface MovimientoDeCajaDePagoPorCuenta {
  pagoId: string;
  monto: string; // STRING escala 2
  descripcion: string;
  registradoPor: string;
  /** `undefined` = hoy (manda el DEFAULT de la columna, ficha 334). */
  fechaMovimiento?: Date;
}

export interface ICajaPagoPorCuentaFeedService {
  /** R29: la SALIDA de dinero de las tiendas (`egreso_pago_por_cuenta_tienda`). */
  emitirEgresoDePagoPorCuenta(
    tx: CajaPagoPorCuentaTxClient,
    movimiento: MovimientoDeCajaDePagoPorCuenta,
  ): Promise<number>;
  /** R46: la ENTRADA que devuelve el dinero al anular (`ingreso_reverso_pago_por_cuenta_tienda`). */
  emitirReversoDePagoPorCuenta(
    tx: CajaPagoPorCuentaTxClient,
    movimiento: MovimientoDeCajaDePagoPorCuenta,
  ): Promise<number>;
}
