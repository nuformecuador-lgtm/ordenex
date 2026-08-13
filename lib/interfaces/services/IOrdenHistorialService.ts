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
   * Feature 215 (R1/R3/R6) — numero de intentos de entrega DERIVADO, sin columna materializada.
   * Es el PUNTO UNICO del criterio (R6): lo consumen el cron SLA (99, `DevolucionSlaService`),
   * el drawer de historial (47, `obtenerHistorial`) y —via `contarIntentosEnLote`— todas las
   * superficies que muestran la orden.
   *
   * Cuenta los CIERRES APROBADOS DISTINTOS en los que la orden tuvo un resultado de gestion
   * VIGENTE de los que cuentan (`rechazada`/`devuelta`/`reprogramada`). Ya NO cuenta
   * transiciones del historial. La FIRMA no cambio con la 215; lo que cambio es el NUMERO que
   * devuelve, y eso gobierna dinero real (`rechazada` -> `cobroRechazado`, 56).
   */
  contarIntentos(ordenId: string): Promise<number>;
  /**
   * Feature 215 (R4/R7/R8) — el MISMO conteo para un LOTE de ordenes, resuelto con UNA sola
   * consulta (ya no hace falta leer el catalogo de estados: el criterio se expresa sobre enums).
   * Lo consumen los servicios de lectura que alimentan las superficies paginadas.
   *
   * Las ordenes sin intentos NO vienen en el Map; el llamador emite `?? 0` (R8: el `0` es un
   * valor conocido, no un dato ausente). `ordenIds` vacio -> Map vacio sin consultar (R7).
   */
  contarIntentosEnLote(ordenIds: string[]): Promise<Map<string, number>>;
}
