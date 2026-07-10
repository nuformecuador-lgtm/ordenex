import type { UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ActualizarUsuarioInput,
  CambiarEstadoUsuarioInput,
  CrearUsuarioInput,
  ListarUsuariosInput,
  UsuarioListItemDTO,
} from "@/lib/types/usuario";

// Feature 25. Se reutiliza el `Actor` de IOrdenService (`{ usuarioId, rol }`),
// resuelto desde la sesion (R1). Ningun result expone `passwordHash` (R12/R24).
export type { Actor };

// R33/R35: `generatedPassword` SOLO presente en modo autogenerado; nunca en modo
// manual ni en ninguna otra operacion.
export type CrearUsuarioServiceResult =
  | { status: "ok"; usuario: UsuarioPublico; generatedPassword?: string }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R9: catalogo
  | { status: "conflict"; campo: "email" | "cedula" } // R10/R11
  | { status: "forbidden" }; // R3/R4

export type ListarUsuariosServiceResult =
  | { status: "ok"; items: UsuarioListItemDTO[]; page: number; pageSize: number; total: number }
  | { status: "forbidden" };

export type ObtenerUsuarioServiceResult =
  | { status: "ok"; usuario: UsuarioPublico }
  | { status: "forbidden" }
  | { status: "not_found" };

export type ActualizarUsuarioServiceResult =
  | { status: "ok"; usuario: UsuarioPublico }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R18: catalogo
  | { status: "forbidden" }
  | { status: "not_found" }; // R17

export type CambiarEstadoUsuarioServiceResult =
  | { status: "ok"; usuario: UsuarioPublico }
  | { status: "forbidden" }
  | { status: "not_found" }; // R22

export type ListarTiposIdentificacionServiceResult =
  | { status: "ok"; tipos: { id: string; value: string }[] }
  | { status: "forbidden" };

export interface IUsuarioService {
  crear(input: CrearUsuarioInput, actor: Actor): Promise<CrearUsuarioServiceResult>;
  listar(input: ListarUsuariosInput, actor: Actor): Promise<ListarUsuariosServiceResult>;
  obtener(id: string, actor: Actor): Promise<ObtenerUsuarioServiceResult>;
  actualizar(
    id: string,
    input: ActualizarUsuarioInput,
    actor: Actor,
  ): Promise<ActualizarUsuarioServiceResult>;
  cambiarEstado(
    id: string,
    input: CambiarEstadoUsuarioInput,
    actor: Actor,
  ): Promise<CambiarEstadoUsuarioServiceResult>;
  listarTiposIdentificacion(actor: Actor): Promise<ListarTiposIdentificacionServiceResult>;
}
