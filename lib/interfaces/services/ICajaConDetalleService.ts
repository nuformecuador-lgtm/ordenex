import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CajaConDetalleServiceResult } from "@/lib/types/detalle-en-lote";
import type { ListarLibroCajaCompletoServicioInput } from "@/lib/types/wallet";

/**
 * Ficha 464 (design §2.3/§4) — la descarga «Movimientos y detalle por orden» de la CAJA en una sola
 * lectura (R36): `listarMovimientosCompleto` con la MISMA entrada (filtros, termino y orden de la 463)
 * + el detalle en lote de ESOS movimientos.
 */
export interface ICajaConDetalleService {
  cajaConDetalle(
    input: ListarLibroCajaCompletoServicioInput,
    actor: Actor,
  ): Promise<CajaConDetalleServiceResult>;
}
