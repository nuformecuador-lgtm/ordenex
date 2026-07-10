import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RawRow } from "@/lib/parsers/spreadsheet";
import type { BulkSummary } from "@/lib/types/carga-masiva";

// R11: resultado discriminado. La autorizacion NO lanza; el borde (Route
// Handler) traduce "forbidden" a un AppErrorShape (feature 10).
export type BulkOrdenResult = { status: "ok"; summary: BulkSummary } | { status: "forbidden" };

export interface IBulkOrdenService {
  /**
   * Procesa las filas ya parseadas de un archivo de carga masiva: autoriza
   * (SOLO adminTienda, R11), resuelve/valida cada fila (R18-R23), deduplica
   * (R25/R26), persiste en lotes (R27) con exito parcial (R29) y arma el
   * resumen (R30). Nunca lanza por autorizacion; SI puede lanzar por fallos
   * inesperados de infraestructura (el borde los normaliza a INTERNAL).
   */
  cargarMasiva(rows: RawRow[], actor: Actor): Promise<BulkOrdenResult>;
}
