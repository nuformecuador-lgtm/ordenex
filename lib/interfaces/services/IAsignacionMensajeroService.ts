import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { MensajeroDTO, ResumenCargaOrdenDTO } from "@/lib/types/asignacion-mensajero";

// Feature 16 — contrato del servicio de asignacion de mensajero sugerido.
// Resultados discriminados de dominio (patron IOrdenService), sin acoplarse a
// HTTP; el borde (Server Action) los traduce a ActionError.

export type ListarMensajerosServiceResult =
  | { status: "ok"; mensajeros: MensajeroDTO[] }
  | { status: "forbidden" };

export type ResumenCargaMasivaServiceResult =
  | { status: "ok"; ordenes: ResumenCargaOrdenDTO[] }
  | { status: "forbidden" };

export type AsignarMensajeroSugeridoServiceResult =
  | { status: "ok"; asignadas: number }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" };

export interface IAsignacionMensajeroService {
  /** R1/R5: mensajeros activos para el select; adminTienda/maestro/admin -> ok. */
  listarMensajeros(actor: Actor): Promise<ListarMensajerosServiceResult>;
  /** R6/R11: resumen del lote (num_remision -> orden), solo adminTienda, tienda propia. */
  resumenCargaMasiva(
    input: { numRemisiones: string[] },
    actor: Actor,
  ): Promise<ResumenCargaMasivaServiceResult>;
  /** R12-R18: asigna mensajero_sugerido_id por lote, todo-o-nada por tienda. */
  asignarMensajeroSugerido(
    input: { asignaciones: { ordenId: string; mensajeroId: string }[] },
    actor: Actor,
  ): Promise<AsignarMensajeroSugeridoServiceResult>;
}
