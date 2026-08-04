import type { PrismaClient } from "@prisma/client";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";

// Feature 173 (design §3.1) — contrato del servicio que CONSTRUYE el ingreso de contra-entrega
// de un cierre aprobado. Hermano de `IWalletIndemnizacionFeedService` (158), `IWalletFeedService`
// (42) y `IWalletTiendaFeedService` (43): corre DENTRO de la transaccion de aprobacion, LEE en
// esa misma `tx` y devuelve las filas a insertar, sin persistir nada el mismo (las inserta el
// repositorio de la 42, que `CierresAdminRepository` ya tiene inyectado).

/**
 * Cliente de transaccion que necesita el feed: el LEDGER POR TIENDA, y nada mas.
 *
 * Que el `Pick` sea de UNA sola tabla no es cosmetico (R33): con este tipo el feed **no puede**
 * leer `gestion_orden` ni ninguna otra fuente aunque alguien lo intente — el compilador lo
 * impide antes que cualquier test.
 */
export type CajaCodFeedTxClient = Pick<PrismaClient, "walletTiendaMovimiento">;

export interface ICajaCodFeedService {
  /**
   * R11/R12/R13 — suma los creditos `cod_recaudado` que ESE cierre acredito a las tiendas en
   * `wallet_tienda_movimiento` y devuelve 0 o 1 movimiento de ingreso para la caja principal.
   *
   * LEE DEL LEDGER, no de las gestiones, y es la propiedad central de este servicio (design
   * §3.1): asi el importe que entra en la caja es, POR CONSTRUCCION, identico al que se le
   * acredito a las tiendas (R12). Si se recalculara desde `gestion_orden.montoRecibido`
   * habria dos formulas para el mismo dinero y podrian divergir sin que nada fallara.
   *
   * NO recibe el monto por parametro: lo lee de lo que la MISMA `tx` acaba de escribir, igual
   * que el feed de indemnizacion de la 158.
   *
   * Money-safe: la suma se hace con `Prisma.Decimal` y el monto sale como STRING escala 2.
   * Suma 0 (cierre sin contra-entrega) -> lista VACIA: NO se emite una fila en 0.00 (R13).
   *
   * R17: NO fija `fechaMovimiento`. La columna cae en su `DEFAULT CURRENT_TIMESTAMP`, igual
   * que los otros cuatro movimientos de caja de esa misma aprobacion, de modo que los cinco
   * caen en el mismo instante.
   */
  construirIngresoCod(
    cierreId: string,
    tx: CajaCodFeedTxClient,
  ): Promise<CrearMovimientoInput[]>;
}
