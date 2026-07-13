import type { PrismaClient } from "@prisma/client";
import type { CrearPagoMensajeroInput } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";

// Feature 44 (design §2.2) — contrato del servicio que CONSTRUYE los movimientos del pago al
// mensajero de un cierre aprobado. Se usa DENTRO de la transaccion de aprobacion del cierre: LEE
// el cierre (un findUnique) en la misma `tx` y devuelve las filas a insertar, NO las persiste el
// mismo (las inserta el repo en la tx). Money-safe: montos STRING.

// Cliente de transaccion que necesita el feed: leer el cierre (mensajero + snapshots 39/37).
export type WalletMensajeroFeedTxClient = Pick<PrismaClient, "cierreDia">;

/**
 * Resultado del feed: (a) `libro` = movimientos del LIBRO por mensajero (pago_mensajero_movimiento:
 * devengo + pago); (b) `egresoCaja` = el EGRESO en la caja principal 42 (wallet_movimiento) por el
 * costo total P (F1.4-Qa=SI FIRME, R17). Ambos se leen del MISMO snapshot del cierre (un solo
 * findUnique) para que la regla `min(P,E)` y el egreso `P` no se deriven dos veces. La liquidacion
 * posterior (Qf) NO vuelve a emitir egreso en 42 (evita doble conteo).
 */
export interface MovimientosDePagoMensajero {
  libro: CrearPagoMensajeroInput[];
  egresoCaja: CrearMovimientoInput[];
}

export interface IWalletMensajeroFeedService {
  /**
   * R5/R8/R9/R10/R13/R17: lee `cierre_dia.{mensajeroId, totalPagoMensajero (P), totalEfectivo (E)}`
   * (un findUnique; NO re-deriva tarifas ni recuenta gestiones), calcula `pagado = min(P, E)` con
   * Prisma.Decimal y emite: `pago_devengado = P` (si P>0), `pago_efectivo = pagado` (si pagado>0),
   * y el egreso `egreso_pago_mensajero = P` en la caja 42 (si P>0). El pendiente NO es fila: es el
   * saldo derivado. SI P=0 devuelve listas vacias (R10). Idempotente por el constraint DB.
   */
  construirMovimientosDePago(
    cierreId: string,
    tx: WalletMensajeroFeedTxClient,
  ): Promise<MovimientosDePagoMensajero>;
}
