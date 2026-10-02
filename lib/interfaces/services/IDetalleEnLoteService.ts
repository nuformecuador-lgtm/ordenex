import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DetalleEnLoteServiceResult } from "@/lib/types/detalle-en-lote";
import type { WalletMovimientoCategoria } from "@/lib/types/wallet";

/**
 * Ficha 464 (design §4) — un movimiento de la CAJA tal como lo devolvio su lectura completa: lo minimo
 * para decidir su fuente y cotejar su importe. Viene del MISMO servidor y de la MISMA peticion que la
 * hoja de movimientos (R36), nunca de la entrada del cliente.
 */
export interface MovimientoDeCajaParaDetalle {
  id: string;
  categoria: WalletMovimientoCategoria;
  /** STRING escala 2, tal cual lo guarda el libro. */
  monto: string;
  origenTipo: string;
  origenId: string | null;
}

/**
 * Las tres superficies con detalle (R6). La tienda y el alcance NUNCA salen de la entrada del cliente:
 *
 *  - `caja`: los movimientos ya leidos por `listarMovimientosCompleto` (acceso total).
 *  - `tienda_oficina`: los ids de la hoja del estado de cuenta de UNA tienda, y esa tienda (la cuenta
 *    que la oficina ya leyo). Acceso total.
 *  - `mi_wallet`: los ids de la hoja de `/mi-wallet`. La tienda es la del ACTOR (`adminTienda`).
 *
 * En las dos de tienda las filas se RE-LEEN del ledger con la tienda en el `WHERE` (R34): un id que no
 * es de esa tienda no puede colarse en el detalle.
 */
export type DetallarEnLoteInput =
  | { superficie: "caja"; movimientos: readonly MovimientoDeCajaParaDetalle[] }
  | { superficie: "tienda_oficina"; tiendaId: string; movimientoIds: readonly string[] }
  | { superficie: "mi_wallet"; movimientoIds: readonly string[] };

export interface IDetalleEnLoteService {
  /**
   * R18–R23, R32–R34, R37, R39, R40 — el detalle por orden de TODOS los movimientos recibidos, en su
   * orden. El rol se mira ANTES de leer nada; se cuentan las filas antes de leerlas y, si pasan del
   * tope, `limite_excedido` con solo los conteos. Consultas = conceptos distintos x tramos de cierres.
   */
  detallar(input: DetallarEnLoteInput, actor: Actor): Promise<DetalleEnLoteServiceResult>;
}
