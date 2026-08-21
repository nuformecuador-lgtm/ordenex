import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ListarPostulacionesRecursoInput,
  PostulacionRecursoDTO,
  PostulacionRecursoInput,
} from "@/lib/types/postulacion-recurso";

// Feature 253 (T3.1, design §5) — contrato del servicio de postulaciones de recurso. Resultados de
// dominio discriminados por `status`, SIN acoplarse a HTTP: el borde (Server Action) los traduce.
// Reusa `Actor` de IOrdenService (rol resuelto desde la sesion).

/**
 * R1/R2: la escritura publica solo tiene dos desenlaces. No se distingue el motivo del fallo hacia
 * fuera —la persona que postula no puede hacer nada con un codigo interno— y el error real queda
 * registrado por el logger global, sin PII (R19).
 */
export type RegistrarPostulacionRecursoResult = { status: "ok" } | { status: "error" };

export type ListarPostulacionesRecursoServiceResult =
  | {
      status: "ok";
      items: PostulacionRecursoDTO[];
      page: number;
      pageSize: number;
      total: number;
    }
  | { status: "forbidden" };

export type AtenderPostulacionRecursoServiceResult =
  | { status: "ok"; id: string; atendidaAt: string }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "conflict" };

export interface IPostulacionRecursoService {
  /**
   * R1/R20/R24: normaliza, delega en el repositorio y envuelve el fallo. **NO crea usuario, ni
   * sesion, ni fila en `usuario`**: no hay actor y no hay nada que autorizar, es publica.
   */
  registrar(input: PostulacionRecursoInput): Promise<RegistrarPostulacionRecursoResult>;

  /** R27/R28/R30/R33: autoriza por rol ANTES de tocar datos y pagina el listado. */
  listar(
    input: ListarPostulacionesRecursoInput,
    actor: Actor,
  ): Promise<ListarPostulacionesRecursoServiceResult>;

  /** R27/R28/R31/R32: autoriza, aplica el update condicional y distingue `not_found` de `conflict`. */
  atender(id: string, actor: Actor): Promise<AtenderPostulacionRecursoServiceResult>;
}
