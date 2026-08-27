import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DetalleConflicto } from "@/lib/interfaces/services/IGuiaAsignacionService";

// Pedido humano (2026-08-27) — contrato de la REVERSION del borrado logico: `deleted_at` vuelve
// a NULL y la orden reaparece en todos los listados exactamente donde estaba.
//
// SERVICIO PROPIO y no un segundo metodo de `IEliminarOrdenService`, por la convencion que ese
// mismo archivo declara: en este repo la escritura de ordenes vive en UN servicio de dominio POR
// ACCION (`DeshacerAsignacionService`, `RecuperacionBodegaService`, ...). Borrar y recuperar
// COMPARTEN columna pero no comparten reglas — el borrado exige que nadie haya gestionado la
// orden, la recuperacion no exige nada de eso (lo que se deshace es el borrado, no la gestion)
// — y meterlos juntos habria acabado en un metodo con un booleano y dos ramas de autorizacion.
//
// LO QUE SI COMPARTEN, y por eso no se duplica: el rol autorizado (`maestro`), la precarga
// (`findByIdsForTransicion`, que incluye las borradas) y los motivos tipados
// (`lib/services/mensajes-eliminar-orden.ts`).

export interface RecuperarOrdenInput {
  /** Lote no vacio de ids de orden BORRADA. El service DEDUPLICA antes de tocar nada. */
  ordenIds: string[];
}

/**
 * `recuperadas` es lo que el SERVIDOR cambio, no el tamaño del lote pedido: puede ser menor si
 * otra sesion recupero alguna entre la precarga y el `updateMany` (carrera benigna, el `where`
 * incluye `deleted_at IS NOT NULL`).
 */
export type RecuperarOrdenServiceResult =
  | { status: "ok"; recuperadas: number }
  | { status: "forbidden" }
  | { status: "conflict"; detalle: DetalleConflicto[] };

export interface IRecuperarOrdenService {
  recuperar(
    input: RecuperarOrdenInput,
    actor: Actor,
  ): Promise<RecuperarOrdenServiceResult>;
}
