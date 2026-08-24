import type { OrdenHistorialCorreccionDiaDTO } from "@/lib/types/orden-historial";

/**
 * FEATURE 262 (B25, design §14.2) — LECTURA del rastro de correcciones del dia de reparto
 * (`orden_dia_reparto_cambio`).
 *
 * POR QUE UN REPOSITORIO PROPIO Y NO UN METODO MAS EN `IOrdenHistorialRepository`: son TABLAS
 * DISTINTAS. Aquel repo es el de `orden_historial_estado` y ademas es el CHOKE POINT DEL APPEND
 * de estados; colgarle una lectura de otra tabla difumina justamente el limite que hace que ese
 * choke point signifique algo.
 *
 * SOLO LECTURA. La escritura de esta tabla tiene su propio choke point y es el UNICO que existe
 * (`lib/repositories/registrar-cambio-dia-reparto.ts`, B4/R22). Este contrato no declara ningun
 * metodo de escritura a proposito: la tabla es append-only (R23) y un segundo escritor seria un
 * bug.
 */
export interface IOrdenDiaRepartoCambioRepository {
  /**
   * R37/R40 — las correcciones de UNA orden, en orden `created_at ASC, id ASC`, ya mapeadas a
   * DTO legible (nombre del actor resuelto, las dos fechas serializadas a `YYYY-MM-DD`).
   *
   * EL DESEMPATE POR `id` NO ES ADORNO: sin el, dos filas del mismo instante salen en orden
   * INDEFINIDO y la linea de tiempo cambiaria entre dos recargas. Es el mismo motivo por el que
   * `findOrigenesReversion` añadio su `id DESC` (149/Q3).
   *
   * Sin correcciones -> lista vacia (no es un error: es el caso normal, R45).
   */
  findCorreccionesByOrden(ordenId: string): Promise<OrdenHistorialCorreccionDiaDTO[]>;
}
