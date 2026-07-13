import type { PrismaClient } from "@prisma/client";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";

// Feature 42 (design §2.2) — contrato del servicio que CONSTRUYE los movimientos de
// ingreso de un cierre aprobado. Se usa DENTRO de la transaccion de aprobacion del
// cierre: LEE las gestiones del cierre en la misma `tx` y devuelve las filas a insertar
// (no las persiste el mismo; las inserta el repo en la tx). Money-safe: montos STRING.

// Cliente de transaccion que necesita el feed: leer gestiones del cierre con su orden+zona.
export type WalletFeedTxClient = Pick<PrismaClient, "gestionOrden">;

export interface IWalletFeedService {
  /**
   * R5/R8/R9/R10: por cada gestion del cierre `cierreId`, deriva los conceptos de ingreso
   * segun su `resultado`, la tarifa vigente de la zona de la orden y `esCentral`/
   * `cobraComision`; agrega por concepto (1 movimiento por concepto, origen = cierre_dia)
   * y OMITE los conceptos con total 0.00. Devuelve las filas a insertar (idempotentes).
   */
  construirMovimientosDeIngreso(cierreId: string, tx: WalletFeedTxClient): Promise<CrearMovimientoInput[]>;
}
