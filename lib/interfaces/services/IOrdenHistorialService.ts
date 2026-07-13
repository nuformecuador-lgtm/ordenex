import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

// Feature 49 (design §4.1) — contrato del servicio de LECTURA del historial. La
// autorizacion por visibilidad de la orden vive aqui (R27), no en el repo. Resultado de
// dominio (sin acoplarse a HTTP); el borde (Server Action) le suma `unauthenticated`.
//
// Feature 47 (R15/R17): el `ok` ademas expone el conteo de intentos DERIVADO (`intentos`,
// consume `contarIntentos`) y el `umbral` configurable (R3), para que la UI muestre
// "intento X de N" con la MISMA autorizacion de la orden (no se añade regla nueva, R17).
export type ObtenerHistorialServiceResult =
  | { status: "ok"; entradas: OrdenHistorialEntradaDTO[]; intentos: number; umbral: number }
  | { status: "forbidden" }
  | { status: "not_found" };

export interface IOrdenHistorialService {
  /**
   * R26/R27: linea de tiempo de la orden, ordenada cronologicamente, autorizada por la
   * visibilidad de la orden (maestro/admin todas; adminTienda su tienda; mensajero sus
   * asignadas/actuadas; adminSatelite su zona). Sin visibilidad -> not_found/forbidden,
   * sin filtrar datos de la orden.
   */
  obtenerHistorial(ordenId: string, actor: Actor): Promise<ObtenerHistorialServiceResult>;
  /**
   * R24/R25: numero de intentos de entrega fallidos DERIVADO del historial (conteo de
   * transiciones a `devuelta`), sin columna materializada. Consulta reutilizable que la
   * feature 47 leera para la regla de escalado a rechazo (la 49 NO implementa esa regla).
   */
  contarIntentos(ordenId: string): Promise<number>;
}
