import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { EstadoCuentaConDetalleServiceResult } from "@/lib/types/detalle-en-lote";
import type { EstadoCuentaCompletoInput, MiEstadoCuentaCompletoInput } from "@/lib/types/estado-cuenta";

/**
 * Ficha 464 (design §2.3/§4) — la descarga «Movimientos y detalle por orden» del estado de cuenta de
 * una TIENDA (oficina) y de `/mi-wallet`, en una sola lectura (R36). El mensajero y la bodega no tienen
 * detalle por orden (R7): aqui no hay metodo para ellos.
 */
export interface IEstadoCuentaConDetalleService {
  /** La oficina: `leerCompleto` de UNA tienda + su detalle. Otra clase de cuenta => `validation_error`. */
  tiendaConDetalle(input: EstadoCuentaCompletoInput, actor: Actor): Promise<EstadoCuentaConDetalleServiceResult>;
  /** `/mi-wallet`: `leerMiTiendaCompleto` + su detalle, acotado a la tienda de la sesion. */
  miTiendaConDetalle(
    input: MiEstadoCuentaCompletoInput,
    actor: Actor,
  ): Promise<EstadoCuentaConDetalleServiceResult>;
}
