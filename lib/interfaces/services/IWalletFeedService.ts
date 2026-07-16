import type { PrismaClient } from "@prisma/client";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";

// Feature 42 (design §2.2) — contrato del servicio que CONSTRUYE los movimientos de
// ingreso de un cierre aprobado. Se usa DENTRO de la transaccion de aprobacion del
// cierre: LEE las gestiones del cierre en la misma `tx` y devuelve las filas a insertar
// (no las persiste el mismo; las inserta el repo en la tx). Money-safe: montos STRING.

// Cliente de transaccion que necesita el feed. Feature 69/R12: el SNAPSHOT (`cierre_detail`)
// + las gestiones (que aportan el `resultado`). `orden`, `zona` y `tarifas` VIVAS ya NO se
// consultan al aprobar: ese era el bug money-critical.
export type WalletFeedTxClient = Pick<PrismaClient, "gestionOrden" | "cierreDetail">;

export interface IWalletFeedService {
  /**
   * R5/R8/R9/R10: por cada gestion del cierre `cierreId`, deriva los conceptos de ingreso
   * segun su `resultado` (de la GESTION) y los datos CONGELADOS de su orden (feature 69/R12:
   * `monto_cobrar`, `cobra_comision`, `es_central` y la tarifa, todos de `cierre_detail`);
   * agrega por concepto (1 movimiento por concepto, origen = cierre_dia) y OMITE los
   * conceptos con total 0.00. Devuelve las filas a insertar (idempotentes).
   *
   * Feature 69/R14: si falta la fila congelada de alguna orden del cierre, LANZA
   * (`CierreDetalleFaltanteError`) y la aprobacion aborta. NO hay fallback a datos vivos.
   */
  construirMovimientosDeIngreso(cierreId: string, tx: WalletFeedTxClient): Promise<CrearMovimientoInput[]>;
}
