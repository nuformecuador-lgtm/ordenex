import type { PrismaClient } from "@prisma/client";
import type { CrearMovimientoTiendaInput } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";

// Feature 43 (design §2.2) — contrato del servicio que CONSTRUYE los movimientos del ledger
// POR TIENDA de un cierre aprobado. Se usa DENTRO de la transaccion de aprobacion del cierre:
// LEE las gestiones del cierre en la misma `tx` y devuelve las filas a insertar (credito COD
// + debitos por concepto, por tienda), NO las persiste el mismo (las inserta el repo en la
// tx). Money-safe: montos STRING.

// Cliente de transaccion que necesita el feed: leer gestiones del cierre con su orden+zona.
export type WalletTiendaFeedTxClient = Pick<PrismaClient, "gestionOrden">;

export interface IWalletTiendaFeedService {
  /**
   * R5/R8/R9/R10/R11/R14/R28: por cada gestion del cierre `cierreId`, deriva los DEBITOS por
   * concepto REUTILIZANDO `derivarIngresoOrden` (42) y el CREDITO `cod_recaudado` =
   * montoRecibido (Q2); agrega por (tienda, concepto) con Prisma.Decimal, OMITE los que quedan
   * en 0.00 y aplica el interruptor Q3 (TIENDA_DEBITA_FLETE_DEVOLUCION). Devuelve las filas a
   * insertar (origen = cierre_dia, por tienda), idempotentes.
   */
  construirMovimientosPorTienda(
    cierreId: string,
    tx: WalletTiendaFeedTxClient,
  ): Promise<CrearMovimientoTiendaInput[]>;
}
