import type { RolValue } from "@prisma/client";
import type {
  CrearOrdenInput,
  ActualizarOrdenInput,
  ListarOrdenesInput,
  OrdenDTO,
  OrdenListItemDTO,
} from "@/lib/types/orden";

// Actor autenticado que ejecuta la operacion. El rol se resuelve desde la sesion
// (R19) y determina la autorizacion (matriz R20-R24).
export interface Actor {
  usuarioId: string;
  rol: RolValue;
}

// Resultados de dominio del servicio (sin acoplarse a HTTP). El borde (Server
// Action) los traduce al resultado tipado expuesto (R42).
export type CrearOrdenServiceResult =
  | { status: "ok"; orden: OrdenDTO }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }
  | { status: "conflict" };

export type ObtenerOrdenServiceResult =
  | { status: "ok"; orden: OrdenDTO }
  | { status: "forbidden" }
  | { status: "not_found" };

export type ListarOrdenesServiceResult =
  | { status: "ok"; items: OrdenListItemDTO[]; page: number; pageSize: number; total: number }
  | { status: "forbidden" };

export type ActualizarOrdenServiceResult =
  | { status: "ok"; orden: OrdenDTO }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }
  | { status: "not_found" };

export type BorrarOrdenServiceResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" };

export interface IOrdenService {
  crear(input: CrearOrdenInput, actor: Actor): Promise<CrearOrdenServiceResult>;
  obtener(id: string, actor: Actor): Promise<ObtenerOrdenServiceResult>;
  listar(input: ListarOrdenesInput, actor: Actor): Promise<ListarOrdenesServiceResult>;
  actualizar(
    id: string,
    input: ActualizarOrdenInput,
    actor: Actor,
  ): Promise<ActualizarOrdenServiceResult>;
  borrar(id: string, actor: Actor): Promise<BorrarOrdenServiceResult>;
}
