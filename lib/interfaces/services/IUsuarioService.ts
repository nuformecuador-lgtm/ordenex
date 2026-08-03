import type { RolItem, UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ActualizarUsuarioInput,
  CambiarEstadoUsuarioInput,
  CrearUsuarioInput,
  ListarUsuariosCompletoInput,
  ListarUsuariosInput,
  UsuarioListItemDTO,
} from "@/lib/types/usuario";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";

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

// Feature 170 (T H.2): reexpresado sobre el contrato comun de listado paginado
// (`lib/types/listado-paginado`). Misma forma, una sola definicion.
export type ListarUsuariosServiceResult = ListarPaginadoServiceResult<UsuarioListItemDTO>;

/**
 * Feature 170 (T B.1) — lectura SIN paginacion para la descarga del dataset completo.
 * Mismo servicio que `listar` para heredar su autorizacion (solo `maestro`), de modo que
 * ni `limite_excedido` ni `forbidden` puedan viajar con filas (R17/R27).
 */
export type ListarUsuariosCompletoServiceResult =
  ListarCompletoServiceResult<UsuarioListItemDTO>;

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

export type ListarRolesServiceResult =
  | { status: "ok"; roles: RolItem[] }
  | { status: "forbidden" };

export interface IUsuarioService {
  crear(input: CrearUsuarioInput, actor: Actor): Promise<CrearUsuarioServiceResult>;
  listar(input: ListarUsuariosInput, actor: Actor): Promise<ListarUsuariosServiceResult>;
  /**
   * Feature 170/R9: el MISMO listado sin recorte por pagina, para la descarga. Mismo
   * guard de rol, misma consulta y mismo criterio de orden que `listar`; solo cambian el
   * `skip` (0) y el `take` (tope + 1), y se anade el guard del tope (R27/R29).
   */
  listarCompleto(
    input: ListarUsuariosCompletoInput,
    actor: Actor,
  ): Promise<ListarUsuariosCompletoServiceResult>;
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
  listarRoles(actor: Actor): Promise<ListarRolesServiceResult>;
}
