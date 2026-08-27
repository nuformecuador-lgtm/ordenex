import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DetalleConflicto } from "@/lib/interfaces/services/IGuiaAsignacionService";

// Feature «eliminar orden» (2026-08-26) — contrato del BORRADO LOGICO de ordenes.
//
// Servicio PROPIO y no un metodo mas de `IOrdenService`: aquel es SOLO LECTURAS desde el
// 2026-08-07 (ver su cabecera) y la escritura de ordenes vive, por convencion de este repo, en
// un servicio de dominio por accion (`DeshacerAsignacionService`, `RecuperacionBodegaService`,
// ...). Esta es una accion mas de esa familia.
//
// POR QUE LOGICO Y NO FISICO: `orden` es el centro del grafo (historial de estados, notas,
// incidentes, cierres, liquidaciones, movimientos de wallet). Un DELETE fisico o bien arrastra
// evidencia contable en cascada o bien rompe FKs. La columna `deleted_at` ya existia desde
// `20260709130100_ordenes` y TODAS las lecturas del sistema ya la filtran; lo unico que faltaba
// —desde que el chore de deuda del 2026-08-07 retiro `OrdenRepository.softDelete` por quedarse
// sin pantalla— era el WRITER y su superficie.

export interface EliminarOrdenInput {
  /** Lote no vacio de ids de orden. El service DEDUPLICA antes de tocar nada. */
  ordenIds: string[];
}

/**
 * `eliminadas` es lo que el SERVIDOR cambio, no el tamano del lote pedido: puede ser menor si
 * otra sesion borro alguna orden entre la precarga y el `updateMany` (carrera benigna, el
 * `where` incluye `deleted_at IS NULL`).
 */
export type EliminarOrdenServiceResult =
  | { status: "ok"; eliminadas: number }
  | { status: "forbidden" }
  | { status: "conflict"; detalle: DetalleConflicto[] };

export interface IEliminarOrdenService {
  eliminar(
    input: EliminarOrdenInput,
    actor: Actor,
  ): Promise<EliminarOrdenServiceResult>;
}
