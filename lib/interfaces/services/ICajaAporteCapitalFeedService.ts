import type { PrismaClient } from "@prisma/client";

/**
 * FICHA 459 (design §6.3) — el PUERTO de la caja del saldo inicial o aporte de capital. Mismo
 * molde que `ICajaPagoTiendaFeedService`: dos metodos, el tipo, la categoria y el origen fijados
 * por la implementacion.
 */
export type CajaAporteCapitalTxClient = Pick<PrismaClient, "walletMovimiento">;

export interface MovimientoDeCajaDeCapital {
  aporteId: string;
  monto: string; // STRING escala 2
  descripcion: string;
  registradoPor: string;
  /** `undefined` = hoy (manda el DEFAULT de la columna). */
  fechaMovimiento?: Date;
}

export interface ICajaAporteCapitalFeedService {
  /** R68: la ENTRADA de capital (`ingreso_aporte_capital`). */
  emitirIngresoDeCapital(
    tx: CajaAporteCapitalTxClient,
    movimiento: MovimientoDeCajaDeCapital,
  ): Promise<number>;
  /** R74: la SALIDA que lo revierte al anular (`egreso_reverso_aporte_capital`). */
  emitirReversoDeCapital(
    tx: CajaAporteCapitalTxClient,
    movimiento: MovimientoDeCajaDeCapital,
  ): Promise<number>;
}
