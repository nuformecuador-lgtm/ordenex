import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ListarPostulacionesInput,
  PostulacionPendienteDTO,
} from "@/lib/types/aprobacion-postulacion";

// Feature 22 — contrato del servicio de aprobacion de postulaciones. Resultados
// de dominio discriminados por `status` (sin acoplarse a HTTP); el borde (Server
// Action) los traduce al resultado tipado que consume la UI (R20). Reusa `Actor`
// de IOrdenService (rol resuelto desde la sesion).

export type ListarPendientesServiceResult =
  | {
      status: "ok";
      items: PostulacionPendienteDTO[];
      page: number;
      pageSize: number;
      total: number;
    }
  | { status: "forbidden" };

export type DecisionServiceResult =
  | { status: "ok"; usuarioId: string; estado: "activo" | "inactivo" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "conflict" };

export interface IAprobacionPostulacionService {
  /** R2/R3/R5/R6-R11: lista postulaciones pendientes paginadas con URLs firmadas. */
  listarPendientes(
    input: ListarPostulacionesInput,
    actor: Actor,
  ): Promise<ListarPendientesServiceResult>;
  /** R2/R3/R5/R12-R15: aprueba (pendiente -> activo). */
  aprobar(usuarioId: string, actor: Actor): Promise<DecisionServiceResult>;
  /** R2/R3/R5/R16-R19: rechaza (pendiente -> inactivo). */
  rechazar(usuarioId: string, actor: Actor): Promise<DecisionServiceResult>;
}
