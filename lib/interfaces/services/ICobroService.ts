import type { RolValue } from "@prisma/client";
import type {
  ActualizarCobroInput,
  CobroDTO,
  CrearCobroInput,
  ListarCobrosInput,
} from "@/lib/types/cobro";

// Actor autenticado que ejecuta la operacion. El rol se resuelve desde la
// sesion (R9) y determina la autorizacion (matriz R10-R13).
export interface Actor {
  usuarioId: string;
  rol: RolValue;
}

// Resultados de dominio del servicio (sin acoplarse a HTTP). El borde (Server
// Action) los traduce al resultado tipado expuesto (R26). Sin estado
// `conflict` (id es uuid, nombre no es unico).
export type CrearCobroServiceResult =
  | { status: "ok"; cobro: CobroDTO }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" };

export type ObtenerCobroServiceResult =
  | { status: "ok"; cobro: CobroDTO }
  | { status: "forbidden" }
  | { status: "not_found" };

export type ListarCobrosServiceResult =
  | { status: "ok"; items: CobroDTO[]; page: number; pageSize: number; total: number }
  | { status: "forbidden" };

export type ActualizarCobroServiceResult =
  | { status: "ok"; cobro: CobroDTO }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }
  | { status: "not_found" };

export type BorrarCobroServiceResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" };

export interface ICobroService {
  crear(input: CrearCobroInput, actor: Actor): Promise<CrearCobroServiceResult>;
  obtener(id: string, actor: Actor): Promise<ObtenerCobroServiceResult>;
  listar(input: ListarCobrosInput, actor: Actor): Promise<ListarCobrosServiceResult>;
  actualizar(
    id: string,
    input: ActualizarCobroInput,
    actor: Actor,
  ): Promise<ActualizarCobroServiceResult>;
  borrar(id: string, actor: Actor): Promise<BorrarCobroServiceResult>;
}
