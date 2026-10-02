import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { EstadoCuentaCompletoInput, MiEstadoCuentaCompletoInput } from "@/lib/types/estado-cuenta";
import type { CuentaKardexConDetalleServiceResult, CuentaKardexServiceResult } from "@/lib/types/libro-kardex";

/**
 * Ficha 468 — lo mismo para un ESTADO DE CUENTA: en la oficina (tienda, mensajero, bodega) y en
 * `/mi-wallet`. La bodega solo tiene «Solo los movimientos» (R25).
 */
export interface ICuentaKardexService {
  /** La hoja «Movimientos» de cualquier cuenta de la oficina, bodega incluida. */
  kardex(input: EstadoCuentaCompletoInput, actor: Actor): Promise<CuentaKardexServiceResult>;
  /** Las dos hojas de una tienda o un mensajero en la oficina. La bodega → `validation_error` (R25). */
  kardexConDetalle(input: EstadoCuentaCompletoInput, actor: Actor): Promise<CuentaKardexConDetalleServiceResult>;
  /** La hoja «Movimientos» de `/mi-wallet` (la tienda de la sesion). */
  miKardex(input: MiEstadoCuentaCompletoInput, actor: Actor): Promise<CuentaKardexServiceResult>;
  /** Las dos hojas de `/mi-wallet`. */
  miKardexConDetalle(input: MiEstadoCuentaCompletoInput, actor: Actor): Promise<CuentaKardexConDetalleServiceResult>;
}
