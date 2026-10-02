import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { LibroCajaKardexConDetalleServiceResult, LibroCajaKardexServiceResult } from "@/lib/types/libro-kardex";
import type { ListarLibroCajaCompletoServicioInput } from "@/lib/types/wallet";

/**
 * Ficha 468 (design §3–§4) — la descarga del libro de la CAJA como kardex, en sus dos modos. Cada modo es
 * UNA lectura (R53) y la hoja «Movimientos» sale identica en los dos (R57). El orden lo FUERZA el
 * servidor: cronologico ascendente, sea cual sea el de la pantalla (R7).
 */
export interface ICajaKardexService {
  /** «Solo los movimientos · una hoja»: el kardex con los conteos de ordenes, sin leer ninguna (R61). */
  kardex(input: ListarLibroCajaCompletoServicioInput, actor: Actor): Promise<LibroCajaKardexServiceResult>;
  /** «Movimientos y detalle por guía · dos hojas»: el kardex + el detalle agrupado por guia (R26). */
  kardexConDetalle(
    input: ListarLibroCajaCompletoServicioInput,
    actor: Actor,
  ): Promise<LibroCajaKardexConDetalleServiceResult>;
}
