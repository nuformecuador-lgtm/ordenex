import type { PrismaClient } from "@prisma/client";

/**
 * FICHA 461 (design §5.2) — el PUERTO de la caja del cobro de Ordenex a una tienda. Molde exacto de
 * `ICajaPagoPorCuentaFeedService`: el servicio que lo recibe no puede EXPRESAR una escritura en la
 * caja que no sea el CARGO del cobro o su REVERSO. El tipo, la categoria y el origen los fija la
 * implementacion, no quien la llama.
 *
 * Es OBLIGATORIO en el constructor de `CobroTiendaService` (R9): sin caja no se construye. Es el
 * contrario exacto de la 381 (D1: «no se inyecta ningun puerto de caja»), por decision del humano
 * (HD1 de la 461): un cobro sin su linea de caja fue el fallo mudo que motiva la ficha.
 */
export type CajaCobroTiendaTxClient = Pick<PrismaClient, "walletMovimiento">;

export interface MovimientoDeCajaDeCobroTienda {
  /** El id del DEBITO `cobro_manual` del libro de la tienda: es el `origen_id` de las dos filas. */
  cobroId: string;
  monto: string; // STRING escala 2
  descripcion: string;
  registradoPor: string;
  /**
   * R3/R11: SIEMPRE el instante que fija el servicio, nunca el DEFAULT de la columna. Prisma
   * rellena `@default(now())` fila a fila en el cliente y el debito y la linea de caja quedarian
   * con instantes distintos (medido en la 459: 4 ms).
   */
  fechaMovimiento: Date;
}

export interface ICajaCobroTiendaFeedService {
  /** R1/R2/R22: el CARGO del cobro (`ingreso/ingreso_cobro_tienda`, origen `cobro_tienda`). */
  emitirCargoDeCobro(
    tx: CajaCobroTiendaTxClient,
    movimiento: MovimientoDeCajaDeCobroTienda,
  ): Promise<number>;
  /** R10/R22: el REVERSO del cargo al anular (`egreso/egreso_reverso_cobro_tienda`, mismo origen). */
  emitirReversoDeCobro(
    tx: CajaCobroTiendaTxClient,
    movimiento: MovimientoDeCajaDeCobroTienda,
  ): Promise<number>;
}
