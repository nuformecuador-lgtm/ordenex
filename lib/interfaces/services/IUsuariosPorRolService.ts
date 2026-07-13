import type { RolValue } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";

// Contrato del servicio generico de listado de usuarios por rol. Resultado
// discriminado de dominio (patron IAsignacionMensajeroService), sin acoplarse a
// HTTP; el borde (Server Action) lo traduce a ActionError.
export type ListarUsuariosPorRolServiceResult =
  | { status: "ok"; usuarios: UsuarioPorRolDTO[] }
  | { status: "forbidden" };

export interface IUsuariosPorRolService {
  /** Lista usuarios activos del rol pedido (proyeccion id/nombre); autoriza por actor. */
  listarPorRol(rolValue: RolValue, actor: Actor): Promise<ListarUsuariosPorRolServiceResult>;
  /** Atajo: usuarios activos con rol `adminTienda` (misma estrategia que mensajeros). */
  listarAdminTiendas(actor: Actor): Promise<ListarUsuariosPorRolServiceResult>;
}
