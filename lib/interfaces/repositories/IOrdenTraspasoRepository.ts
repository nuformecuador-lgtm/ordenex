import type { OrdenHistorialTraspasoDTO } from "@/lib/types/orden-historial";

/**
 * FICHA 427 (T20, design §9) — LECTURA del rastro de traspasos de una orden entre mensajeros
 * (`orden_traspaso_mensajero`).
 *
 * POR QUE UN REPOSITORIO PROPIO Y NO UN METODO MAS EN `IOrdenHistorialRepository`: son TABLAS
 * DISTINTAS, y ese repo es ademas el CHOKE POINT DEL APPEND de estados; colgarle la lectura de otra
 * tabla difumina justamente el limite que hace que ese choke point signifique algo. Es la MISMA
 * decision, con el mismo argumento, que tomo `IOrdenDiaRepartoCambioRepository` (262) — esta es su
 * tercera hermana.
 *
 * SOLO LECTURA. La escritura de esta tabla tiene su propio choke point y es el UNICO que existe
 * (`lib/repositories/registrar-traspaso-mensajero.ts`, T6), que ademas exige un `tx` como primer
 * parametro. Este contrato no declara ningun metodo de escritura a proposito: la tabla es
 * append-only (R30) y un segundo escritor seria un bug.
 */
export interface IOrdenTraspasoRepository {
  /**
   * R29/R30 — los traspasos de UNA orden, en orden `created_at ASC, id ASC`, ya mapeados a DTO
   * legible (los TRES nombres resueltos y el rol del actor CONGELADO tal como lo guardo la fila).
   *
   * EL DESEMPATE POR `id` NO ES ADORNO: un acto de traspaso escribe N filas dentro de la MISMA
   * transaccion, asi que todas comparten el `CURRENT_TIMESTAMP` del inicio de esa transaccion. Sin
   * el desempate, dos traspasos de la misma orden en el mismo instante saldrian en orden INDEFINIDO
   * y la linea de tiempo cambiaria entre dos recargas. Mismo motivo que en la 262 y en la 149/Q3.
   *
   * Sin traspasos -> lista vacia (no es un error: es el caso normal de casi todas las ordenes).
   */
  findTraspasosByOrden(ordenId: string): Promise<OrdenHistorialTraspasoDTO[]>;
}
